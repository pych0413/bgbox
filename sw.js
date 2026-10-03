// sw.js — offline shell for 桌遊盒 (GitHub Pages project site, served from a subpath).
//
// Nothing here hard-codes '/': every URL is resolved against self.registration.scope, so the
// same file works at https://<user>.github.io/cheese-thief/ and on a local root server.
//
// Strategy
//   navigations, index.html     network-first (revalidates, 3.5 s timeout) -> cached shell offline
//   ?v=<stamp> .js / .css       cache-first (the URL changes whenever the content does)
//   other precached files       cache-first (manifest, icons; re-fetched with every SW version)
//   peerjs / qrcode CDN libs    cache-first, filled the first time they are used
//   everything else             not touched (PeerJS signalling, STUN/TURN, unknown origins)
//
// Updates: a new sw.js installs (full precache) and then WAITS. It takes over when every tab /
// home-screen window is closed, or earlier if the page sends { type: 'skip-waiting' }.
// It never swaps itself in mid-game: an already-running page keeps lazy-loading its modules
// from the cache of the version it started with, so a push during play cannot give it a
// half-old, half-new app.
//
// Register from index.html (plain 'sw.js': browsers always revalidate the worker script itself):
//
//   if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
//     navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
//       // an installed home-screen app is rarely reloaded: look for a new version on every resume
//       document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
//       // optional "new version" prompt, e.g. only offered on the home screen:
//       //   reg.waiting?.postMessage({ type: 'skip-waiting' });
//       //   navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
//     }).catch(() => {});
//   }
//
// While developing, stamps stay constant, so a cache-first worker would serve stale code. On
// localhost this worker therefore only passes requests through, unless it was registered as
// 'sw.js?force' (used to test the worker itself).
//
// tools/bump-version.sh rewrites VERSION and the PRECACHE block below. Do not edit them by hand.

const VERSION = '20261003102525'; // rewritten by tools/bump-version.sh

// BEGIN PRECACHE
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'css/base.css?v=20261003102525',
  'js/core/bag.js?v=20261003102525',
  'js/core/client.js?v=20261003102525',
  'js/core/engine-kit.js?v=20261003102525',
  'js/core/narrator.js?v=20261003102525',
  'js/core/net.js?v=20261003102525',
  'js/core/room.js?v=20261003102525',
  'js/core/session.js?v=20261003102525',
  'js/core/sfx.js?v=20261003102525',
  'js/core/shake.js?v=20261003102525',
  'js/core/transport.js?v=20261003102525',
  'js/core/util.js?v=20261003102525',
  'js/data/9upper-terms.js?v=20261003102525',
  'js/data/draw-words.js?v=20261003102525',
  'js/data/spyfall-locations.js?v=20261003102525',
  'js/data/undercover-words.js?v=20261003102525',
  'js/games/9upper/game.js?v=20261003102525',
  'js/games/9upper/index.js?v=20261003102525',
  'js/games/9upper/script.js?v=20261003102525',
  'js/games/9upper/style.css?v=20261003102525',
  'js/games/9upper/ui.js?v=20261003102525',
  'js/games/avalon/game.js?v=20261003102525',
  'js/games/avalon/index.js?v=20261003102525',
  'js/games/avalon/script.js?v=20261003102525',
  'js/games/avalon/style.css?v=20261003102525',
  'js/games/avalon/ui.js?v=20261003102525',
  'js/games/cheese-thief/game.js?v=20261003102525',
  'js/games/cheese-thief/index.js?v=20261003102525',
  'js/games/cheese-thief/script.js?v=20261003102525',
  'js/games/cheese-thief/style.css?v=20261003102525',
  'js/games/cheese-thief/ui.js?v=20261003102525',
  'js/games/custom/game.js?v=20261003102525',
  'js/games/custom/index.js?v=20261003102525',
  'js/games/custom/style.css?v=20261003102525',
  'js/games/custom/ui.js?v=20261003102525',
  'js/games/draw-guess/fold.js?v=20261003102525',
  'js/games/draw-guess/game.js?v=20261003102525',
  'js/games/draw-guess/index.js?v=20261003102525',
  'js/games/draw-guess/judge.js?v=20261003102525',
  'js/games/draw-guess/script.js?v=20261003102525',
  'js/games/draw-guess/style.css?v=20261003102525',
  'js/games/draw-guess/ui.js?v=20261003102525',
  'js/games/fake-artist/game.js?v=20261003102525',
  'js/games/fake-artist/index.js?v=20261003102525',
  'js/games/fake-artist/script.js?v=20261003102525',
  'js/games/fake-artist/style.css?v=20261003102525',
  'js/games/fake-artist/ui.js?v=20261003102525',
  'js/games/onuw/game.js?v=20261003102525',
  'js/games/onuw/index.js?v=20261003102525',
  'js/games/onuw/script.js?v=20261003102525',
  'js/games/onuw/style.css?v=20261003102525',
  'js/games/onuw/ui.js?v=20261003102525',
  'js/games/registry.js?v=20261003102525',
  'js/games/spyfall/game.js?v=20261003102525',
  'js/games/spyfall/index.js?v=20261003102525',
  'js/games/spyfall/style.css?v=20261003102525',
  'js/games/spyfall/ui.js?v=20261003102525',
  'js/games/undercover/game.js?v=20261003102525',
  'js/games/undercover/index.js?v=20261003102525',
  'js/games/undercover/style.css?v=20261003102525',
  'js/games/undercover/ui.js?v=20261003102525',
  'js/games/werewolf/game.js?v=20261003102525',
  'js/games/werewolf/index.js?v=20261003102525',
  'js/games/werewolf/script.js?v=20261003102525',
  'js/games/werewolf/style.css?v=20261003102525',
  'js/games/werewolf/ui.js?v=20261003102525',
  'js/main.js?v=20261003102525',
  'js/ui/components/Canvas.js?v=20261003102525',
  'js/ui/components/ConfigForm.js?v=20261003102525',
  'js/ui/components/Cover.js?v=20261003102525',
  'js/ui/components/DiceCup.js?v=20261003102525',
  'js/ui/components/NarratorBar.js?v=20261003102525',
  'js/ui/components/PassGate.js?v=20261003102525',
  'js/ui/components/PlayerPicker.js?v=20261003102525',
  'js/ui/components/RoleCard.js?v=20261003102525',
  'js/ui/components/RulesSheet.js?v=20261003102525',
  'js/ui/components/Scoreboard.js?v=20261003102525',
  'js/ui/components/SeatEditor.js?v=20261003102525',
  'js/ui/components/Timer.js?v=20261003102525',
  'js/ui/components/VotePanel.js?v=20261003102525',
  'js/ui/components/index.js?v=20261003102525',
  'js/ui/dom.js?v=20261003102525',
  'js/ui/hints.js?v=20261003102525',
  'js/ui/ink.js?v=20261003102525',
  'js/ui/logic.js?v=20261003102525',
  'js/ui/preflight.js?v=20261003102525',
  'js/ui/screens/home.js?v=20261003102525',
  'js/ui/screens/join.js?v=20261003102525',
  'js/ui/screens/lobby.js?v=20261003102525',
  'js/ui/screens/play.js?v=20261003102525',
  'js/ui/screens/results.js?v=20261003102525',
  'js/ui/settings.js?v=20261003102525',
  'js/ui/sheet.js?v=20261003102525',
  'js/ui/shell.js?v=20261003102525',
  'js/ui/status.js?v=20261003102525',
  'js/ui/timer.js?v=20261003102525',
];
// END PRECACHE

const SCOPE = self.registration.scope;                  // 'https://host/cheese-thief/'
const SCOPE_PATH = new URL(SCOPE).pathname;             // '/cheese-thief/'
const ORIGIN = new URL(SCOPE).origin;
const PREFIX = `bgb:${SCOPE_PATH}`;                     // namespaces our caches on a shared github.io origin
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;        // precache + stamped assets of this version
const LIB_CACHE = `${PREFIX}libs`;                      // CDN libs are version-pinned, so they outlive app versions
const ROOT_URL = SCOPE;
const INDEX_URL = new URL('index.html', SCOPE).href;
const PRECACHE_URLS = PRECACHE.map((p) => new URL(p, SCOPE).href);
const PRECACHED = new Set(PRECACHE_URLS);

const NETWORK_TIMEOUT_MS = 3500; // weak data: after this, a cached shell beats waiting
const LIB_HOSTS = new Set(['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com']);
const PASSTHROUGH = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname)
  && !self.location.search.includes('force');

const isShellDoc = (url) => url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`;
const isLibUrl = (url) => url.protocol === 'https:' && LIB_HOSTS.has(url.hostname)
  && /\/(peerjs|qrcode)/i.test(url.pathname);

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

self.addEventListener('install', (event) => {
  if (PASSTHROUGH) return;
  event.waitUntil(precache());
});

// All-or-nothing: if any file fails, install fails and the browser retries later, so a
// version is never half-cached. Unstamped files bypass the HTTP cache (GitHub Pages sets
// max-age=600); stamped ones may come from it, their URL already names the content.
async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(PRECACHE_URLS.map(async (href) => {
    const mode = href.includes('?v=') ? 'default' : 'reload';
    const res = await fetch(new Request(href, { cache: mode }));
    if (!res.ok) throw new Error(`precache ${res.status} ${href}`);
    await cache.put(href, res);
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, LIB_CACHE]);
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(PREFIX) && !keep.has(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'skip-waiting') self.skipWaiting();
  if (type === 'get-version' && event.source) event.source.postMessage({ type: 'version', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  if (PASSTHROUGH) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);

  if (url.origin !== ORIGIN) {
    if (isLibUrl(url)) event.respondWith(libFirst(event));
    return;
  }
  if (request.mode === 'navigate' || isShellDoc(url)) {
    event.respondWith(shellFirst(event, url));
  } else if (url.searchParams.has('v') || PRECACHED.has(url.href)) {
    event.respondWith(cacheFirst(event));
  }
});

async function shellFirst(event, url) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(event.request, { cache: 'no-cache' });
  // Registered first, so the body is cloned before the page starts reading it. Keeps the worker
  // alive for a slow response that arrives after the timeout fallback was already served.
  event.waitUntil(network.then((res) => {
    if (!isShellDoc(url) || !res.ok || res.type !== 'basic') return undefined;
    return Promise.all([cache.put(ROOT_URL, res.clone()), cache.put(INDEX_URL, res.clone())]);
  }).catch(() => {}));
  try {
    return await withTimeout(network, NETWORK_TIMEOUT_MS);
  } catch {
    const cached = (await cache.match(ROOT_URL)) || (await cache.match(INDEX_URL));
    return cached || network; // nothing cached yet: keep waiting for the network
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(event.request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok && res.type === 'basic') event.waitUntil(cache.put(event.request, res.clone()));
  return res;
}

// <script src="cdn..."> is a no-cors request, which would give an opaque response that cannot be
// checked for errors. Re-request it with CORS (jsDelivr/unpkg/cdnjs all allow it) so only a good
// response is cached; a CORS response may still be handed to the no-cors request.
async function libFirst(event) {
  const cache = await caches.open(LIB_CACHE);
  const key = event.request.url;
  const hit = await cache.match(key, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(key, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      event.waitUntil(cache.put(key, res.clone()));
      return res;
    }
  } catch { /* fall through to a plain request */ }
  return fetch(event.request);
}
