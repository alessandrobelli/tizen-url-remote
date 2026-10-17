/*
 * Launcher page (TizenBrew websiteURL). Plain ES5.
 * First run: asks for server URL + token (stored in this origin's localStorage).
 * Then: fetches /state and opens the URL with the config payload attached,
 * so the injected tvurl.js on the target site can keep polling.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tvurl-launcher';
  var AUTO_OPEN_DELAY_MS = 3000;
  var RETRY_MS = 5000;
  var KEY_ENTER = 13;

  var statusEl = document.getElementById('status');
  var menuEl = document.getElementById('menu');
  var formEl = document.getElementById('settings');
  var apiEl = document.getElementById('api');
  var tokenEl = document.getElementById('token');
  var navEl = document.getElementById('nav');

  var pendingTimer = null;

  function loadConfig() {
    try {
      var cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return cfg && cfg.api && cfg.token ? cfg : null;
    } catch (e) {
      return null;
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) {
      setStatus('Could not save settings: ' + e.message, true);
    }
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'error' : '';
  }

  function cancelPending() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function showMenu(message) {
    cancelPending();
    formEl.className = 'hidden';
    menuEl.className = '';
    if (message) setStatus(message, false);
    document.getElementById('open').focus();
  }

  function showSettings(message, isError) {
    cancelPending();
    var cfg = loadConfig();
    apiEl.value = cfg ? cfg.api : '';
    tokenEl.value = cfg ? cfg.token : '';
    navEl.checked = cfg ? cfg.nav !== false : true;
    menuEl.className = 'hidden';
    formEl.className = '';
    setStatus(message || 'Enter your server details.', isError);
    apiEl.focus();
  }

  function openCurrent() {
    var cfg = loadConfig();
    if (!cfg) {
      showSettings();
      return;
    }
    cancelPending();
    setStatus('Contacting ' + cfg.api + ' ...', false);
    window.TVURL.fetchState(cfg, function (err, state, status) {
      if (status === 401) {
        showSettings('The server rejected the token. Check it and save again.', true);
        return;
      }
      if (err) {
        setStatus('Cannot reach the server (' + err + '). Retrying...', true);
        pendingTimer = setTimeout(openCurrent, RETRY_MS);
        return;
      }
      if (!state.url) {
        setStatus('No URL set yet. Send /url <link> to the bot. Waiting...', false);
        pendingTimer = setTimeout(openCurrent, RETRY_MS);
        return;
      }
      setStatus('Opening ' + state.url, false);
      var payload = { api: cfg.api, token: cfg.token, nav: cfg.nav !== false, v: state.version };
      location.href = window.TVURL.addPayload(state.url, payload);
    });
  }

  function startAutoOpen() {
    menuEl.className = '';
    setStatus('Opening in a moment... press any key for the menu.', false);
    document.getElementById('open').focus();
    pendingTimer = setTimeout(openCurrent, AUTO_OPEN_DELAY_MS);

    function interrupt() {
      document.removeEventListener('keydown', interrupt, true);
      if (pendingTimer) showMenu('Auto-open cancelled.');
    }
    document.addEventListener('keydown', interrupt, true);
  }

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var api = apiEl.value.replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
    var token = tokenEl.value.replace(/^\s+|\s+$/g, '');
    if (!/^https?:\/\/\S+$/.test(api)) {
      setStatus('Server URL must start with https:// (or http:// for local testing).', true);
      apiEl.focus();
      return;
    }
    if (!token) {
      setStatus('The token is required.', true);
      tokenEl.focus();
      return;
    }
    saveConfig({ api: api, token: token, nav: navEl.checked });
    openCurrent();
  }, false);

  // Enter on a checkbox would submit the form; toggle it instead.
  navEl.addEventListener('keydown', function (e) {
    if (e.keyCode === KEY_ENTER) {
      e.preventDefault();
      navEl.checked = !navEl.checked;
    }
  }, false);

  document.getElementById('open').addEventListener('click', openCurrent, false);
  document.getElementById('edit').addEventListener('click', function () { showSettings(); }, false);

  // Page restored from the back/forward cache: don't bounce straight back.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) showMenu('Welcome back.');
  }, false);

  if (!loadConfig()) {
    showSettings('First run: enter your server details.');
  } else if (window.TVURL.isBackForwardLoad()) {
    showMenu('Welcome back.');
  } else {
    startAutoOpen();
  }
}());
