/*
 * TV URL Remote - script injected by TizenBrew into every page.
 * Plain ES5 on purpose: must run on old Tizen Chromium (47+).
 * Never uses innerHTML so Trusted Types sites can't block it.
 *
 * - Reads its config (API URL, token, nav toggle, last version) from a
 *   "tvurl=" payload the launcher adds to the URL, then keeps it in
 *   sessionStorage for further same-origin pages.
 * - Polls GET /state every 5s and navigates when the version changes.
 * - Remote Back key -> history.back() unless the site handled it.
 * - Fallback spatial navigation when the site doesn't handle arrows.
 */
(function (root) {
  'use strict';

  if (root.TVURL) return; // already injected in this page

  var PAYLOAD_PARAM = 'tvurl';
  var STORAGE_KEY = 'tvurl-config';
  var POLL_MS = 5000;
  var REQUEST_TIMEOUT_MS = 4000;
  var EDGE_TOLERANCE = 2;
  var ORTHO_WEIGHT = 3;
  var KEY_ENTER = 13;
  var KEY_BACK = 10009;
  var SEEK_SECONDS = 10;
  var BACK_RETRY_MS = 4000; // 2nd Back on a popup that didn't close navigates back
  // Remote keys -> player actions (media keys are registered in package.json).
  var PLAYER_KEYS = {
    13: 'toggle', 10252: 'toggle', 415: 'play', 19: 'pause',
    39: 'forward', 417: 'forward', 37: 'rewind', 412: 'rewind'
  };
  var MEDIA_KEYS = { 10252: true, 415: true, 19: true, 417: true, 412: true };
  var DIALOG_SELECTOR = [
    'dialog[open]', '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
    '[class*="modal"]', '[class*="popup"]', '[class*="dialog"]'
  ].join(',');
  // Poster-like elements that sites make clickable with JS only.
  var CARD_SELECTOR = '[class*="card"],[class*="poster"],[class*="tile"],[class*="slide"]';
  var DIRECTIONS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  var FOCUSABLE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary', '[tabindex]',
    '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]',
    '[role="option"]', '[onclick]'
  ].join(',');

  // ---------------------------------------------------------------------
  // Config payload (pure helpers, unit-tested)
  // ---------------------------------------------------------------------

  function isValidConfig(cfg) {
    return !!cfg && typeof cfg.api === 'string' && cfg.api !== '' &&
      typeof cfg.token === 'string' && cfg.token !== '';
  }

  function encodePayload(cfg) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
  }

  function decodePayload(text) {
    try {
      var cfg = JSON.parse(decodeURIComponent(escape(atob(text))));
      return isValidConfig(cfg) ? cfg : null;
    } catch (e) {
      return null;
    }
  }

  // Appends the payload in the hash, or in the query when the URL already
  // has a hash (so hash-based routers keep their route).
  function addPayload(url, cfg) {
    var param = PAYLOAD_PARAM + '=' + encodeURIComponent(encodePayload(cfg));
    var hashIndex = url.indexOf('#');
    if (hashIndex === -1) return url + '#' + param;
    var beforeHash = url.slice(0, hashIndex);
    var separator = beforeHash.indexOf('?') === -1 ? '?' : '&';
    return beforeHash + separator + param + url.slice(hashIndex);
  }

  // Returns { config: {...}, cleanUrl: 'url without payload' } or null.
  function extractPayload(url) {
    var match = new RegExp('([?&#])' + PAYLOAD_PARAM + '=([^&#]*)').exec(url);
    if (!match) return null;
    var config;
    try {
      config = decodePayload(decodeURIComponent(match[2]));
    } catch (e) {
      config = null;
    }
    if (!config) return null;

    var separator = match[1];
    var before = url.slice(0, match.index);
    var after = url.slice(match.index + match[0].length);
    if (separator !== '&' && after.charAt(0) === '&') {
      after = separator + after.slice(1);
    }
    return { config: config, cleanUrl: before + after };
  }

  function stripHash(url) {
    var hashIndex = url.indexOf('#');
    return hashIndex === -1 ? url : url.slice(0, hashIndex);
  }

  // ---------------------------------------------------------------------
  // Spatial navigation scoring (pure, unit-tested)
  // rects: { left, top, right, bottom }
  // ---------------------------------------------------------------------

  function rangeGap(aStart, aEnd, bStart, bEnd) {
    return Math.max(0, Math.max(aStart, bStart) - Math.min(aEnd, bEnd));
  }

  // Lower is better; -1 means "not in that direction".
  function scoreCandidate(from, to, dir) {
    var primary;
    var ortho;
    var centreOffset;
    if (dir === 'left' || dir === 'right') {
      primary = dir === 'right' ? to.left - from.right : from.left - to.right;
      ortho = rangeGap(from.top, from.bottom, to.top, to.bottom);
      centreOffset = Math.abs((from.top + from.bottom) - (to.top + to.bottom)) / 2;
    } else {
      primary = dir === 'down' ? to.top - from.bottom : from.top - to.bottom;
      ortho = rangeGap(from.left, from.right, to.left, to.right);
      centreOffset = Math.abs((from.left + from.right) - (to.left + to.right)) / 2;
    }
    if (primary < -EDGE_TOLERANCE) return -1;
    // centreOffset only breaks ties between equally placed candidates.
    return Math.max(0, primary) + ortho * ORTHO_WEIGHT + centreOffset * 0.01;
  }

  // candidates: [{ rect, item }] -> best item or null
  function chooseCandidate(fromRect, candidates, dir) {
    var best = null;
    var bestScore = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var score = scoreCandidate(fromRect, candidates[i].rect, dir);
      if (score >= 0 && score < bestScore) {
        bestScore = score;
        best = candidates[i].item;
      }
    }
    return best;
  }

  // For up/down, prefer candidates that are on screen horizontally, so moving
  // between poster rows doesn't jump to a card scrolled off to the side.
  function verticalPool(candidates, dir, view) {
    if (dir !== 'up' && dir !== 'down') return candidates;
    var visible = [];
    for (var i = 0; i < candidates.length; i++) {
      var r = candidates[i].rect;
      if (r.right > 0 && r.left < view.width) visible.push(candidates[i]);
    }
    return visible.length ? visible : candidates;
  }

  // ---------------------------------------------------------------------
  // Popups and player (pure, unit-tested)
  // ---------------------------------------------------------------------

  function isCloseLabel(text) {
    var label = String(text || '').replace(/^\s+|\s+$/g, '');
    if (/^[×✕✖xX]$/.test(label)) return true;
    return /^(close|chiudi|dismiss)\b/i.test(label);
  }

  function playerAction(keyCode) {
    return PLAYER_KEYS[keyCode] || null;
  }

  function applyPlayerAction(video, action) {
    if (action === 'toggle') action = video.paused ? 'play' : 'pause';
    if (action === 'play') {
      var promise = video.play();
      if (promise && promise['catch']) promise['catch'](function () { /* autoplay blocked */ });
    } else if (action === 'pause') {
      video.pause();
    } else if (action === 'forward') {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + SEEK_SECONDS);
    } else if (action === 'rewind') {
      video.currentTime = Math.max(0, video.currentTime - SEEK_SECONDS);
    }
  }

  // ---------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------

  // callback(errorMessage, state, httpStatus)
  function fetchState(cfg, callback) {
    var xhr = new XMLHttpRequest();
    var done = false;
    function finish(err, state, status) {
      if (done) return;
      done = true;
      callback(err, state, status);
    }
    try {
      // Cache-buster: static hosts like GitHub Pages (demo mode) cache for minutes.
      xhr.open('GET', cfg.api.replace(/\/+$/, '') + '/state?t=' + new Date().getTime(), true);
      xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.token);
      xhr.timeout = REQUEST_TIMEOUT_MS;
    } catch (e) {
      finish('request blocked: ' + e.message, null, 0);
      return;
    }
    xhr.onload = function () {
      if (xhr.status !== 200) {
        finish('HTTP ' + xhr.status, null, xhr.status);
        return;
      }
      try {
        finish(null, JSON.parse(xhr.responseText), 200);
      } catch (e) {
        finish('invalid JSON from server', null, xhr.status);
      }
    };
    xhr.onerror = function () { finish('network error (offline, CORS or CSP?)', null, 0); };
    xhr.ontimeout = function () { finish('timeout', null, 0); };
    xhr.send();
  }

  // ---------------------------------------------------------------------
  // Config storage (per origin, per tab)
  // ---------------------------------------------------------------------

  var memoryConfig = null; // used when sessionStorage throws (sandboxed pages)

  function loadConfig() {
    try {
      var raw = root.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        var cfg = JSON.parse(raw);
        if (isValidConfig(cfg)) return cfg;
      }
    } catch (e) { /* fall back to memory */ }
    return memoryConfig;
  }

  function saveConfig(cfg) {
    memoryConfig = cfg;
    try {
      root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) { /* memory copy is enough for this page */ }
  }

  // ---------------------------------------------------------------------
  // Navigation to the controlled URL
  // ---------------------------------------------------------------------

  function navigateTo(url, cfg) {
    var loc = root.location;
    if (stripHash(url) === stripHash(loc.href)) {
      // Same document: changing only the hash would not reload the page.
      if (url !== loc.href) root.history.replaceState(null, '', url);
      loc.reload();
      return;
    }
    loc.href = addPayload(url, cfg);
  }

  function isBackForwardLoad() {
    try {
      var perf = root.performance;
      var entries = perf.getEntriesByType && perf.getEntriesByType('navigation');
      if (entries && entries.length) return entries[0].type === 'back_forward';
      return perf.navigation.type === 2;
    } catch (e) {
      return false;
    }
  }

  // After Back/Forward the stored version may be old. Adopt the server's
  // version instead of navigating, or Back would bounce to the current URL.
  var adoptNextVersion = false;

  function startPolling(cfg) {
    adoptNextVersion = isBackForwardLoad();
    root.addEventListener('pageshow', function (e) {
      if (e.persisted) adoptNextVersion = true; // restored from back/forward cache
    }, false);

    function tick() {
      fetchState(cfg, function (err, state) {
        if (err) {
          if (root.console) root.console.warn('[tvurl] /state failed: ' + err);
        } else if (state && adoptNextVersion) {
          adoptNextVersion = false;
          cfg.v = state.version;
          saveConfig(cfg);
        } else if (state && state.version !== cfg.v) {
          cfg.v = state.version;
          saveConfig(cfg);
          if (state.url) {
            navigateTo(state.url, cfg);
            return; // page is unloading
          }
        }
        root.setTimeout(tick, POLL_MS);
      });
    }
    root.setTimeout(tick, POLL_MS);
  }

  // ---------------------------------------------------------------------
  // Keys: Back + fallback spatial navigation
  // ---------------------------------------------------------------------

  function isEditable(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      var nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'range', 'color', 'file'];
      return nonText.indexOf((el.type || '').toLowerCase()) === -1;
    }
    return !!el.isContentEditable;
  }

  // Single-line inputs: up/down always leave; left/right leave only when the
  // caret is already at that end. Textarea/select/contenteditable keep arrows.
  function canLeaveField(el, dir) {
    if (el.tagName !== 'INPUT') return false;
    if (dir === 'up' || dir === 'down') return true;
    var start;
    var end;
    try {
      start = el.selectionStart;
      end = el.selectionEnd;
    } catch (e) {
      return true; // types like email/number expose no caret position
    }
    if (start === null || start !== end) return start === null;
    return dir === 'left' ? start === 0 : start === el.value.length;
  }

  function isNativelyClickable(el) {
    var tag = el.tagName;
    return (tag === 'A' && el.hasAttribute('href')) || tag === 'BUTTON' ||
      tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY';
  }

  function isUsable(el) {
    if (el.disabled || el.getAttribute('tabindex') === '-1') return false;
    if (el.tagName === 'INPUT' && el.type === 'hidden') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var style = root.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function collectCandidates(exclude) {
    var doc = root.document;
    var nodes = doc.querySelectorAll(FOCUSABLE_SELECTOR);
    var list = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i] !== exclude && isUsable(nodes[i])) {
        list.push({ rect: nodes[i].getBoundingClientRect(), item: nodes[i] });
      }
    }
    // Poster cards clickable only via JS. Only the innermost ones count: a
    // card that wraps a real link/button or other cards is a container.
    var cards = doc.querySelectorAll(CARD_SELECTOR);
    for (i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card === exclude || card.matches(FOCUSABLE_SELECTOR)) continue;
      if (card.querySelector(FOCUSABLE_SELECTOR + ',' + CARD_SELECTOR)) continue;
      var r = card.getBoundingClientRect();
      if (r.width < 48 || r.height < 48 || !isUsable(card)) continue;
      list.push({ rect: r, item: card });
    }
    return list;
  }

  function firstVisible(candidates) {
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var r = candidates[i].rect;
      var inView = r.bottom > 0 && r.top < root.innerHeight && r.right > 0 && r.left < root.innerWidth;
      if (inView && (!best || r.top < best.rect.top || (r.top === best.rect.top && r.left < best.rect.left))) {
        best = candidates[i];
      }
    }
    return best ? best.item : null;
  }

  // Inline style via CSSOM: allowed even under a strict style-src CSP.
  // Outline sits inside the element so rows with overflow:hidden don't clip it.
  var HIGHLIGHT_STYLES = {
    'outline': '4px solid #00b2ff',
    'outline-offset': '-4px',
    'box-shadow': '0 0 24px 4px rgba(0, 178, 255, 0.8)'
  };

  var clearHighlight = null; // restores the last highlighted element

  function highlight(el) {
    // Don't rely on blur alone: it doesn't fire while the window lacks focus.
    if (clearHighlight) clearHighlight();
    var saved = {};
    var name;
    function set(prop, value) {
      saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
      el.style.setProperty(prop, value, 'important');
    }
    for (name in HIGHLIGHT_STYLES) {
      if (HIGHLIGHT_STYLES.hasOwnProperty(name)) set(name, HIGHLIGHT_STYLES[name]);
    }
    // Enlarge only elements without their own transform (carousels use it).
    if (root.getComputedStyle(el).transform === 'none') {
      set('transition', 'transform 0.15s');
      set('transform', 'scale(1.06)');
    }
    function restore() {
      el.removeEventListener('blur', restore, false);
      if (clearHighlight === restore) clearHighlight = null;
      for (var prop in saved) {
        if (saved.hasOwnProperty(prop)) el.style.setProperty(prop, saved[prop][0], saved[prop][1]);
      }
    }
    el.addEventListener('blur', restore, false);
    clearHighlight = restore;
  }

  function isFullyVisible(el) {
    var r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= root.innerHeight && r.right <= root.innerWidth;
  }

  function focusElement(el) {
    if (el.tabIndex < 0) el.setAttribute('tabindex', '-1'); // make div/span focusable
    el.focus();
    if (root.document.activeElement !== el) return;
    highlight(el);
    // Centre posters cut off at a row/screen edge. Old Chromium treats the
    // options object as `true` (align to top), which is still usable.
    if (!isFullyVisible(el)) el.scrollIntoView({ block: 'center', inline: 'center' });
  }

  function moveFocus(dir) {
    var doc = root.document;
    var current = doc.activeElement;
    var hasCurrent = current && current !== doc.body && current !== doc.documentElement;
    var candidates = collectCandidates(hasCurrent ? current : null);
    var view = { width: root.innerWidth, height: root.innerHeight };
    var target = hasCurrent ?
      chooseCandidate(current.getBoundingClientRect(), verticalPool(candidates, dir, view), dir) :
      firstVisible(candidates);

    if (target) {
      focusElement(target);
      return;
    }
    // Nothing in that direction: scroll so long pages stay readable.
    var step = Math.round((dir === 'up' || dir === 'down' ? root.innerHeight : root.innerWidth) * 0.4);
    var dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
    var dy = dir === 'up' ? -step : dir === 'down' ? step : 0;
    root.scrollBy(dx, dy);
  }

  function synthesizeClick(el) {
    var types = ['mousedown', 'mouseup', 'click'];
    for (var i = 0; i < types.length; i++) {
      var event = root.document.createEvent('MouseEvents');
      event.initMouseEvent(types[i], true, true, root, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
      el.dispatchEvent(event);
    }
  }

  // ---------------------------------------------------------------------
  // Back: close popups / fullscreen first, then go back
  // ---------------------------------------------------------------------

  function isShown(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.top >= root.innerHeight || r.right <= 0 || r.left >= root.innerWidth) return false;
    var style = root.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function findCloseControl(dialog) {
    var nodes = dialog.querySelectorAll('*');
    for (var i = 0; i < nodes.length && i < 500; i++) {
      var el = nodes[i];
      var label = el.getAttribute('aria-label') || el.getAttribute('title') ||
        (el.children.length === 0 ? el.textContent : '');
      var cls = el.getAttribute('class') || '';
      if ((isCloseLabel(label) || /(^|[^a-z])close/i.test(cls)) && isShown(el)) return el;
    }
    return null;
  }

  // Topmost visible popup: { dialog, close } or null. Later in the DOM wins.
  // Without a close control, only real overlays (dialog role or fixed
  // position) count, so a "popup-menu" in the page doesn't swallow Back.
  function findOpenDialog() {
    var doc = root.document;
    var nodes = doc.querySelectorAll(DIALOG_SELECTOR);
    var fallback = null;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var el = nodes[i];
      if (el === doc.body || el === doc.documentElement || !isShown(el)) continue;
      var close = findCloseControl(el);
      if (close) return { dialog: el, close: close };
      var isOverlay = el.tagName === 'DIALOG' || el.hasAttribute('role') || el.hasAttribute('aria-modal') ||
        root.getComputedStyle(el).position === 'fixed';
      if (!fallback && isOverlay) fallback = { dialog: el, close: null };
    }
    return fallback;
  }

  function sendEscape() {
    var target = root.document.activeElement || root.document.body;
    var types = ['keydown', 'keyup'];
    function code() { return 27; }
    for (var i = 0; i < types.length; i++) {
      var event;
      try {
        event = new root.KeyboardEvent(types[i], { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
      } catch (e) {
        event = root.document.createEvent('Event');
        event.initEvent(types[i], true, true);
      }
      try {
        Object.defineProperty(event, 'keyCode', { get: code });
        Object.defineProperty(event, 'which', { get: code });
      } catch (e) { /* key/code still set */ }
      target.dispatchEvent(event);
    }
  }

  function exitFullscreen() {
    var doc = root.document;
    if (!(doc.fullscreenElement || doc.webkitFullscreenElement)) return false;
    try {
      var result = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen();
      if (result && result['catch']) result['catch'](function () { /* already left */ });
    } catch (e) { /* not allowed */ }
    return true;
  }

  var lastPopupBack = { dialog: null, time: 0 };

  function handleBack() {
    var now = new Date().getTime();
    var open = findOpenDialog();
    var retry = open && open.dialog === lastPopupBack.dialog && now - lastPopupBack.time < BACK_RETRY_MS;
    if (open && !retry) {
      lastPopupBack = { dialog: open.dialog, time: now };
      if (open.close) synthesizeClick(open.close); else sendEscape();
      return;
    }
    lastPopupBack = { dialog: null, time: 0 };
    if (exitFullscreen()) return;
    root.history.back();
  }

  // ---------------------------------------------------------------------
  // Player keys
  // ---------------------------------------------------------------------

  // Largest loaded <video> covering at least a quarter of the viewport.
  function findActiveVideo() {
    var videos = root.document.getElementsByTagName('video');
    var minArea = root.innerWidth * root.innerHeight * 0.25;
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < videos.length; i++) {
      var r = videos[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (videos[i].readyState > 0 && area >= minArea && area > bestArea) {
        best = videos[i];
        bestArea = area;
      }
    }
    return best;
  }

  // Returns true when the key controlled a video. Enter/arrows only count
  // when nothing else is focused, so on-screen buttons stay clickable.
  function handlePlayerKey(key, active) {
    var action = playerAction(key);
    if (!action) return false;
    var video = findActiveVideo();
    if (!video) return false;
    if (!MEDIA_KEYS[key]) {
      var doc = root.document;
      var idle = !active || active === doc.body || active === doc.documentElement ||
        active === video || (active.contains && active.contains(video));
      if (!idle) return false;
    }
    applyPlayerAction(video, action);
    return true;
  }

  // Players usually live in iframes: key events then go to the iframe, so
  // Back is forwarded up to the top page, which owns history and popups.
  function listenForChildBack(onBack) {
    root.addEventListener('message', function (e) {
      if (!e.data || e.data.tvurl !== 'back' || !e.source || e.source.parent !== root) return;
      onBack();
    }, false);
  }

  function installFrameHandlers() {
    listenForChildBack(function () { root.parent.postMessage({ tvurl: 'back' }, '*'); });
    root.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) return;
      if (e.keyCode === KEY_BACK) {
        e.preventDefault();
        if (!exitFullscreen()) root.parent.postMessage({ tvurl: 'back' }, '*');
        return;
      }
      if (handlePlayerKey(e.keyCode, root.document.activeElement)) e.preventDefault();
    }, false);
  }

  function installKeyHandlers(navEnabled) {
    var focusAtStart = null;

    listenForChildBack(handleBack);

    // Capture phase runs before the site's handlers: remember where focus was.
    root.addEventListener('keydown', function () {
      focusAtStart = root.document.activeElement;
    }, true);

    // Bubble phase on window runs after the site's handlers. Only act when the
    // site didn't handle the key (no preventDefault, no stopPropagation, no
    // focus change of its own).
    root.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) return;
      var key = e.keyCode;
      var active = root.document.activeElement;

      if (key === KEY_BACK) {
        e.preventDefault();
        handleBack();
        return;
      }
      if (handlePlayerKey(key, active)) {
        e.preventDefault();
        return;
      }
      if (!navEnabled || active !== focusAtStart) return;

      var dir = DIRECTIONS[key];
      if (dir) {
        if (isEditable(active) && !canLeaveField(active, dir)) return; // let caret/select work
        e.preventDefault();
        moveFocus(dir);
        return;
      }
      if (key === KEY_ENTER && active && active !== root.document.body && !isNativelyClickable(active)) {
        e.preventDefault();
        synthesizeClick(active);
      }
    }, false);
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  var api = {
    addPayload: addPayload,
    extractPayload: extractPayload,
    encodePayload: encodePayload,
    decodePayload: decodePayload,
    scoreCandidate: scoreCandidate,
    chooseCandidate: chooseCandidate,
    fetchState: fetchState,
    isBackForwardLoad: isBackForwardLoad,
    verticalPool: verticalPool,
    isCloseLabel: isCloseLabel,
    playerAction: playerAction,
    applyPlayerAction: applyPlayerAction
  };
  root.TVURL = api;

  if (typeof root.document === 'undefined') return; // unit tests
  if (root.top !== root.self) { // TizenBrew also injects into iframes
    installFrameHandlers();
    return;
  }

  // Read the payload immediately, before an SPA router rewrites the URL.
  var found = extractPayload(root.location.href);
  if (found) {
    saveConfig(found.config);
    try {
      root.history.replaceState(root.history.state, '', found.cleanUrl);
    } catch (e) { /* URL keeps the payload; harmless */ }
  }

  function start() {
    var cfg = loadConfig();
    var isLauncher = root.document.documentElement.hasAttribute('data-tvurl-launcher');
    installKeyHandlers(!cfg || cfg.nav !== false);
    if (cfg && !isLauncher) startPolling(cfg);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', start, false);
  } else {
    start();
  }
}(typeof window !== 'undefined' ? window : this));
