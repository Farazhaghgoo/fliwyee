// Fliwyee background worker: on/off, sessions, the icon counter, the session file and Ask AI.
// Storage (chrome.storage.local):
//   enabled   boolean                capture on/off (off only pauses: the session keeps going)
//   current   Session | null         the open session (starts with the first capture)
//   sessions  Session[]              ended sessions, newest first
//   lastSaved { count, folder, filename, error, at }   the last ended session
//   settings  { ai, prompts: { word, sentence, session } }
// Session = { id, startedAt, updatedAt, endedAt?, filename?, downloadId?, items: Item[] }
// Item    = { id, at, type: 'word'|'phrase'|'sentence', text, context, videoId, title, time, auto }

importScripts('lib/format.js');

const F = self.FliwyeeFormat;
const DEFAULTS = { enabled: false, current: null, sessions: [], settings: null };
const TYPES = new Set(['word', 'phrase', 'sentence']);
const SITES = new Set(['youtube', 'netflix', 'web']);

// Every state change goes through this queue so two quick actions can't overwrite each other.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}

const getState = () => chrome.storage.local.get(DEFAULTS);
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function cleanItem(raw) {
  const r = raw || {};
  const time = Number(r.time);
  return {
    type: TYPES.has(r.type) ? r.type : 'word',
    text: str(r.text, 500),
    context: str(r.context, 1000),
    site: SITES.has(r.site) ? r.site : 'youtube',
    videoId: str(r.videoId, 1000), // other websites: the page address
    title: str(r.title, 200),
    time: Number.isFinite(time) && time > 0 ? Math.floor(time) : 0,
    auto: !!r.auto,
  };
}

function findSession(st, sessionId) {
  if (st.current && (!sessionId || st.current.id === sessionId)) return { s: st.current, isCurrent: true };
  const s = st.sessions.find((x) => x.id === sessionId);
  return s ? { s, isCurrent: false } : { s: null, isCurrent: false };
}

// ---------- captures ----------

async function capture(raw) {
  const st = await getState();
  if (!st.enabled) return { status: 'off' };
  const item = cleanItem(raw);
  if (!item.text) return { status: 'empty' };

  const now = Date.now();
  const current = st.current || { id: `s${now}`, startedAt: now, updatedAt: now, items: [] };
  const key = F.norm(item.text);
  const dup = current.items.find((i) => F.norm(i.text) === key);
  if (dup) return { status: 'duplicate', id: dup.id, count: current.items.length };
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
  return { status: 'removed', id: gone.id, text: gone.text, count: cur.items.length };
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

// ---------- editing (only when you open the editor) ----------

function findItem(st, itemId) {
  for (const s of [st.current, ...st.sessions]) {
    const it = s && s.items.find((i) => i.id === itemId);
    if (it) return { s, it, isCurrent: s === st.current };
  }
  return null;
}

async function getItem(itemId) {
  const st = await getState();
  const found = findItem(st, itemId);
  return found ? { status: 'ok', sessionId: found.s.id, item: found.it } : { status: 'none' };
}

// Change an item's text, its sentence and your note. A corrected sentence is applied to every
// item from that same sentence in the session, so they stay on one line in the file.
async function editItem(m) {
  const st = await getState();
  const found = findItem(st, m.id);
  if (!found) return { status: 'none' };
  const { s, it, isCurrent } = found;
  const oldSentence = it.type === 'sentence' ? it.text : it.context;
  const text = str(m.text, 500) || it.text;
  const sentence = str(m.sentence, 1000);
  it.note = String(m.note == null ? it.note || '' : m.note).trim().slice(0, 2000);
  it.text = text;
  if (it.type !== 'sentence') it.context = sentence === text ? '' : sentence;
  const newSentence = it.type === 'sentence' ? it.text : it.context;
  if (oldSentence && newSentence && F.norm(oldSentence) !== F.norm(newSentence)) {
    for (const other of s.items) {
      if (other === it) continue;
      if (other.type === 'sentence' && F.norm(other.text) === F.norm(oldSentence)) other.text = newSentence;
      else if (other.type !== 'sentence' && F.norm(other.context) === F.norm(oldSentence)) other.context = newSentence;
    }
  }
  s.updatedAt = Date.now();
  await chrome.storage.local.set(isCurrent ? { current: s } : { sessions: st.sessions });
  return { status: 'saved', item: it };
}

// Side panels that are open right now, by window (each open panel keeps a port to us).
const openPanels = new Map(); // windowId -> port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  let windowId = null;
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'hello') {
      windowId = msg.windowId;
      openPanels.set(windowId, port);
    }
  });
  port.onDisconnect.addListener(() => {
    if (windowId != null && openPanels.get(windowId) === port) openPanels.delete(windowId);
  });
});

// N on YouTube: show the editor for that item in the side panel (opening it if needed), or in a
// small window when Chrome doesn't let us open the side panel from here.
// Called straight from onMessage (no waiting first): opening the side panel needs your key press.
function openEditor(itemId, sender) {
  const windowId = sender && sender.tab ? sender.tab.windowId : null;
  const request = { id: itemId, at: Date.now(), closeAfter: !openPanels.has(windowId) };
  const panel = openPanels.get(windowId);
  if (panel) {
    panel.postMessage({ type: 'edit', request });
    return Promise.resolve({ status: 'panel' });
  }
  let opening;
  try {
    opening = windowId != null && chrome.sidePanel && chrome.sidePanel.open ? chrome.sidePanel.open({ windowId }) : Promise.reject();
  } catch (e) {
    opening = Promise.reject(e);
  }
  return chrome.storage.local
    .set({ editRequest: request })
    .then(() => opening)
    .then(() => ({ status: 'panel' }))
    .catch(async () => {
      await chrome.storage.local.set({ editRequest: null });
      const url = chrome.runtime.getURL(`sidepanel/sidepanel.html?editor=${encodeURIComponent(itemId)}`);
      await chrome.windows.create({ url, type: 'popup', width: 440, height: 470, focused: true });
      return { status: 'window' };
    });
}

// ---------- the session files ----------

async function download(filename, mime, content) {
  const url = `data:${mime};charset=utf-8,` + encodeURIComponent(content);
  return chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'overwrite' });
}

// Writes (or rewrites) both files of a session in Downloads/italian-subtitles/:
//   fliwyee_<start>.html  a small web page: every minute is a working link to that moment
//   fliwyee_<start>.txt   the same as plain text
async function writeFile(session) {
  const filename = F.sessionFilename(session, 'html');
  session.downloadId = await download(filename, 'text/html', F.sessionHtml(session));
  session.txtDownloadId = await download(F.sessionFilename(session, 'txt'), 'text/plain', F.sessionText(session));
  session.filename = filename;
  return filename;
}

async function saveFile(sessionId) {
  const st = await getState();
  const { s, isCurrent } = findSession(st, sessionId);
  if (!s || !s.items.length) return { status: 'empty' };
  await writeFile(s);
  await chrome.storage.local.set(isCurrent ? { current: s } : { sessions: st.sessions });
  return { status: 'saved', filename: s.filename, downloadId: s.downloadId };
}

async function showFile(sessionId) {
  const st = await getState();
  const { s } = findSession(st, sessionId);
  if (s && s.downloadId != null) {
    try {
      const [d] = await chrome.downloads.search({ id: s.downloadId });
      if (d && d.exists !== false && d.state === 'complete') {
        chrome.downloads.show(s.downloadId);
        return { status: 'shown' };
      }
    } catch (_) {
      /* fall back to the folder */
    }
  }
  chrome.downloads.showDefaultFolder();
  return { status: 'folder' };
}

// Ends the open session: writes its file and moves it to the past sessions.
async function endSession() {
  const st = await getState();
  const cur = st.current;
  if (!cur) return { status: 'empty' };
  if (!cur.items.length) {
    await chrome.storage.local.set({ current: null });
    return { status: 'empty' };
  }
  cur.endedAt = Date.now();
  let error = null;
  try {
    await writeFile(cur);
  } catch (e) {
    error = String((e && e.message) || e);
  }
  const lastSaved = { count: cur.items.length, folder: F.FOLDER, filename: cur.filename || null, error, at: cur.endedAt };
  await chrome.storage.local.set({ current: null, sessions: [cur, ...st.sessions], lastSaved });
  return { status: 'saved', saved: lastSaved };
}

async function deleteSession(sessionId) {
  const st = await getState();
  await chrome.storage.local.set({ sessions: st.sessions.filter((x) => x.id !== sessionId) });
  return { status: 'deleted' };
}

// ---------- on / off (pausing never ends the session) ----------

async function setEnabled(on) {
  await chrome.storage.local.set({ enabled: !!on });
  return { status: 'ok', enabled: !!on };
}

async function toggle() {
  const st = await getState();
  return setEnabled(!st.enabled);
}

// Is Fliwyee running in this tab?
async function hasFliwyee(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return !!(r && r.ok);
  } catch (_) {
    return false;
  }
}

// Add Fliwyee to a tab (a website where it doesn't run by itself). Your Ctrl+Shift+X gives it
// permission for this tab ("activeTab"), until the tab goes to another site.
async function addToTab(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/page-hook.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__fliwyeeAnnounce = true;
      },
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/format.js', 'content/sites.js', 'content/content.js'] });
    return true;
  } catch (_) {
    return false; // e.g. chrome:// pages or the Chrome Web Store
  }
}

// Ctrl+Shift+X. In a tab where Fliwyee isn't running (another website, or a YouTube tab whose
// Fliwyee was cut off by an update), the first press adds it to the tab and turns capture on;
// after that it pauses / resumes as usual.
async function toggleFromShortcut(tab) {
  const url = (tab && tab.url) || '';
  if (tab && tab.id != null && /^https?:\/\//.test(url) && !(await hasFliwyee(tab.id))) {
    if (await addToTab(tab.id)) {
      const st = await getState();
      if (!st.enabled) await setEnabled(true);
      return { status: 'added' };
    }
  }
  return toggle();
}

// ---------- Ask AI ----------

// Runs inside the AI chat page: puts the prompt in the message box (you press Enter yourself).
async function insertPrompt(text) {
  const SELECTORS = [
    '#prompt-textarea', // ChatGPT
    'div.ProseMirror[contenteditable="true"]', // Claude, ChatGPT
    'rich-textarea [contenteditable="true"]', // Gemini
    '.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea',
  ];
  const visible = (el) => !!el && (el.offsetWidth > 0 || el.offsetHeight > 0);
  const find = () => {
    for (const sel of SELECTORS) {
      const el = Array.from(document.querySelectorAll(sel)).find(visible);
      if (el) return el;
    }
    return null;
  };
  const squash = (s) => String(s || '').replace(/\s+/g, '');
  const valueOf = (el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText || el.textContent || '');

  const notice = (msg) => {
    const n = document.createElement('div');
    n.textContent = msg;
    n.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;' +
      'border-radius:8px;background:#1b1b1b;color:#fff;font:500 14px/1.3 system-ui,sans-serif;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.3);';
    document.documentElement.appendChild(n);
    setTimeout(() => n.remove(), 3500);
  };

  let box = find();
  for (let i = 0; !box && i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    box = find();
  }
  if (!box) {
    notice('Fliwyee: the prompt is copied. Click the message box and press Ctrl+V.');
    return false;
  }

  box.focus();
  if (box.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const insert = (valueOf(box).trim() ? '\n\n' : '') + text;
  const marker = squash(text).slice(0, 24);
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, insert) && squash(valueOf(box)).includes(marker);
  } catch (_) {
    ok = false;
  }
  if (!ok) {
    const dt = new DataTransfer();
    dt.setData('text/plain', insert);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    ok = squash(valueOf(box)).includes(marker);
  }
  notice(ok ? 'Fliwyee: prompt added. Check it and press Enter.' : 'Fliwyee: the prompt is copied. Press Ctrl+V.');
  return ok;
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// Go to the AI chat you used last (or open a new one) and put the prompt in its message box.
// The caller has already copied the prompt, so Ctrl+V always works as a backup.
async function askAI(text) {
  const prompt = String(text || '').slice(0, 20000);
  if (!prompt.trim()) return { status: 'empty' };
  const st = await getState();
  const settings = F.mergedSettings(st.settings);

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: F.AI_SITES.map((a) => a.match) });
  } catch (_) {
    tabs = [];
  }
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  let tab = tabs[0];
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    const site = F.AI_SITES.find((a) => a.id === settings.ai) || F.AI_SITES[0];
    tab = await chrome.tabs.create({ url: site.newUrl, active: true });
    await waitForTabLoad(tab.id, 15000);
  }

  const site = F.aiSiteForUrl(tab.url || tab.pendingUrl) || F.AI_SITES.find((a) => a.id === settings.ai);
  let inserted = false;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: insertPrompt, args: [prompt] });
    inserted = !!(res && res.result);
  } catch (_) {
    inserted = false;
  }
  return { status: 'ok', inserted, site: site ? site.name : 'your AI chat' };
}

// ---------- icon badge ----------

async function refreshBadge() {
  const st = await getState();
  const n = st.current ? st.current.items.length : 0;
  // green number while capturing, grey number while paused with a session open
  const text = st.enabled ? (n ? String(n) : 'ON') : n ? String(n) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: st.enabled ? '#008C45' : '#6B7075' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await chrome.action.setTitle({
    title: st.enabled
      ? `Fliwyee: capturing${n ? ` · ${F.plural(n)}` : ''}`
      : n
        ? `Fliwyee: paused · session open (${F.plural(n)})`
        : 'Fliwyee: off',
  });
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
  showFile: (m) => showFile(m.sessionId),
  deleteSession: (m) => deleteSession(m.sessionId),
  editItem: (m) => editItem(m),
  getItem: (m) => getItem(m.id),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'openEditor') {
    // not queued: the side panel must be opened while your key press still counts
    openEditor(msg.id, sender).then(sendResponse, () => sendResponse({ status: 'error' }));
    return true;
  }
  if (msg && msg.type === 'askAI') {
    // not queued: it only reads state, and it waits for other tabs
    askAI(msg.text).then(sendResponse, (err) => sendResponse({ status: 'error', message: String((err && err.message) || err) }));
    return true;
  }
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  serial(() => handler(msg)).then(sendResponse, (err) =>
    sendResponse({ status: 'error', message: String((err && err.message) || err) })
  );
  return true; // answer asynchronously
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-capture') serial(() => toggleFromShortcut(tab));
  else if (command === 'end-session') serial(endSession);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.current)) refreshBadge();
});

// Runs inside an open YouTube tab after Fliwyee is installed or updated. That tab still has the
// old Fliwyee (or none), so ask for a reload.
function showUpdateNotice(reason) {
  if (document.getElementById('fliwyee-update')) return;
  const bar = document.createElement('div');
  bar.id = 'fliwyee-update';
  bar.style.cssText =
    'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;' +
    'align-items:center;gap:14px;padding:10px 12px 10px 16px;border-radius:10px;background:#1b1b1b;' +
    'color:#fff;font:500 14px/1.3 Roboto,Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.35);';
  const msg = document.createElement('span');
  msg.textContent =
    reason === 'install'
      ? 'Fliwyee is installed. Reload this tab to start using it.'
      : 'Fliwyee was updated. Reload this tab to use the new version.';
  const btn = (label, css, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'border:0;border-radius:6px;cursor:pointer;font:600 14px Roboto,Arial,sans-serif;' + css;
    b.addEventListener('click', onClick);
    return b;
  };
  bar.append(
    msg,
    btn('Reload', 'padding:6px 12px;background:#2ecc71;color:#0d1a12;', () => location.reload()),
    btn('✕', 'padding:4px 8px;background:transparent;color:#bbb;', () => bar.remove())
  );
  document.documentElement.appendChild(bar);
}

// Capture is off when Chrome starts. An open session stays open until you end it.
chrome.runtime.onStartup.addListener(() => serial(() => setEnabled(false)));

chrome.runtime.onInstalled.addListener(async (details) => {
  refreshBadge();
  if (details.reason !== 'install' && details.reason !== 'update') return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://www.netflix.com/*'] });
  } catch (_) {
    tabs = [];
  }
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, func: showUpdateNotice, args: [details.reason] })
      .catch(() => {}); // e.g. a tab that is still loading
  }
});

// Clicking the toolbar icon opens the side panel.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
refreshBadge();
