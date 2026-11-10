import { STICKERS, auditModule, bestTime, bumpStreak, cardKey, cloze, counts, coverage, dayStr, deadlinePlan, decoys, distractors, dueAcross, duplicatesAcross, esc, examScore, examSet, fmt, forecast, growPrompt, hash, ident, judgeTyped,
  letterTiles, mergeConfusions, mergeState, minutesFor, newCards, parseImport, pickSession, rankFor, reminderIcs, schedule, sharpenPrompt, shuffle, slowAfter, spellable, spreadDue, tagTotals, starred, toMarkdown, stickerEarned, troubleSpots,
  stickersFor, validateModule, weekSummary, weeklyTotals, maskHint, diffChars, quickBefore, yearSummary, listItems, ladderRung, briefPayload } from './core.js';

const KEY = 'pit.v1';
const app = document.getElementById('app');
const live = document.getElementById('live');
const bar = document.getElementById('bar');

const AVATARS = ['🦊', '🐙', '🦉', '🐝', '🦕', '🐬', '🦖', '🐧', '🦁', '🪐', '🚀', '🔭'];
// A learner picks the light in their own pit. The names are for the picker; each holds the
// two accents the whole interface is built from — once glowing on black, once dark enough to
// read on paper. An accent set inline beats the stylesheet, so the daylight pair has to live
// here too or a light theme is left with colours meant for a dark one.
const ACCENTS = {
  cyan:   { dark: ['#63e0ff', '#d99b63'], light: ['#0e6f92', '#8a5620'] },
  violet: { dark: ['#b98cff', '#ffb454'], light: ['#6b3fc4', '#8a5620'] },
  mint:   { dark: ['#5fe0b0', '#ffd166'], light: ['#127a5c', '#8a6a10'] },
  rose:   { dark: ['#ff8fa3', '#ffd6a5'], light: ['#b23050', '#8a5620'] },
  amber:  { dark: ['#ffc857', '#7ad7f0'], light: ['#8a6a10', '#0e6f92'] },
  lime:   { dark: ['#a9e34b', '#ff922b'], light: ['#3f7a12', '#a4530e'] },
};

function applyAccent() {
  const set = ACCENTS[opt().accent] || ACCENTS.cyan;
  const [accent, second] = document.documentElement.dataset.theme === 'light' ? set.light : set.dark;
  document.documentElement.style.setProperty('--cyan', accent);
  document.documentElement.style.setProperty('--copper', second);
}
const newProfile = (avatar = '◎') => ({
  srs: {},
  stats: { reviews: 0, correct: 0, streak: 0, lastDay: '', stars: 0, days: {}, hits: {} },
  opts: { avatar },      // opt() fills in the rest, and keeps filling it as options are added
});

// Per-learner switches: one tablet, several kids, different needs.
// Fills gaps in place and returns the SAME object every time — an earlier version rebuilt it
// on each call, so `opt().x = opt().y` wrote into an object that was already orphaned.
const OPT_DEFAULTS = { avatar: '◎', kid: false, sound: true, voice: '', size: 12, goal: 20, sort: '',
  lastAdd: '', theme: 'auto', lastGame: '', text: 100, rate: 0 };

function opt() {
  const p = P();
  const o = (p.opts ||= {});
  for (const [k, v] of Object.entries(OPT_DEFAULTS)) if (o[k] === undefined) o[k] = v;
  if (o.tts === undefined) o.tts = !!state.settings.tts;
  if (!Array.isArray(o.hidden)) o.hidden = [];
  return o;
}

// Every deliberate change to a learner's settings goes through here, because sync needs to
// know which device changed them last — a device that has only ever filled in defaults must
// not overwrite another one's real choices.
function setOpt(patch) {
  Object.assign(opt(), patch, { t: Date.now() });
  save();
}

// The modules this learner should see. Hiding is per profile: one tablet, several kids,
// and a five-year-old should not have to scroll past Logical Fallacies.
const visible = () => modules.filter(m => !opt().hidden.includes(m.id));

// "The test is on the 24th" is a fact about this learner, not about the module file.
const deadlines = () => (opt().deadlines ||= {});
const planFor = m => deadlinePlan(m.cards, P().srs, m.id, deadlines()[m.id]);
const blank = () => ({ active: 'Explorer', settings: { tts: false, clientId: '' }, profiles: { Explorer: newProfile() }, custom: [] });

let state = read();
let modules = [];
let session = null;
let view = { name: 'home' };
const stack = [];

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && s.profiles ? Object.assign(blank(), s) : blank();
  } catch { return blank(); }
}

// ---- media store ----
// localStorage holds about 5 MB and one picture module can pass that by itself. In memory, in
// a backup, in a share and in a sync the state keeps its shape — card.image and card.audio are
// inline data URIs — but on disk each blob lives once in IndexedDB and the JSON carries a
// pointer. The serialiser swaps them out; hydrate() puts them back at boot.
// ponytail: hash + length as the key — a 32-bit hash alone would collide eventually.
const MEDIA = 'pit.media';
const stored = new Set();          // blob keys already written, so a save does not rewrite them
const blobKey = v => 'idb:' + hash(v) + v.length.toString(36);
const isMedia = (k, v) => (k === 'image' || k === 'audio') && typeof v === 'string' && v.startsWith('data:');
function mediaDb() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no IndexedDB'));
    const r = indexedDB.open(MEDIA, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function mediaPut(entries) {
  const db = await mediaDb();
  await new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite');
    for (const [k, v] of entries) tx.objectStore('blobs').put(v, k);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  db.close();
  for (const [k] of entries) stored.add(k);
}
async function mediaGet(keys) {
  const out = new Map();
  if (!keys.length) return out;
  const db = await mediaDb();
  await Promise.all(keys.map(k => new Promise(res => {
    const r = db.transaction('blobs').objectStore('blobs').get(k);
    r.onsuccess = () => { if (r.result) out.set(k, r.result); res(); };
    r.onerror = () => res();
  })));
  db.close();
  return out;
}
// The state as it goes to disk: pointers where the blobs were, and the blobs still to write.
function serialize() {
  const pending = new Map();
  const json = JSON.stringify(state, (k, v) => {
    if (!isMedia(k, v)) return v;
    const key = blobKey(v);
    if (!stored.has(key)) pending.set(key, v);
    return key;
  });
  return { json, pending };
}
// Blobs back into the cards. Only custom modules carry media. A pointer with no blob behind
// it is left as it is rather than dropped — the picture is part of the card's identity.
async function hydrate() {
  const keys = new Set();
  for (const m of state.custom || []) {
    for (const c of m.cards || []) for (const f of ['image', 'audio']) if (String(c[f] || '').startsWith('idb:')) keys.add(c[f]);
  }
  if (!keys.size) return;
  const got = await mediaGet([...keys]).catch(() => new Map());
  for (const m of state.custom || []) {
    for (const c of m.cards || []) for (const f of ['image', 'audio']) if (got.has(c[f])) { stored.add(c[f]); c[f] = got.get(c[f]); }
  }
}

let warnedFull = false;
let mediaOk = !!window.indexedDB;
function save({ sync = true } = {}) {
  const write = json => {
    try {
      localStorage.setItem(KEY, json);
    } catch (e) {
      // Out of storage: reviews would silently stop persisting, so say so loudly once.
      if (!warnedFull) {
        warnedFull = true;
        toast('Storage is full — progress is not being saved. Export a backup, then remove a module.', 'Settings', () => go({ name: 'settings' }));
      }
      return;
    }
    if (sync) queueSync();
  };
  if (!mediaOk) return write(JSON.stringify(state));
  const { json, pending } = serialize();
  if (!pending.size) return write(json);
  // New blobs reach IndexedDB first, so a pointer on disk never points at nothing. If the
  // store is unavailable (private mode, an old browser) the state is written inline instead.
  mediaPut([...pending]).then(() => write(json), () => { mediaOk = false; write(JSON.stringify(state)); });
}
function P() {
  if (!state.profiles[state.active]) state.profiles[state.active] = newProfile();
  return state.profiles[state.active];
}
function say(msg) { live.textContent = msg; }

// ---------------- modules ----------------

let loadErrors = [];

async function loadModules() {
  let files = [];
  loadErrors = [];
  try {
    const idx = await fetch('modules/index.json', { cache: 'no-cache' }).then(r => r.json());
    files = Array.isArray(idx) ? idx : idx.modules || [];
  } catch { /* offline or served from file:// — custom modules still work */ }
  // Revalidate like the index: a bundled module that gains cards should not sit stale in a
  // browser cache. The service worker still answers when there is no network.
  const fetched = await Promise.all(files.map(f =>
    fetch('modules/' + f, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .catch(e => { loadErrors.push(`${f}: ${e.message}`); return null; })));
  const byId = new Map();
  for (const raw of [...fetched, ...(state.custom || [])]) {
    if (!raw) continue;
    try { const m = validateModule(raw); byId.set(m.id, m); } // custom wins: it is loaded last
    catch (e) { loadErrors.push(e.message); console.warn('skipped a module:', e.message); }
  }
  modules = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// ponytail: no timeout — fetch() has no simple one and a stuck request is visible, not silent.
async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  if (text.length > 2_000_000) throw new Error('That file is too big to import (2 MB max).');
  return text;
}

function addCustom(raw) {
  const m = validateModule(raw);            // throws before anything is stored
  m.savedAt = Date.now();
  state.custom = (state.custom || []).filter(c => c.id !== m.id).concat([m]);
  save();
  return m;
}

// ---------------- google drive sync (appdata folder, no backend) ----------------

// The profile scopes are only there to show whose Drive this is — a name and a face beside
// "synced". Nothing from them is stored or synced.
const SCOPE = 'openid profile email https://www.googleapis.com/auth/drive.appdata';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const FILE = 'learning-pit-state.json';
let account = null;     // { name, email, picture } of the connected Google account, this page only
let token = null, tokenExp = 0, tokenClient = null, syncTimer = null, syncing = false, syncError = '';

// The OAuth client ID belongs to the deployment, not the person: if config.json carries
// one, every device that loads the app can sign in without being told a magic string.
// A value typed into Settings overrides it.
let deployClientId = '';
const clientId = () => (state.settings.clientId || deployClientId || '').trim();
const signedIn = () => !!token;

// Who is connected. Never through api(): a token granted before the profile scopes existed
// gets a 401 here and must go on syncing — it just shows no face.
async function loadAccount() {
  try {
    const me = token === 'mock' ? await api(USERINFO)
      : await fetch(USERINFO, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.ok ? r.json() : null);
    account = me ? { name: me.name || '', email: me.email || '', picture: me.picture || '' } : null;
  } catch { account = null; }
  renderBar();
  if (view.name === 'settings') render();
}
// The Google account's own picture — not the learner's emoji avatar, which is the app's.
const accountPic = () => /^(https:\/\/|data:image\/)/.test(account?.picture || '')
  ? `<img class="gpic" src="${esc(account.picture)}" alt="" referrerpolicy="no-referrer" width="24" height="24">` : '';

function auth(interactive) {
  if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
  if (!clientId()) return Promise.reject(new Error('Add a Google client ID in Settings first.'));
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error('Google sign-in unavailable (offline?).'));
  tokenClient ||= google.accounts.oauth2.initTokenClient({ client_id: clientId(), scope: SCOPE, callback: () => {} });
  return new Promise((res, rej) => {
    tokenClient.callback = r => {
      if (r.error) return rej(new Error(r.error));
      token = r.access_token;
      tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
      localStorage.setItem('pit.wasSignedIn', '1');
      loadAccount();
      res(token);
    };
    tokenClient.error_callback = e => rej(new Error(e.type || 'sign-in cancelled'));
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

let api = async function (url, opts = {}) {
  const t = await auth(false);
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (r.status === 401) { token = null; throw new Error('sign-in expired'); }
  if (!r.ok) throw new Error('Drive ' + r.status);
  return opts.raw ? r.text() : r.json();
};

// `?mock-drive` swaps Drive for a local stand-in so the sync flow can be exercised without
// an account. The module is only fetched when the flag is present, so it never ships weight.
if (new URLSearchParams(location.search).has('mock-drive')) {
  import('./dev-mock-drive.js').then(m => {
    api = m.mockApi;
    token = 'mock';
    tokenExp = Date.now() + 3600e3;
    loadAccount();
    toast('Drive mock active — nothing leaves this device.');
  }).catch(e => console.warn('mock-drive:', e.message));
}

async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    const q = encodeURIComponent(`name='${FILE}'`);
    const found = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id)&q=${q}`);
    const file = found.files?.[0];
    if (file) {
      const remote = await api(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`).catch(() => null);
      if (remote && remote.profiles) {
        const wasUntouched = !(P().stats.reviews > 0);
        state = mergeState(state, remote);
        // A fresh device shouldn't land on its own empty starter profile when the account
        // it just signed into has real ones.
        if (wasUntouched) {
          const busiest = Object.entries(state.profiles)
            .sort((a, b) => (b[1].stats?.reviews || 0) - (a[1].stats?.reviews || 0))[0];
          if (busiest && (busiest[1].stats?.reviews || 0) > 0) state.active = busiest[0];
        }
        save({ sync: false });
        await loadModules();
        render();     // the screen was drawn from the state this device had a moment ago
      }
    }
    const body = JSON.stringify(state);
    if (file) {
      await api(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body, raw: true });
    } else {
      const b = '-'.repeat(20) + 'pit';
      await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST', raw: true,
        headers: { 'Content-Type': `multipart/related; boundary=${b}` },
        body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
              `${JSON.stringify({ name: FILE, parents: ['appDataFolder'] })}\r\n` +
              `--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`,
      });
    }
    state.settings.lastSync = Date.now();
    save({ sync: false });
    return true;
  } finally {
    syncing = false;
  }
}

// ponytail: debounce, no queue/retry. A missed sync self-heals on the next save.
function queueSync() {
  if (!clientId() || !signedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync()
    .then(() => { syncError = ''; renderBar(); })
    // Failing quietly would leave someone believing two devices are in step when they are not.
    .catch(e => { syncError = e.message; console.warn('sync:', e.message); renderBar(); }), 4000);
}

// Closing the tab inside the debounce window would otherwise strand the last few reviews.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && signedIn() && syncTimer) {
    clearTimeout(syncTimer);
    sync().catch(() => {});
  }
});

// ---------------- share a module as a link ----------------
// The whole module rides in the URL fragment (deflate + base64url), so a module can
// be texted to someone with no server, no account, and no upload.

const b64url = {
  to: bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  from: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
};

async function packModule(m) {
  const json = JSON.stringify({ id: m.id, title: m.title, description: m.description, tags: m.tags, cards: m.cards });
  if (!window.CompressionStream) return 'j' + b64url.to(new TextEncoder().encode(json));
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'z' + b64url.to(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function unpackModule(s) {
  const bytes = b64url.from(s.slice(1));
  if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

async function shareModule(m) {
  const url = location.origin + location.pathname + '#m=' + await packModule(m);
  // A big module will not fit in a link, but a phone can hand the file itself to the share
  // sheet — which is how you actually send one to somebody standing next to you.
  if (url.length > 8000) {
    const file = new File([JSON.stringify(m, null, 2)], `${m.id}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: m.title }); return say('Shared.'); }
      catch { /* dismissed */ }
    }
    download(`${m.id}.json`, JSON.stringify(m, null, 2), 'application/json');
    return say('Too big for a link — saved as a file instead.');
  }
  if (navigator.share) {
    try { await navigator.share({ title: m.title, text: `Flashcards: ${m.title}`, url }); return say('Shared.'); }
    catch { /* user dismissed the sheet */ }
  }
  await navigator.clipboard.writeText(url);
  say('Link copied — anyone who opens it gets this module.');
}

// ---------------- dialogs ----------------
// In-app instead of native prompt()/confirm(): those look alien in a standalone PWA and
// a four-year-old will not read a Chrome dialog.

function dialog({ title, value, ok = 'OK', danger = false, choices = null }) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'sheet';
    el.innerHTML = `<div class="sheet-box" role="dialog" aria-modal="true">
      <p>${esc(title)}</p>
      ${choices ? `<div class="choices">${choices.map(c =>
        `<button class="opt" data-choice="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div>`
        : value === undefined ? ''
          : `<input id="dlg" value="${esc(value)}" enterkeyhint="done" aria-label="${esc(title)}">`}
      <div class="row">
        ${choices ? '' : `<button class="btn ${danger ? 'again' : ''}" data-ok>${esc(ok)}</button>`}
        <button class="btn ghost" data-cancel>Cancel</button>
      </div>
    </div>`;
    document.body.append(el);
    const input = el.querySelector('#dlg');
    const done = v => { el.remove(); resolve(v); };
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-cancel]')) return done(null);
      const chosen = e.target.closest('[data-choice]');
      if (chosen) return done(chosen.dataset.choice);
      if (e.target.closest('[data-ok]')) return done(input ? input.value.trim() : true);
    });
    el.addEventListener('keydown', e => {
      e.stopPropagation();     // the app's own shortcuts must not fire behind the sheet
      if (e.key === 'Enter' && input) return done(input.value.trim());
      if (e.key === 'Escape') return done(null);
      if (e.key !== 'Tab') return;
      // Keep Tab inside the sheet: behind it is a screen the user cannot act on.
      const focusable = [...el.querySelectorAll('input, button')];
      const edge = e.shiftKey ? focusable[0] : focusable[focusable.length - 1];
      if (document.activeElement === edge) {
        e.preventDefault();
        (e.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
      }
    });
    // Focus whatever this sheet actually has: a field, a confirm button, or the first choice.
    (input || el.querySelector('[data-ok]') || el.querySelector('[data-choice]') || el).focus?.();
    input?.select();
  });
}

const askText = (title, value = '') => dialog({ title, value });

// The child-proof latch. Two numbers a small child cannot multiply, and three tries.
async function grownUp() {
  const a = 6 + Math.floor(Math.random() * 7), b = 6 + Math.floor(Math.random() * 7);
  const said = await dialog({ title: `Grown-ups only. What is ${a} × ${b}?`, value: '', ok: 'Enter' });
  if (said === null) return false;
  if (Number(String(said).trim()) === a * b) return true;
  toast('Not quite — ask a grown-up.');
  return false;
}
const askYes = (title, ok = 'Delete') => dialog({ title, ok, danger: true });

// ---------------- toast ----------------

function toast(msg, label, fn) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${label ? '<button class="linky"></button>' : ''}`;
  el.querySelector('button')?.addEventListener('click', () => { el.remove(); fn(); });
  if (label) el.querySelector('button').textContent = label;
  let stack = document.getElementById('toasts');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toasts';
    document.body.append(stack);
  }
  stack.append(el);
  say(msg);
  if (!label) setTimeout(() => el.remove(), 4000);
}

// A deletion that cannot be taken back is one confirmation dialog away from losing work
// somebody typed. The toast holds the only copy until it is dismissed.
function undoable(msg, restore) {
  // One pending Undo at a time. Two stacked — an old import's under a fresh deletion's —
  // means "the Undo button" is ambiguous, and the wrong one fires on a real thumb.
  for (const t of document.querySelectorAll('#toasts .toast')) {
    if (t.querySelector('button')) t.remove();
  }
  toast(msg, 'Undo', async () => {
    await restore();
    say('Put back.');
  });
}

// ---------------- streaks ----------------

const today = () => dayStr();

// ---------------- navigation ----------------

function go(v) { stack.push(view); view = v; history.pushState({ d: stack.length }, ''); render(); }
function back() { history.back(); }
addEventListener('popstate', () => {
  clearInterval(session?.timer);
  hushSpeech();
  view = stack.pop() || { name: 'home' };
  // Leaving a session ends it — except when back lands *on* the session, which is what
  // happens after nipping into the editor to fix the card being asked.
  if (view.name !== 'session') session = null;
  render();
});

// ---------------- rendering ----------------

function renderBar() {
  const p = P();
  applyAccent();
  const sync = !clientId() ? ''
    : syncError ? `<button class="chip warnchip" data-act="sync" title="${esc(syncError)} — tap to retry">⚠ sync</button>`
    : signedIn() ? `<button class="chip" data-act="sync" title="Sync now${account ? ' — ' + esc(account.name || account.email) : ''}">${accountPic() || '☁'} synced</button>`
    : `<button class="chip" data-act="signin">☁ sign in</button>`;
  bar.innerHTML = `
    <button class="chip" data-act="home" aria-label="Home">◎ <b>Learning Pit</b></button>
    <span class="spacer"></span>
    <button class="chip flame" data-act="progress" aria-label="${
      opt().kid ? `${p.stats.stars || 0} stars` : `${p.stats.streak || 0} day streak`} — see progress">${
      opt().kid ? `${p.stats.stars || 0}★` : `${p.stats.streak || 0}🔥`}</button>
    ${sync}
    <button class="chip" data-act="settings" aria-label="Settings for ${esc(state.active)}">
      <span aria-hidden="true">${opt().avatar}</span> ${esc(state.active)}</button>`;
}

// A thrown render would otherwise leave a blank screen and no explanation.
addEventListener('error', e => {
  console.error(e.error || e.message);
  if (!document.querySelector('.toast')) toast('Something went wrong on that screen.', 'Reload', () => location.reload());
});
addEventListener('unhandledrejection', e => console.warn('unhandled:', e.reason?.message || e.reason));

function render() {
  draw();
  // A pasted paragraph is a paragraph, not a poster: below poster size it stops shouting and
  // reads left-aligned. Done here rather than in sixteen game templates.
  for (const f of app.querySelectorAll('.face')) {
    f.classList.toggle('long', f.textContent.trim().length > 180);
  }
  // Redrawing destroys whatever had focus, which drops keyboard and screen-reader users
  // back to the top of the document. If nothing claimed focus, put it on the heading.
  // Sessions manage their own (the typing game owns its input).
  if (view.name !== 'session' && (!document.activeElement || document.activeElement === document.body)) {
    const h = app.querySelector('h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
}

// 'auto' is resolved here rather than in a media query, so the stylesheet only ever has to
// describe two themes and the whole app follows whichever is stamped on <html>.
const LIGHT = matchMedia('(prefers-color-scheme: light)');
// Type scale, as a percentage of the browser's own base size. Everything in the stylesheet is
// in rem or clamp(), so one number moves the whole interface — for a five-year-old across the
// room or for eyes that would rather not squint.
function applyTextSize() {
  const pct = Math.min(160, Math.max(80, opt().text || 100));
  document.documentElement.style.fontSize = pct === 100 ? '' : `${pct}%`;
}

function applyTheme() {
  const t = opt().theme;
  const light = t === 'light' || (t === 'auto' && LIGHT.matches);
  document.documentElement.dataset.theme = t === 'contrast' ? 'contrast' : light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t === 'contrast' ? '#000000' : light ? '#f2f6fa' : '#06080b');
}
LIGHT.addEventListener('change', () => { if (opt().theme === 'auto') applyTheme(); });

// The count on the installed app's icon — the one reminder that costs nothing and nags
// nobody. ponytail: setAppBadge is a no-op where unsupported; no capability dance.
function updateBadge() {
  if (!navigator.setAppBadge) return;
  const n = dueEverything().length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function draw() {
  applyTheme();          // each learner keeps their own, so this follows the profile too
  applyTextSize();
  updateBadge();
  renderBar();
  const v = view;
  app.className = 'screen ' + v.name;
  if (v.name === 'home') return home();
  if (v.name === 'module') return moduleView(v.id);
  if (v.name === 'session') {
    if (!session) { view = { name: 'home' }; return home(); }   // a stale entry in the history
    return session.game.frame();
  }
  if (v.name === 'results') return results();
  if (v.name === 'import') return importView();
  if (v.name === 'progress') return progressView();
  if (v.name === 'edit') return editView(v.id);
  if (v.name === 'browse') return browseView(v.id);
  if (v.name === 'quick') return quickView();
  if (v.name === 'setup') return setupView();
  if (v.name === 'settings') return settings();
}

const norm = s => String(s).toLowerCase();

// "when did I last touch this?" is the question a shelf of twenty modules raises, and every
// card already carries the timestamp of its last grade.
function lastStudied(m) {
  const srs = P().srs;
  let last = 0;
  for (const card of m.cards) last = Math.max(last, srs[cardKey(m.id, card)]?.t || 0);
  if (!last) return '';
  const days = Math.floor((Date.now() - last) / 86400000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago`
    : days < 365 ? `${Math.round(days / 30)} months ago` : 'over a year ago';
}

function tile(m) {
  const c = counts(m.cards, P().srs, m.id);
  const pct = Math.round((c.learned / c.total) * 100);
  const seen = lastStudied(m);
  return `<button class="tile ${opt().kid ? 'big-icon' : ''}" data-act="open" data-id="${esc(m.id)}">
    <span class="tile-icon" aria-hidden="true">${esc(m.icon || '◈')}</span>
    <span class="tile-title">${esc(m.title)}</span>
    <span class="tile-sub">${c.total} cards${m.tags.length ? ' · ' + esc(m.tags.slice(0, 2).join(' · ')) : ''}</span>
    ${deadlines()[m.id] ? `<span class="tile-sub deadline">📅 by ${esc(deadlines()[m.id])}</span>` : ''}
    <span class="ring" style="--pct:${pct}"><i>${c.due + c.fresh || '✓'}</i></span>
    <span class="tile-sub dim">${c.due + c.fresh ? `${c.due} due · ${c.fresh} new` : 'all rested'}${
      seen ? ` · ${esc(seen)}` : ''}</span>
  </button>`;
}

function libraryHtml(q, tag) {
  const srs = P().srs, now = Date.now();
  const workload = m => { const c = counts(m.cards, srs, m.id, now); return c.due * 10 + c.fresh; };
  const shown = visible()
    .filter(m => !tag || m.tags.includes(tag))
    // Alphabetical by default so the shelf stays where a child left it; by workload on request.
    .sort((a, b) => opt().sort === 'due' ? workload(b) - workload(a) || a.title.localeCompare(b.title) : 0);
  if (!q) {
    return `${tag && shown.length > 1
      ? `<button class="btn wide due-all" data-act="drilltag">Drill everything tagged “${esc(tag)}”</button>` : ''}
      <div class="tiles">${shown.map(tile).join('')}
      <button class="tile add" data-act="import">＋<span class="tile-sub">Import module</span></button>
      <button class="tile add" data-act="newmodule">✎<span class="tile-sub">Write one</span></button>
    </div>`;
  }
  const needle = norm(q);
  const mods = shown.filter(m => norm(m.title + ' ' + m.description + ' ' + m.tags.join(' ')).includes(needle));
  const hits = [];
  for (const m of shown) {
    for (const c of m.cards) {
      // The hint and the note are where the useful half of a card often lives — searching
      // only the two sides means "that card about the Wald bombers" never comes back.
      const hay = [c.front, c.back, c.hint, c.note, ...(c.alt || [])].filter(Boolean).join(' ');
      if (norm(hay).includes(needle)) hits.push({ ...c, mid: m.id, from: m.title });
    }
  }
  matches = hits;
  return `
    ${mods.length ? `<div class="tiles">${mods.map(tile).join('')}</div>` : ''}
    ${hits.length ? `<h2>${hits.length} matching card${hits.length > 1 ? 's' : ''}</h2>
      <button class="btn wide due-all" data-act="drill">Drill these ${Math.min(hits.length, 20)}</button>
      <div class="list">${hits.slice(0, 40).map(c => `<div class="li">
        <button class="rowbtn" data-act="open" data-id="${esc(c.mid)}">
          <span>${esc(c.front)}</span><em>${esc(c.back)} · ${esc(c.from)}</em></button>
      </div>`).join('')}</div>` : ''}
    ${!mods.length && !hits.length ? '<p class="lede">Nothing matches.</p>' : ''}`;
}

function emptyLibraryNote() {
  if (visible().length || !modules.length) return '';
  return `<p class="warn">Every module is hidden for ${esc(state.active)}.
    Turn some back on in <button class="linky" data-act="settings">Settings</button>.</p>`;
}

let matches = [];

function home() {
  const due = dueEverything();
  const tags = [...new Set(visible().flatMap(m => m.tags))].slice(0, 10);
  const { q = '', tag = '' } = view;
  const doneToday = (P().stats.days || {})[today()] || 0;
  const goal = opt().goal || 0;
  app.innerHTML = `
    <h1>Choose a discipline</h1>
    <p class="lede">${!modules.length ? 'No modules yet — import one to begin.'
      : goal ? `${doneToday} of ${goal} today${doneToday >= goal ? ' — done. ' + (opt().kid ? '⭐' : 'The pit rests.') : ''}`
      : 'The pit is ready.'}${
      // A streak is only worth having if you are told when it is about to go.
      !doneToday && (P().stats.streak || 0) > 1
        ? ` <b class="atrisk">${P().stats.streak} day streak — nothing done yet today.</b>` : ''}</p>
    ${goal ? `<div class="goal"><i style="width:${Math.min(100, Math.round((doneToday / goal) * 100))}%"></i></div>` : ''}
    ${(P().stats.reviews || 0) ? rankLine() : ''}
    ${(P().stats.reviews || 0) === 0 ? `<div class="welcome">
      <p>${opt().kid ? 'Pick something below. The pit will remember what you find hard and ask it again.'
        : `Pick a discipline below and the pit will start scheduling it for you — each card comes
           back just before you'd forget it.`}</p>
      ${opt().kid ? '' : `<p>To drill your own material,
        <button class="linky" data-act="import">import a module</button>:
        paste an answer from Claude, a table, or a list, and it becomes cards.
        Studying with a child? Add them in ⚙ Settings and turn on <b>kid mode</b>.</p>`}
    </div>` : ''}
    ${opt().kid && visible().length ? `<button class="btn wide kidplay" data-act="kidplay">
      ▶ Play</button>` : ''}
    ${(() => {
      const r = readSession();
      if (r) return `<button class="btn wide due-all" data-act="resume">
        Finish ${esc(r.module.title)} <small>${r.queue.length} cards left</small></button>`;
      // A deadline outranks the ordinary due pile: it is the thing with a date on it.
      const urgent = visible()
        .map(m => ({ m, plan: planFor(m) }))
        .filter(x => x.plan && !x.plan.passed && x.plan.remaining)
        .sort((a, b) => a.plan.daysLeft - b.plan.daysLeft)[0];
      if (urgent) return `<button class="btn wide due-all urgent" data-act="play"
        data-id="${esc(urgent.m.id)}" data-game="recall">
        ${esc(urgent.m.title)} by ${esc(deadlines()[urgent.m.id])}
        <small>${urgent.plan.perDay} a day · ${urgent.plan.daysLeft} day${urgent.plan.daysLeft === 1 ? '' : 's'} left</small></button>`;
      if (due.length) {
        // A big pile is only frightening until you know it is a few minutes of it.
        const now = Math.min(due.length, opt().size);
        const mins = minutesFor(now, P().stats.sessions);
        const across = new Set(due.map(c => c.mid)).size;
        return `<button class="btn wide due-all" data-act="reviewall">
          Review ${due.length} due <small>${now < due.length ? `${now} now, ` : ''}about ${mins} min ·
          ${across} module${across === 1 ? '' : 's'}</small></button>
          ${due.length > Math.max(20, opt().goal * 2) ? `<button class="ghost sm spread"
            data-act="spreadpile">That is a lot. Spread it over the week?</button>` : ''}`;
      }
      return modules.length ? `<button class="btn wide due-all" data-act="learnnew">
        Learn something new <small>nothing is due yet</small></button>` : '';
    })()}
    ${installPrompt && !opt().kid ? `<button class="linky addcard" data-act="install">⤓ install on this device</button>` : ''}
    ${(() => {
      const n = starred(visible(), P().srs).length;
      return n ? `<button class="linky addcard" data-act="drillstarred">★ starred (${n})</button>` : '';
    })()}
    ${!opt().kid && modules.length ? `<button class="linky addcard" data-act="quickcard">＋ quick card</button>` : ''}
    ${!opt().kid && modules.length > 1 ? `<button class="linky addcard" data-act="mockexam">◷ mock exam</button>` : ''}
    ${modules.length > 1 ? `<input id="q" type="search" aria-label="Search cards and modules"
      placeholder="Search cards and modules" value="${esc(q)}">` : ''}
    ${tags.length > 1 || modules.length > 4 ? `<div class="row wrap tagrow">
      ${tags.map(t => `<button class="chip ${t === tag ? 'on' : ''}" data-act="tag" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
      ${modules.length > 4 ? `<button class="chip ${opt().sort === 'due' ? 'on' : ''}" data-act="sort">
        ${opt().sort === 'due' ? '⇅ most to do' : '⇅ A–Z'}</button>` : ''}
    </div>` : ''}
    ${emptyLibraryNote()}
    <div id="results">${libraryHtml(q, tag)}</div>
    ${loadErrors.length ? `<p class="warn">${loadErrors.length} module${loadErrors.length > 1 ? 's' : ''} could not be loaded:
      ${esc(loadErrors.slice(0, 3).join('; '))}</p>` : ''}`;
  const input = document.getElementById('q');
  if (input) {
    input.addEventListener('input', e => {
      view.q = e.target.value;
      document.getElementById('results').innerHTML = libraryHtml(view.q, view.tag);
    });
    // Type, Enter, drilling — the search box is a launcher, not just a filter.
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.querySelector('[data-act="drill"]')?.click();
    });
    if (q) { input.focus(); input.setSelectionRange(q.length, q.length); }
  }
}

// The first thing a new device sees. A grown-up setting this up for a five-year-old should
// not have to find kid mode in a settings screen, and should not have to read anything.
function setupView() {
  app.innerHTML = `
    <h1>Who is the pit for?</h1>
    <p class="lede">You can add more learners later, and each one keeps their own progress,
    settings and schedule.</p>
    <div class="games">
      <button class="game" data-act="setupme">
        <span class="glyph">◎</span>
        <span><b>Me</b><small>Full set of exercises, numbers and percentages</small></span>
      </button>
      <button class="game" data-act="setupkid">
        <span class="glyph">🧸</span>
        <span><b>A child</b><small>Two big buttons, stars, everything read aloud</small></span>
      </button>
    </div>
    <button class="linky" data-act="setupskip">skip — I will sort it out later</button>`;
}

// One fact, one screen, no editor. This is where something learned five minutes ago goes
// before it is forgotten — and it stays open so the next one is one keystroke away.
function quickView() {
  const target = quickTarget();
  app.innerHTML = `
    <button class="back" data-act="back">‹ back</button>
    <h1>Quick card</h1>
    <p class="lede">Straight into a module you already study. It joins the new pile and comes
    round on schedule like any other card.</p>
    <form id="quickf" class="stack">
      <label class="field">Into
        <select id="qmod">${modules.map(m => `<option value="${esc(m.id)}" ${m.id === target ? 'selected' : ''}>${
          esc((m.icon ? m.icon + ' ' : '') + m.title)} (${m.cards.length})</option>`).join('')}
          <option value="+">＋ a new module…</option></select>
      </label>
      <label class="field">Question
        <textarea id="qfront" rows="2" placeholder="What are you asking yourself?"></textarea>
      </label>
      <label class="field">Answer
        <textarea id="qback" rows="2" placeholder="The thing you want to come back to you"></textarea>
      </label>
      <label class="field">Why <small class="dim">— optional, shown after you answer</small>
        <textarea id="qnote" rows="2"></textarea>
      </label>
      <div class="row picrow">
        ${view.pic ? `<img class="thumb" src="${esc(view.pic)}" alt="">` : ''}
        <label class="btn ghost">${view.pic ? 'Replace picture' : 'Add a picture'}
          <input class="sr" type="file" accept="image/*" id="qpic"></label>
        ${view.pic ? '<button class="ghost sm" type="button" data-act="quicknopic">Remove</button>' : ''}
      </div>
      <div class="row">
        <button class="btn" type="submit">Add card</button>
        <button class="btn ghost" type="button" data-act="quickdone">Done</button>
      </div>
    </form>
    <p class="lede dim">Ctrl/⌘ + Enter adds it and clears the fields for the next one.</p>
    <p id="err" class="err"></p>
    ${(view.added || []).length ? `<h2>Added just now</h2><div class="list">${view.added.map(a => `
      <div class="li"><span>${esc(a.front)} <small>${esc(a.module)}</small></span></div>`).join('')}</div>` : ''}`;
  const form = document.getElementById('quickf');
  document.getElementById('qpic').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      view.pic = await shrinkImage(file);      // same 480px shrink the editor uses
      render();
    } catch (err) { showErr(err); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); ACT.quickadd(); });
  form.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ACT.quickadd(); }
  });
  document.getElementById('qfront').focus();
}

// Where the last quick card went, if that module is still around.
const quickTarget = () => (modules.some(m => m.id === opt().lastAdd) ? opt().lastAdd : modules[0]?.id);

function moduleView(id) {
  const m = modules.find(x => x.id === id);
  if (!m) { view = { name: 'home' }; return home(); }   // deleted underneath us
  const c = counts(m.cards, P().srs, m.id);
  app.innerHTML = `
    <button class="back" data-act="back">‹ back</button>
    <h1>${esc(m.title)}</h1>
    <p class="lede">${esc(m.description || '')}</p>
    <div class="stats">
      <span><b>${c.due}</b>due</span><span><b>${c.fresh}</b>new</span>
      <span><b>${c.learned}</b>resting</span>${c.paused ? `<span><b>${c.paused}</b>paused</span>` : ''}
      <span><b>${c.total}</b>total</span>
      ${(() => {
        // How this module has actually gone, from the sittings that were on it.
        const mine = (P().stats.sessions || []).filter(s => s.m === m.title);
        const asked = mine.reduce((n, s) => n + (s.r || 0) + (s.w || 0), 0);
        const right = mine.reduce((n, s) => n + (s.r || 0), 0);
        return asked >= 10 ? `<span><b>${Math.round((100 * right) / asked)}%</b>you get right</span>` : '';
      })()}
    </div>
    ${deadlineBar(m)}
    <div class="row wrap tagrow">
      <button class="chip ${view.rev ? 'on' : ''}" data-act="rev">⇄ ${view.rev ? 'Answer → question' : 'Question → answer'}</button>
      <button class="chip ${view.exam ? 'on' : ''}" data-act="exam">◷ ${view.exam ? 'Exam: every card, no scheduling' : 'Practice'}</button>
      <button class="chip ${deadlines()[m.id] ? 'on' : ''}" data-act="setdeadline" data-id="${esc(m.id)}">
        ${deadlines()[m.id] ? '📅 ' + esc(deadlines()[m.id]) : '📅 Set a deadline'}</button>
    </div>
    <button class="btn wide" data-act="surprise" data-id="${esc(m.id)}">▶ Just start
      <small>whatever suits these cards · about ${
        minutesFor(Math.min(opt().size, c.due + c.fresh || c.total), P().stats.sessions)} min</small></button>
    ${gameList(m, 'drill')}
    ${gameList(m, 'play')}
    ${(() => {
      // The module's own sore teeth, by lapse count — the schedule knows, the learner should too.
      const rough = troubleSpots([m], P().srs, 3);
      if (!rough.length) return '';
      return `<h2>Rough spots</h2><div class="list">
        ${rough.map(r => `<div class="li"><span>${esc(r.card.front)}
          <small class="dim">${r.lapses ? `${r.lapses} lapse${r.lapses === 1 ? '' : 's'}` : 'missed lately'}</small></span></div>`).join('')}
        <button class="ghost sm" data-act="drillrough" data-id="${esc(m.id)}">Drill just these</button>
      </div>`;
    })()}
    <div class="row wrap">
      ${c.total && c.learned === c.total
        ? `<button class="ghost" data-act="certificate" data-id="${esc(m.id)}">🎓 Print certificate</button>` : ''}
      <button class="ghost" data-act="browse" data-id="${esc(m.id)}">Read through</button>
      ${visible().length > 1 ? `<button class="ghost" data-act="mixwith" data-id="${esc(m.id)}">Mix with…</button>` : ''}
      <button class="ghost" data-act="grow" data-id="${esc(m.id)}">Ask Claude for more</button>
      ${m.src ? `<button class="ghost" data-act="refresh" data-id="${esc(m.id)}"
        title="${esc(m.src)}">Check ${esc(host(m.src))} for new cards</button>` : ''}
      <button class="ghost" data-act="edit" data-id="${esc(m.id)}">Edit cards</button>
      <button class="ghost" data-act="merge" data-id="${esc(m.id)}">Merge into…</button>
      <button class="ghost" data-act="reset" data-id="${esc(m.id)}">Reset ${esc(state.active)}'s progress</button>
    </div>`;
}

// Which exercises this module and this learner can actually use right now.
function eligibleGames(m, group) {
  return Object.entries(GAMES).filter(([, g]) =>
    (!group || g.group === group)
    && (!g.needs || g.needs())
    && (!g.module || g.module(m))
    && (!opt().kid || g.kid !== false)
    && (g.filter ? m.cards.filter(g.filter).length : m.cards.length) >= g.min);
}

// Fifteen exercises is a long list on a phone, so they come in two groups — and a child sees
// only the ones that suit them rather than a wall of choices.
function gameList(m, group) {
  const entries = Object.entries(GAMES).filter(([, g]) =>
    g.group === group && (!g.needs || g.needs()) && (!g.module || g.module(m)) && (!opt().kid || g.kid !== false));
  if (!entries.length) return '';
  // A game is offered only if enough of this module's cards actually suit it. With sixteen
  // of them, the ones that cannot run are a footnote rather than a wall of dead buttons.
  const usableCount = g => (g.filter ? m.cards.filter(g.filter).length : m.cards.length);
  const fit = entries.filter(([, g]) => usableCount(g) >= g.min);
  const unfit = entries.filter(([, g]) => usableCount(g) < g.min);
  if (!fit.length) return '';
  return `<h2>${group === 'drill' ? 'Drills' : 'Games'}</h2>
    <div class="games">${fit.map(([k, g]) => `
      <button class="game" data-act="play" data-id="${esc(m.id)}" data-game="${k}">
        <span class="glyph">${g.glyph}</span>
        <span><b>${g.label}</b><small>${g.hint}</small></span>
      </button>`).join('')}</div>
    ${unfit.length ? `<p class="lede dim small-note">${unfit.map(([, g]) => esc(g.label)).join(', ')}
      ${unfit.length === 1 ? 'needs' : 'need'} other kinds of card — pictures, numbers, longer answers.</p>` : ''}`;
}

// Ties the sitting back to the day: a session means more when you can see where it landed.
function goalLine() {
  const goal = opt().goal;
  if (!goal || session.exam) return '';
  const done = (P().stats.days || {})[today()] || 0;
  const left = Math.max(0, goal - done);
  return `<p class="lede center">${left
    ? `${done} of ${goal} today — ${left} to go`
    : `${done} today. ${opt().kid ? 'All done! ⭐' : 'The day’s work is done.'}`}</p>
    <div class="goal"><i style="width:${Math.min(100, Math.round((done / goal) * 100))}%"></i></div>`;
}

// What a deadline is asking of you today, in one line and one bar.
function deadlineBar(m) {
  const plan = planFor(m);
  if (!plan) return '';
  const doneToday = (P().stats.days || {})[today()] || 0;
  if (plan.passed) {
    return `<p class="warn">That deadline has passed. ${plan.remaining
      ? `${plan.remaining} cards never got learned — clear the date or set a new one.` : 'Everything was learned in time.'}</p>`;
  }
  const sweep = plan.sweep && plan.beyond
    ? `<p class="lede sweep">Final stretch: ${plan.beyond} card${plan.beyond === 1 ? ' is' : 's are'} scheduled past the date,
      so each is asked once more before it.</p>` : '';
  if (!plan.remaining) return `<p class="lede">Ready — every card is learned with ${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'} to spare.</p>${sweep}`;
  return `<p class="lede">${plan.remaining} cards left, ${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'} to go —
    <b>${plan.perDay} a day</b> from here.</p>${sweep}
    <div class="goal"><i style="width:${Math.min(100, Math.round((doneToday / plan.perDay) * 100))}%"></i></div>`;
}

// After a sitting across modules, the score alone says little: which subject let you down is
// the whole point of taking one.
function examBreakdown() {
  if (session.module.id !== 'exam') return '';
  const rows = examScore(session.cards, session.missed || []);
  if (rows.length < 2) return '';
  return `<h2>Where it went</h2>
    <div class="list">${rows.map(r => `<div class="bar-row">
      <span>${esc(r.name)}<small>${r.asked - r.wrong}/${r.asked}</small></span>
      <div class="bar ${r.pct < 60 ? 'weak' : ''}"><i style="width:${r.pct}%"></i></div>
    </div>`).join('')}</div>
    ${session.missed?.length ? `<div class="row"><button class="btn wide" data-act="drillmissed">
      Drill the ${new Set((session.missed || []).map(c => c.front)).size} you missed</button></div>` : ''}`;
}

// The maker's app portal keeps a character sheet from what its apps report about you: one
// entry per finished sitting, amount in units of ten minutes. Same-origin localStorage, so it
// never leaves this browser. The selftest drives hundreds of sittings, so it is excluded.
function portalActivity(startedAt) {
  if (location.search.includes('selftest')) return;
  try {
    const k = 'portal-activity', a = JSON.parse(localStorage.getItem(k) || '[]');
    const mins = Math.max(1, Math.round((Date.now() - (startedAt || Date.now())) / 60000));
    a.push([Math.round(Date.now() / 1000), 'learning-pit', 'study', Math.max(0.5, mins / 10)]);
    localStorage.setItem(k, JSON.stringify(a.slice(-2000)));
  } catch { /* quota - ignore */ }
}

function results() {
  const { right, wrong, module: m } = session;
  const total = right + wrong || 1;
  const ratio = right / total;
  const stars = ratio === 1 ? 3 : ratio >= 0.7 ? 2 : ratio > 0 ? 1 : 0;
  if (!session.counted && !session.exam) {   // an exam is measured, not rewarded
    const p = P();
    const before = p.stats.stars || 0;
    p.stats.stars = before + stars;
    session.counted = true;
    session.sticker = stickerEarned(before, p.stats.stars);
    // What was actually done, so "what did I study yesterday?" has an answer. Fifty is
    // about a fortnight of real use and costs a couple of kilobytes.
    if (session.mixups?.length) {
      p.stats.confusions = mergeConfusions(p.stats.confusions,
        session.mixups.map(x => ({ a: x.asked, b: x.took })));
    }
    p.stats.sessions = [{ t: Date.now(), m: m.title, g: session.key, r: right, w: wrong,
      secs: Math.round((Date.now() - (session.startedAt || Date.now())) / 1000) },
      ...(p.stats.sessions || [])].slice(0, 50);
    // A promotion is announced once: the rank held is remembered, not recomputed for show.
    const now = rankFor(learnedCount()).rank.name;
    if (p.stats.rank !== now) {
      if (p.stats.rank) session.promoted = now;
      p.stats.rank = now;
    }
    save();
    portalActivity(session.startedAt);
    pushCoach();
    blip(stars >= 2 ? 'win' : 'good');
    if (session.sticker) toast(`New sticker: ${session.sticker.emoji} ${session.sticker.name}`);
    if (session.promoted) toast(`You are now ${session.promoted}.`);
    setTimeout(renderBar);  // the bar was drawn before these stars existed
  }
  if (session.key === 'duel') {
    const table = session.players
      .map((name, i) => ({ name, score: session.scores[i] }))
      .sort((a, b) => b.score - a.score);
    const top = table[0].score;
    const winners = table.filter(p => p.score === top);
    const drawn = winners.length === table.length;
    app.innerHTML = `
      <div class="pit done"><div class="card"><div class="face">
        <span class="score">${table.map(p => p.score).join(' — ')}</span>
        <p>${drawn ? 'A draw. Again?'
          : winners.length > 1 ? `${winners.map(p => esc(p.name)).join(' and ')} tie for it.`
          : `${esc(winners[0].name)} wins.`}</p>
      </div></div></div>
      <div class="list">${table.map(p => `<div class="li">
        <span>${esc((state.profiles[p.name]?.opts || {}).avatar || '◎')} ${esc(p.name)}</span>
        <b>${p.score}</b></div>`).join('')}</div>
      <div class="row">
        <button class="btn" data-act="again">Again</button>
        <button class="btn ghost" data-act="home">Done</button>
      </div>`;
    say(`${table.map(p => `${p.name} ${p.score}`).join(', ')}. ${
      drawn ? 'A draw.' : winners.map(p => p.name).join(' and ') + ' wins.'}`);
    return;
  }
  if (!right && !wrong) {                    // ran out of time before answering anything
    app.innerHTML = `
      <div class="pit done"><div class="card"><div class="face">
        <p>No answers that time. The pit waits.</p>
      </div></div></div>
      <div class="row">
        <button class="btn" data-act="again">Again</button>
        <button class="btn ghost" data-act="home">Done</button>
      </div>`;
    return;
  }
  app.innerHTML = `
    <div class="pit done">
      <div class="card"><div class="face">
        ${opt().kid
          ? `<span class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
             <p>${stars === 3 ? 'Every single one!' : stars === 2 ? 'Great work.' : 'Good try — go again!'}</p>
             ${session.sticker ? `<p class="won">${session.sticker.emoji} ${esc(session.sticker.name)} unlocked!</p>` : ''}`
          : `<span class="score">${right}<small>/${total}</small></span>
             <p>${ratio === 1 ? 'Flawless. Logic is the beginning of wisdom.' : ratio >= 0.7 ? 'Solid. The pattern is forming.' : 'Repetition is the instrument. Again.'}</p>`}
      </div></div>
    </div>
    ${(() => {
      const secs = Math.round((Date.now() - (session.startedAt || Date.now())) / 1000);
      const mins = Math.floor(secs / 60);
      return `<p class="lede center">${right + wrong} cards in ${
        mins ? `${mins} min ${secs % 60}s` : `${secs}s`}</p>`;
    })()}
    ${goalLine()}
    ${examBreakdown()}
    ${session.mixups?.length ? `<h2>You mixed these up</h2>
      <div class="list">${[...new Map(session.mixups.map(x => [x.asked + '|' + x.took, x])).values()]
        .slice(0, 6).map((x, i) => `<div class="li missed"><span>
          <b>${fmt(x.asked)}</b><em>you gave “${fmt(x.answer)}” — that belongs to “${fmt(x.took)}”</em>
        </span><button class="ghost sm" data-act="drillpair" data-i="${i}">drill the pair</button></div>`).join('')}</div>` : ''}
    ${session.slow?.length ? `<h2>Right, but slowly</h2>
      <p class="lede small-note">Answers that took well over your usual pace. The schedule
      thinks these are safe; the hesitation says otherwise.</p>
      <div class="list">${[...new Map(session.slow.map(c => [c.front, c])).values()].slice(0, 6)
        .map(c => `<div class="li missed"><span><b>${fmt(c.front)}</b><em>${fmt(c.back)}</em></span></div>`)
        .join('')}</div>` : ''}
    ${session.quick?.length ? `<h2>Wrong in a flash</h2>
      <p class="lede small-note">Answered in under ${quickBefore(P().stats.sessions)} seconds, and wrong — a guess, or a
      blank. The attempt to retrieve is the learning; give these a moment next time.</p>
      <div class="list">${[...new Map(session.quick.map(c => [c.front, c])).values()].slice(0, 6)
        .map(c => `<div class="li missed"><span><b>${fmt(c.front)}</b><em>${fmt(c.back)}</em></span></div>`)
        .join('')}</div>` : ''}
    ${session.missed?.length ? `<h2>Worth another look</h2>
      <div class="list">${[...new Map(session.missed.map(c => [c.front, c])).values()].slice(0, 8)
        .map((c, i) => `<div class="li missed">
          <span><b>${fmt(c.front)}</b><em>${fmt(c.back)}</em>${c.note ? `<em class="dim">${fmt(c.note)}</em>` : ''}</span>
          <button class="ghost sm" data-act="notecard" data-i="${i}">${c.note ? 'edit note' : '＋ note'}</button>
        </div>`).join('')}</div>
      ${navigator.clipboard?.writeText ? `<button class="ghost sm" data-act="sharpen">
        Ask Claude to sharpen these</button>` : ''}` : ''}
    <div class="row">
      <button class="btn" data-act="again">Again</button>
      ${!session.exam && modules.some(x => x.id === session.module.id)
        ? `<button class="btn ghost" data-act="anotherway">Another way</button>` : ''}
      <button class="btn ghost" data-act="home">Done</button>
    </div>`;
  say(`Session complete. ${right} of ${total} correct.`);
}

const PROMPT = `Turn everything we just covered into a Learning Pit module. Reply with ONLY a JSON code block:
{"id":"kebab-case-id","title":"…","icon":"one emoji","description":"…","tags":["…"],
 "cards":[{"front":"question or cue","back":"answer","hint":"optional nudge",
           "note":"optional why, shown after answering","alt":["other wordings that count as right"],
           "options":["optional plausible wrong answers"]}]}
Rules: one idea per card, front is a question or cue (never "explain X"), back under ~20 words,
15-40 cards, and no card answerable from the wording of another.`;

// Enough to curate a generated batch by eye; beyond that, trust it and prune in the editor.
const PICK_ROWS = 60;

function importView() {
  const pend = view.pending;
  app.innerHTML = `
    <button class="back" data-act="back">‹ back</button>
    <h1>Import a module</h1>
    ${pend ? `
      <p class="lede">Found ${pend.reduce((n, m) => n + m.cards.length, 0)} cards in ${pend.length} module${pend.length > 1 ? 's' : ''}.</p>
      ${pend.map(m => {
        const existing = modules.find(x => x.id === m.id);
        const kept = existing ? m.cards.filter(c => existing.cards.some(e => e.front === c.front)).length : 0;
        // A re-paste of an updated module deserves a real diff, not just a card count:
        // what is new is what the author came to curate, what is gone is what they lose.
        const fresh = existing ? new Set(newCards(existing.cards, m.cards).map(ident)) : new Set();
        const gone = existing ? newCards(m.cards, existing.cards).length : 0;
        return `<div class="preview">
        <b>${esc(m.title)}</b> <small>${m.cards.length} cards</small>
        ${existing ? `<p class="warn">Replaces the existing “${esc(existing.title)}” (${existing.cards.length} cards).
          ${kept === 1 ? '1 card keeps its' : `${kept} cards keep their`} review history; the rest start fresh.
          ${fresh.size ? `${fresh.size} of these ${fresh.size === 1 ? 'is' : 'are'} new.` : ''}
          ${gone ? `${gone} old card${gone === 1 ? ' is' : 's are'} not in this paste and will go.` : ''}</p>
` : ''}
        ${modules.length ? `<button class="linky" data-act="appendto" data-id="${esc(m.id)}">
          or add only its new cards to a module you already have…</button>` : ''}
        <ol class="picklist">${m.cards.slice(0, PICK_ROWS).map((c, i) => `<li>
          <label><input type="checkbox" class="pick" data-drop="${esc(m.id)}:${i}"
            ${view.drop?.includes(m.id + ':' + i) ? '' : 'checked'}>
          <span>${esc(c.front)}${fresh.has(ident(c)) ? ' <b class="newtag">new</b>' : ''}</span><em>${esc(c.back)}</em></label></li>`).join('')}</ol>
        ${m.cards.length > PICK_ROWS
          ? `<small class="dim">…and ${m.cards.length - PICK_ROWS} more, all included</small>` : ''}
      </div>`;
      }).join('')}
      <div class="row">
        <button class="btn" data-act="commit">Add to library</button>
        <button class="btn ghost" data-act="import">Start over</button>
      </div>`
    : `
      <p class="lede">Paste anything: JSON, a markdown table, <code>Q:</code>/<code>A:</code> lines,
      a bullet glossary, or <code>front :: back</code> per line.</p>
      <textarea id="paste" rows="9" spellcheck="false" aria-label="Paste cards here"
        placeholder="Paste Claude's answer here…"></textarea>
      <div class="row wrap">
        <button class="btn" data-act="paste">Read it</button>
        ${navigator.clipboard?.readText ? '<button class="btn ghost" data-act="clip">Paste from clipboard</button>' : ''}
        <label class="btn ghost">Open file…<input class="sr" type="file" accept=".json,.md,.txt,.csv,.tsv,text/*" multiple id="file"></label>
      </div>
      <div class="row">
        <input id="url" aria-label="URL of a module to fetch" placeholder="…or a URL to a module JSON">
        <button class="btn ghost" data-act="fetchurl">Fetch</button>
      </div>
      <p class="lede dim">Drop a file anywhere on this screen. Not sure what to ask Claude for?
      <button class="linky" data-act="copyprompt">Copy the prompt</button>, or use the
      <a class="linky" href="PROMPT.md" target="_blank" rel="noopener">full authoring brief</a>
      for a module you care about.</p>`}
    <p id="err" class="err"></p>
    ${(state.custom || []).length ? `<h2>Imported</h2><div class="list">${state.custom.map(m => `
      <div class="li"><span>${esc(m.title)} <small>${m.cards.length} cards</small></span>
      <button class="ghost sm" data-act="delcustom" data-id="${esc(m.id)}">remove</button></div>`).join('')}</div>` : ''}`;
  document.getElementById('file')?.addEventListener('change', e => readFiles(e.target.files));
  for (const box of app.querySelectorAll('[data-drop]')) {
    box.addEventListener('change', e => {
      const k = e.target.dataset.drop;
      view.drop = e.target.checked ? (view.drop || []).filter(x => x !== k) : [...(view.drop || []), k];
      // No redraw: the checkbox already shows the state, and redrawing would lose the scroll.
    });
  }
}

async function readFiles(files) {
  const out = [];
  for (const f of files) {
    try { out.push(...parseImport(await f.text(), f.name.replace(/\.[^.]+$/, ''))); }
    catch (e) { return showErr(new Error(`${f.name}: ${e.message}`)); }
  }
  if (out.length) { view = { name: 'import', pending: out }; render(); }
}

// "Open with Learning Pit": the OS hands files over the way a drop does. Registering the
// consumer replays any launch that queued while the app was still loading.
if ('launchQueue' in window) {
  launchQueue.setConsumer(async p => {
    if (!p.files?.length) return;
    view = { name: 'import' };
    readFiles(await Promise.all(p.files.map(h => h.getFile())));
  });
}

// Drop anywhere on the import screen. ponytail: no drag-over styling, the toast is enough.
document.addEventListener('dragover', e => { if (view.name === 'import') e.preventDefault(); });
document.addEventListener('drop', e => {
  if (view.name !== 'import') return;
  e.preventDefault();
  if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
});

// Fork-on-write: bundled modules stay pristine on disk; the edited copy lives in
// state.custom and shadows it by id. Cards get stable ids so fixing a typo in the
// front text doesn't orphan that card's review history.
function editable(id) {
  let c = (state.custom || []).find(x => x.id === id);
  if (!c) {
    const m = modules.find(x => x.id === id);
    if (!m) return null;
    c = JSON.parse(JSON.stringify(m));
    c.cards.forEach(card => { card.id = card.id || hash(card.front); });
    c.savedAt = Date.now();
    state.custom = [...(state.custom || []), c];
    save();
  }
  return c;
}

// A phone photo is 3 MB and localStorage holds about 5 MB, so shrink before storing:
// 480px on the long edge is plenty on a card and lands around 30 KB.
function shrinkImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const webp = canvas.toDataURL('image/webp', 0.8);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image this browser can read.')); };
    img.src = url;
  });
}

// Record straight into the card. Ten seconds is more than any answer needs and keeps the
// clip small enough to live in localStorage and ride along in a sync.
let recorder = null;
function recordClip(onDone, onFail) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return onFail(new Error('This browser cannot record.'));
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      recorder = null;
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => onDone(reader.result);
      reader.onerror = () => onFail(new Error('Could not read the recording.'));
      reader.readAsDataURL(blob);
    };
    recorder.start();
    setTimeout(() => recorder?.state === 'recording' && recorder.stop(), 10000);
  }).catch(() => onFail(new Error('Microphone blocked.')));
}

async function touch(m) {
  m.savedAt = Date.now();
  save();
  await loadModules();
  render();
}

// Where this card stands for the current learner, in three words or fewer, plus the last few
// answers as dots — a run of misses is visible at a glance.
function cardState(s) {
  if (!s) return 'new';
  if (s.susp) return 'paused';
  const days = Math.round((s.due - Date.now()) / 86400000);
  const when = days <= 0 ? 'due now' : days === 1 ? 'due tomorrow' : `due in ${days}d`;
  const dots = (s.log || '').slice(-6).replace(/a/g, '●').replace(/[ge]/g, '○');
  return dots ? `<span class="log" title="oldest to newest">${dots}</span> ${when}` : when;
}

// Reading a module through is not studying it, and sometimes it is exactly what you want:
// checking a fresh import, or seeing what a child is about to be asked.
// Speaks card i and then the next, for as long as the reader stays on this screen. The view
// is re-checked every step: leaving the screen or pressing stop ends it without a flag to unset.
function readOn(id, i) {
  const m = modules.find(x => x.id === id);
  const c = m?.cards[i];
  if (!c || view.name !== 'browse' || view.id !== id || view.reading !== i) return;
  document.querySelector('.li.reading.now')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  speak(`${c.front}. ${c.back}`, true, () => {
    if (view.name !== 'browse' || view.id !== id || view.reading !== i) return;
    // A beat between cards, so they do not run together — and so a browser that refuses to
    // speak at all steps through visibly instead of blinking to the end.
    setTimeout(() => {
      if (view.name !== 'browse' || view.id !== id || view.reading !== i) return;
      if (i + 1 >= m.cards.length) { view.reading = null; return render(); }
      view.reading = i + 1;
      render();
      readOn(id, i + 1);
    }, 400);
  }, c);
}

function browseView(id) {
  const m = modules.find(x => x.id === id);
  if (!m) { view = { name: 'home' }; return home(); }
  const srs = P().srs;
  app.innerHTML = `
    <button class="back" data-act="back">‹ back</button>
    <h1>${esc(m.icon || '')} ${esc(m.title)}</h1>
    <p class="lede">${m.cards.length} cards, in order. Nothing here is graded.</p>
    ${window.speechSynthesis ? `<div class="row wrap">
      <button class="btn ${view.reading == null ? '' : 'ghost'}" data-act="${view.reading == null ? 'readall' : 'readstop'}">
        ${view.reading == null ? '▶ Read it to me' : '■ Stop reading'}</button>
      ${view.reading == null ? '' : `<small class="dim">card ${view.reading + 1} of ${m.cards.length}</small>`}
    </div>` : ''}
    <div class="list read">${m.cards.map((c, i) => `<div class="li reading ${view.reading === i ? 'now' : ''}">
      <div>
        ${pic(c)}
        <b>${fmt(c.front)}</b>
        ${c.hint ? `<small class="hint">${esc(c.hint)}</small>` : ''}
        <em>${fmt(c.back)}</em>
        ${note(c)}
      </div>
      <div class="readside">
        <small class="dim">${cardState(srs[cardKey(m.id, c)])}</small>
        ${c.audio || opt().tts ? `<button class="ghost sm" data-act="readaloud" data-i="${i}">🔊</button>` : ''}
        ${opt().kid ? '' : `<button class="ghost sm" data-act="editfrom" data-i="${i}" aria-label="Edit this card">✎</button>`}
      </div>
    </div>`).join('')}</div>`;
}

const EDIT_ROWS = 200;

// Pausing several at once, in the current learner's schedule only — a paused card is a fact
// about this learner, not about the module.
function setPausedForSelection(paused) {
  const m = editable(view.id), p = P(), now = Date.now();
  for (const i of view.sel || []) {
    const c = m.cards[i];
    if (!c) continue;
    const k = cardKey(m.id, c);
    const s = p.srs[k] = Object.assign({ reps: 0, lapses: 0, ease: 2.5, interval: 0, due: now }, p.srs[k]);
    s.susp = paused;
    if (!paused) { s.lapses = 0; s.due = now; }
    s.t = now;
  }
  const n = (view.sel || []).length;
  view.sel = [];
  save();
  render();
  toast(`${n} card${n === 1 ? '' : 's'} ${paused ? 'paused' : 'back in rotation'}.`);
}

// A generated module is quick to make and quick to be sloppy. This is the second read a
// human would give it: not a verdict, a list of cards worth looking at again.
function auditBanner(m) {
  const byCard = new Map();
  for (const it of auditModule(m.cards)) byCard.set(it.i, [...(byCard.get(it.i) || []), it]);
  if (!byCard.size) return '';
  const rows = [...byCard].slice(0, 10);
  return `<div class="preview audit">
    <b>${byCard.size} card${byCard.size === 1 ? '' : 's'} worth a second look</b>
    <div class="list">${rows.map(([i, its]) => `<div class="li">
      <button class="rowbtn" data-act="editcard" data-i="${i}">
        <span>${esc(m.cards[i].front)}</span>
        <em>${its.map(x => esc(`${x.kind} — ${x.why}`)).join(' · ')}</em></button>
    </div>`).join('')}</div>
    ${byCard.size > rows.length ? `<small class="dim">…and ${byCard.size - rows.length} more</small>` : ''}
  </div>`;
}

function editView(id) {
  const m = (state.custom || []).find(x => x.id === id) || modules.find(x => x.id === id);
  if (!m) return ACT.home();
  const srs = P().srs, editing = view.editing;
  app.innerHTML = `
    <button class="back" data-act="back">‹ back</button>
    <h1>Edit</h1>
    <div class="row">
      <label class="stack icon-field">Icon<input data-field="icon" value="${esc(m.icon || '')}" maxlength="4"></label>
      <label class="stack grow">Title<input data-field="title" value="${esc(m.title)}"></label>
    </div>
    <label class="stack">Description<input data-field="description" value="${esc(m.description || '')}"></label>
    <div class="row">
      <label class="stack grow">Tags <small class="dim">(comma separated — they drive the filters)</small>
        <input data-field="tags" value="${esc((m.tags || []).join(', '))}"></label>
      <label class="stack icon-field">Spoken as <small class="dim">(fr, de…)</small>
        <input data-field="lang" value="${esc(m.lang || '')}" maxlength="12" placeholder="—"></label>
    </div>
    ${auditBanner(m)}
    <h2>${m.cards.length} cards</h2>
    ${m.cards.length > 12 ? `<input id="cardq" type="search" aria-label="Filter cards" placeholder="Filter cards" value="${esc(view.cq || '')}">` : ''}
    <div class="list">${m.cards.map((c, i) => {
      if (view.cq && i !== editing && !norm(c.front + ' ' + c.back).includes(norm(view.cq))) return '';
      // ponytail: a flat cap instead of virtual scrolling. Filter to reach the rest.
      if (!view.cq && i >= EDIT_ROWS && i !== editing) return '';
      const s = srs[cardKey(m.id, c)];
      if (i !== editing) return `<div class="li card-row ${s?.susp ? 'paused' : ''} ${view.sel?.includes(i) ? 'chosen' : ''}">
        <input type="checkbox" class="pick" data-pick="${i}" ${view.sel?.includes(i) ? 'checked' : ''}
          aria-label="Select this card">
        <button class="rowbtn" data-act="editcard" data-i="${i}">
          <span>${esc(c.front)}</span><em>${esc(c.back)}</em></button>
        <small class="dim state">${cardState(s)}</small>
      </div>`;
      return `<div class="li editing">
        <label class="stack">Front<textarea data-card="front" rows="2">${esc(c.front)}</textarea></label>
        <label class="stack">Back<textarea data-card="back" rows="2">${esc(c.back)}</textarea></label>
        <label class="stack">Hint <small class="dim">(shown before the answer)</small><input data-card="hint" value="${esc(c.hint || '')}"></label>
        <label class="stack">Note <small class="dim">(the why, shown after)</small><textarea data-card="note" rows="2">${esc(c.note || '')}</textarea></label>
        <label class="stack">Source <small class="dim">(a link back to where this came from)</small><input data-card="source" value="${esc(c.source || '')}"></label>
        <label class="stack">Also accept <small class="dim">(one per line — other wordings that count as right)</small><textarea data-card="alt" rows="2">${esc((c.alt || []).join('\n'))}</textarea></label>
        <label class="stack">Wrong answers <small class="dim">(one per line, for multiple choice)</small><textarea data-card="options" rows="2">${esc((c.options || []).join('\n'))}</textarea></label>
        <div class="stack">Sound <small class="dim">(a recording of the answer)</small>
          <div class="row wrap picrow">
            ${c.audio ? '<button class="ghost sm" data-act="playcard">▶ play</button>' : ''}
            <button class="ghost sm ${recorder ? 'recording' : ''}" data-act="rec">${recorder ? '■ stop' : '● record'}</button>
            ${c.audio ? '<button class="ghost sm" data-act="delaudio">Remove</button>' : ''}
          </div>
        </div>
        <div class="stack">Picture <small class="dim">(shown with the question)</small>
          <div class="row wrap picrow">
            ${c.image ? `<img class="thumb" src="${esc(c.image)}" alt="">` : ''}
            <label class="btn ghost">${c.image ? 'Replace' : 'Add a picture'}
              <input class="sr" type="file" accept="image/*" id="cardpic"></label>
            ${navigator.onLine ? '<button class="ghost sm" data-act="findpic">Find one</button>' : ''}
            ${c.image ? '<button class="ghost sm" data-act="delpic">Remove</button>' : ''}
          </div>
          ${view.found ? `<p class="lede small-note">${view.found.length
            ? 'From Wikimedia Commons — tap one to use it. The card keeps a link to where it came from.'
            : 'Nothing found for that — try another word.'}</p>
          <div class="pics found">${view.found.map((f, i) => `<button class="pictile" data-act="usepic" data-i="${i}"
            aria-label="${esc(f.title)}"><img class="cardimg" src="${esc(f.thumb)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        </div>
        <div class="row">
          <button class="btn" data-act="savecard" data-i="${i}">Save</button>
          <button class="ghost sm" data-act="pausecard" data-i="${i}">${s?.susp ? 'Resume' : 'Pause'}</button>
          ${visible().some(x => x.id !== m.id) ? `<button class="ghost sm" data-act="movecard">Move to…</button>` : ''}
          <button class="ghost sm" data-act="delcard" data-i="${i}">Delete</button>
        </div>
      </div>`;
    }).join('')}</div>
    ${!view.cq && m.cards.length > EDIT_ROWS
      ? `<p class="lede">Showing the first ${EDIT_ROWS} of ${m.cards.length}. Filter to reach the rest.</p>` : ''}
    ${view.sel?.length ? `<div class="row wrap bulk">
      <b>${view.sel.length} selected</b>
      <button class="ghost sm" data-act="bulkdrill">Drill these</button>
      <button class="ghost sm" data-act="bulkpause">Pause</button>
      <button class="ghost sm" data-act="bulkresume">Resume</button>
      <button class="ghost sm" data-act="bulkdelete">Delete</button>
      <button class="ghost sm" data-act="bulkclear">Clear</button>
    </div>` : ''}
    ${view.cq ? `<button class="ghost sm" data-act="split">Move the filtered cards into a new module</button>` : ''}
    <div class="row wrap">
      <button class="btn" data-act="addcard" data-id="${esc(m.id)}">＋ Add a card</button>
      <button class="btn ghost" data-act="share" data-id="${esc(m.id)}">Share link</button>
      <button class="btn ghost" data-act="exportmodule" data-id="${esc(m.id)}">Export JSON</button>
      <button class="btn ghost" data-act="exporttsv" data-id="${esc(m.id)}">Export TSV</button>
      <button class="btn ghost" data-act="print">Print sheet</button>
      <button class="btn ghost" data-act="printcards" data-id="${esc(m.id)}">Print cut-outs</button>
    </div>
    <p id="err" class="err"></p>`;
  // Card fields write through as you type and persist on blur, so tapping another card —
  // or closing the tab — never silently throws the edit away. Save just closes the row.
  const stage = () => {
    if (view.editing == null) return null;
    const target = editable(view.id);
    const c = target.cards[view.editing];
    const get = f => app.querySelector(`[data-card="${f}"]`)?.value.trim() ?? '';
    c.front = get('front').slice(0, 2000) || c.front;
    c.back = get('back').slice(0, 4000) || c.back;
    c.hint = get('hint').slice(0, 500) || undefined;
    c.note = get('note').slice(0, 2000) || undefined;
    const src = get('source').slice(0, 500);
    c.source = /^https?:\/\//i.test(src) ? src : undefined;
    const alts = get('alt').split('\n').map(o => o.trim().slice(0, 200)).filter(o => o && o !== c.back);
    c.alt = alts.length ? [...new Set(alts)].slice(0, 5) : undefined;
    const opts = get('options').split('\n').map(o => o.trim().slice(0, 200)).filter(o => o && o !== c.back);
    c.options = opts.length ? [...new Set(opts)].slice(0, 5) : undefined;
    return target;
  };
  for (const el of app.querySelectorAll('[data-card]')) {
    el.addEventListener('input', stage);
    el.addEventListener('change', () => { stage(); save(); });
  }
  document.getElementById('cardpic')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await shrinkImage(file);
      const target = editable(view.id);
      target.cards[view.editing].image = data;
      say(`Picture added (${Math.round(data.length / 1024)} KB).`);
      touch(target);
    } catch (err) { showErr(err); }
  });
  app.querySelector('.li.editing')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  for (const box of app.querySelectorAll('[data-pick]')) {
    box.addEventListener('change', e => {
      const i = +e.target.dataset.pick;
      view.sel = e.target.checked ? [...(view.sel || []), i] : (view.sel || []).filter(x => x !== i);
      render();
    });
  }
  const cq = document.getElementById('cardq');
  if (cq) {
    cq.addEventListener('input', e => { view.cq = e.target.value; view.editing = null; render(); });
    if (view.cq) { cq.focus(); cq.setSelectionRange(cq.value.length, cq.value.length); }
  }

  const LIMITS = { title: 120, description: 500, icon: 4, tags: 200, lang: 12 };
  for (const el of app.querySelectorAll('[data-field]')) {
    el.addEventListener('change', e => {
      const f = e.target.dataset.field;
      const v = e.target.value.trim().slice(0, LIMITS[f]);
      if (f === 'title' && !v) return showErr(new Error('A module needs a title.'));
      if (f === 'lang') {
        if (v && !/^[a-z]{2,3}(-[A-Za-z]{2,8})?$/.test(v)) return showErr(new Error('Use a tag like fr or de-AT.'));
        m.lang = v || undefined;
      } else if (f === 'tags') {
        m.tags = [...new Set(v.toLowerCase().split(',').map(t => t.trim().slice(0, 32)).filter(Boolean))].slice(0, 12);
      } else {
        m[f] = v || undefined;
      }
      touch(m);
    });
  }
  app.querySelector('.editing textarea')?.focus();
}

// Reviews per profile over the last 7 days — cousins keep score whether you build it or not.
// Earned ones in colour, the next one dim with its price on it — a child needs to see what
// they are working towards, not just what they have.
function stickerShelf(stars) {
  const got = new Set(stickersFor(stars).map(s => s.at));
  const next = STICKERS.find(s => !got.has(s.at));
  return `<h2>Stickers</h2>
    <div class="shelf">${STICKERS.map(s => got.has(s.at)
      ? `<span class="sticker" title="${esc(s.name)}">${s.emoji}</span>`
      : `<span class="sticker locked" title="${s.at} stars">${s.emoji}<small>${s.at}★</small></span>`).join('')}</div>
    ${next ? `<p class="lede">${next.at - stars} more star${next.at - stars === 1 ? '' : 's'} for ${next.emoji} ${esc(next.name)}.</p>`
      : '<p class="lede">Every sticker collected.</p>'}`;
}

function familyBoard() {
  if (Object.keys(state.profiles).length < 2) return '';
  const rows = weeklyTotals(state.profiles);
  const top = Math.max(1, rows[0].total);
  return `<h2>This week</h2>
    ${rows.map(r => `<div class="bar-row">
      <span><b class="who"><span aria-hidden="true">${esc(r.avatar)}</span> ${esc(r.name)}</b><small>${r.total} card${r.total === 1 ? '' : 's'}</small></span>
      <div class="bar"><i style="width:${Math.round((r.total / top) * 100)}%"></i></div>
    </div>`).join('')}`;
}

// The pairs that keep blurring together, across every sitting. One mix-up is noise; the
// same two cards three times is a diagnosis.
function confusionsList() {
  const worst = (P().stats.confusions || []).filter(x => x.n >= 2).slice(0, 5);
  if (!worst.length) return '';
  return `<h2>Often confused</h2>
    <div class="list">${worst.map(x => `<div class="li">
      <span><b>${esc(x.a)}</b> ↔ <b>${esc(x.b)}</b> <small>${x.n}×</small></span>
      <button class="ghost sm" data-act="drillconfusion" data-a="${esc(x.a)}" data-b="${esc(x.b)}">drill the pair</button>
    </div>`).join('')}</div>`;
}

// Mastery by subject: the level "what should I study?" is actually asked at. Tapping one
// lands on the home shelf filtered to it, where the drill-everything button waits.
function subjects() {
  const tags = tagTotals(visible(), P().srs).slice(0, 6);
  if (tags.length < 2) return '';
  return `<h2>By subject</h2>
    ${tags.map(t => `<div class="bar-row">
      <button class="rowbtn" data-act="subject" data-t="${esc(t.tag)}">
        <span>${esc(t.tag)}<small>${t.learned}/${t.total}${t.due ? ` · ${t.due} due` : ''}</small></span></button>
      <div class="bar ${t.due ? 'weak' : ''}"><i style="width:${Math.round((t.learned / t.total) * 100)}%"></i></div>
    </div>`).join('')}`;
}

// The last few sittings, in the order they happened. A heatmap says how much; this says what.
function sittings() {
  const log = (P().stats.sessions || []).slice(0, 8);
  if (!log.length) return '';
  const when = t => {
    const days = Math.floor((Date.now() - t) / 86400000);
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };
  return `<h2>Recent sittings</h2>
    <div class="list">${log.map(s => `<div class="li">
      <span>${esc(s.m)} <small>${esc(GAMES[s.g]?.label || s.g)} · ${when(s.t)}</small></span>
      <b class="${s.w === 0 ? 'clean' : ''}">${s.r}/${s.r + s.w}</b>
    </div>`).join('')}</div>`;
}

// The week in a sentence, and a way to send it to whoever is asking how it is going —
// a parent, usually, about a child who is not going to write it down themselves.
function recapLine() {
  const w = weekSummary(P().stats);
  if (!w.reviews) return '';
  // Time spent is the one figure nobody guesses right about themselves.
  const week = Date.now() - 7 * 86400000;
  const secs = (P().stats.sessions || [])
    .filter(s => s.t > week && s.secs > 0 && s.secs < 4 * 3600)
    .reduce((n, s) => n + s.secs, 0);
  const spent = secs >= 3600 ? `${(secs / 3600).toFixed(1)} hours`
    : secs >= 60 ? `${Math.round(secs / 60)} minutes` : '';
  return `<p class="lede">This week: <b>${w.reviews}</b> reviews on ${w.active} of 7 days,
    <b>${w.pct}%</b> right${w.best.n ? `, best day ${w.best.n}` : ''}${spent ? `, ${spent} in the pit` : ''}.
    <button class="linky" data-act="recap">share it</button></p>`;
}

// Only worth saying once there is enough of it to be true, which bestTime() decides.
function timeOfDayLine() {
  const t = bestTime(P().stats.sessions || []);
  if (!t || t.best.pct - t.worst.pct < 10) return '';
  return `<p class="lede">You answer best in the <b>${esc(t.best.name)}</b> — ${t.best.pct}% there
    against ${t.worst.pct}% ${esc(t.worst.name)}.</p>`;
}

// The long view, once there is one: a month of days is where a week stops being the story.
function yearLine() {
  const y = yearSummary(P().stats);
  if (y.active < 30) return '';
  const when = y.busiest ? new Date(y.busiest.month + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long' }) : '';
  return `<p class="lede">Last twelve months: <b>${y.reviews}</b> reviews on ${y.active} days, <b>${y.pct}%</b> right${
    when ? `, busiest in ${esc(when)}` : ''}.</p>`;
}

function recapText() {
  const w = weekSummary(P().stats), st = P().stats;
  const rank = rankFor(learnedCount()).rank;
  return `${state.active} in the Learning Pit this week: ${w.reviews} reviews on ${w.active} of 7 days, `
    + `${w.pct}% right, ${learnedCount()} cards resting. `
    + `${st.streak || 0} day streak, ${st.stars || 0} stars, rank ${rank.name}.`;
}

function progressView() {
  const p = P(), st = p.stats, days = st.days || {};
  const acc = st.reviews ? Math.round((st.correct / st.reviews) * 100) : 0;
  // Recent accuracy says more than the lifetime figure once a few hundred reviews are in.
  const week = Array.from({ length: 7 }, (_, i) => dayStr(Date.now() - i * 86400000))
    .reduce((a, d) => ({ reviews: a.reviews + (days[d] || 0), hits: a.hits + ((st.hits || {})[d] || 0) }), { reviews: 0, hits: 0 });

  // 17 weeks of activity, Sunday-first columns, most recent on the right.
  const cells = [];
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (16 * 7 + start.getDay()));
  for (let i = 0; i < 17 * 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = dayStr(d.getTime());
    const n = days[key] || 0;
    cells.push(`<i class="cell l${n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4}"
      title="${key}: ${n} review${n === 1 ? '' : 's'}"></i>`);
  }

  // What lands in the next week, and what keeps slipping.
  const now = Date.now();
  const mastery = [];
  for (const m of visible()) {
    const c = counts(m.cards, p.srs, m.id, now);
    if (c.learned + c.due) mastery.push({ m, c });
  }
  const month = forecast(visible(), p.srs, 30, now);
  const fc = month.slice(0, 7);
  const monthTotal = month.reduce((a, b) => a + b, 0);
  const heaviest = month.indexOf(Math.max(...month));
  const stuck = troubleSpots(visible(), p.srs);
  const peak = Math.max(1, ...fc);

  if (opt().kid) {
    app.innerHTML = `
      <button class="back" data-act="back">‹ back</button>
      <h1>${opt().avatar} ${esc(state.active)}</h1>
      <div class="pit done"><div class="card"><div class="face">
        <span class="stars big">${st.stars || 0}★</span>
        <p>${st.streak || 0} day${st.streak === 1 ? '' : 's'} in a row</p>
      </div></div></div>
      ${rankLine()}
      ${stickerShelf(st.stars || 0)}
      <h2>What you know</h2>
      ${mastery.length ? mastery.map(({ m, c }) => `<div class="bar-row">
        <span>${esc(m.title)}<small>${c.learned} of ${c.total}</small></span>
        <div class="bar"><i style="width:${Math.round((c.learned / c.total) * 100)}%"></i></div>
      </div>`).join('') : '<p class="lede">Play a game to fill this in.</p>'}
      ${familyBoard()}`;
    return;
  }
  app.innerHTML = `
    <button class="back" data-act="back">‹ back</button>
    <h1>${esc(state.active)}'s progress</h1>
    <div class="stats">
      <span><b>${st.streak || 0}</b>day streak</span>
      ${(st.bestStreak || 0) > (st.streak || 0)
        ? `<span><b>${st.bestStreak}</b>longest ever</span>` : ''}
      <span><b>${st.reviews || 0}</b>reviews</span>
      <span><b>${acc}%</b>correct</span>
      ${week.reviews ? `<span><b>${Math.round((week.hits / week.reviews) * 100)}%</b>this week</span>` : ''}
      <span><b>${mastery.reduce((n, x) => n + x.c.learned, 0)}</b>cards resting</span>
    </div>
    ${rankLine()}
    ${recapLine()}
    ${timeOfDayLine()}
    ${yearLine()}
    <h2>Activity</h2>
    <div class="heat" role="img" aria-label="Reviews per day over the last 17 weeks. ${
      Object.values(days).reduce((a, b) => a + b, 0)} reviews on ${Object.keys(days).length} days.">${cells.join('')}</div>
    <h2>Coming up</h2>
    <p class="lede small-note">A card you get right comes back in a day, then three, then
    further apart each time; one you get wrong comes back inside the sitting.</p>
    <div class="fc">${fc.map((n, i) => `<span title="${n} cards">
      <i style="height:${Math.round((n / peak) * 100)}%"></i>
      <small>${i === 0 ? 'today' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(now + i * 86400000).getDay()]}</small>
      <b>${n || ''}</b></span>`).join('')}</div>
    ${monthTotal ? `<p class="lede small-note">Next 30 days: ${monthTotal} review${monthTotal === 1 ? '' : 's'},
      heaviest ${heaviest === 0 ? 'today' : `on ${new Date(now + heaviest * 86400000)
        .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`} (${month[heaviest]}).</p>` : ''}
    <h2>Mastery</h2>
    ${mastery.length ? mastery.map(({ m, c }) => `<div class="bar-row">
      <span>${esc(m.title)}<small>${c.learned}/${c.total}</small></span>
      <div class="bar"><i style="width:${Math.round((c.learned / c.total) * 100)}%"></i></div>
    </div>`).join('') : '<p class="lede">Nothing studied yet.</p>'}
    ${confusionsList()}
    ${subjects()}
    ${sittings()}
    ${familyBoard()}
    ${stuck.length ? `<h2>Sticking points</h2>
      <p class="lede">The cards that keep going wrong, most recent trouble first. Drill them on their
      own, rewrite the ones that ask too much at once, or pause a card and come back to it later.</p>
      <div class="row"><button class="btn wide" data-act="drillstuck">Drill these ${stuck.length}</button></div>
      <div class="list">${stuck.slice(0, 10).map(l => `
        <div class="li">
          <button class="rowbtn" data-act="edit" data-id="${esc(l.module.id)}">
            <span>${esc(l.card.front)}</span><em>${esc(l.module.title)} · ${
              l.misses ? `${l.misses} of the last 6 missed` : `missed ${l.lapses}×`}</em></button>
          <button class="ghost sm" data-act="pausekey" data-k="${esc(cardKey(l.module.id, l.card))}">pause</button>
        </div>`).join('')}
        ${stuck.length > 10 ? `<p class="lede dim">…and ${stuck.length - 10} more</p>` : ''}</div>` : ''}
    <h2>Ask a tutor</h2>
    <p class="lede">Hand this progress to an agent through a folder on this device — CoworkSyncHub,
    Claude Desktop, or a person — and it will say what to study next. Nothing is uploaded.</p>
    <div id="coachhost"></div>
    <p class="lede" id="coachreply" style="display:none;white-space:pre-wrap"></p>`;
  mountCoach();
}

// Folder cowork through the maker's shared panel (https://adervec.github.io/cowork.js) in fs
// mode: it drives a folder you pick, we write coach/request.json into it and show whatever an
// agent writes back to coach/reply.json. Every screen rebuilds the DOM, so this re-mounts per
// render; the script is fetched once. Kid mode never reaches here — that branch returns above.
function loadCowork() {
  if (window.cowork) return Promise.resolve(window.cowork);
  const head = document.head || document.documentElement;
  if (!head || typeof head.appendChild !== 'function') return Promise.resolve(null);
  return new Promise(res => {
    try {
      const s = document.createElement('script');
      s.src = 'https://adervec.github.io/cowork.js';
      s.async = true;
      s.onload = () => res(window.cowork || null);
      s.onerror = () => res(null);
      head.appendChild(s);
    } catch { res(null); }
  });
}
function coachHash(t) {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
const COACH_INSTRUCTIONS = [
  '# Learning Pit - coach channel',
  '',
  'A learner is working through their own flashcard modules with spaced repetition. The app',
  'rewrites `coach/request.json` after every finished sitting and whenever the progress screen',
  'is opened, so it is always current; `generatedAt` says how current. It is built to be read',
  'as a whole by a coach, a daily brief or a weekly brief - nothing else needs opening.',
  '',
  'Read `coach/request.json`, `payload`:',
  '',
  '- `learner` - name, kid mode, daily goal, cards done today, today\'s local date, timezone.',
  '- `stats` - streak, best streak, last day studied, rest day spent, lifetime reviews and',
  '  accuracy, rank, stars.',
  '- `week` - the last 7 days: reviews, correct, active days, best day, accuracy, minutes.',
  '- `year` - the last 12 months: reviews, active days, accuracy, busiest month.',
  '- `days` - the last 35 days, oldest first, each `{day, reviews, correct}` (local dates):',
  '  compare yesterday with today, this week with last, without touching anything else.',
  '- `due` - the pile now: count, minutes at this learner\'s pace, modules involved, and',
  '  `forecast30`, reviews falling due per day for the next 30 days.',
  '- `pace` - seconds per card, and the part of the day they answer best and worst in.',
  '- `modules` - each visible module: id, title, tags, cards, learned, due, new, paused,',
  '  accuracy from its own sittings, when it was last studied, and its deadline plan if any.',
  '- `sittings` - the last fifty, newest first: time (ISO), module, game, right, wrong, seconds.',
  '- `stuck` - the questions that keep going wrong, with their answers and how often.',
  '- `confusions` - pairs of answers they mix up with each other.',
  '- `starred` - how many cards they marked to come back to; `parked` - cards taken out of',
  '  rotation after repeated misses, which usually need rewriting.',
  '- `family` - reviews this week per learner, when several share the device.',
  '',
  'Write `coach/reply.json`:',
  '',
  '```json',
  '{ "requestHash": "<copy the request\'s requestHash verbatim>",',
  '  "reply": "<short markdown: the one module to give time to this week and why, what the',
  '  sticking points have in common, and one concrete way to rewrite or split a card that keeps',
  '  failing. Warm and practical. Never scold a missed day.>" }',
  '```'
].join('\n');
// The one panel behind the folder. A brief that reads yesterday's numbers is no brief, so once
// a folder has been connected the request is rewritten after every finished sitting — from a
// hidden panel mounted at boot — and on every visit to the progress screen.
let coachPanel = null;
const COACH_FLAG = 'pit.cowork';
function coachConfig(show) {
  return {
    app: 'learning-pit',
    manifest: { protocol: 'cowork-manifest', protocolVersion: 1, app: 'learning-pit',
      channels: [{ name: 'coach', request: ['coach/request.json'],
        instructions: 'coach/INSTRUCTIONS.md', replyPath: 'coach/reply.json' }] },
    files: () => {
      const payload = briefPayload({ profiles: state.profiles, active: state.active, modules: visible() });
      return {
        'coach/request.json': { protocol: 'learning-pit-coach', protocolVersion: 2,
          kind: 'coach-request', generatedAt: new Date().toISOString(),
          requestHash: coachHash(JSON.stringify(payload)), payload },
        'coach/INSTRUCTIONS.md': COACH_INSTRUCTIONS,
      };
    },
    apply: (ch, reply) => {
      const t = typeof reply === 'string' ? reply
        : (reply && (reply.reply || (reply.payload && reply.payload.reply)))
          || JSON.stringify(reply, null, 2);
      try { localStorage.setItem('pit.coachreply', t); } catch { /* quota */ }
      show(t);
    },
  };
}
// The panel restores its folder on its own, asynchronously. Once a channel shows a request on
// disk the folder is live: remember that for the next boot, and write fresh numbers now.
function watchCoach(panel) {
  let tries = 0;
  const t = setInterval(() => {
    const live = (panel.channels || []).some(c => c.request_mtime > 0);
    if (live || ++tries > 16) clearInterval(t);
    if (live) {
      try { localStorage.setItem(COACH_FLAG, '1'); } catch { /* private mode */ }
      panel.push('coach');
    }
  }, 250);
}
// After a sitting: fresh numbers for whoever reads the folder. A no-op with no folder.
function pushCoach() { coachPanel?.push?.('coach'); }
function mountCoach(host = document.getElementById('coachhost'), out = document.getElementById('coachreply')) {
  if (!host || host.childElementCount) return;
  const show = t => { if (!out) return; out.textContent = t || ''; out.style.display = t ? 'block' : 'none'; };
  try { show(localStorage.getItem('pit.coachreply') || ''); } catch { /* private mode */ }
  loadCowork().then(cw => {
    if (!cw || host.childElementCount) return;
    coachPanel = cw.mount(host, coachConfig(show));
    watchCoach(coachPanel);
  });
}

// Two modules built from two conversations about the same subject will overlap, and each
// copy then carries its own schedule. Say so; merging or deleting is the learner's call.
function overlapNote() {
  const dupes = duplicatesAcross(visible());
  if (!dupes.length) return '';
  return `<h2>The same question, twice</h2>
    <p class="lede">${dupes.length} question${dupes.length === 1 ? '' : 's'} appear in more than one
    module, so each copy is scheduled separately. Merge the modules, or delete one copy.</p>
    <div class="list">${dupes.slice(0, 6).map(where => `<div class="li">
      <button class="rowbtn" data-act="edit" data-id="${esc(where[0].id)}">
        <span>${esc(where[0].front)}</span>
        <em>${where.map(w => esc(w.title)).join(' · ')}</em></button>
    </div>`).join('')}</div>`;
}

function settings() {
  const names = Object.keys(state.profiles);
  app.innerHTML = `
    <button class="back" data-act="back">‹ back</button>
    <h1>Settings</h1>
    <h2>Who is learning</h2>
    <div class="row wrap">
      ${names.map(n => `<button class="chip big ${n === state.active ? 'on' : ''}" data-act="profile" data-name="${esc(n)}">${
        (state.profiles[n].opts || {}).avatar || '◎'} ${esc(n)}</button>`).join('')}
      <button class="chip big" data-act="addprofile">＋ add</button>
    </div>
    <h2>${esc(state.active)}'s settings</h2>
    <div class="row wrap avatars">
      ${AVATARS.map(a => `<button class="chip ${opt().avatar === a ? 'on' : ''}" data-act="avatar" data-a="${a}"
        aria-label="Choose ${a}">${a}</button>`).join('')}
      <button class="chip" data-act="rename">✎ rename</button>
    </div>
    <div class="row wrap avatars">
      ${Object.entries(ACCENTS).map(([name, set]) => `<button class="chip swatch ${opt().accent === name ? 'on' : ''}"
        data-act="accent" data-c="${name}" aria-label="${name} light"
        style="--sw:${document.documentElement.dataset.theme === 'light' ? set.light[0] : set.dark[0]}"><span></span></button>`).join('')}
    </div>
    <label class="row"><input type="checkbox" data-opt="kid" ${opt().kid ? 'checked' : ''}> Kid mode <small class="dim">— two big buttons, stars instead of numbers</small></label>
    <label class="row"><input type="checkbox" data-opt="tts" ${opt().tts ? 'checked' : ''}> Read cards aloud</label>
    ${voices().length ? `<label class="row">Voice
      <select data-opt="voice">
        <option value="">Default</option>
        ${voices().filter(v => v.lang.startsWith((navigator.language || 'en').slice(0, 2)))
          .map(v => `<option ${opt().voice === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
      </select>
      <button class="ghost sm" data-act="tryvoice">Try it</button>
    </label>` : ''}
    <label class="row"><input type="checkbox" data-opt="sound" ${opt().sound ? 'checked' : ''}> Sound effects</label>
    <label class="row">Look
      <select data-opt="theme">${[['auto', 'Follow the device'], ['dark', 'Always dark'], ['light', 'Always light'], ['contrast', 'High contrast']]
        .map(([v, l]) => `<option value="${v}" ${opt().theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <label class="row">Reading speed
      <select data-opt="rate">${[[0, 'Normal'], [0.7, 'Slow'], [1.15, 'Quick']]
        .map(([v, l]) => `<option value="${v}" ${(opt().rate || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    ${window.appFont ? `<label class="row">Font
      <select id="fontpick">${window.appFont.options
        .map(o => `<option value="${esc(o.id)}" ${window.appFont.get() === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
    </label>` : ''}
    <label class="row">Text size
      <select data-opt="text">${[[90, 'Small'], [100, 'Normal'], [115, 'Large'], [135, 'Very large']]
        .map(([v, l]) => `<option value="${v}" ${opt().text === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <label class="row">Cards per session
      <select data-opt="size">${[6, 12, 20, 40].map(n => `<option ${opt().size === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </label>
    <label class="row">Daily goal
      <select data-opt="goal">${[0, 10, 20, 40, 80].map(n => `<option value="${n}" ${opt().goal === n ? 'selected' : ''}>${n || 'off'}</option>`).join('')}</select>
    </label>
    ${modules.length > 1 ? `<h2>Modules ${esc(state.active)} can see</h2>
      <div class="list">${modules.map(m => `<label class="li">
        <span><span aria-hidden="true">${esc(m.icon || '◈')}</span> ${esc(m.title)} <small>${m.cards.length} cards</small></span>
        <input type="checkbox" data-show="${esc(m.id)}" ${opt().hidden.includes(m.id) ? '' : 'checked'}>
      </label>`).join('')}</div>` : ''}
    ${overlapNote()}
    ${names.length > 1 ? `<button class="ghost sm" data-act="delprofile">Remove ${esc(state.active)}</button>` : ''}
    <h2>Sync (Google Drive)</h2>
    <p class="lede">Progress and imported modules live in this app's private Drive folder.
      ${deployClientId && !state.settings.clientId
        ? 'This deployment already carries a client ID — just connect.'
        : 'Paste an OAuth client ID — see README.md.'}</p>
    <input id="cid" aria-label="Google OAuth client ID" placeholder="xxxxx.apps.googleusercontent.com"
      value="${esc(state.settings.clientId || '')}" spellcheck="false">
    ${signedIn() && account ? `<p class="acct">${accountPic()}<span>${esc(account.name || account.email)}</span>
      ${account.name && account.email ? `<em>${esc(account.email)}</em>` : ''}</p>` : ''}
    <div class="row wrap">
      <button class="btn" data-act="signin">${signedIn() ? 'Sync now' : 'Connect Google'}</button>
      ${signedIn() ? '<button class="btn ghost" data-act="signout">Sign out</button>' : ''}
      <button class="btn ghost" data-act="export">Export backup</button>
      <button class="btn ghost" data-act="exportmd">Export as markdown</button>
      <button class="btn ghost" data-act="exporthistory">Export history CSV</button>
      <button class="btn ghost" data-act="remindme">Daily reminder</button>
      <label class="btn ghost">Restore backup<input class="sr" type="file" accept=".json,application/json" id="restore"></label>
      <button class="btn ghost" data-act="install">Install app</button>
    </div>
    <p class="lede">${state.settings.lastSync ? 'Last sync ' + new Date(state.settings.lastSync).toLocaleString() : 'Never synced.'}</p>
    <h2>This device</h2>
    <p class="lede" id="usage">…</p>
    <div id="heavy"></div>
    <button class="ghost sm" data-act="wipe">Erase everything on this device</button>
    <p id="err" class="err"></p>
    <h2>Elsewhere</h2>
    <p class="lede">More apps by the same maker, all free and local-first —
      <a class="linky" href="https://adervec.github.io/portal/" target="_blank"
        rel="noopener">adervec.github.io</a></p>`;
  for (const el of app.querySelectorAll('[data-opt]')) {
    el.addEventListener('change', e => {
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      const key = e.target.dataset.opt;
      const word = key === 'voice' || key === 'theme';
      setOpt({ [key]: e.target.tagName === 'SELECT' && !word ? +v : v });
      render();
    });
  }
  // The font is the device's, shared with the maker's other apps on this origin — not a
  // learner's setting, so it lives in font.js's own key rather than in opts.
  document.getElementById('fontpick')?.addEventListener('change', e => window.appFont.set(e.target.value));
  usageLine();
  for (const el of app.querySelectorAll('[data-show]')) {
    el.addEventListener('change', e => {
      const id = e.target.dataset.show, o = opt();
      setOpt({ hidden: e.target.checked ? o.hidden.filter(x => x !== id) : [...new Set([...o.hidden, id])] });
    });
  }
  document.getElementById('cid').addEventListener('change', e => { state.settings.clientId = e.target.value.trim(); tokenClient = null; save({ sync: false }); renderBar(); });
  // Restore merges rather than replaces: a backup from one tablet must not wipe another's work.
  document.getElementById('restore').addEventListener('change', async e => {
    try {
      const backup = JSON.parse(await e.target.files[0].text());
      if (!backup || typeof backup !== 'object' || !backup.profiles) throw new Error('That is not a Learning Pit backup.');
      state = mergeState(state, backup);
      save();
      await loadModules();
      render();
      toast(`Restored — ${Object.keys(state.profiles).length} learners, ${(state.custom || []).length} imported modules.`);
    } catch (err) { showErr(err); }
  });
}

async function usageLine() {
  const el = document.getElementById('usage');
  if (!el) return;
  // Everything, pictures and recordings included — they live in IndexedDB, but they are still weight.
  const kb = Math.round(JSON.stringify(state).length / 1024);
  const cards = modules.reduce((n, m) => n + m.cards.length, 0);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  el.textContent = `${cards} cards in ${modules.length} modules · ${kb} KB stored`
    + (persisted ? ' · the browser has been asked to keep it' : '');
  // localStorage holds ~5 MB, and pictures and recordings are what actually fill it.
  // Once the store is heavy, say which modules are carrying the weight.
  const box = document.getElementById('heavy');
  if (!box || kb < 2000) return;
  const weighed = (state.custom || [])
    .map(m => ({ m, kb: Math.round(JSON.stringify(m).length / 1024) }))
    .filter(x => x.kb >= 100)
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 5);
  if (!weighed.length) return;
  box.innerHTML = `<p class="lede small-note">The heaviest modules — pictures and recordings, usually.
    They are kept apart from your progress, so they cannot crowd it out:</p>
    <div class="list">${weighed.map(x => `<div class="li">
      <button class="rowbtn" data-act="edit" data-id="${esc(x.m.id)}">
        <span>${esc(x.m.title)}</span><em>${x.kb} KB</em></button>
    </div>`).join('')}</div>`;
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  say('Saved ' + name);
}

function showErr(e) {
  const el = document.getElementById('err');
  if (el) el.textContent = e.message || String(e);
  say(e.message || String(e));
}

// ---------------- speech ----------------

// Chrome populates the voice list asynchronously — redraw Settings when it lands.
window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
  if (view.name === 'settings') render();
});

const voices = () => window.speechSynthesis?.getVoices?.() || [];

// A card that carries a recording plays that instead of a synthesised voice — a real
// pronunciation beats a robot reading letters.
let clip = null;
function playClip(card, onEnd) {
  if (!card?.audio) return false;
  clip?.pause();
  clip = new Audio(card.audio);
  clip.onended = clip.onerror = () => onEnd?.();
  clip.play().catch(() => onEnd?.());
  return true;
}

// The language of whatever module is on screen — a session's, or the one being read through.
function currentLang() {
  return session?.module?.lang
    || (view?.name === 'browse' && modules.find(x => x.id === view.id)?.lang)
    || '';
}

function speak(text, force, onEnd, card) {
  if (card?.audio && (force || opt().tts) && playClip(card, onEnd)) return;
  if (!(force || opt().tts) || !window.speechSynthesis) return onEnd?.();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opt().rate || (opt().kid ? 0.85 : 0.95);   // 0 means "whatever suits this learner"
  // A French module read in the device's English voice is worse than silence. The tag lets
  // the engine pick a matching voice; an explicitly chosen voice still wins.
  const lang = currentLang();
  if (lang) u.lang = lang;
  if (lang) {
    const match = voices().find(v => v.lang?.toLowerCase().startsWith(lang.toLowerCase()));
    if (match) u.voice = match;
  } else {
    const chosen = voices().find(v => v.name === opt().voice);
    if (chosen) u.voice = chosen;
  }
  if (onEnd) {
    u.onend = onEnd;
    u.onerror = onEnd;
    setTimeout(() => { if (u.onend) { u.onend = null; onEnd(); } }, 800 + text.length * 90);  // some voices never fire onend
  }
  speechSynthesis.speak(u);
}

function hushSpeech() {
  clip?.pause();
  clip = null;
  window.speechSynthesis?.cancel();
  if (recog) { recog.abort(); recog = null; }
}

// Speaking the answer instead of typing it — the difference between "my nephew can use
// this" and "my nephew can't". ponytail: browser API, no library, hidden where unsupported.
// Note: Chrome sends the audio to Google's speech service; the mic button is the consent point.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;

function listen(onResult, lang) {
  if (!SpeechRec) return;
  if (recog) { recog.abort(); recog = null; }
  const r = recog = new SpeechRec();
  r.lang = lang || navigator.language || 'en-US';
  r.interimResults = false;
  r.maxAlternatives = 3;
  r.onresult = e => {
    recog = null;
    onResult([...e.results[0]].map(a => a.transcript));
  };
  r.onerror = e => { recog = null; say(e.error === 'not-allowed' ? 'Microphone blocked.' : 'Did not catch that.'); render(); };
  r.onend = () => { if (recog === r) { recog = null; render(); } };
  try { r.start(); } catch { recog = null; }
  return r;
}

// ponytail: two oscillator beeps beat shipping audio files — nothing to load, nothing to cache.
let audio = null;
function blip(kind) {
  if (!opt().sound) return;
  // A phone in a quiet room still says something. Same switch as the sound: one idea, one
  // control. ponytail: vibrate() is ignored where it is unsupported, so no capability check.
  navigator.vibrate?.({ good: 12, bad: 40, win: [14, 60, 14, 60, 24] }[kind] || 10);
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { good: [523, 784], bad: [277, 233], win: [523, 659, 784, 1047] }[kind] || [440];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = audio.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.25);
    });
  } catch { /* autoplay policy or no audio device: silence is fine */ }
}

// ---------------- games ----------------

// A wrong pick is rarely random: it is usually another card's answer, and *which* card is
// the useful fact. "You gave Uganda's capital for Kenya" beats "wrong" every time.
function noteMixup(s, card, chose) {
  const other = (s.pool || []).find(c => c.back === chose && c.front !== card.front);
  if (!other) return;
  (s.mixups ||= []).push({ asked: card.front, took: other.front, answer: chose });
}

function grade(card, g) {
  const p = P();
  // How long this answer took, from the moment the last one landed. A right answer that
  // took three times the learner's usual pace is one the schedule is over-trusting.
  const answeredAt = Date.now();
  const took = (answeredAt - (session.lastAnswerAt || session.startedAt || answeredAt)) / 1000;
  session.lastAnswerAt = answeredAt;
  if (g !== 'again' && took > slowAfter(p.stats.sessions)) (session.slow ||= []).push(card);
  // And a wrong one in a flash never tried: a guess or a blank, and either way not retrieval.
  if (g === 'again' && session.key !== 'speed' && took < quickBefore(p.stats.sessions)) (session.quick ||= []).push(card);
  // Exam mode scores the sitting without touching the schedule, the streak or the stats.
  if (g === 'again') (session.missed ||= []).push(card);
  if (session.exam) {
    if (g === 'again') session.wrong++; else session.right++;
    blip(g === 'again' ? 'bad' : 'good');
    return;
  }
  const k = cardKey(session.module.id, card);
  // One level of undo — enough for the mis-tap that actually happens.
  session.undo = {
    k,
    srs: p.srs[k] ? { ...p.srs[k] } : null,
    // Both day maps must be cloned, or undo hands back an object we then mutate anyway.
    stats: { ...p.stats, days: { ...p.stats.days }, hits: { ...p.stats.hits } },
    right: session.right, wrong: session.wrong, done: session.done,
    queue: session.queue ? session.queue.slice() : null,
    missed: session.missed ? session.missed.slice() : null,
  };
  const wasParked = p.srs[k]?.susp;
  p.srs[k] = schedule(p.srs[k], g);
  if (p.srs[k].susp && !wasParked) {
    toast(`Parked “${card.front.slice(0, 40)}” — missed ${p.srs[k].lapses} times. Rewrite it in the editor.`,
      'Edit', () => go({ name: 'edit', id: card.mid || session.module.id }));
  }
  p.stats.reviews++;
  if (g === 'again') session.wrong++; else { session.right++; p.stats.correct++; }
  p.stats.days = p.stats.days || {};
  p.stats.hits = p.stats.hits || {};
  const done = p.stats.days[today()] = (p.stats.days[today()] || 0) + 1;
  if (g !== 'again') p.stats.hits[today()] = (p.stats.hits[today()] || 0) + 1;
  if (opt().goal && done === opt().goal) {          // exactly on the goal, so it fires once
    blip('win');
    toast(opt().kid ? 'Goal reached! ⭐' : `Daily goal reached — ${done} cards.`);
  }
  // A forgiven day is worth saying out loud, or the streak looks like it miscounted.
  const restedBefore = p.stats.rested;
  Object.assign(p.stats, bumpStreak(p.stats));
  p.stats.bestStreak = Math.max(p.stats.bestStreak || 0, p.stats.streak || 0);
  if (p.stats.rested === today() && restedBefore !== p.stats.rested) {
    toast(`Rest day taken — the ${p.stats.streak} day streak holds.`);
  }
  blip(g === 'again' ? 'bad' : 'good');
  save();
  saveSession();
}

const mic = () => SpeechRec
  ? `<button type="button" class="micbtn ${recog ? 'on' : ''}" data-act="mic"
      aria-label="${recog ? 'Listening — tap to stop' : 'Speak your answer'}">${recog ? '◉' : '🎤'}</button>`
  : '';

// A slate to write on: the word in faint outline once it has been shown, and whatever the
// finger draws on top. The canvas is recreated on every redraw, so each card starts blank.
function drawSlate(word, showWord) {
  const canvas = document.getElementById('slate');
  if (!canvas) return;
  const box = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  if (showWord) {
    // Measure and shrink rather than guessing from the letter count: "I" and "W" are not
    // the same width, and a word that runs off the slate cannot be traced.
    let size = Math.round(box.height * 0.6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    do {
      ctx.font = `600 ${size}px ui-rounded, system-ui, sans-serif`;
      size -= 4;
    } while (size > 14 && ctx.measureText(word).width > box.width * 0.88);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--guide') || 'rgba(128,128,128,.35)';
    ctx.fillText(word, box.width / 2, box.height / 2);
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  ctx.strokeStyle = getComputedStyle(canvas).color;
  let drawing = false;
  const at = e => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', e => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...at(e));
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    ctx.lineTo(...at(e));
    ctx.stroke();
    e.preventDefault();
  });
  for (const end of ['pointerup', 'pointercancel', 'pointerleave']) {
    canvas.addEventListener(end, () => { drawing = false; });
  }
}

// Everything a game keeps about the card on screen. Moving off that card clears it, whether
// the card was answered, parked or skipped.
function clearCardState(s) {
  s.flipped = false;
  s.opts = null;
  s.picked = null;
  s.verdict = null;
  s.guess = '';
  s.blank = null;
  s.slots = null;
  s.tiles = null;
  s.entry = '';
  s.shown = false;
  s.said = '';
  s.claim = null;
  s.peek = false;
  s.sub = null;
  s.steps = null;
}

function progress() {
  const total = session.total || 1;
  // The alcove lights up as the session fills — progress you feel rather than read.
  app.style.setProperty('--lit', (0.25 + 0.75 * Math.min(1, session.done / total)).toFixed(2));
  // A card that is wrong, broken or simply not for today should not need the session
  // abandoned to deal with it.
  // Not on the clock: a timed round cannot be paused to go and edit something.
  const onCard = session.queue?.length && !session.exam && !opt().kid
    && session.key !== 'duel' && !session.timer;
  return `<div class="prog"><i style="width:${Math.round((session.done / total) * 100)}%"></i></div>
    <div class="pcount">${session.done} of ${total}</div>
    <div class="tools">
      ${session.undo && session.key !== 'duel' ? '<button class="undo" data-act="undo">↶ undo last answer</button>' : ''}
      ${onCard ? '<button class="undo" data-act="fixcard">✎ fix this card</button>' : ''}
      ${onCard ? `<button class="undo" data-act="starcard">${
        P().srs[cardKey(session.module.id, session.queue[0])]?.star ? '★ starred' : '☆ star it'}</button>` : ''}
      ${onCard ? '<button class="undo" data-act="parkcard">⏻ park it</button>' : ''}
      ${onCard ? '<button class="undo" data-act="snooze">⏾ not today</button>' : ''}
      ${onCard && (session.right + session.wrong) > 0
        ? '<button class="undo" data-act="endsitting">✔ end here</button>' : ''}
    </div>`;
}

function finish() {
  clearInterval(session.timer);
  hushSpeech();
  localStorage.removeItem(RESUME);
  view = { name: 'results' };
  history.replaceState({}, '');
  render();
}

const GAMES = {
  recall: {
    label: 'Recall', glyph: '◈', hint: 'Flip the card, rate yourself', min: 1, group: 'drill',
    start(s) { s.queue = s.cards.slice(); s.flipped = false; s.total = s.queue.length; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      app.innerHTML = `
        ${progress()}
        <div class="pit">
          <button class="card ${s.flipped ? 'flipped' : ''}" data-act="flip" aria-label="Flip card">
            <div class="face">${pic(c)}${fmt(s.flipped ? c.back : c.front)}
              ${!s.flipped && (c.hint || s.peek) ? `<small class="hint">${esc(c.hint || maskHint(c.back))}</small>` : ''}
              ${s.flipped ? note(c) : ''}${from(c)}</div>
            <span class="tap">${s.flipped ? '' : 'tap to reveal'}</span>
          </button>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        ${s.flipped ? (opt().kid ? `<div class="row grades kid">
          <button class="btn again" data-act="grade" data-g="again">👎 Not yet</button>
          <button class="btn good" data-act="grade" data-g="good">👍 Got it</button>
        </div>` : `<div class="row grades">
          <button class="btn again" data-act="grade" data-g="again">Again${dueIn(c, 'again')}</button>
          <button class="btn good" data-act="grade" data-g="good">Good${dueIn(c, 'good')}</button>
          <button class="btn easy" data-act="grade" data-g="easy">Easy${dueIn(c, 'easy')}</button>
        </div>`) : `${peekLine(c)}<div class="row"><button class="btn wide" data-act="flip">Reveal</button></div>`}`;
      speak(s.flipped ? c.back : c.front);
    },
  },


  // A cold card is a bad first meeting. This one shows a handful with their answers, then
  // asks for exactly those — the read-through and the drill in one sitting.
  study: {
    label: 'Study first', glyph: '📖', hint: 'See a few, then be asked them', min: 2, group: 'drill',
    start(s) {
      s.show = s.cards.slice(0, 6);
      s.i = 0;
      s.phase = 'show';
      s.queue = [];
      s.total = s.show.length;
      s.flipped = false;
    },
    frame() {
      const s = session;
      if (s.phase === 'show') {
        const c = s.show[s.i];
        return void (app.innerHTML = `
          ${progress()}
          <p class="lede center">Reading ${s.i + 1} of ${s.show.length} — nothing is graded yet.</p>
          <div class="pit small">
            <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}
              <p class="answer">${fmt(c.back)}</p>${note(c)}${from(c)}</div></div>
            <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
          </div>
          <div class="row">
            <button class="btn wide" data-act="studynext">${s.i + 1 === s.show.length ? 'Now ask me' : 'Next'}</button>
          </div>`, speak(`${c.front}. ${c.back}`, false, null, c));
      }
      const c = s.queue[0];
      if (!c) return finish();
      app.innerHTML = `
        ${progress()}
        <div class="pit">
          <button class="card ${s.flipped ? 'flipped' : ''}" data-act="flip" aria-label="Flip card">
            <div class="face">${pic(c)}${fmt(s.flipped ? c.back : c.front)}${s.flipped ? note(c) : ''}${from(c)}</div>
            <span class="tap">${s.flipped ? '' : 'tap to reveal'}</span>
          </button>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        ${s.flipped ? `<div class="row grades ${opt().kid ? 'kid' : ''}">
          <button class="btn again" data-act="grade" data-g="again">${opt().kid ? '👎 Not yet' : 'Again'}</button>
          <button class="btn good" data-act="grade" data-g="good">${opt().kid ? '👍 Got it' : 'Good'}</button>
          ${opt().kid ? '' : '<button class="btn easy" data-act="grade" data-g="easy">Easy</button>'}
        </div>` : '<div class="row"><button class="btn wide" data-act="flip">Reveal</button></div>'}`;
      speak(s.flipped ? c.back : c.front);
    },
  },

  choice: {
    label: 'Identify', glyph: '◇', hint: 'Pick the right answer', min: 4, group: 'drill',
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.opts = null; s.picked = null; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      if (!s.opts) s.opts = shuffle([c.back, ...distractors(c, s.pool)]);
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}${from(c)}</div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        <div class="options">${s.opts.map((o, i) => {
          const cls = s.picked == null ? '' : o === c.back ? 'right' : (i === s.picked ? 'wrong' : 'faded');
          return `<button class="opt ${cls}" data-act="pick" data-i="${i}" ${s.picked != null ? 'disabled' : ''}>${fmt(o)}</button>`;
        }).join('')}</div>
        ${s.picked != null ? `${note(c)}<div class="row"><button class="btn wide" data-act="next">Continue</button></div>` : ''}`;
      speak(c.front);
    },
  },

  type: {
    label: 'Write it', glyph: '⌁', hint: 'Type the answer from memory', min: 1, group: 'drill', kid: false,
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.verdict = null; s.guess = ''; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      const v = s.verdict;
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}
            ${s.peek && !v ? `<small class="hint">${esc(maskHint(c.back))}</small>` : ''}${from(c)}</div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        <form id="typef" class="row">
          <input id="ans" placeholder="Your answer" value="${esc(s.guess)}" ${v ? 'disabled' : ''}
            autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
          ${v ? '' : mic()}
          ${v ? '' : '<button class="btn" type="submit">Check</button>'}
        </form>
        ${v ? '' : '<button class="linky skip" data-act="skip">skip this one</button>' + peekLine(c)}
        ${v ? `<div class="verdict ${v}">
          <b>${v === 'exact' ? 'Correct' : v === 'close' ? 'Close enough' : 'Not this time'}</b>
          ${typedDiff(s.guess, c.back, v)}${note(c)}
          ${v === 'wrong' ? '<button class="linky" data-act="override">I actually had it — count it</button>' : ''}
        </div>
        <div class="row"><button class="btn wide" data-act="next">Continue</button></div>` : ''}`;
      const el = document.getElementById('ans');
      if (!v) el.focus();
      document.getElementById('typef').addEventListener('submit', e => { e.preventDefault(); ACT.check(); });
      speak(c.front);
    },
  },

  // Free recall: write everything you remember, then judge yourself against the answer.
  // The word chips are a memory jog, not a mark — wording is not what is being tested.
  explain: {
    label: 'Explain it', glyph: '✎', hint: 'Write what you remember, then check yourself',
    min: 1, group: 'drill', kid: false,
    filter: c => c.back.trim().length >= 40,
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.shown = false; s.said = ''; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      const cov = s.shown ? coverage(c.back, s.said) : null;
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}
            ${!s.shown && c.hint ? `<small class="hint">${esc(c.hint)}</small>` : ''}${from(c)}</div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        <textarea id="dump" rows="5" spellcheck="false" ${s.shown ? 'disabled' : ''}
          placeholder="Everything you remember. Rough notes are fine.">${esc(s.said)}</textarea>
        ${s.shown ? `
          <div class="hits">${cov.points.map(p =>
            `<span class="hit ${cov.hit.includes(p) ? 'got' : 'miss'}">${esc(p)}</span>`).join('')}</div>
          <p class="lede">${cov.hit.length} of ${cov.points.length} key words — the dim ones you did not say.
            Grade the idea, not the wording.</p>
          <div class="verdict">${fmt(c.back)}${note(c)}</div>
          <div class="row grades">
            <button class="btn again" data-act="grade" data-g="again">Missed it</button>
            <button class="btn" data-act="grade" data-g="good">Roughly</button>
            <button class="btn easy" data-act="grade" data-g="easy">Had it</button>
          </div>`
        : `<div class="row wrap">
            <button class="btn" data-act="reveal">Check it</button>
            ${SpeechRec ? `<button type="button" class="micbtn ${recog ? 'on' : ''}" data-act="saymore"
              aria-label="Dictate">🎤</button>` : ''}
          </div>`}`;
      if (!s.shown) {
        const dump = document.getElementById('dump');
        dump.focus();
        // The global shortcuts skip anything with ctrl held, so this one lives with the field.
        dump.addEventListener('keydown', e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ACT.reveal(); }
        });
      }
      speak(c.front);
    },
  },

  cloze: {
    label: 'Fill the blank', glyph: '␣', hint: 'One word missing from the answer', min: 1, group: 'drill', kid: false,
    filter: c => !!cloze(c.back),
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.verdict = null; s.guess = ''; s.blank = null; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      if (!s.blank) s.blank = cloze(c.back);
      const v = s.verdict;
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">
            <small class="prompt">${fmt(c.front)}</small>
            ${fmt(v ? c.back : s.blank.masked)}${from(c)}
          </div></div>
        </div>
        <form id="typef" class="row">
          <input id="ans" placeholder="Missing word" value="${esc(s.guess)}" ${v ? 'disabled' : ''}
            autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
          ${v ? '' : mic()}
          ${v ? '' : '<button class="btn" type="submit">Check</button>'}
        </form>
        ${v ? '' : '<button class="linky skip" data-act="skip">skip this one</button>'}
        ${v ? `<div class="verdict ${v}">
          <b>${v === 'wrong' ? 'It was' : 'Yes'} — ${esc(s.blank.answer)}</b>${note(c)}
        </div>
        <div class="row"><button class="btn wide" data-act="next">Continue</button></div>` : ''}`;
      if (!v) document.getElementById('ans').focus();
      document.getElementById('typef').addEventListener('submit', e => { e.preventDefault(); ACT.checkblank(); });
    },
  },

  // Nothing to read, nothing to type: the pit asks, the learner answers out loud.
  listen: {
    label: 'Hands free', glyph: '🎧', hint: 'It asks aloud, you answer out loud', min: 1, group: 'drill',
    needs: () => !!SpeechRec && !!window.speechSynthesis,
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.phase = 'ask'; s.verdict = null; s.heard = ''; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      const status = { ask: 'Listen…', listening: 'Your turn — say it', verdict: '' }[s.phase] || '';
      app.innerHTML = `
        ${progress()}
        <div class="pit">
          <div class="card static ${s.phase === 'listening' ? 'flipped' : ''}"><div class="face">
            ${pic(c)}${fmt(c.front)}
            ${s.verdict ? `<p class="note">${s.verdict === 'wrong' ? 'The answer is ' : ''}${fmt(c.back)}</p>` : ''}
            ${s.heard ? `<small class="from">heard: ${esc(s.heard)}</small>` : ''}
          </div></div>
        </div>
        <p class="lede center ${s.phase === 'listening' ? 'pulsing' : ''}">${status}</p>
        <div class="row grades">
          <button class="btn again" data-act="handsgrade" data-g="again">Missed it</button>
          <button class="btn" data-act="handsrepeat">Again, please</button>
          <button class="btn good" data-act="handsgrade" data-g="good">Got it</button>
        </div>`;
      if (s.phase === 'ask') {
        s.phase = 'asking';
        speak(c.front, true, () => {
          if (session !== s || view.name !== 'session' || s.queue[0] !== c) return;
          s.phase = 'listening';
          render();
          listen(alternatives => {
            if (session !== s || s.queue[0] !== c) return;
            const best = alternatives
              .map(t => ({ t, v: judgeTyped(t, c.back, c.alt, c.options) }))
              .sort((a, b) => ['exact', 'close', 'wrong'].indexOf(a.v) - ['exact', 'close', 'wrong'].indexOf(b.v))[0];
            s.heard = best.t;
            s.verdict = best.v;
            s.phase = 'verdict';
            grade(c, best.v === 'wrong' ? 'again' : 'good');
            render();
            speak(best.v === 'wrong' ? `Not quite. ${c.back}` : 'Yes.', true,
              () => { if (session === s && s.queue[0] === c) ACT.handsnext(); });
          });
        });
      }
    },
  },

  // Shadowing, for a module in another language: the cue is on the front, the thing to say is
  // on the back — hear it said properly, then say it yourself and see which words came out.
  // Recognition runs in the module's own language.
  sayit: {
    label: 'Say it', glyph: '🗣', hint: 'Hear it, then say it yourself', min: 1, group: 'drill',
    needs: () => !!SpeechRec && !!window.speechSynthesis,
    module: m => !!m.lang,
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.phase = 'ask'; s.verdict = null; s.heard = ''; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      const cov = s.heard ? coverage(c.back, s.heard) : null;
      const status = { ask: 'Listen…', listening: 'Your turn — say it', verdict: '' }[s.phase] || '';
      app.innerHTML = `
        ${progress()}
        <div class="pit">
          <div class="card static ${s.phase === 'listening' ? 'flipped' : ''}"><div class="face">
            ${pic(c)}<small class="prompt">${fmt(c.front)}</small>${fmt(c.back)}
            ${cov?.points.length ? `<div class="hits">${cov.points.map(p =>
              `<span class="hit ${cov.hit.includes(p) ? 'got' : 'miss'}">${esc(p)}</span>`).join('')}</div>` : ''}
            ${s.heard ? `<small class="from">heard: ${esc(s.heard)}</small>` : ''}
          </div></div>
        </div>
        <p class="lede center ${s.phase === 'listening' ? 'pulsing' : ''}">${status}</p>
        <div class="row grades">
          <button class="btn again" data-act="handsgrade" data-g="again">Not yet</button>
          <button class="btn" data-act="handsrepeat">Say it again</button>
          <button class="btn good" data-act="handsgrade" data-g="good">Got it</button>
        </div>`;
      if (s.phase === 'ask') {
        s.phase = 'asking';
        speak(c.back, true, () => {
          if (session !== s || view.name !== 'session' || s.queue[0] !== c) return;
          s.phase = 'listening';
          render();
          listen(alternatives => {
            if (session !== s || s.queue[0] !== c) return;
            // Content words matter, not every article; a two-word phrase has none, so fall back
            // to the typed judge for it.
            const score = t => { const cv = coverage(c.back, t); return cv.points.length ? cv.pct : (judgeTyped(t, c.back) === 'wrong' ? 0 : 100); };
            const best = alternatives.map(t => ({ t, pct: score(t) })).sort((a, b) => b.pct - a.pct)[0];
            s.heard = best.t;
            s.verdict = best.pct >= 70 ? 'exact' : 'wrong';
            s.phase = 'verdict';
            grade(c, s.verdict === 'wrong' ? 'again' : 'good');
            render();
            const on = () => { if (session === s && s.queue[0] === c) ACT.handsnext(); };
            if (s.verdict === 'wrong') speak(c.back, true, on, c); else setTimeout(on, 900);
          }, s.module.lang);
        }, c);
      }
    },
  },

  // Each card asked the way it has earned: new ones recognised among options, young ones with
  // a blank, mature ones produced from nothing. The frame belongs to whichever game the card
  // is on; this only decides which, once per appearance, and lets that game draw.
  ladder: {
    label: 'Ladder', glyph: '⟋', hint: 'Each card asked the way it has earned', min: 1, group: 'drill',
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      if (!s.sub) {
        s.sub = ladderRung(P().srs[cardKey(s.module.id, c)], c,
          { kid: opt().kid, poolSize: new Set(s.pool.map(x => x.back)).size });
      }
      GAMES[s.sub].frame();
    },
  },

  // Two learners, one tablet, alternating turns. Each answer is scored against whoever
  // gave it, so a duel is real practice for both of them, not just a game.
  duel: {
    label: 'Duel', glyph: '⚔', hint: 'Everyone on this device takes turns', min: 4, group: 'play',
    needs: () => Object.keys(state.profiles).length > 1,
    start(s) {
      s.queue = s.cards.slice();
      s.total = s.queue.length;
      // Everyone on the device, up to four — a phone passed round a table.
      s.players = Object.keys(state.profiles).slice(0, 4);
      s.scores = s.players.map(() => 0);
      s.turn = 0;
      s.opts = null;
      s.picked = null;
    },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      if (!s.opts) s.opts = shuffle([c.back, ...distractors(c, s.pool)]);
      const who = s.players[s.turn];
      const avatar = n => (state.profiles[n]?.opts || {}).avatar || '◎';
      app.innerHTML = `
        ${progress()}
        <div class="duelbar">
          ${s.players.map((n, i) => `<span class="${i === s.turn ? 'up' : ''}">
            <b>${esc(avatar(n))} ${esc(n)}</b> ${s.scores[i]}</span>`).join('')}
        </div>
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}${from(c)}</div></div>
        </div>
        <div class="options">${s.opts.map((o, i) => {
          const cls = s.picked == null ? '' : o === c.back ? 'right' : (i === s.picked ? 'wrong' : 'faded');
          return `<button class="opt ${cls}" data-act="duelpick" data-i="${i}" ${s.picked != null ? 'disabled' : ''}>${fmt(o)}</button>`;
        }).join('')}</div>
        ${s.picked != null ? `${note(c)}<div class="row"><button class="btn wide" data-act="duelnext">
          ${esc(s.players[(s.turn + 1) % s.players.length])}'s turn</button></div>`
        : `<p class="lede center">${esc(who)} answers</p>`}`;
    },
  },

  // Which shelf does this belong on? Telling two topics apart is a different skill from
  // recalling either of them, and the only one that gets harder as you learn more.
  sort: {
    label: 'Sort', glyph: '⚖', hint: 'Which module does this card belong to?', min: 4, group: 'play',
    needs: () => visible().length > 1,
    start(s) {
      const partner = shuffle(visible().filter(m => m.id !== s.module.id && m.cards.length >= 4))[0];
      if (!partner) { s.queue = []; s.total = 0; return; }
      s.bins = [s.module, partner];
      const take = (m, n) => shuffle(m.cards).slice(0, n).map(c => ({ ...c, mid: m.id, from: m.title }));
      s.queue = shuffle([...take(s.module, 6), ...take(partner, 6)]);
      s.total = s.queue.length;
      s.picked = null;
    },
    frame() {
      const s = session, c = s.queue[0];
      if (!c || !s.bins) return finish();
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}
            ${s.picked ? `<p class="note">${fmt(c.back)}</p>` : ''}
          </div></div>
        </div>
        <div class="bins">${s.bins.map(b => {
          const right = b.id === c.mid;
          const cls = !s.picked ? '' : right ? 'right' : (s.picked === b.id ? 'wrong' : 'faded');
          return `<button class="bin ${cls}" data-act="sortpick" data-bin="${esc(b.id)}" ${s.picked ? 'disabled' : ''}>
            <span class="glyph">${esc(b.icon || '◈')}</span>${esc(b.title)}</button>`;
        }).join('')}</div>
        ${s.picked ? '<div class="row"><button class="btn wide" data-act="next">Continue</button></div>' : ''}`;
    },
  },

  // A number answer wants a number pad, not a keyboard: a tablet keyboard covers half the
  // screen and a five-year-old cannot find the digits on it.
  pad: {
    label: 'Number pad', glyph: '🔢', hint: 'Tap the digits, no keyboard', min: 1, group: 'play',
    filter: c => /^-?\d{1,6}$/.test(c.back.trim()),
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.entry = ''; s.verdict = null; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      const v = s.verdict;
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}
            <span class="entry ${v || ''}">${esc(s.entry || '?')}</span>
          </div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        ${v ? `<div class="verdict ${v}"><b>${v === 'wrong' ? 'It was ' + esc(c.back) : 'Yes'}</b>${note(c)}</div>
          <div class="row"><button class="btn wide" data-act="next">Continue</button></div>`
        : `<div class="pad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-act="padtap" data-n="${n}">${n}</button>`).join('')}
            <button class="key dim" data-act="padback" aria-label="Delete">⌫</button>
            <button class="key" data-act="padtap" data-n="0">0</button>
            <button class="key ok" data-act="padok" aria-label="Check" ${s.entry ? '' : 'disabled'}>✓</button>
          </div>`}`;
      speak(c.front);
    },
  },

  // Recognition rather than recall: half the pairings are lies, and saying so is the answer.
  // Two buttons, no reading of options, and it works on any module without extra data.
  truefalse: {
    label: 'True or false', glyph: '⊘', hint: 'Is that really the answer?', min: 4, group: 'play',
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.claim = null; s.picked = null; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      if (!s.claim) {
        const fake = distractors(c, s.pool, 1)[0];
        const truth = !fake || Math.random() < 0.5;
        s.claim = { text: truth ? c.back : fake, truth };
      }
      const answered = s.picked != null;
      const right = answered && s.picked === s.claim.truth;
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}
            <p class="claim ${answered ? (s.claim.truth ? 'yes' : 'no') : ''}">${fmt(s.claim.text)}</p>
          </div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        ${answered ? `<div class="verdict ${right ? 'exact' : 'wrong'}">
            <b>${right ? 'Right' : 'No'} — the answer is ${fmt(c.back)}</b>${note(c)}</div>
          <div class="row"><button class="btn wide" data-act="next">Continue</button></div>`
        : `<div class="row grades kid">
            <button class="btn good" data-act="tf" data-v="1">✔ True</button>
            <button class="btn again" data-act="tf" data-v="0">✘ False</button>
          </div>`}`;
      speak(`${c.front}. ${s.claim.text}?`);
    },
  },

  point: {
    label: 'Point at it', glyph: '👉', hint: 'Hear the word, tap the picture', min: 4, group: 'play',
    filter: c => !!c.image,
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.tiles = null; s.picked = null; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      // The options are whole cards, so the answer is given by looking, not by reading.
      if (!s.tiles) s.tiles = shuffle([c, ...decoys(c, s.pool.filter(x => x.image), 3)]);
      app.innerHTML = `
        ${progress()}
        <div class="asking">
          <b>${fmt(c.back)}</b>
          <button class="speak" data-act="sayback" aria-label="Say it again">🔊</button>
        </div>
        <div class="pics">${s.tiles.map((t, i) => {
          const cls = s.picked == null ? '' : t.back === c.back ? 'right' : (i === s.picked ? 'wrong' : 'faded');
          return `<button class="pictile ${cls}" data-act="point" data-i="${i}" aria-label="${esc(t.back)}"
            ${s.picked != null ? 'disabled' : ''}>${pic(t)}</button>`;
        }).join('')}</div>
        ${s.picked != null ? `${note(c)}<div class="row"><button class="btn wide" data-act="next">Continue</button></div>` : ''}`;
      if (s.picked == null) speak(c.back, true, null, c);
    },
  },

  // Writing it is how a five-year-old learns a word, and a tablet is a slate. Nothing here
  // recognises handwriting — the child writes, then sees the answer and says whether they had
  // it. ponytail: a tracing scorer would be guesswork; the eye that matters is already there.
  trace: {
    label: 'Write it out', glyph: '✍', hint: 'Trace the word with a finger', min: 1, group: 'play',
    // A single letter or digit traces as well as a word does — that is how letters are learnt.
    filter: c => spellable(c.back) || /^[^\W_]$/u.test(c.back.trim()),
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.shown = false; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}</div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        <div class="slate">
          <canvas id="slate"></canvas>
          <button class="ghost sm wipe" data-act="wipe">Clear</button>
        </div>
        ${s.shown ? `<div class="row grades kid">
            <button class="btn again" data-act="grade" data-g="again">👎 Not yet</button>
            <button class="btn good" data-act="grade" data-g="good">👍 Got it</button>
          </div>`
        : `<div class="row"><button class="btn wide" data-act="showword">Show me the word</button></div>`}`;
      drawSlate(c.back.toUpperCase(), s.shown);
      speak(c.front);
    },
  },

  spell: {
    label: 'Spell it', glyph: '🔡', hint: 'Build the answer from letters', min: 1, group: 'play',
    filter: c => spellable(c.back),
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.slots = null; s.verdict = null; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      const answer = c.back.trim().toUpperCase();
      if (!s.slots) {
        s.tiles = letterTiles(answer, Math.random, answer.length > 7 ? 2 : 3);
        s.slots = Array(answer.length).fill(null);   // each holds a tile index
      }
      const filled = s.slots.filter(x => x !== null).length;
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">
            ${pic(c)}<small class="prompt">${fmt(c.front)}</small>
            <span class="slots">${s.slots.map((t, i) => `<button class="slot ${t === null ? '' : 'full'}"
              data-act="unslot" data-i="${i}" ${t === null ? 'disabled' : ''}>${t === null ? '' : esc(s.tiles[t])}</button>`).join('')}</span>
            ${s.verdict === 'wrong' ? `<small class="hint">It was ${esc(c.back)}</small>` : ''}${from(c)}
          </div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        <div class="letters">${s.tiles.map((ch, i) => `<button class="letter"
          data-act="slot" data-i="${i}" ${s.slots.includes(i) ? 'disabled' : ''}>${esc(ch)}</button>`).join('')}</div>
        ${filled === s.slots.length && !s.verdict ? '<div class="row"><button class="btn wide" data-act="checkspell">Check</button></div>' : ''}
        ${s.verdict ? `<div class="row"><button class="btn wide" data-act="next">Continue</button></div>` : ''}`;
      speak(c.front);
    },
  },

  // A sequence is a different kind of knowing: the steps are easy, the order is the point.
  order: {
    label: 'Order it', glyph: '⇵', hint: 'Put the steps in the right order', min: 1, group: 'play',
    filter: c => !!listItems(c),
    start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; s.steps = null; s.verdict = null; },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      if (!s.steps) {
        const items = listItems(c);
        let deal = shuffle(items);
        if (deal.join('|') === items.join('|')) deal = deal.reverse();   // never dealt already solved
        s.steps = { items, deal, placed: [] };
      }
      const { items, deal, placed } = s.steps;
      const v = s.verdict;
      app.innerHTML = `
        ${progress()}
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}${from(c)}</div></div>
          <button class="speak" data-act="speak" aria-label="Read aloud">🔊</button>
        </div>
        <ol class="steps placed">${items.map((_, n) => n < placed.length
          ? `<li><button class="step ${v ? (deal[placed[n]] === items[n] ? 'right' : 'wrong') : ''}"
              data-act="ounstep" data-n="${n}" ${v ? 'disabled' : ''}>${fmt(deal[placed[n]])}</button></li>`
          : '<li><span class="step empty"></span></li>').join('')}</ol>
        <div class="steps">${deal.map((t, i) => `<button class="step" data-act="ostep" data-i="${i}"
          ${placed.includes(i) || v ? 'disabled' : ''}>${fmt(t)}</button>`).join('')}</div>
        ${v ? `<div class="verdict ${v}"><b>${v === 'wrong' ? 'The order is' : 'Yes'}</b>
            ${v === 'wrong' ? `<p>${items.map(fmt).join(' → ')}</p>` : ''}${note(c)}</div>
          <div class="row"><button class="btn wide" data-act="next">Continue</button></div>`
        : placed.length === items.length ? '<div class="row"><button class="btn wide" data-act="ocheck">Check</button></div>' : ''}`;
      speak(c.front);
    },
  },

  speed: {
    label: 'Speed round', glyph: '⏱', hint: 'One minute, as many as you can', min: 4, group: 'play',
    start(s) {
      s.queue = s.cards.slice();
      s.total = s.queue.length;
      s.opts = null;
      s.picked = null;
      s.ends = 0;          // the clock only starts when they say go
    },
    // Split out so the ready gate can start it: nobody should lose seconds reading the rules.
    run(s) {
      s.ends = Date.now() + 60000;
      clearInterval(s.timer);
      s.timer = setInterval(() => {
        const left = s.ends - Date.now();
        const el = document.getElementById('clock');
        if (!el) return clearInterval(s.timer);
        el.style.width = Math.max(0, (left / 60000) * 100) + '%';
        if (left <= 0) { clearInterval(s.timer); finish(); }
      }, 200);
    },
    frame() {
      const s = session, c = s.queue[0];
      if (!c) return finish();
      if (!s.ends) {
        app.innerHTML = `
          <div class="pit"><div class="card static"><div class="face">
            <span class="score">60<small>s</small></span>
            <p>As many as you can. It starts when you do.</p>
          </div></div></div>
          <div class="row"><button class="btn wide" data-act="gospeed">Start</button></div>`;
        return;
      }
      if (!s.opts) s.opts = shuffle([c.back, ...distractors(c, s.pool)]);
      app.innerHTML = `
        <div class="prog clock"><i id="clock" style="width:${Math.max(0, ((s.ends - Date.now()) / 60000) * 100)}%"></i></div>
        <div class="scoreline"><b>${s.right}</b> correct</div>
        <div class="pit small">
          <div class="card static"><div class="face">${pic(c)}${fmt(c.front)}${from(c)}</div></div>
        </div>
        <div class="options">${s.opts.map((o, i) => {
          const cls = s.picked == null ? '' : o === c.back ? 'right' : (i === s.picked ? 'wrong' : 'faded');
          return `<button class="opt ${cls}" data-act="quick" data-i="${i}" ${s.picked != null ? 'disabled' : ''}>${fmt(o)}</button>`;
        }).join('')}</div>`;
    },
  },

  match: {
    label: 'Match', glyph: '⬡', hint: 'Pair them up, no timer', min: 6, group: 'play',
    start(s) {
      s.pairs = s.cards.slice(0, 6);
      s.total = s.pairs.length;
      s.tiles = shuffle(s.pairs.flatMap((c, i) => [
        { i, side: 'front', text: c.front }, { i, side: 'back', text: c.back }]));
      s.sel = null; s.matched = new Set(); s.wrongPairs = new Set();
    },
    frame() {
      const s = session;
      if (s.matched.size === s.pairs.length) {
        for (const [i, c] of s.pairs.entries()) grade(c, s.wrongPairs.has(i) ? 'again' : 'good');
        return finish();
      }
      app.innerHTML = `
        ${progress()}
        <p class="lede center">Pair each prompt with its answer.</p>
        <div class="grid">${s.tiles.map((t, n) => {
          const done = s.matched.has(t.i);
          return `<button class="mtile ${done ? 'done' : ''} ${s.sel === n ? 'sel' : ''} ${t.side}"
            data-act="match" data-n="${n}" aria-pressed="${s.sel === n}" ${done ? 'disabled' : ''}>${fmt(t.text)}</button>`;
        }).join('')}</div>`;
    },
  },
};

// Same card, asked backwards. Keeping the id fixed means both directions share one
// schedule rather than doubling the workload.
// The pinned id must be the card's real identity — for a picture card that is front + NUL +
// image, not front alone, or every "What is this?" card lands in one phantom srs row.
const flip = c => ({ ...c, id: c.id || cardKey('x', c).split(':').pop(),
  front: c.back, back: c.front, hint: undefined });

function startGame(id, key) {
  const m = modules.find(x => x.id === id);
  const g = GAMES[key];
  if (!m || !g) return;
  // Under a deadline the daily target sets the pace, so a session may need more new cards
  // than the usual five.
  const plan = planFor(m);
  const newPerSession = plan && !plan.passed ? Math.max(5, plan.perDay) : 5;
  const sizes = { match: { size: 6, newPerSession: 6 }, speed: { size: 40, newPerSession: 40 } };
  // Sample from the cards this game can actually use, or a game that suits only part of a
  // module keeps drawing sessions it has to throw away.
  const eligible = g.filter ? m.cards.filter(g.filter) : m.cards;
  // Exam: the whole module in one go, and nothing it does touches the schedule.
  // In the last days before a deadline every scheduled card counts as due, soonest first — the
  // ones the schedule had pushed past the date would otherwise never be seen before it.
  const now = plan?.sweep ? Infinity : Date.now();
  const cards = view.exam
    ? shuffle(eligible).slice(0, key === 'match' ? 6 : 100)
    : pickSession(eligible, P().srs, m.id,
        { ...(sizes[key] || { size: Math.max(opt().size, newPerSession), newPerSession }), now });
  launch(m, key, view.rev ? cards.map(flip) : cards, view.rev ? m.cards.map(flip) : m.cards, view.exam,
    () => startGame(id, key));
}

// A tablet gets closed mid-session. Graded cards are already saved; this keeps the
// rest of the queue so the learner picks up where they stopped.
const RESUME = 'pit.session';
const RESUME_MAX_AGE = 6 * 3600000;

// Only the games whose whole state is queue + counters. Match holds a board and Speed
// holds a clock; neither is worth freezing.
const RESUMABLE = ['recall', 'choice', 'type'];

function saveSession() {
  const s = session;
  if (!s || !s.queue || !RESUMABLE.includes(s.key)) return localStorage.removeItem(RESUME);
  try {
    localStorage.setItem(RESUME, JSON.stringify({
      at: Date.now(), key: s.key, profile: state.active,
      module: { id: s.module.id, title: s.module.title },   // cards come back from `pool`
      pool: s.pool, cards: s.cards, queue: s.queue,
      right: s.right, wrong: s.wrong, done: s.done, total: s.total,
    }));
  } catch { /* storage full — the resume file is the first thing worth dropping */ }
}

function readSession() {
  try {
    const r = JSON.parse(localStorage.getItem(RESUME));
    if (!r || !r.queue?.length || r.profile !== state.active) return null;
    if (Date.now() - r.at > RESUME_MAX_AGE) return null;
    return RESUMABLE.includes(r.key) ? r : null;
  } catch { return null; }
}

function resume(r) {
  const pool = r.pool || r.cards;
  session = {
    module: { ...r.module, cards: pool }, game: GAMES[r.key], key: r.key, cards: r.cards, pool,
    queue: r.queue, right: r.right, wrong: r.wrong, done: r.done, total: r.total,
  };
  go({ name: 'session' });
}

function launch(module, key, cards, pool, exam, again) {
  const g = GAMES[key];
  if (!g) return;
  if (g.filter) cards = cards.filter(g.filter);
  if (!cards.length) return toast('No cards in this module suit that exercise yet.');
  // pool is where wrong-answer options come from — the whole module, not just this session.
  // `again` is how this session was started, so the results screen can repeat it exactly.
  session = { module, game: g, key, cards, pool: pool || module.cards, exam, again,
    right: 0, wrong: 0, done: 0, startedAt: Date.now() };
  g.start(session);
  go({ name: 'session' });
}

const dueEverything = () => dueAcross(visible(), P().srs);

// Cards that have graduated out of the new pile — the number every rank is measured against.
const learnedCount = () => visible().reduce((n, m) => {
  const c = counts(m.cards, P().srs, m.id);
  return n + c.learned + c.due;
}, 0);

// The badge, and the standing behind it. Shown wherever a learner looks at themselves.
function rankLine() {
  const r = rankFor(learnedCount());
  return `<div class="rank" title="${r.next ? `${r.toGo} more cards learned to reach ${r.next.name}` : 'Nothing above this'}">
    <span class="rank-glyph">${r.rank.glyph}</span>
    <span><b>${esc(r.rank.name)}</b>${r.next
      ? `<small>${r.toGo} more to ${esc(r.next.name)}</small>` : '<small>the deepest rank</small>'}</span>
    <i class="rank-bar"><i style="width:${r.pct}%"></i></i>
  </div>`;
}

const from = c => c.from ? `<small class="from">${esc(c.from)}</small>` : '';
// The note explains the answer; the source says where the answer came from. Both belong
// with the revealed side, never with the question.
const note = c => (c.note ? `<p class="note">${fmt(c.note)}</p>` : '')
  + (c.source ? `<a class="source" href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">source ↗</a>` : '');
// The picture belongs to the prompt, so it shows with the front and stays for the answer.
// Just the host: the whole URL is unreadable on a phone, and the title attribute has it.
const host = u => { try { return new URL(u).host; } catch { return 'the source'; } };
const pic = c => c.image ? `<img class="cardimg" src="${esc(c.image)}" alt="" loading="lazy">` : '';

// What each grade would do to the card — "3 days" under Good — so the buttons say what they
// mean. Not in an exam, where nothing is scheduled; a child gets two big buttons instead.
const inDays = n => n < 1 ? 'today' : n === 1 ? '1 day' : n < 30 ? `${n} days` : n < 365 ? `${Math.round(n / 30)} months` : '1 year';
function dueIn(c, g) {
  if (session.exam) return '';
  if (g === 'again') return '<small>10 min</small>';
  const next = schedule(P().srs[cardKey(session.module.id, c)], g, Date.now(), () => 0.5);
  return `<small>${inDays(next.interval)}</small>`;
}
// A hint nobody wrote — the shape of the answer — offered only where the answer has one.
const peekLine = c => (!c.hint && !session.peek && maskHint(c.back)
  ? '<button class="linky skip" data-act="peek">need a hint?</button>' : '');
// A miss shown letter by letter: what was typed with the stray letters struck out, the answer
// with the missed ones marked. Only for a real wrong answer short enough to read that way.
function typedDiff(guess, answer, v) {
  const d = v === 'wrong' && guess.trim() && answer.length <= 60 ? diffChars(guess.trim(), answer) : null;
  if (!d) return `<p>${fmt(answer)}</p>`;
  const mark = (arr, tag) => arr.map(([ch, ok]) => (ok ? esc(ch) : `<${tag}>${esc(ch)}</${tag}>`)).join('');
  return `<p class="typed">you typed <span>${mark(d.guess, 'del')}</span></p><p>${mark(d.answer, 'ins')}</p>`;
}

// ---------------- actions ----------------

const ACT = {
  home: () => { hushSpeech(); clearInterval(session?.timer); stack.length = 0; session = null; view = { name: 'home' }; render(); },
  back,
  settings: async () => {
    // A tablet in a five-year-old's hands should not be one tap from wiping the library.
    // ponytail: a sum, not a password — it keeps a child out, and that is all it is for.
    if (opt().kid && !(await grownUp())) return;
    go({ name: 'settings' });
  },
  progress: () => go({ name: 'progress' }),
  shortcuts: () => dialog({
    title: 'space or enter — reveal, then Good · 1 2 3 — Again, Good, Easy · '
      + '1–4 — pick an option or a picture · t / f — true or false · '
      + 'digits and enter — the number pad · '
      + 'ctrl/⌘ + enter — check a write-up · s — star this card · u — undo the last answer · '
      + '1–8 — place the next step · swipe a revealed card left or right · '
      + '/ — search the library · esc — back · ? — this list',
    ok: 'Got it',
  }),
  import: () => go({ name: 'import' }),
  open: el => go({ name: 'module', id: el.dataset.id }),
  play: el => startGame(el.dataset.id, el.dataset.game),
  // Choosing between fifteen exercises is a decision nobody wants before studying. Drills
  // carry the learning, so they win most rolls; the last one is skipped so it varies.
  // A five-year-old should not have to choose a module either. Whatever has the most
  // waiting wins; with nothing waiting, whatever they know least of.
  // The same module, a different exercise — repetition without the monotony.
  anotherway: () => {
    const id = session?.module?.id;
    if (!id || !modules.some(x => x.id === id)) return;
    ACT.surprise({ dataset: { id } });
  },
  kidplay: () => {
    const srs = P().srs;
    const load = m => { const c = counts(m.cards, srs, m.id); return c.due * 10 + c.fresh; };
    const pick = visible().slice().sort((a, b) => load(b) - load(a))[0];
    if (!pick) return;
    ACT.surprise({ dataset: { id: pick.id } });
  },
  surprise: el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (!m) return;
    // Never roll Duel: it needs a second human actually in the room, which no heuristic
    // can know. It stays a deliberate choice from the list.
    const notDuel = list => list.filter(([k]) => k !== 'duel');
    const drills = notDuel(eligibleGames(m, 'drill')), plays = notDuel(eligibleGames(m, 'play'));
    let pool = (Math.random() < 0.65 ? drills : plays);
    if (!pool.length) pool = drills.length ? drills : plays;
    if (!pool.length) return toast('Nothing here suits an exercise yet.');
    const fresh = pool.filter(([k]) => k !== opt().lastGame);
    const [key] = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
    opt().lastGame = key;
    save();
    startGame(m.id, key);
  },
  profile: el => { state.active = el.dataset.name; save(); render(); },
  addprofile: async () => {
    const n = ((await askText('Name for the new learner?')) || '').slice(0, 24);
    if (!n || state.profiles[n]) return;
    const taken = new Set(Object.values(state.profiles).map(p => p.opts?.avatar));
    state.profiles[n] = newProfile(AVATARS.find(a => !taken.has(a)) || AVATARS[0]);
    state.active = n;
    save();
    render();
  },
  avatar: el => { setOpt({ avatar: el.dataset.a }); render(); },
  accent: el => { setOpt({ accent: el.dataset.c }); render(); },
  rename: async () => {
    const from = state.active;
    const to = ((await askText('New name for this learner?', from)) || '').slice(0, 24);
    if (!to || to === from) return;
    if (state.profiles[to]) return showErr(new Error(`There is already a learner called ${to}.`));
    // Rebuild in place so the profile keeps its position in the list, and its history.
    state.profiles = Object.fromEntries(
      Object.entries(state.profiles).map(([k, v]) => [k === from ? to : k, v]));
    state.active = to;
    save();
    render();
  },
  delprofile: async () => {
    const n = state.active;
    if (Object.keys(state.profiles).length < 2) return;
    if (!await askYes(`Remove ${n} and all their progress?`, 'Remove')) return;
    const gone = JSON.parse(JSON.stringify(state.profiles[n]));
    delete state.profiles[n];
    state.active = Object.keys(state.profiles)[0];
    save();
    render();
    undoable(`${n} removed.`, () => {
      state.profiles[n] = gone;
      state.active = n;
      save();
      render();
    });
  },
  reset: async el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (!m || !await askYes(`Clear ${state.active}'s progress on ${m.title}?`, 'Clear')) return;
    for (const c of m.cards) delete P().srs[cardKey(m.id, c)];
    save();
    render();
  },
  delcustom: async el => {
    const m = state.custom.find(c => c.id === el.dataset.id);
    if (!m || !await askYes(`Remove ${m.title} from this device?`, 'Remove')) return;
    const gone = JSON.parse(JSON.stringify(m));
    state.custom = state.custom.filter(c => c.id !== el.dataset.id);
    save();
    await loadModules();
    render();
    undoable(`${gone.title} removed.`, async () => {
      state.custom = [...(state.custom || []).filter(c => c.id !== gone.id), gone];
      save();
      await loadModules();
      render();
    });
  },
  paste: async () => {
    const text = document.getElementById('paste').value.trim();
    // A URL pasted into the big box means "fetch that" — nobody is going to notice the
    // separate field below when the box is right there.
    if (/^https?:\/\/\S+$/.test(text)) {
      document.getElementById('url').value = text;
      return ACT.fetchurl();
    }
    try { view = { name: 'import', pending: parseImport(text) }; render(); }
    catch (e) { showErr(e); }
  },
  clip: async () => {
    try {
      const text = await navigator.clipboard.readText();
      document.getElementById('paste').value = text;
      ACT.paste();
    } catch { showErr(new Error('Could not read the clipboard — paste into the box instead.')); }
  },
  commit: async () => {
    try {
      const drop = new Set(view.drop || []);
      const added = view.pending
        .map(m => ({ ...m, cards: m.cards.filter((_, i) => !drop.has(m.id + ':' + i)) }))
        .filter(m => m.cards.length);
      if (!added.length) return showErr(new Error('Nothing left to add — tick at least one card.'));
      // What each id held before, so the whole import can be taken back — including the case
      // where it replaced an existing module rather than adding a new one.
      const before = added.map(m => ({ id: m.id,
        prev: (state.custom || []).find(c => c.id === m.id) }));
      for (const m of added) addCustom(m);
      await loadModules();
      ACT.home();
      undoable(`Added ${added.map(m => m.title).join(', ')}.`, async () => {
        state.custom = (state.custom || []).filter(c => !before.some(b => b.id === c.id));
        for (const b of before) if (b.prev) state.custom.push(b.prev);
        save();
        await loadModules();
        render();
      });
    } catch (e) { showErr(e); }
  },
  // One place that fetches text off the network, so the size cap and the error wording
  // are the same for the first import and every refresh after it.
  // Interleaving: two subjects shuffled together are harder in the session and better
  // remembered afterwards. This is the module's own Learning Science card, made usable.
  mixwith: async el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (!m) return;
    const others = visible().filter(x => x.id !== m.id);
    if (!others.length) return;
    const withId = await dialog({
      title: `Mix ${m.title} with which module?`,
      choices: others.map(o => ({ value: o.id, label: `${o.icon || ''} ${o.title}` })),
    });
    const other = modules.find(x => x.id === withId);
    if (!other) return;
    // Half a sitting from each, drawn the way each module would draw its own.
    const half = Math.max(3, Math.round(opt().size / 2));
    const draw = mod => pickSession(mod.cards, P().srs, mod.id, { size: half, newPerSession: 3 })
      .map(c => ({ ...c, mid: mod.id, from: mod.title }));
    const cards = shuffle([...draw(m), ...draw(other)]);
    if (!cards.length) return toast('Nothing to study in those two yet.');
    launch({ id: 'mix', title: `${m.title} + ${other.title}`, cards }, 'recall', cards, cards, false,
      () => ACT.mixwith(el));
  },
  // Every card resting is worth a piece of paper on the fridge. It costs one screen and it
  // is the reward a six-year-old actually understands.
  certificate: el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (!m) return;
    const r = rankFor(learnedCount()).rank;
    app.className = 'screen certificate';
    app.innerHTML = `
      <div class="cert">
        <div class="cert-icon" aria-hidden="true">${esc(m.icon || '◈')}</div>
        <p class="cert-head">Certificate of Mastery</p>
        <p class="cert-who">${esc(opt().avatar || '')} ${esc(state.active)}</p>
        <p class="cert-what">has learned every one of the <b>${m.cards.length}</b> cards in</p>
        <p class="cert-module">${esc(m.title)}</p>
        <p class="cert-meta">${new Date().toLocaleDateString()} · ${esc(r.name)} of the Learning Pit</p>
      </div>
      <div class="row">
        <button class="btn" data-act="certprint">Print it</button>
        <button class="btn ghost" data-act="open" data-id="${esc(m.id)}">‹ back</button>
      </div>`;
  },
  certprint: () => window.print(),
  // A sitting across modules: nothing is scheduled, nothing is rewarded, and the score comes
  // back broken down by where the misses were.
  mockexam: async () => {
    const tags = [...new Set(visible().flatMap(m => m.tags || []))].slice(0, 3);
    const where = await dialog({
      title: 'What is the exam on?',
      choices: [{ value: '*', label: 'Everything in the library' },
        ...tags.map(t => ({ value: t, label: 'Only ' + t }))],
    });
    if (!where) return;
    const mods = where === '*' ? visible() : visible().filter(m => (m.tags || []).includes(where));
    const n = await dialog({
      title: 'How many cards?',
      choices: [{ value: '10', label: '10 — a quick check' }, { value: '25', label: '25' },
        { value: '50', label: '50 — a real sitting' }],
    });
    if (!n) return;
    const cards = examSet(mods, P().srs, +n);
    if (cards.length < 2) return toast('Not enough cards for an exam yet.');
    launch({ id: 'exam', title: where === '*' ? 'Mock exam' : `Mock exam — ${where}` , cards },
      'recall', cards, cards, true, ACT.mockexam);
  },
  // Straight from the exam report into the cards that failed it — this time for real, with
  // the schedule watching.
  // The moment you know why you got it wrong is the moment the note is worth writing, and
  // that moment is here — not later, in the editor, when the reason has gone.
  notecard: async el => {
    const missed = [...new Map((session.missed || []).map(c => [c.front, c])).values()];
    const card = missed[+el.dataset.i];
    if (!card) return;
    const id = card.mid || session.module.id;
    const text = await dialog({
      title: `Why does “${card.front}” keep going? It shows after you answer.`,
      value: card.note || '', ok: 'Save',
    });
    if (text === null) return;
    try {
      const mine = editable(id);
      const target = mine.cards.find(x => cardKey(id, x) === cardKey(id, card));
      if (!target) return toast('That card is not editable from here.');
      if (text) target.note = text; else delete target.note;
      card.note = text;                      // so the results screen shows it straight away
      await touch(mine);
      say(text ? 'Noted.' : 'Note cleared.');
    } catch (e) { showErr(e); }
  },
  // Two cards that blur together only separate when they are asked side by side, repeatedly,
  // until telling them apart is the whole exercise.
  drillpair: el => {
    const pairs = [...new Map((session.mixups || []).map(x => [x.asked + '|' + x.took, x])).values()];
    const p = pairs[+el.dataset.i];
    if (!p) return;
    const pool = session.pool || [];
    const cards = pool.filter(c => c.front === p.asked || c.front === p.took);
    if (cards.length < 2) return;
    // Each asked twice, shuffled — enough contrast to bite, short enough to actually do.
    const drill = shuffle([...cards, ...cards.map(c => ({ ...c }))]);
    launch({ id: 'pair', title: `${p.asked} vs ${p.took}`, cards: drill }, 'recall', drill, pool, false, null);
  },
  // A card missed twice is usually the card's fault. This puts the misses on the clipboard
  // as a brief Claude can act on; the reply pastes back through Import, where the diff shows
  // exactly what changed.
  sharpen: () => {
    const cards = [...new Map((session.missed || []).map(c => [c.front, c])).values()];
    if (!cards.length) return;
    navigator.clipboard?.writeText(sharpenPrompt(cards, session.module.title))
      .then(() => say('Copied — paste it to Claude, then import the reply.'))
      .catch(() => toast('The clipboard said no. Try again after tapping the page.'));
  },
  drillmissed: () => {
    const cards = [...new Map((session.missed || []).map(c => [c.front, c])).values()];
    if (!cards.length) return;
    launch({ id: 'missed', title: 'What you missed', cards }, 'recall', cards, cards, false, null);
  },
  setupme: () => { state.settings.setup = 1; save(); ACT.home(); },
  setupskip: () => { state.settings.setup = 1; save(); ACT.home(); },
  setupkid: async () => {
    const name = ((await askText("The child's name?")) || '').slice(0, 24).trim();
    state.settings.setup = 1;
    if (!name || state.profiles[name]) { save(); return ACT.home(); }
    const taken = new Set(Object.values(state.profiles).map(p => p.opts?.avatar));
    state.profiles[name] = newProfile(AVATARS.find(a => !taken.has(a)) || AVATARS[0]);
    // "Who is the pit for?" — "a child" means the pit is theirs. The untouched starter
    // profile would otherwise haunt the picker and make Duel look playable alone.
    for (const [n, p] of Object.entries(state.profiles)) {
      if (n !== name && !(p.stats?.reviews > 0)) delete state.profiles[n];
    }
    state.active = name;
    // A five-year-old should not be scrolling past Logical Fallacies to find Colours.
    // The library may still be fetching on a fresh device — wait, or the hidden list is short.
    await loadModules();
    const grownUpOnly = modules.filter(m => !(m.tags || []).includes('kids')).map(m => m.id);
    setOpt({ kid: true, tts: true, goal: 10, size: 6, hidden: grownUpOnly });
    ACT.home();
    toast(`${name} is set up — kid mode, read aloud, six cards a sitting.`);
  },
  quickcard: () => go({ name: 'quick', added: [] }),
  quicknopic: () => { view.pic = null; render(); },
  quickdone: () => ACT.home(),
  quickadd: async () => {
    let id = document.getElementById('qmod').value;
    const front = document.getElementById('qfront').value.trim();
    const back = document.getElementById('qback').value.trim();
    const note = document.getElementById('qnote').value.trim();
    const image = view.pic || '';
    if (!front || !back) return showErr(new Error('A card needs both a question and an answer.'));
    try {
      // Nowhere sensible to put it yet: make somewhere, with this card as its first.
      if (id === '+') {
        const title = ((await askText('Name the new module')) || '').trim();
        if (!title) return;
        const made = addCustom({ title, cards: [{ front, back, ...(note ? { note } : {}), ...(image ? { image } : {}) }] });
        opt().lastAdd = made.id;
        view.pic = null;
        view.added = [{ front, module: made.title }, ...(view.added || [])].slice(0, 8);
        await touch(made);
        document.getElementById('qfront').value = '';
        document.getElementById('qback').value = '';
        document.getElementById('qnote').value = '';
        return say(`Started ${made.title} with that card.`);
      }
      const m = modules.find(x => x.id === id);
      if (!m) return;
      if (m.cards.some(c => ident(c) === ident({ front, image }))) {
        return showErr(new Error('That question is already in ' + m.title + '.'));
      }
      const mine = editable(id);
      mine.cards.push({ front, back, ...(note ? { note } : {}), ...(image ? { image } : {}) });
      opt().lastAdd = id;
      view.pic = null;
      view.added = [{ front, module: mine.title }, ...(view.added || [])].slice(0, 8);
      await touch(mine);                       // saves, reloads the library, redraws
      say(`Added to ${mine.title} — ${mine.cards.length} cards.`);
    } catch (e) { showErr(e); }
  },
  // Growing a module: keep every card already held, take only the questions that are new.
  // Claude's reply rarely carries the module's id, so the target is picked by hand — with
  // the modules that would actually gain something listed first.
  appendto: async el => {
    const incoming = (view.pending || []).find(m => m.id === el.dataset.id);
    if (!incoming) return;
    // The likeliest target is the module that already holds some of these questions, so
    // rank by overlap, not by how many cards it would gain.
    const targets = modules
      .map(m => ({ m, fresh: newCards(m.cards, incoming.cards) }))
      .filter(t => t.fresh.length)
      .map(t => ({ ...t, shared: incoming.cards.length - t.fresh.length }))
      .sort((a, b) => b.shared - a.shared || a.m.title.localeCompare(b.m.title));
    if (!targets.length) return say('Every one of those cards is already in your library.');
    const id = await dialog({
      title: `Add the new cards from “${incoming.title}” to which module?`,
      choices: targets.map(t => ({ value: t.m.id,
        label: `${t.m.icon || ''} ${t.m.title} — +${t.fresh.length}${t.shared ? `, ${t.shared} already there` : ''}` })),
    });
    const target = targets.find(t => t.m.id === id);
    if (!target) return;
    try {
      const mine = editable(target.m.id);     // a bundled module forks before it grows
      mine.cards = [...mine.cards, ...target.fresh];
      await touch(mine);
      ACT.home();
      say(`Added ${target.fresh.length} card${target.fresh.length === 1 ? '' : 's'} to ${mine.title}.`);
    } catch (e) { showErr(e); }
  },
  fetchurl: async () => {
    const u = document.getElementById('url').value.trim();
    if (!u) return;
    try {
      const text = await fetchText(u);
      // The URL rides along with the preview so the committed module can be refetched later.
      view = { name: 'import', src: u,
        pending: parseImport(text, u.split('/').pop().replace(/\.[^.]+$/, '')).map(m => ({ ...m, src: u })) };
      render();
    } catch (e) { showErr(new Error(e.message.includes('Failed to fetch') ? 'Could not fetch that URL (the site may block cross-origin reads).' : e.message)); }
  },
  // The loop closes here: the module's own questions go back to Claude as a prompt, and the
  // reply comes home through the importer, which offers to append rather than replace.
  grow: async el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (!m) return;
    const n = await dialog({ title: `How many more cards for “${m.title}”?`, choices: [
      { value: '10', label: '10 more' }, { value: '20', label: '20 more' }, { value: '40', label: '40 more' }] });
    if (!n) return;
    const text = growPrompt(m, +n);
    try {
      await navigator.clipboard.writeText(text);
      say('Prompt copied — paste it into Claude, then bring the answer back through Import.');
    } catch {
      // No clipboard permission (or no clipboard): show it so it can still be selected.
      await dialog({ title: text, ok: 'Close' });
    }
  },
  refresh: async el => {
    const id = el.dataset.id;
    const m = modules.find(x => x.id === id);
    if (!m?.src) return;
    say('Checking ' + host(m.src) + '…');
    try {
      const found = parseImport(await fetchText(m.src), m.title);
      // A source can hold several modules; take the one this module came from.
      const incoming = found.find(x => x.id === id) || found[0];
      if (!incoming) throw new Error('Nothing readable came back.');
      const fresh = newCards(m.cards, incoming.cards);
      if (!fresh.length) return say('Already up to date — ' + m.cards.length + ' cards.');
      if (!await dialog({ ok: 'Add', title: `${host(m.src)} has ${fresh.length} card${fresh.length === 1 ? '' : 's'} `
        + `you do not have yet, starting with “${fresh[0].front}”. Add them? Nothing you already study changes.` })) return;
      const mine = editable(id);              // a bundled module forks before it grows
      mine.cards = [...mine.cards, ...fresh];
      mine.src = m.src;
      await touch(mine);                      // saves, reloads the library, redraws
      say(`Added ${fresh.length} new card${fresh.length === 1 ? '' : 's'}.`);
    } catch (e) { showErr(e); }
  },
  copyprompt: () => navigator.clipboard?.writeText(PROMPT).then(() => say('Prompt copied — paste it at the end of a Claude conversation.')),
  // The whole library as one readable document — for keeping, for printing, and for pasting
  // back into a conversation when you want more of it.
  // Fifty sittings, one line each — enough to make your own charts from without asking the
  // app to grow a charting library.
  // No push server, so the calendar does the reminding: one .ics, repeating daily.
  remindme: async () => {
    // Default to the part of the day this learner actually answers best in, once that is known.
    const best = bestTime(P().stats.sessions || [])?.best.name;
    const t = ((await askText('Remind at what time? (24h, like 17:30)',
      { morning: '08:00', afternoon: '14:00', evening: '19:00', 'late at night': '22:00' }[best] || '17:00')) || '').trim();
    if (!t) return;
    const ics = reminderIcs(t, location.origin + location.pathname);
    if (!ics) return toast('That is not a time — try 17:30.');
    download('learning-pit-reminder.ics', ics, 'text/calendar');
    say('Open the file and your calendar takes it from there.');
  },
  exporthistory: () => {
    const rows = [['when', 'module', 'exercise', 'right', 'wrong', 'seconds']];
    for (const s of P().stats.sessions || []) {
      rows.push([new Date(s.t).toISOString(), s.m, s.g, s.r, s.w, s.secs ?? '']);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`${state.active}-history.csv`, csv, 'text/csv');
  },
  exportmd: () => {
    const md = `# ${state.active}'s Learning Pit

${toMarkdown(visible())}`;
    download('learning-pit.md', md, 'text/markdown');
  },
  export: () => {
    download(`learning-pit-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
    state.settings.lastBackup = today();
    save({ sync: false });
  },
  signin: async () => {
    try { await auth(true); renderBar(); say('Syncing…'); await sync(); renderBar(); say('Synced.'); }
    catch (e) { showErr(e); }
  },
  wipe: async () => {
    if (!await askYes('Erase every profile, module and setting on this device? Export a backup first if you want one.', 'Erase')) return;
    for (const k of ['pit.v1', 'pit.session', 'pit.wasSignedIn', 'pit.mockdrive']) localStorage.removeItem(k);
    try { indexedDB.deleteDatabase(MEDIA); } catch { /* nothing to delete */ }
    setTimeout(() => location.reload(), 300);
  },
  signout: async () => {
    // Hand the token back rather than just forgetting it — this is a family device.
    if (!await askYes('Stop syncing on this device? Progress stays here and in Drive.', 'Sign out')) return;
    try { if (token) google.accounts.oauth2.revoke(token, () => {}); } catch { /* offline */ }
    token = null;
    account = null;
    tokenExp = 0;
    tokenClient = null;
    syncError = '';
    localStorage.removeItem('pit.wasSignedIn');
    render();
    say('Signed out.');
  },
  sync: async () => {
    try { say('Syncing…'); await sync(); syncError = ''; render(); say('Synced.'); }
    catch (e) { syncError = e.message; renderBar(); toast('Sync failed: ' + e.message); }
  },

  browse: el => go({ name: 'browse', id: el.dataset.id }),
  // Hands-free revision, and the only way a child who cannot read yet can meet a whole module
  // on their own. Each card is spoken with its answer, then it moves on by itself.
  readall: () => {
    view.reading = 0;
    render();
    readOn(view.id, 0);
  },
  readstop: () => { hushSpeech(); view.reading = null; render(); },
  // Reading through is where typos are actually noticed; the fix should be one tap away.
  editfrom: el => {
    const id = view.id;
    editable(id);
    go({ name: 'edit', id, editing: +el.dataset.i });
  },
  readaloud: el => {
    const m = modules.find(x => x.id === view.id);
    const c = m?.cards[+el.dataset.i];
    if (!c) return;
    if (!playClip(c)) speak(`${c.front}. ${c.back}`, true);
  },
  edit: el => { editable(el.dataset.id); go({ name: 'edit', id: el.dataset.id }); },
  editcard: el => { view.editing = +el.dataset.i; view.found = null; render(); },
  // A picture for a word, from Wikimedia Commons — finding pictures was the slow part of
  // making a picture module. The one network call the editor makes, and only when asked; the
  // chosen file is shrunk like any other, and the card keeps the file's page as its source,
  // which is also where the credit lives.
  findpic: async () => {
    const m = editable(view.id), c = m?.cards[view.editing];
    if (!c) return;
    const q = ((await askText('Find a picture of…', c.back.length <= 30 ? c.back : c.front.slice(0, 30))) || '').trim();
    if (!q) return;
    say('Searching…');
    try {
      const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search'
        + `&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}`
        + '&prop=imageinfo&iiprop=url&iiurlwidth=320';
      const r = await fetch(u);
      if (!r.ok) throw new Error('Commons said ' + r.status);
      const pages = Object.values((await r.json()).query?.pages || {});
      view.found = pages
        .map(p => ({ title: String(p.title || '').replace(/^File:/, ''), thumb: p.imageinfo?.[0]?.thumburl, page: p.imageinfo?.[0]?.descriptionurl }))
        .filter(f => /^https:\/\//.test(f.thumb || '')).slice(0, 6);
      render();
    } catch (e) { showErr(new Error('Could not reach Wikimedia Commons — are you online?')); }
  },
  usepic: async el => {
    const f = view.found?.[+el.dataset.i];
    if (!f) return;
    try {
      const data = await shrinkImage(await (await fetch(f.thumb)).blob());
      const target = editable(view.id), card = target.cards[view.editing];
      card.image = data;
      if (/^https:\/\//.test(f.page || '') && !card.source) card.source = f.page;
      view.found = null;
      say(`Picture added (${Math.round(data.length / 1024)} KB).`);
      touch(target);
    } catch (e) { showErr(new Error('That picture could not be fetched.')); }
  },
  rec: () => {
    if (recorder) return recorder.stop();      // the change lands in the callback below
    recordClip(data => {
      const m = editable(view.id);
      m.cards[view.editing].audio = data;
      say(`Recorded (${Math.round(data.length / 1024)} KB).`);
      touch(m);
    }, err => { showErr(err); render(); });
    render();
  },
  playcard: () => playClip(editable(view.id).cards[view.editing]),
  delaudio: () => {
    const m = editable(view.id);
    delete m.cards[view.editing].audio;
    touch(m);
  },
  delpic: () => {
    const m = editable(view.id);
    delete m.cards[view.editing].image;
    touch(m);
  },
  // Pruning a 200-card import one card at a time is the worst part of curating a library.
  bulkclear: () => { view.sel = []; render(); },
  // Exactly the cards ticked, in the order they sit in the module — the way you would
  // rehearse a specific handful before a test.
  bulkdrill: () => {
    const m = modules.find(x => x.id === view.id);
    const cards = (view.sel || []).slice().sort((a, b) => a - b).map(i => m?.cards[i]).filter(Boolean);
    if (!cards.length) return;
    launch(m, 'recall', cards, m.cards, false, null);
  },
  bulkpause: () => setPausedForSelection(true),
  bulkresume: () => setPausedForSelection(false),
  bulkdelete: async () => {
    const m = editable(view.id), sel = view.sel || [];
    if (m.cards.length - sel.length < 1) return toast('A module needs at least one card.');
    if (!await askYes(`Delete ${sel.length} card${sel.length === 1 ? '' : 's'}?`)) return;
    const doomed = new Set(sel.map(i => m.cards[i]));
    const before = m.cards.slice();
    m.cards = m.cards.filter(c => !doomed.has(c));
    view.sel = [];
    view.editing = null;
    await touch(m);
    undoable(`${doomed.size} deleted.`, async () => {
      const back = editable(view.id);
      back.cards = before;
      await touch(back);
    });
  },

  // Two modules covering the same ground is the usual result of asking Claude twice.
  merge: async el => {
    const from = modules.find(x => x.id === el.dataset.id);
    const others = modules.filter(m => m.id !== from.id);
    if (!others.length) return toast('There is nothing to merge into yet.');
    const intoId = await dialog({
      title: `Move every card from “${from.title}” into…`,
      choices: others.map(m => ({ value: m.id, label: `${m.icon || '◈'} ${m.title} (${m.cards.length})` })),
    });
    if (!intoId) return;
    const into = editable(intoId);
    const have = new Set(into.cards.map(c => c.front.toLowerCase() + ' ' + (c.image || '')));
    const added = from.cards.filter(c => !have.has(c.front.toLowerCase() + ' ' + (c.image || '')));
    into.cards.push(...added.map(c => ({ ...c })));
    // The source is only removed if it was a local copy; a bundled file stays on disk and is
    // hidden for this learner instead, so nothing is destroyed that cannot be got back.
    if ((state.custom || []).some(c => c.id === from.id)) {
      state.custom = state.custom.filter(c => c.id !== from.id);
    } else {
      opt().hidden = [...new Set([...opt().hidden, from.id])];
    }
    await touch(into);
    toast(`${added.length} card${added.length === 1 ? '' : 's'} moved into ${into.title}${
      added.length < from.cards.length ? ` (${from.cards.length - added.length} were already there)` : ''}.`);
    go({ name: 'module', id: into.id });
  },

  // The other direction: pull the cards you have filtered out into a module of their own.
  split: async () => {
    const m = editable(view.id);
    const q = norm(view.cq || '');
    const matching = m.cards.filter(c => q && norm(c.front + ' ' + c.back).includes(q));
    if (!matching.length) return toast('Filter to the cards you want to split out first.');
    if (matching.length === m.cards.length) return toast('That is every card — nothing to split.');
    const title = await askText(`Move ${matching.length} matching cards into a new module called…`, view.cq);
    if (!title) return;
    const fresh = validateModule({ title, tags: m.tags, icon: m.icon, cards: matching });
    fresh.savedAt = Date.now();
    m.cards = m.cards.filter(c => !matching.includes(c));
    state.custom = [...(state.custom || []).filter(c => c.id !== fresh.id), fresh];
    view.cq = '';
    await touch(m);
    toast(`${fresh.cards.length} cards moved into ${fresh.title}.`);
  },

  savecard: () => {
    const get = f => app.querySelector(`[data-card="${f}"]`).value.trim();
    if (!get('front') || !get('back')) return showErr(new Error('A card needs both a front and a back.'));
    const m = editable(view.id);
    view.editing = null;      // the fields already wrote through; this just closes the row
    touch(m);
  },
  // One card in the wrong module — merge is a sledgehammer for that. The move carries every
  // learner's history with it: the card keeps being the same question, so it keeps its past.
  movecard: async () => {
    const fromId = view.id, i = view.editing;
    const from = editable(fromId);
    const card = from.cards[i];
    if (!card) return;
    if (from.cards.length < 2) return showErr(new Error('A module needs at least one card.'));
    // Your own modules first — that is where a stray card is going — then the shelf, all of it.
    const customIds = new Set((state.custom || []).map(c => c.id));
    const others = visible().filter(x => x.id !== fromId)
      .sort((a, b) => (customIds.has(b.id) - customIds.has(a.id)) || a.title.localeCompare(b.title));
    const toId = await dialog({
      title: `Move “${card.front}” to which module?`,
      choices: others.map(o => ({ value: o.id, label: `${o.icon || ''} ${o.title}` })),
    });
    if (!toId) return;
    const target = modules.find(x => x.id === toId);
    if (!target) return;
    if (target.cards.some(c => ident(c) === ident(card))) {
      return showErr(new Error(`${target.title} already asks that.`));
    }
    try {
      const mine = editable(toId);
      const oldKey = cardKey(fromId, card);
      from.cards.splice(i, 1);
      mine.cards.push(card);
      const newKey = cardKey(toId, card);
      for (const p of Object.values(state.profiles)) {
        if (p.srs[oldKey]) { p.srs[newKey] = p.srs[oldKey]; delete p.srs[oldKey]; }
      }
      mine.savedAt = Date.now();
      view.editing = null;
      await touch(from);        // one save covers both — they live in the same state
      say(`Moved to ${mine.title}, history and all.`);
    } catch (e) { showErr(e); }
  },
  delcard: async el => {
    const m = editable(view.id), i = +el.dataset.i;
    if (m.cards.length < 2) return showErr(new Error('A module needs at least one card.'));
    if (!await askYes(`Delete "${m.cards[i].front}"?`)) return;
    const [gone] = m.cards.splice(i, 1);
    view.editing = null;
    await touch(m);
    undoable('Card deleted.', async () => {
      const back = editable(view.id);
      back.cards.splice(Math.min(i, back.cards.length), 0, gone);
      await touch(back);
    });
  },
  pausecard: el => {
    const m = editable(view.id), c = m.cards[+el.dataset.i], p = P();
    const k = cardKey(m.id, c);
    const s = p.srs[k] = Object.assign({ reps: 0, lapses: 0, ease: 2.5, interval: 0, due: Date.now() }, p.srs[k]);
    s.susp = !s.susp;
    // Resuming a card that was parked for repeated failure gives it a clean slate, or the
    // next miss would park it again immediately.
    if (!s.susp) { s.lapses = 0; s.due = Date.now(); }
    s.t = Date.now();
    save();
    render();
  },
  addcard: el => {
    const m = editable(el.dataset.id);
    m.cards.push({ id: 'c' + Date.now().toString(36), front: 'New card', back: 'Answer' });
    view.editing = m.cards.length - 1;
    touch(m);
  },
  newmodule: async () => {
    const title = (await askText('What is the module called?')) || '';
    if (!title) return;
    const m = validateModule({ title, cards: [{ front: 'First question', back: 'Answer' }] });
    m.savedAt = Date.now();
    state.custom = [...(state.custom || []), m];
    save();
    loadModules().then(() => go({ name: 'edit', id: m.id, editing: 0 }));
  },
  recap: async () => {
    const text = recapText();
    if (navigator.share) {
      try { await navigator.share({ title: 'Learning Pit', text }); return say('Shared.'); }
      catch { /* the sheet was dismissed — fall through to the clipboard */ }
    }
    try { await navigator.clipboard.writeText(text); say('Copied: ' + text); }
    catch { await dialog({ title: text, ok: 'Close' }); }
  },
  share: el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (m) shareModule(m).catch(showErr);
  },
  print: () => { view.editing = null; render(); window.print(); },
  // Cut along the solid lines, fold along the dashed one: real cards for small hands.
  printcards: el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (!m) return;
    app.className = 'screen cutouts';
    app.innerHTML = `
      <h1>${esc(m.title)}</h1>
      <p class="lede noprint">Cut along the solid lines, fold along the dashed one.
        <button class="linky" data-act="back">go back</button></p>
      <div class="cutgrid">${m.cards.map(c => `<div class="cut">
        <div class="cut-front">${fmt(c.front)}</div>
        <div class="cut-back">${fmt(c.back)}</div>
      </div>`).join('')}</div>`;
    setTimeout(() => window.print(), 100);
  },
  tryvoice: () => speak('Which planet is the hottest?', true),
  install: async () => {
    if (installPrompt) { installPrompt.prompt(); installPrompt = null; return; }
    if (matchMedia('(display-mode: standalone)').matches) return toast('Already installed.');
    // iOS has no install prompt, so say where the button actually is.
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    toast(ios ? 'Tap Share, then “Add to Home Screen”.' : 'Use your browser menu: Install app / Add to Home Screen.');
  },
  exam: () => { view.exam = !view.exam; render(); },
  exportmodule: el => {
    const m = modules.find(x => x.id === el.dataset.id);
    download(m.id + '.json', JSON.stringify(m, null, 2), 'application/json');
  },
  // Tab-separated, which is what Anki and every spreadsheet speak — and what our own
  // importer reads back, so this round-trips.
  exporttsv: el => {
    const m = modules.find(x => x.id === el.dataset.id);
    const clean = s => String(s || '').replace(/[\t\r\n]+/g, ' ');
    const rows = m.cards.map(c => [c.front, c.back, c.hint, c.note].map(clean).join('\t'));
    download(m.id + '.tsv', rows.join('\n'), 'text/tab-separated-values');
  },

  tag: el => { view.tag = view.tag === el.dataset.t ? '' : el.dataset.t; render(); },
  sort: () => { setOpt({ sort: opt().sort === 'due' ? '' : 'due' }); render(); },
  rev: () => { view.rev = !view.rev; render(); },
  setdeadline: async el => {
    const id = el.dataset.id;
    const now = deadlines()[id] || '';
    const answer = await dialog({ title: 'Learn it all by when? (YYYY-MM-DD, or empty to clear)', value: now, ok: 'Set' });
    if (answer === null) return;
    if (answer && !/^\d{4}-\d{2}-\d{2}$/.test(answer)) return toast('Use a date like 2026-08-24.');
    if (answer) deadlines()[id] = answer; else delete deadlines()[id];
    setOpt({ deadlines: deadlines() });      // stamped, so sync knows this device set it
    render();
  },
  drill: () => {
    if (!matches.length) return;
    launch({ id: 'search', title: 'Search results', cards: matches }, 'recall', matches.slice(0, 20), null, false, ACT.drill);
  },
  subject: el => { hushSpeech(); session = null; view = { name: 'home', tag: el.dataset.t }; render(); },
  drillconfusion: el => {
    const wanted = new Set([el.dataset.a, el.dataset.b]);
    const cards = [];
    for (const m of visible()) {
      for (const c of m.cards) if (wanted.has(c.front)) cards.push({ ...c, mid: m.id, from: m.title });
    }
    if (cards.length < 2) return toast('One of those cards is gone.');
    const drill = shuffle([...cards, ...cards.map(c => ({ ...c }))]);
    launch({ id: 'pair', title: `${el.dataset.a} vs ${el.dataset.b}`, cards: drill },
      'recall', drill, cards, false, null);
  },
  drillstarred: () => {
    const cards = starred(visible(), P().srs);
    if (!cards.length) return;
    launch({ id: 'starred', title: 'Starred', cards }, 'recall', cards, cards, false, ACT.drillstarred);
  },
  drillrough: el => {
    const m = modules.find(x => x.id === el.dataset.id);
    if (!m) return;
    const cards = troubleSpots([m], P().srs, 6).map(r => r.card);
    if (!cards.length) return;
    launch({ id: 'rough:' + m.id, title: `${m.title} — rough spots`, cards }, 'recall',
      shuffle(cards), cards, false, null);
  },
  drillstuck: () => {
    const cards = troubleSpots(visible(), P().srs).map(t => t.card);
    if (!cards.length) return;
    launch({ id: 'stuck', title: 'Sticking points', cards }, 'recall', cards, cards, false, ACT.drillstuck);
  },
  drilltag: () => {
    // Due cards from every module carrying this tag, oldest first, then anything new.
    const tag = view.tag, srs = P().srs, now = Date.now(), due = [], fresh = [];
    for (const m of visible().filter(x => x.tags.includes(tag))) {
      for (const c of m.cards) {
        const s = srs[cardKey(m.id, c)];
        const card = { ...c, mid: m.id, from: m.title };
        if (s?.susp) continue;
        if (!s) fresh.push(card);
        else if (s.due <= now) due.push({ ...card, due: s.due });
      }
    }
    due.sort((a, b) => a.due - b.due);
    const cards = [...due, ...shuffle(fresh).slice(0, Math.max(0, opt().size - due.length))].slice(0, opt().size);
    if (!cards.length) return toast(`Nothing left to drill under “${tag}” today.`);
    launch({ id: 'tag:' + tag, title: `Tagged “${tag}”`, cards }, 'recall', cards, null, false, ACT.drilltag);
  },

  reviewall: () => {
    const due = dueEverything();
    if (!due.length) return ACT.learnnew();
    launch({ id: 'everything', title: 'Everything due', cards: due }, 'ladder', due.slice(0, 20), null, false, ACT.reviewall);
  },
  // Overload relief. A returned-from-holiday pile teaches nothing but dread; dealt out over
  // the week it goes back to being a habit. Only what the learner can see moves.
  spreadpile: () => {
    const p = P(), vis = new Set(visible().map(m => m.id));
    const mine = Object.fromEntries(Object.entries(p.srs).filter(([k]) => vis.has(k.split(':')[0])));
    const moves = spreadDue(mine);
    if (!moves.length) return;
    const was = moves.map(([k]) => [k, p.srs[k].due]);
    for (const [k, due] of moves) { p.srs[k].due = due; p.srs[k].t = Date.now(); }
    save();
    render();
    undoable(`Spread ${moves.length} cards over the week.`, () => {
      // A fresh stamp, not the old one — the undo has to win last-write-wins too.
      for (const [k, due] of was) if (p.srs[k]) { p.srs[k].due = due; p.srs[k].t = Date.now(); }
      save();
      render();
    });
  },
  again: () => {
    const repeat = session?.again;
    if (repeat) repeat(); else ACT.home();
  },
  resume: () => { const r = readSession(); if (r) resume(r); else render(); },
  learnnew: () => {
    // Whichever module has the most unseen cards — no menu, just start.
    const p = P();
    const best = visible()
      .map(m => ({ m, n: counts(m.cards, p.srs, m.id).fresh }))
      .sort((a, b) => b.n - a.n)[0];
    if (!best?.n) return toast('Every card has been seen — import or write a new module.');
    startGame(best.m.id, 'recall');
  },
  pausekey: el => {
    const p = P(), k = el.dataset.k;
    p.srs[k] = Object.assign({ reps: 0, lapses: 0, ease: 2.5, interval: 0, due: Date.now() }, p.srs[k]);
    p.srs[k].susp = true;
    p.srs[k].t = Date.now();
    save();
    render();
    say('Paused. Resume it from the module editor.');
  },

  undo: () => {
    const s = session, u = s.undo, p = P();
    if (!u) return;
    if (u.srs) p.srs[u.k] = u.srs; else delete p.srs[u.k];
    p.stats = u.stats;
    Object.assign(s, { right: u.right, wrong: u.wrong, done: u.done, undo: null });
    if (u.queue) s.queue = u.queue;
    if (u.missed) s.missed = u.missed; else delete s.missed;
    s.flipped = false; s.opts = null; s.picked = null; s.verdict = null; s.guess = ''; s.sub = null; s.peek = false;
    save();
    render();
    say('Undone.');
  },

  // in-session
  flip: () => { session.flipped = true; render(); },
  check: () => {
    const s = session, c = s.queue[0];
    s.guess = document.getElementById('ans').value;
    s.verdict = judgeTyped(s.guess, c.back, c.alt, c.options);
    grade(c, s.verdict === 'wrong' ? 'again' : 'good');
    render();
  },
  reveal: () => {
    const s = session;
    s.said = document.getElementById('dump')?.value || '';
    s.shown = true;
    render();
  },
  // Dictation here adds to what you wrote instead of being judged against the answer.
  saymore: () => {
    const s = session;
    if (recog) { recog.abort(); recog = null; return render(); }
    s.said = document.getElementById('dump')?.value || '';
    listen(alternatives => {
      s.said = (s.said + ' ' + alternatives[0]).trim();
      render();
    });
    render();
  },
  mic: () => {
    if (recog) { recog.abort(); recog = null; return render(); }
    listen(alternatives => {
      const s = session;
      const card = s.queue[0];
      const blank = (s.sub || s.key) === 'cloze';
      const target = blank ? s.blank.answer : card.back;
      const also = blank ? [] : card.alt;
      // Take the alternative the speech engine offered that scores best — "for" vs "four".
      const best = alternatives
        .map(t => ({ t, v: judgeTyped(t, target, also) }))
        .sort((a, b) => ['exact', 'close', 'wrong'].indexOf(a.v) - ['exact', 'close', 'wrong'].indexOf(b.v))[0];
      s.guess = best.t;
      render();
      const el = document.getElementById('ans');
      if (el) el.value = best.t;
      ACT[blank ? 'checkblank' : 'check']();
    });
    render();
  },
  handsgrade: el => {                      // the manual override, for when speech misfires
    const s = session, c = s.queue[0];
    hushSpeech();
    if (!s.verdict) grade(c, el.dataset.g);
    else if (el.dataset.g === 'good' && s.verdict === 'wrong') ACT.override();
    ACT.handsnext();
  },
  handsrepeat: () => { hushSpeech(); session.phase = 'ask'; session.heard = ''; render(); },
  handsnext: () => {
    const s = session;
    hushSpeech();
    s.queue.shift();
    s.done++;
    s.phase = 'ask';
    s.verdict = null;
    s.heard = '';
    render();
  },
  slot: el => {
    const s = session, i = +el.dataset.i;
    const next = s.slots.indexOf(null);
    if (next === -1) return;
    s.slots[next] = i;
    blip('good');
    render();
    // Filling the last slot with the right letters checks itself — no extra tap for a five-year-old.
    if (!s.slots.includes(null)) {
      const built = s.slots.map(t => s.tiles[t]).join('');
      if (built === session.queue[0].back.trim().toUpperCase()) ACT.checkspell();
    }
  },
  unslot: el => {
    const s = session;
    if (s.verdict) return;
    s.slots[+el.dataset.i] = null;
    render();
  },
  checkspell: () => {
    const s = session, c = s.queue[0];
    const built = s.slots.map(t => s.tiles[t]).join('');
    s.verdict = built === c.back.trim().toUpperCase() ? 'exact' : 'wrong';
    grade(c, s.verdict === 'wrong' ? 'again' : 'good');
    render();
  },
  skip: () => {
    const s = session;
    const c = s.queue.shift();
    if (s.queue.length < 24) s.queue.push(c); else s.done++;   // seen later, not judged now
    s.verdict = null; s.guess = ''; s.blank = null; s.peek = false; s.sub = null;
    render();
    say('Skipped.');
  },
  checkblank: () => {
    const s = session;
    s.guess = document.getElementById('ans').value;
    s.verdict = judgeTyped(s.guess, s.blank.answer);
    grade(s.queue[0], s.verdict === 'wrong' ? 'again' : 'good');
    render();
  },
  override: () => {
    const s = session, c = s.queue[0];
    const p = P(), k = cardKey(s.module.id, c);
    p.srs[k] = schedule(p.srs[k], 'good');   // undo the lapse we just recorded
    p.stats.correct++;
    p.stats.hits[today()] = (p.stats.hits[today()] || 0) + 1;
    if (s.missed) s.missed = s.missed.filter(x => x !== c);
    s.wrong--; s.right++;
    s.verdict = 'close';
    save();
    render();
  },
  speak: () => {
    const c = session.queue[0];
    // Flipped, a recording is what you want to hear; face down, the question.
    if (session.flipped && c.audio) return void playClip(c);
    speak(session.flipped ? c.back : c.front, true, null, session.flipped ? c : null);
  },
  grade: el => {
    const s = session, c = s.queue.shift(), g = el.dataset.g;
    const key = cardKey(s.module.id, c);
    const wasNew = !P().srs[key];   // read before grading, which creates the entry
    grade(c, g);
    // A missed card comes back, and so does a brand-new one you got right — seeing a new
    // card exactly once is presentation, not learning. Easy means you already knew it.
    s.seen ||= new Set();
    const repeat = !s.exam && ((g === 'again') || (wasNew && g === 'good' && !s.seen.has(key)));
    if (repeat && s.queue.length < 24) { s.seen.add(key); s.queue.push(c); } else s.done++;
    s.flipped = false;
    s.shown = false;
    s.said = '';
    s.peek = false;
    s.sub = null;
    render();
  },
  gospeed: () => { session.game.run(session); render(); },
  sortpick: el => {
    const s = session, c = s.queue[0];
    s.picked = el.dataset.bin;
    // The card is scored in its own module, wherever it was sorted to.
    grade(c, s.picked === c.mid ? 'good' : 'again');
    render();
  },
  duelpick: el => {
    const s = session, i = +el.dataset.i, c = s.queue[0];
    const right = s.opts[i] === c.back;
    s.picked = i;
    if (right) s.scores[s.turn]++;
    // Score it against the player who actually answered, not whoever the tablet belongs to.
    const was = state.active;
    state.active = s.players[s.turn];
    grade(c, right ? 'good' : 'again');
    state.active = was;
    save();
    render();
  },
  duelnext: () => {
    const s = session;
    s.queue.shift();
    s.done++;
    s.opts = null;
    s.picked = null;
    s.turn = (s.turn + 1) % s.players.length;
    render();
  },
  quick: el => {
    const s = session, i = +el.dataset.i, c = s.queue[0];
    s.picked = i;
    if (s.opts[i] !== c.back) noteMixup(s, c, s.opts[i]);
    grade(c, s.opts[i] === c.back ? 'good' : 'again');
    render();
    // Brief pause so the right answer registers, then straight on — no tapping through.
    setTimeout(() => {
      if (session !== s || view.name !== 'session') return;
      s.queue.shift();
      s.done++;
      s.opts = null;
      s.picked = null;
      if (!s.queue.length) s.queue = shuffle(s.cards);   // ran out of cards before time
      render();
    }, s.opts[i] === c.back ? 350 : 1100);
  },
  pick: el => {
    const s = session, i = +el.dataset.i;
    s.picked = i;
    const right = s.opts[i] === s.queue[0].back;
    if (!right) noteMixup(s, s.queue[0], s.opts[i]);
    grade(s.queue[0], right ? 'good' : 'again');
    render();
  },
  studynext: () => {
    const s = session;
    if (++s.i < s.show.length) return render();
    s.phase = 'quiz';
    s.queue = shuffle(s.show.slice());   // asked in a different order than they were read
    s.flipped = false;
    render();
  },
  showword: () => { session.shown = true; render(); },
  wipe: () => drawSlate(session.shown ? session.queue[0].back.toUpperCase() : '', session.shown),
  padtap: el => {
    const s = session;
    if (s.entry.length < 6) s.entry += el.dataset.n;
    render();
  },
  padback: () => { session.entry = session.entry.slice(0, -1); render(); },
  padok: () => {
    const s = session, c = s.queue[0];
    s.verdict = s.entry === c.back.trim() ? 'exact' : 'wrong';
    grade(c, s.verdict === 'wrong' ? 'again' : 'good');
    render();
  },
  tf: el => {
    const s = session, said = el.dataset.v === '1';
    s.picked = said;
    grade(s.queue[0], said === s.claim.truth ? 'good' : 'again');
    render();
  },
  point: el => {
    const s = session, i = +el.dataset.i;
    s.picked = i;
    grade(s.queue[0], s.tiles[i].back === s.queue[0].back ? 'good' : 'again');
    render();
  },
  sayback: () => { const c = session?.queue[0]; if (c) speak(c.back, true, null, c); },
  next: () => {
    const s = session;
    s.queue.shift();
    s.done++;
    clearCardState(s);
    render();
  },
  // A star is the learner's own mark, and the one thing the scheduler cannot infer: come
  // back to this, whatever the algorithm thinks.
  starcard: () => {
    const s = session, c = s.queue?.[0];
    if (!c) return;
    const p = P(), k = cardKey(s.module.id, c);
    const e = (p.srs[k] ||= { due: Date.now(), ease: 2.5, interval: 0, reps: 0, lapses: 0 });
    e.star = !e.star;
    e.t = Date.now();
    save();
    render();
    say(e.star ? 'Starred.' : 'Star removed.');
  },
  // Stopping is not abandoning: what was answered stays answered, the sitting is scored and
  // logged as it stands, and the unasked cards simply wait their turn.
  endsitting: () => {
    if (!session || session.right + session.wrong === 0) return;
    finish();
  },
  peek: () => { session.peek = true; render(); },
  // Not today: the card waits until tomorrow, ungraded. Skip brings it back inside the
  // sitting and park removes it for good; this is the one in between.
  snooze: () => {
    const s = session, c = s.queue?.[0];
    if (!c) return;
    const p = P(), k = cardKey(s.module.id, c);
    if (p.srs[k]) { p.srs[k].due = Math.max(p.srs[k].due, Date.now() + 86400000); p.srs[k].t = Date.now(); save(); }
    s.queue = s.queue.filter(x => x !== c);     // a repeat already queued goes with it
    s.done++;
    clearCardState(s);
    toast('Back tomorrow.');
    render();
  },
  // Order it: tap the steps into place; the last one checks itself when it lands right.
  ostep: el => {
    const s = session, st = s.steps;
    if (s.verdict || st.placed.includes(+el.dataset.i)) return;
    st.placed.push(+el.dataset.i);
    blip('good');
    render();
    if (st.placed.length === st.items.length && st.placed.every((i, n) => st.deal[i] === st.items[n])) ACT.ocheck();
  },
  ounstep: el => {
    const s = session;
    if (s.verdict) return;
    s.steps.placed.splice(+el.dataset.n);       // this one and everything after it go back
    render();
  },
  ocheck: () => {
    const s = session, c = s.queue[0], { items, deal, placed } = s.steps;
    s.verdict = placed.length === items.length && placed.every((i, n) => deal[i] === items[n]) ? 'exact' : 'wrong';
    grade(c, s.verdict === 'wrong' ? 'again' : 'good');
    render();
  },
  // Park: out of rotation for good, until it is let back in from the module screen.
  parkcard: () => {
    const s = session, c = s.queue?.[0];
    if (!c) return;
    const p = P(), k = cardKey(s.module.id, c);
    // t is what sync compares, so a park has to be stamped like any other change.
    p.srs[k] = { ...(p.srs[k] || { due: Date.now(), ease: 2.5, interval: 0, reps: 0, lapses: 0 }),
      susp: true, t: Date.now() };
    save();
    s.queue.shift();
    s.done++;
    clearCardState(s);
    toast('Parked — let it back in from Edit cards.');
    render();
  },
  // Fix: the editor, opened on this very card; going back lands in the session again.
  // ponytail: the card on screen is the copy the session started with, so a change to its
  // wording shows the next time it comes round rather than immediately.
  fixcard: async () => {
    const s = session, c = s.queue?.[0];
    if (!c) return;
    const id = c.mid || s.module.id;
    try {
      const mine = editable(id);
      const i = mine.cards.findIndex(x => cardKey(id, x) === cardKey(id, c));
      if (i < 0) return toast('That card cannot be edited from here.');
      await loadModules();
      go({ name: 'edit', id, editing: i });
    } catch (e) { showErr(e); }
  },
  match: el => {
    const s = session, n = +el.dataset.n, t = s.tiles[n];
    speak(t.text);                      // reads the tile aloud when read-aloud is on
    if (s.sel === null) { s.sel = n; return render(); }
    const prev = s.tiles[s.sel];
    if (s.sel === n) { s.sel = null; return render(); }
    if (prev.i === t.i && prev.side !== t.side) { s.matched.add(t.i); s.done++; }
    else { s.wrongPairs.add(prev.i); s.wrongPairs.add(t.i); }
    s.sel = null;
    render();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  ACT[el.dataset.act]?.(el);
});

// Swipe a revealed card: left is Again, right is Good. Buttons still do everything —
// this is the shortcut for a thumb, not a replacement for them.
let swipe = null;
document.addEventListener('pointerdown', e => {
  const card = e.target.closest('.screen.session .card');
  if (!card || !session?.flipped || (session.sub || session.key) !== 'recall') return;
  swipe = { x: e.clientX, y: e.clientY, card };
});
document.addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x;
  if (Math.abs(dx) > 8) {
    swipe.card.style.transform = `translateX(${dx * 0.6}px) rotate(${dx * 0.02}deg)`;
    swipe.card.style.borderColor = dx > 0 ? 'var(--good)' : 'var(--bad)';
  }
});
document.addEventListener('pointerup', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = Math.abs(e.clientY - swipe.y);
  swipe.card.style.transform = swipe.card.style.borderColor = '';
  const far = Math.abs(dx) > Math.max(70, swipe.card.offsetWidth * 0.22);
  swipe = null;
  if (far && dy < 90) document.querySelector(`[data-g="${dx > 0 ? 'good' : 'again'}"]`)?.click();
});
document.addEventListener('pointercancel', () => {
  if (swipe) swipe.card.style.transform = swipe.card.style.borderColor = '';
  swipe = null;
});

// Keyboard for the desk; every one of these has a button for the tablet.
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = e.target instanceof Element && e.target.matches('input, textarea');
  if (e.key === 'Escape' && !typing) return back();
  if (e.key === '?' && !typing) return ACT.shortcuts();
  if (e.key === '/' && !typing && document.getElementById('q')) { e.preventDefault(); return document.getElementById('q').focus(); }
  if (view.name !== 'session') return;
  const s = session, k = e.key, mode = s.sub || s.key;   // the ladder draws another game's frame
  // Starring is the one session tool safe to put on a key: it changes nothing but a mark.
  if (k.toLowerCase() === 's' && !typing && document.querySelector('[data-act="starcard"]')) {
    e.preventDefault();
    return ACT.starcard();
  }
  if (k.toLowerCase() === 'u' && !typing && session?.undo) {
    e.preventDefault();
    return ACT.undo();
  }
  const hit = sel => { const el = document.querySelector(sel); if (el && !el.disabled) { e.preventDefault(); el.click(); } };
  if (mode === 'recall') {
    if (typing) return;
    if (k === ' ' || k === 'Enter') return hit(s.flipped ? '[data-g="good"]' : '[data-act="flip"]');
    if (s.flipped && '123'.includes(k)) return hit(`[data-g="${['again', 'good', 'easy'][+k - 1]}"]`);
  } else if (mode === 'choice') {
    if (typing) return;
    if ('1234'.includes(k)) return hit(`[data-i="${+k - 1}"]`);
    if (k === 'Enter' || k === ' ') return hit('[data-act="next"]');
  } else if ((mode === 'type' || mode === 'cloze') && k === 'Enter' && s.verdict) {
    return hit('[data-act="next"]');
  } else if (mode === 'order') {
    if (typing) return;
    // 1–8 places the nth step still waiting; enter checks, then moves on.
    if (/^[1-8]$/.test(k)) {
      const left = [...document.querySelectorAll('[data-act="ostep"]:not([disabled])')];
      if (left[+k - 1]) { e.preventDefault(); left[+k - 1].click(); }
      return;
    }
    if (k === 'Enter' || k === ' ') return hit(s.verdict ? '[data-act="next"]' : '[data-act="ocheck"]');
  } else if (s.key === 'study') {
    if (typing) return;
    if (s.phase === 'show') return (k === ' ' || k === 'Enter') ? hit('[data-act="studynext"]') : undefined;
    if (k === ' ' || k === 'Enter') return hit(s.flipped ? '[data-g="good"]' : '[data-act="flip"]');
    if (s.flipped && '123'.includes(k)) return hit(`[data-g="${['again', 'good', 'easy'][+k - 1]}"]`);
  } else if (s.key === 'point') {
    if (typing) return;
    if ('1234'.includes(k)) return hit(`[data-act="point"][data-i="${+k - 1}"]`);
    if (k === 'Enter' || k === ' ') return hit('[data-act="next"]');
  } else if (s.key === 'pad') {
    if (typing) return;
    if (/^[0-9]$/.test(k)) return hit(`[data-act="padtap"][data-n="${k}"]`);
    if (k === 'Backspace') { e.preventDefault(); return hit('[data-act="padback"]'); }
    if (k === 'Enter') return hit(s.verdict ? '[data-act="next"]' : '[data-act="padok"]');
  } else if (s.key === 'truefalse') {
    if (typing) return;
    if (s.picked != null) return (k === 'Enter' || k === ' ') ? hit('[data-act="next"]') : undefined;
    if ('ty1'.includes(k.toLowerCase())) return hit('[data-act="tf"][data-v="1"]');
    if ('fn2'.includes(k.toLowerCase())) return hit('[data-act="tf"][data-v="0"]');
  } else if (s.key === 'explain' && s.shown && !typing) {
    if ('123'.includes(k)) return hit(`[data-g="${['again', 'good', 'easy'][+k - 1]}"]`);
  }
});

// ---------------- boot ----------------

let installPrompt = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  render();          // the offer only exists once the browser says it does
});

(async function boot() {
  // A brand-new device asks who it is for before it shows a library.
  if (!state.settings.setup && !(P().stats.reviews || 0) && !location.hash) view = { name: 'setup' };
  render();
  await hydrate();          // pictures and recordings back from IndexedDB before anything reads a card
  await Promise.all([
    loadModules(),
    fetch('config.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(c => { deployClientId = (c?.clientId || '').trim(); })
      .catch(() => {}),   // no config.json is the normal case
  ]);

  // Someone opened a shared module link.
  const shared = location.hash.match(/^#m=(.+)$/);
  if (shared) {
    history.replaceState({}, '', location.pathname);
    try {
      view = { name: 'import', pending: parseImport(JSON.stringify(await unpackModule(shared[1]))) };
    } catch (e) {
      toast('That shared link could not be read.');
    }
  }

  // Android share sheet ("share Claude's answer to Learning Pit") and manifest shortcuts.
  const params = new URLSearchParams(location.search);
  const sharedText = [params.get('title'), params.get('text')].filter(Boolean).join('\n');
  if (sharedText || params.get('go')) {
    history.replaceState({}, '', location.pathname);
    if (sharedText) {
      try { view = { name: 'import', pending: parseImport(sharedText) }; }
      catch (e) { view = { name: 'import' }; toast(e.message); }
    } else if (params.get('go') === 'import') {
      view = { name: 'import' };
    } else if (params.get('go') === 'quick') {
      view = { name: 'quick', added: [] };
    } else if (params.get('go') === 'play') {
      // The tablet home-screen shortcut for the learner who cannot read the menu.
      ACT.kidplay();
    }
  }
  render();
  if (params.get('go') === 'due') ACT.reviewall();

  if (clientId() && localStorage.getItem('pit.wasSignedIn')) {
    auth(false).then(() => sync()).then(render).catch(() => renderBar());
  }

  // A year of reviews living in one browser's localStorage, with no sync and no backup, is
  // one cleared-cache away from gone. Say so once a month, and only once there is something
  // worth losing.
  const owed = (P().stats.reviews || 0) > 150 && !signedIn()
    && (!state.settings.lastBackup
      || Date.now() - Date.parse(state.settings.lastBackup) > 30 * 86400000);
  if (owed && state.settings.nudged !== today()) {
    state.settings.nudged = today();
    save({ sync: false });
    setTimeout(() => toast('This is the only copy of your progress.', 'Back it up', ACT.export), 1200);
  }

  // Ask the browser not to evict a year of review history when storage runs low.
  navigator.storage?.persist?.().catch(() => {});

  // A learner who has connected a cowork folder gets it kept current after every sitting,
  // from a panel nobody sees. Only for them: everyone else never loads the script.
  if (localStorage.getItem(COACH_FLAG) && !opt().kid && !location.search.includes('selftest')) {
    const hidden = document.createElement('div');
    hidden.hidden = true;
    document.body.appendChild(hidden);
    mountCoach(hidden, null);
  }

  // Let the maker's app portal know (same-origin localStorage) that this app is installed.
  try {
    const dm = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];
    if (navigator.standalone || dm.some(m => matchMedia(`(display-mode: ${m})`).matches)) {
      const k = 'portal-installed', reg = JSON.parse(localStorage.getItem(k) || '{}');
      reg['learning-pit'] = Date.now();
      localStorage.setItem(k, JSON.stringify(reg));
    }
  } catch { /* private mode - ignore */ }

  if (location.protocol.startsWith('http')) {
    navigator.serviceWorker?.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready.', 'Reload', () => location.reload());
          }
        });
      });
    }).catch(() => {});
  }
})();
