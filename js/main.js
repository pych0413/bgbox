// ============================================================
// main.js — boots 桌遊盒.
//
//   const app = createApp({ narrator });
//   startShell(app, root, { narrator });
//
// Modules are imported dynamically and one by one, so while a piece of core
// is missing or broken the page shows what failed instead of a blank screen.
// ============================================================

const root = document.getElementById('app');

function showError(title, detail) {
  const box = document.createElement('div');
  box.className = 'boot';

  const emoji = document.createElement('div');
  emoji.className = 'boot-emoji';
  emoji.textContent = '🧀';

  const head = document.createElement('div');
  head.textContent = title;

  const msg = document.createElement('div');
  msg.className = 'boot-err';
  msg.textContent = detail;

  const retry = document.createElement('button');
  retry.className = 'btn btn-primary';
  retry.textContent = '重新載入';
  retry.addEventListener('click', () => location.reload());

  box.append(emoji, head, msg, retry);
  root.replaceChildren(box);
}

// `loader` is a thunk around a literal import('…?v=N'), so tools/bump-version.sh
// can find and restamp every specifier.
async function load(loader, what) {
  try {
    return await loader();
  } catch (err) {
    console.error(`[main] cannot load ${what}`, err);
    const wrapped = new Error(`載入唔到「${what}」`);
    wrapped.cause = err;
    throw wrapped;
  }
}

// ?as=<name> gives this tab its own identity (device id, seats, tokens), so two
// tabs of one browser behave as two phones. Testing aid only; without it the
// app uses plain localStorage. Device preferences (mute, motion grant) stay shared.
function testIdentityStorage() {
  let as = null;
  try { as = new URLSearchParams(location.search).get('as'); } catch { /* no URL */ }
  if (!as || !/^[\w-]{1,24}$/.test(as)) return undefined;
  const prefix = `as:${as}:`;
  const ls = globalThis.localStorage;
  return {
    getItem: (k) => ls.getItem(prefix + k),
    setItem: (k, v) => ls.setItem(prefix + k, v),
    removeItem: (k) => ls.removeItem(prefix + k),
  };
}

async function boot() {
  const { createNarrator } = await load(() => import('./core/narrator.js?v=1'), '旁白');
  const { createApp } = await load(() => import('./core/client.js?v=1'), '房間核心 core/client.js');
  const { startShell } = await load(() => import('./ui/shell.js?v=1'), '介面 ui/shell.js');

  const narrator = createNarrator();
  const app = createApp({ narrator, storage: testIdentityStorage() });
  window.__app = app;   // handy in the console; the shell never reads it
  await startShell(app, root, { narrator });
}

boot().catch((err) => {
  showError('桌遊盒未開得工', `${err?.message ?? err}${err?.cause ? ` — ${err.cause.message ?? err.cause}` : ''}`);
});
