# TV URL Remote

Show a web page on a Samsung TV (via [TizenBrew](https://github.com/reisxd/TizenBrew)) and change it from Telegram. The TV switches within ~5 seconds.

```
Telegram ──/url──▶ server (bot + API, Docker on Proxmox) ◀──GET /state every 5s── TV
                                                                                  │
                    TizenBrew opens launcher (GitHub Pages) ──▶ your URL ◀────────┘
                    and injects docs/tvurl.js into every page
```

| Part | Where | What |
|---|---|---|
| `server/` | Docker on your homelab | Telegram bot (`/url`, `/current`, `/reload`) + `GET /state` API, no npm dependencies |
| `docs/index.html`, `docs/launcher.js` | GitHub Pages | Launcher: first-run settings, then opens the current URL |
| `docs/tvurl.js` | injected by TizenBrew | Polls `/state`, navigates on change, Back key, fallback arrow-key navigation |
| `package.json` (root) | GitHub | The TizenBrew module manifest |

## How it works

- `GET /state` returns `{ "url": "...", "version": 7 }`. `version` increases on every `/url` and `/reload`; the TV navigates whenever it sees a new version (`/reload` reopens the same URL).
- TizenBrew downloads the module from GitHub via jsDelivr, so the repo must be **public**. It contains no secrets: the server URL and token are typed once on the TV and stored there.
- The launcher passes the settings to the opened site in a `#tvurl=...` (or `?tvurl=...`) fragment. `tvurl.js` saves them in that site's `sessionStorage` and immediately removes the fragment from the address bar.
- Arrow keys: `tvurl.js` only moves focus if the site didn't handle the key itself (no `preventDefault`, no focus change of its own). Enter clicks the focused element. Poster cards that are clickable only through JavaScript (class names containing card/poster/tile/slide) are included. Up/down prefers posters that are on screen, and a poster cut off at the edge of a row is scrolled to the centre.
- Back, unless the site handles it: closes a visible popup first (clicks its ×/Close control, or sends Escape), then leaves fullscreen, then goes to the previous page. If a popup doesn't close, a second Back within 4 s goes back anyway. From the first page, Back returns to the launcher menu.
- Player: when a video covers at least a quarter of the screen and nothing else is focused, Enter plays/pauses and ←/→ skip 10 s. The ⏯ ⏪ ⏩ media keys work whenever a video is on screen. This also works inside player iframes; Back pressed inside an iframe is passed to the page.
- Injected code is plain ES5, never uses `innerHTML` (works with Trusted Types), and styles the focus ring via CSSOM (works with a strict `style-src`).

## 1. Server (Proxmox LXC + Docker)

### 1.1 Create the Telegram bot
1. In Telegram, talk to **@BotFather** → `/newbot` → copy the bot token.
2. Find your chat ID: message **@userinfobot** (it replies with your ID). Alternative: start the server with any number as `TELEGRAM_CHAT_ID`, message your bot, and read `Ignoring message from chat <id>` in the logs.

### 1.2 Docker inside the LXC
In Proxmox: select the container → **Options → Features** → enable **nesting** (and **keyctl** for unprivileged containers) → restart it. Then in the container:

```bash
apt update && apt install -y curl git && curl -fsSL https://get.docker.com | sh
```

### 1.3 Run the server
```bash
git clone https://github.com/alessandrobelli/tizen-url-remote.git
cd tizen-url-remote/server
cp .env.example .env
openssl rand -hex 12          # 24 chars; paste as API_TOKEN in .env (you type it once on the TV)
nano .env                     # set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, API_TOKEN
docker compose up -d --build
docker compose logs -f        # expect "API listening on :3000" and "Telegram bot polling started"
```

State is kept in the `tv-url-data` volume, so the URL survives restarts.

### 1.4 HTTPS
The TV opens HTTPS sites, so it must reach the API over **HTTPS with a publicly trusted certificate** (a self-signed or homelab-CA certificate will not be trusted by the TV). Put your reverse proxy in front of port 3000, e.g. Caddy:

```
tv.example.com {
    reverse_proxy 192.168.1.50:3000
}
```

Check from any machine:

```bash
curl -H "Authorization: Bearer YOUR_API_TOKEN" https://tv.example.com/state
```

Then send `/url https://example.com` to your bot and run the `curl` again: `version` should have increased.

## 2. Publish the module (GitHub)

1. Create a **public** GitHub repo named `tizen-url-remote`.
2. In the root `package.json`, set `websiteURL` to `https://alessandrobelli.github.io/tizen-url-remote/`.
3. Push:
   ```bash
   git remote add origin https://github.com/alessandrobelli/tizen-url-remote.git
   git push -u origin main
   ```
4. Repo **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/docs` → Save. After a minute `https://alessandrobelli.github.io/tizen-url-remote/` shows the launcher.
5. Copy the latest commit hash (`git rev-parse --short HEAD`). You'll pin the module to it on the TV; jsDelivr caches aggressively, so pinning a commit is the only reliable way to get updates.

## 3. TV setup (Samsung QE55Q65C, Tizen 7.0)

### 3.1 Developer Mode
1. On the TV, open **Apps → App Settings** (on 2023 models this is **not** the Apps page itself), then press **1 2 3 4 5**. If your remote has no number buttons, use its **123** button to open the on-screen number pad.
2. Turn **Developer mode** **On**, enter your **PC's IP address** as Host PC IP, press OK.
3. Turn the TV off and on again (hold the power button until the Samsung logo appears for a full restart).

### 3.2 Install TizenBrew
1. On your PC, download **TizenBrew Installer** from https://github.com/reisxd/TizenBrewInstaller/releases/latest and run it (PC and TV on the same network).
2. Choose your TV and **Install TizenBrew**. Tizen 7 asks you to **sign in with a Samsung account** to create a certificate. This is required.
3. When installed: go back to **Apps → App Settings → 12345**, set **Host PC IP to `127.0.0.1`**, and restart the TV again (hold power). TizenBrew needs this to inject module scripts. If you see "Could not connect to the SDB Daemon", this step is missing.

### 3.3 Add the module
1. Open **TizenBrew** → **Module Manager** (icon in the header) → **Add GitHub Module**.
2. Type `alessandrobelli/tizen-url-remote@COMMIT_HASH` and move focus away from the field (it saves on blur).
3. Go back to the home screen and select **TV URL Remote**.
4. First run: enter the server URL (`https://tv.example.com`) and the API token, keep or untick arrow-key navigation, then **Save and open**. Settings are remembered.
5. Optional: TizenBrew **Settings → Autolaunch** to start this module when TizenBrew opens.

## Quick TV test without the server (demo mode)

You can test the module on the TV before setting up Telegram or Docker. Do sections 2 and 3 first, then:

1. On GitHub, edit `docs/demo/state` and replace `alessandrobelli` with your username. Commit, and wait about a minute for Pages to update.
2. On the TV's first-run screen, enter:
   - Server URL: `https://alessandrobelli.github.io/tizen-url-remote/demo`
   - Token: anything, e.g. `demo` (it isn't checked)
3. The demo page should open, showing **Injected script: yes**. Try the arrows, Enter (the "Last click" text updates), the text box, and Back.
4. Live switch: edit `docs/demo/state` on GitHub to `?page=2` and `"version": 2`, then commit. Within 1–2 minutes (the Pages deploy plus a 5 s poll) the TV reloads and the heading shows `?page=2`.
5. Optional: set the URL to an external site to check arrows and Back there. Live switching only works on the demo page itself, because GitHub Pages doesn't answer the API's cross-origin requests.

When the real server is running, go to the launcher menu → **Settings** and enter the real server URL and token.

## Usage

| Telegram | Effect |
|---|---|
| `/url https://example.com` | TV opens the link within ~5 s |
| `/current` | Shows the current link and version |
| `/reload` | TV reopens the current link |

On the TV:

| Key | Effect |
|---|---|
| Arrows | Move between links and poster cards (blue outline, slightly enlarged) |
| Enter | Click the focused item; on a video with nothing focused, play/pause |
| ← / → on a video | Skip 10 s back/forward |
| ⏯ ⏪ ⏩ | Play/pause, skip back/forward |
| Back | Close popup → leave fullscreen → previous page |

Pressing a key during the 3-second "Opening..." message on the launcher opens its menu (where Settings is). Pressing Back from the first opened page also returns to that menu.

## Updating the module

Push your change, then in TizenBrew's Module Manager remove the module and add it again with the new `@COMMIT_HASH`. Relaunch TizenBrew.

Always re-pin after **any** change under `docs/`. The launcher (from GitHub Pages, always latest `main`) relies on the injected `tvurl.js` (from the pinned commit). If they come from different commits, the launcher can break.

## Development (Windows, Node 20+)

```bash
npm install
```
```bash
npm test
```
```bash
npm run check:es5
```
```bash
cd server && npm test
```

Then run the end-to-end harness and open http://localhost:8080/ in Chrome:

```bash
npm run serve:test
```

It starts the real API on :3000 (token `local-test-token-123`), the launcher on :8080, and two test sites on :8081/:8082 that load `tvurl.js` the way TizenBrew injects it. Send bot commands without Telegram:
`http://localhost:3001/cmd?text=/url%20http://localhost:8082/`

## Known limitations

- **Sites with a strict `connect-src` CSP** can block the `/state` request; live switching stops on that site (the page still shows). There is no way around this from inside the page.
- **Settings are lost if a site redirects to another domain on its own** (e.g. login via a separate auth domain). Live switching stops on that page until you reopen it from the launcher.
- **Sites that handle arrow keys without `preventDefault()`** may see focus move twice. Disable arrow-key navigation in the launcher settings for those.
- The token is visible to scripts of the sites you open (it sits in their `sessionStorage`). It only grants reading the current URL, but don't reuse it elsewhere.

### Not verified yet

- **Tested so far:** unit tests (server + `tvurl.js` helpers), and an end-to-end run in a Chromium browser against the local harness. That run covered the launcher, a cross-origin live switch, `/reload`, Back, arrows, Enter and a wrong token.
- **Docker:** the image has not been built yet. Run `docker compose up -d --build` and check the logs.
- **Telegram:** only tested with a fake client. The first real `/url` is the live test.
- **On the TV, check:**
  - injection timing on hash-router sites (the `#tvurl=` fragment is removed quickly, but a router could read it first);
  - Back from the launcher reaching TizenBrew's home screen;
  - whether TizenBrew's own UI gets double focus moves from the injected arrow-key fallback after Back. If it does, `tvurl.js` should skip TizenBrew's own pages.
