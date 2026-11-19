// Fliwyee background worker: on/off state, sessions, the icon counter and the session file.
// Storage (chrome.storage.local):
//   enabled   boolean                capture on/off
//   current   Session | null         the open session (starts with the first capture)
//   sessions  Session[]              ended sessions, newest first
//   lastSaved { count, folder, filename, at } | undefined
// Session = { id, startedAt, updatedAt, endedAt?, filename?, items: Item[] }
// Item    = { id, at, type: 'word'|'phrase'|'sentence', text, context, videoId, title, time, auto }

importScripts('lib/format.js');

const { FOLDER, sessionLine, sessionFilename } = self.FliwyeeFormat;
const DEFAULTS = { enabled: false, current: null, sessions: [] };
const TYPES = new Set(['word', 'phrase', 'sentence']);

// Every state change goes through this queue so two quick captures can't overwrite each other.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}

const getState = () => chrome.storage.local.get(DEFAULTS);
const norm = (s) => String(s || '').toLocaleLowerCase('it').replace(/\s+/g, ' ').trim();
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function cleanItem(raw) {
  const r = raw || {};
  const time = Number(r.time);
  return {
    type: TYPES.has(r.type) ? r.type : 'word',
    text: str(r.text, 500),
    context: str(r.context, 1000),
    videoId: str(r.videoId, 32),
    title: str(r.title, 200),
    time: Number.isFinite(time) && time > 0 ? Math.floor(time) : 0,
    auto: !!r.auto,
  };
}

// ---------- captures ----------

async function capture(raw) {
  const st = await getState();
  if (!st.enabled) return { status: 'off' };
  const item = cleanItem(raw);
  if (!item.text) return { status: 'empty' };

  const now = Date.now();
  const current = st.current || { id: `s${now}`, startedAt: now, updatedAt: now, items: [] };
  const key = norm(item.text);
  if (current.items.some((i) => norm(i.text) === key)) {
    return { status: 'duplicate', count: current.items.length };
  }
  const saved = { id: `i${now}${Math.random().toString(36).slice(2, 7)}`, at: now, ...item };
  current.items.push(saved);
  current.updatedAt = now;
  await chrome.storage.local.set({ current });
  return { status: 'added', id: saved.id, count: current.items.length };
}

// Undo: remove one item by id, or the newest item of the open session.
async function undo(id) {
  const st = await getState();
  const cur = st.current;
  if (!cur || !cur.items.length) return { status: 'none' };
  const idx = id ? cur.items.findIndex((i) => i.id === id) : cur.items.length - 1;
  if (idx < 0) return { status: 'none' };
  const [gone] = cur.items.splice(idx, 1);
  await chrome.storage.local.set({ current: cur });
  return { status: 'removed', text: gone.text, count: cur.items.length };
}

async function removeItem(sessionId, id) {
  const st = await getState();
  if (st.current && st.current.id === sessionId) return undo(id);
  const s = st.sessions.find((x) => x.id === sessionId);
  if (!s) return { status: 'none' };
  s.items = s.items.filter((i) => i.id !== id);
  await chrome.storage.local.set({ sessions: st.sessions });
  return { status: 'removed' };
}

// ---------- sessions & files ----------

async function writeFile(session) {
  const filename = sessionFilename(session);
  const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(sessionLine(session) + '\n');
  await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'overwrite' });
  return filename;
}

// Ends the open session: writes its file and moves it to the past sessions.
// Fills `patch` with the storage changes; the caller saves them in one go.
async function endCurrent(st, patch) {
  const cur = st.current;
  patch.current = null;
  if (!cur || !cur.items.length) return null;
  cur.endedAt = Date.now();
  let error = null;
  try {
    cur.filename = await writeFile(cur);
  } catch (e) {
    error = String((e && e.message) || e);
  }
  patch.sessions = [cur, ...st.sessions];
  patch.lastSaved = { count: cur.items.length, folder: FOLDER, filename: cur.filename || null, error, at: cur.endedAt };
  return patch.lastSaved;
}

async function setEnabled(on) {
  const st = await getState();
  if (on) {
    if (!st.enabled) await chrome.storage.local.set({ enabled: true });
    return { status: 'ok', enabled: true };
  }
  const patch = { enabled: false };
  const saved = await endCurrent(st, patch);
  await chrome.storage.local.set(patch);
  return { status: 'ok', enabled: false, saved };
}

async function toggle() {
  const st = await getState();
  return setEnabled(!st.enabled);
}

async function endSession() {
  const st = await getState();
  const patch = {};
  const saved = await endCurrent(st, patch);
  await chrome.storage.local.set(patch);
  return { status: saved ? 'saved' : 'empty', saved };
}

async function saveFile(sessionId) {
  const st = await getState();
  const isCurrent = st.current && (!sessionId || st.current.id === sessionId);
  const s = isCurrent ? st.current : st.sessions.find((x) => x.id === sessionId);
  if (!s || !s.items.length) return { status: 'empty' };
  s.filename = await writeFile(s);
  await chrome.storage.local.set(isCurrent ? { current: s } : { sessions: st.sessions });
  return { status: 'saved', filename: s.filename };
}

async function deleteSession(sessionId) {
  const st = await getState();
  const sessions = st.sessions.filter((x) => x.id !== sessionId);
  await chrome.storage.local.set({ sessions });
  return { status: 'deleted' };
}

// ---------- icon badge ----------

async function refreshBadge() {
  const st = await getState();
  const n = st.current ? st.current.items.length : 0;
  await chrome.action.setBadgeText({ text: st.enabled ? (n ? String(n) : 'ON') : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#008C45' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
}

// ---------- wiring ----------

const HANDLERS = {
  capture: (m) => capture(m.item),
  undo: (m) => undo(m.id),
  remove: (m) => removeItem(m.sessionId, m.id),
  toggle: () => toggle(),
  setEnabled: (m) => setEnabled(!!m.on),
  endSession: () => endSession(),
  saveFile: (m) => saveFile(m.sessionId),
  deleteSession: (m) => deleteSession(m.sessionId),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  serial(() => handler(msg)).then(sendResponse, (err) =>
    sendResponse({ status: 'error', message: String((err && err.message) || err) })
  );
  return true; // answer asynchronously
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-capture') serial(toggle);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.current)) refreshBadge();
});

// Capture is always off when the browser starts. A session left open (browser closed while on)
// is ended and its file written, so nothing is lost.
chrome.runtime.onStartup.addListener(() => {
  serial(async () => {
    const st = await getState();
    if (!st.enabled && !st.current) return;
    const patch = { enabled: false };
    await endCurrent(st, patch);
    await chrome.storage.local.set(patch);
  });
});

chrome.runtime.onInstalled.addListener(() => refreshBadge());

// Clicking the toolbar icon opens the side panel.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
refreshBadge();
