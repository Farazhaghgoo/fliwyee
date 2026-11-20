// Fliwyee background worker: on/off, notebooks (one per video), tags, undo, the icon counter,
// the notebook files and Ask AI.
// Storage (chrome.storage.local):
//   enabled      boolean                capture on/off
//   nb:<id>      Notebook               one per video (see lib/format.js), id = "<site>:<videoId>"
//   undoStack    Undo[]                 the last changes Ctrl+Z / Undo can take back
//   today        { day, count }         captures today (the number on the icon)
//   lastSaved    { files, at, auto, upToDate, error }   the last time files were written
//   settings     { ai, prompts: { word, sentence, notebook } }
//   backupV04    { current, sessions }  Fliwyee 0.4 sessions, kept as they were after moving them
// Every change is saved right away. The notebook files (Downloads/italian-subtitles/*.html) are
// written when you press Ctrl+Shift+E or Save, when you leave a video, when you close the side
// panel, and when Chrome starts (for anything that wasn't written yet).

importScripts('lib/format.js');

const F = self.FliwyeeFormat;
const KINDS = new Set(['word', 'phrase', 'sentence']);
const SITES = new Set(['youtube', 'netflix', 'web']);
const UNDO_MAX = 40;

// Every state change goes through this queue so two quick actions can't overwrite each other.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

async function getNotebook(id) {
  const key = F.storageKey(id);
  const got = await chrome.storage.local.get(key);
  return got[key] ? F.normalizeNotebook(got[key]) : null;
}

const putNotebook = (nb) => chrome.storage.local.set({ [F.storageKey(nb.id)]: nb });

async function allNotebooks() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(F.NB_PREFIX))
    .map((k) => F.normalizeNotebook(all[k]))
    .filter(Boolean);
}

function changed(nb) {
  nb.updated = Date.now();
  nb.dirty = true;
  const day = F.dayKey(nb.updated);
  if (!nb.days.includes(day)) nb.days.push(day);
}

// ---------- the icon counter: captures today ----------

async function bumpToday(delta, at) {
  const day = F.dayKey(Date.now());
  if (at && F.dayKey(at) !== day) return; // undoing something from another day
  const { today } = await chrome.storage.local.get({ today: null });
  const count = today && today.day === day ? today.count : 0;
  await chrome.storage.local.set({ today: { day, count: Math.max(0, count + delta) } });
}

async function pushUndo(entry) {
  const { undoStack } = await chrome.storage.local.get({ undoStack: [] });
  undoStack.push(entry);
  await chrome.storage.local.set({ undoStack: undoStack.slice(-UNDO_MAX) });
}

// ---------- captures ----------

function cleanCapture(raw) {
  const r = raw || {};
  const time = Number(r.time);
  return {
    kind: KINDS.has(r.kind) ? r.kind : 'word',
    text: str(r.text, 500),
    sentence: str(r.sentence, 1000),
    site: SITES.has(r.site) ? r.site : 'youtube',
    videoId: str(r.videoId, 2000), // other websites: the page address
    title: str(r.title, 300),
    time: Number.isFinite(time) && time > 0 ? Math.floor(time) : 0,
    auto: !!r.auto,
  };
}

// A click (word), a drag (phrase) or S (sentence). One line per sentence: a word from a
// sentence you already saved is added to that line, and gets the Word tag.
async function capture(raw, sender) {
  const { enabled } = await chrome.storage.local.get({ enabled: false });
  if (!enabled) return { status: 'off' };
  const it = cleanCapture(raw);
  if (!it.text) return { status: 'empty' };

  const id = F.notebookId(it.site, it.videoId);
  const now = Date.now();
  const nb = (await getNotebook(id)) || F.newNotebook({ site: it.site, videoId: it.videoId, title: it.title, created: now });
  if (!nb.title && it.title) nb.title = it.title;
  if (it.auto) nb.auto = true;

  const isWord = it.kind !== 'sentence';
  const sentence = isWord ? it.sentence : it.text;
  let line = sentence
    ? F.findLine(nb, sentence, it.time)
    : nb.lines.find((l) => !l.sentence && l.words.some((w) => F.norm(w.text) === F.norm(it.text)));
  const undo = { id: F.uid('u'), notebookId: id, at: now, text: it.text };

  if (!line) {
    line = { id: F.uid('l'), at: now, time: it.time, sentence, words: [], tags: [], note: '' };
    if (isWord) {
      line.words.push({ text: it.text, note: '' });
      line.tags.push('word');
    } else line.tags.push('sentence');
    nb.lines.push(line);
    Object.assign(undo, { op: 'newLine', lineId: line.id });
  } else {
    // auto subtitles: the text on screen may now hold more of the sentence
    const longer = F.norm(sentence);
    if (longer.length > F.norm(line.sentence).length && longer.includes(F.norm(line.sentence))) line.sentence = sentence;
    let word = null;
    const tags = [];
    if (isWord) {
      if (!line.words.some((w) => F.norm(w.text) === F.norm(it.text))) {
        line.words.push({ text: it.text, note: '' });
        word = it.text;
      }
      if (!line.tags.includes('word')) tags.push('word');
    } else if (!line.tags.includes('sentence')) tags.push('sentence');
    if (!word && !tags.length) {
      return { status: 'duplicate', notebookId: id, lineId: line.id, count: nb.lines.length, tags: line.tags };
    }
    line.tags = F.TAG_IDS.filter((t) => line.tags.includes(t) || tags.includes(t));
    line.time = Math.min(line.time, it.time);
    Object.assign(undo, { op: 'change', lineId: line.id, word, tags });
  }

  changed(nb);
  nb.lastLineId = line.id;
  nb.lastCaptureAt = now;
  await putNotebook(nb);
  await pushUndo(undo);
  await bumpToday(1);
  if (sender && sender.tab && sender.tab.id != null) rememberTab(sender.tab.id, id);
  return {
    status: 'added',
    joined: undo.op === 'change',
    notebookId: id,
    lineId: line.id,
    undoId: undo.id,
    count: nb.lines.length,
    tags: line.tags,
  };
}

// Undo: one change by its id, or the newest one.
async function undo(undoId) {
  const { undoStack } = await chrome.storage.local.get({ undoStack: [] });
  const idx = undoId ? undoStack.findIndex((u) => u.id === undoId) : undoStack.length - 1;
  if (idx < 0) return { status: 'none' };
  const [u] = undoStack.splice(idx, 1);
  await chrome.storage.local.set({ undoStack });
  const nb = await getNotebook(u.notebookId);
  if (!nb) return { status: 'none' };

  if (u.op === 'newLine') nb.lines = nb.lines.filter((l) => l.id !== u.lineId);
  else if (u.op === 'change') {
    const line = nb.lines.find((l) => l.id === u.lineId);
    if (line) {
      if (u.word) line.words = line.words.filter((w) => F.norm(w.text) !== F.norm(u.word));
      line.tags = line.tags.filter((t) => !u.tags.includes(t));
    }
  } else if (u.op === 'removeLine') {
    if (!nb.lines.some((l) => l.id === u.line.id)) nb.lines.splice(Math.min(u.index, nb.lines.length), 0, F.normalizeLine(u.line));
  }

  // A notebook that this capture started, and that was never written to a file, goes away.
  if (!nb.lines.length && !nb.savedAt) await chrome.storage.local.remove(F.storageKey(nb.id));
  else {
    changed(nb);
    await putNotebook(nb);
  }
  if (u.op !== 'removeLine') await bumpToday(-1, u.at);
  return { status: u.op === 'removeLine' ? 'restored' : 'removed', undoId: u.id, text: u.text, notebookId: u.notebookId, lineId: u.lineId };
}

// ---------- tags and editing (only when you ask for it) ----------

async function toggleTag(m) {
  const nb = await getNotebook(m.notebookId);
  const line = nb && nb.lines.find((l) => l.id === m.lineId);
  if (!line || !F.TAG_IDS.includes(m.tag)) return { status: 'none' };
  const on = m.on == null ? !line.tags.includes(m.tag) : !!m.on;
  line.tags = F.TAG_IDS.filter((t) => (t === m.tag ? on : line.tags.includes(t)));
  changed(nb);
  await putNotebook(nb);
  return { status: 'ok', on, tags: line.tags };
}

// Change a line: its sentence, its words (and their notes), its tags and your note.
async function editLine(m) {
  const nb = await getNotebook(m.notebookId);
  const line = nb && nb.lines.find((l) => l.id === m.lineId);
  if (!line) return { status: 'none' };
  const fixed = F.normalizeLine({ ...line, sentence: m.sentence, words: m.words, tags: m.tags, note: m.note });
  if (!fixed.sentence && !fixed.words.length) return { status: 'empty' };
  Object.assign(line, { sentence: fixed.sentence, words: fixed.words, tags: fixed.tags, note: fixed.note });
  changed(nb);
  await putNotebook(nb);
  return { status: 'saved', line };
}

async function removeLine(m) {
  const nb = await getNotebook(m.notebookId);
  const index = nb ? nb.lines.findIndex((l) => l.id === m.lineId) : -1;
  if (index < 0) return { status: 'none' };
  const [line] = nb.lines.splice(index, 1);
  changed(nb);
  await putNotebook(nb);
  const entry = { id: F.uid('u'), op: 'removeLine', notebookId: nb.id, lineId: line.id, line, index, at: Date.now(), text: line.sentence || line.words.map((w) => w.text).join(', ') };
  await pushUndo(entry);
  return { status: 'removed', undoId: entry.id };
}

async function deleteNotebook(id) {
  await chrome.storage.local.remove(F.storageKey(id));
  return { status: 'deleted' };
}

// Load a notebook file (from the side panel): joined with what Fliwyee already has for that
// video, so nothing is lost on either side.
async function importNotebooks(m) {
  const results = [];
  for (const raw of Array.isArray(m.notebooks) ? m.notebooks : []) {
    const incoming = F.normalizeNotebook(raw);
    if (!incoming || !incoming.lines.length) continue;
    const have = await getNotebook(incoming.id);
    let nb;
    let added = incoming.lines.length;
    let merged = 0;
    if (have) {
      nb = have;
      ({ added, merged } = F.mergeNotebook(nb, incoming));
    } else {
      nb = incoming;
      // keep saving under the name of the file you loaded (in Downloads/italian-subtitles),
      // unless another notebook already writes to that name
      const taken = new Set((await allNotebooks()).map((x) => (x.filename || '').toLowerCase()));
      const fromFile = m.filename ? `${F.FOLDER}/${String(m.filename)}` : '';
      const name = [fromFile, nb.filename].find((f) => f && F.validFilename(f) && !taken.has(f.toLowerCase()));
      nb.filename = name || null;
      nb.downloadId = undefined;
      nb.savedAt = undefined;
    }
    if (added || merged || !have) {
      nb.updated = Date.now();
      nb.dirty = true;
      await putNotebook(nb);
    }
    results.push({ id: nb.id, title: F.nbTitle(nb), added, merged, count: nb.lines.length });
  }
  return results.length ? { status: 'ok', results } : { status: 'empty' };
}

// ---------- the notebook files ----------

// data: URL of the file (base64 keeps big notebooks small enough for Chrome)
function dataUrl(mime, text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${mime};charset=utf-8;base64,${btoa(bin)}`;
}

// A file name no other notebook uses (two videos with the same name on the same day).
async function uniqueFilename(nb) {
  const taken = new Set((await allNotebooks()).filter((x) => x.id !== nb.id && x.filename).map((x) => x.filename.toLowerCase()));
  const base = F.notebookFilename(nb).replace(/\.html$/, '');
  let name = `${base}.html`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).html`;
  return name;
}

// Writes (or rewrites) a notebook's file in Downloads/italian-subtitles/.
async function writeNotebook(nb) {
  if (!nb.filename) nb.filename = await uniqueFilename(nb);
  nb.downloadId = await chrome.downloads.download({
    url: dataUrl('text/html', F.notebookHtml(nb)),
    filename: nb.filename,
    saveAs: false,
    conflictAction: 'overwrite',
  });
  nb.savedAt = Date.now();
  nb.dirty = false;
  await putNotebook(nb);
  return nb.filename;
}

// Saving by itself (leaving a video, closing the panel, Chrome starting): Chrome's download
// message is hidden for that moment, when Chrome allows it.
async function quietly(fn) {
  let hidden = false;
  try {
    if (chrome.downloads.setUiOptions) {
      await chrome.downloads.setUiOptions({ enabled: false });
      hidden = true;
    }
  } catch (_) {
    hidden = false;
  }
  try {
    return await fn();
  } finally {
    if (hidden) setTimeout(() => chrome.downloads.setUiOptions({ enabled: true }).catch(() => {}), 2500);
  }
}

// Write every notebook that has changes not yet in its file.
async function saveChanged({ auto, ids } = {}) {
  const list = (await allNotebooks()).filter((nb) => nb.dirty && nb.lines.length && (!ids || ids.includes(nb.id)));
  if (!list.length) {
    if (!auto) await chrome.storage.local.set({ lastSaved: { files: [], at: Date.now(), upToDate: true } });
    return { status: 'upToDate', files: [] };
  }
  const files = [];
  let error = null;
  const run = async () => {
    for (const nb of list) {
      try {
        files.push(await writeNotebook(nb));
      } catch (e) {
        error = String((e && e.message) || e);
      }
    }
  };
  if (auto) await quietly(run);
  else await run();
  await chrome.storage.local.set({ lastSaved: { files, at: Date.now(), auto: !!auto, error } });
  return { status: error && !files.length ? 'error' : 'saved', files, error };
}

// Save button / Open file in the side panel: always write this notebook now.
async function saveNotebook(id) {
  const nb = await getNotebook(id);
  if (!nb || !nb.lines.length) return { status: 'empty' };
  try {
    await writeNotebook(nb);
  } catch (e) {
    return { status: 'error', message: String((e && e.message) || e) };
  }
  return { status: 'saved', filename: nb.filename, downloadId: nb.downloadId };
}

async function showFile(id) {
  const nb = id ? await getNotebook(id) : null;
  if (nb && nb.downloadId != null) {
    try {
      const [d] = await chrome.downloads.search({ id: nb.downloadId });
      if (d && d.exists !== false && d.state === 'complete') {
        chrome.downloads.show(nb.downloadId);
        return { status: 'shown' };
      }
    } catch (_) {
      /* fall back to the folder */
    }
  }
  chrome.downloads.showDefaultFolder();
  return { status: 'folder' };
}

// Tabs where you captured something, so closing the tab saves that notebook's file.
async function rememberTab(tabId, id) {
  try {
    const { tabNotebooks = {} } = await chrome.storage.session.get('tabNotebooks');
    tabNotebooks[tabId] = Array.from(new Set([...(tabNotebooks[tabId] || []), id]));
    await chrome.storage.session.set({ tabNotebooks });
  } catch (_) {
    /* only a convenience: the notebook itself is already saved */
  }
}

async function tabClosed(tabId) {
  let ids = [];
  try {
    const { tabNotebooks = {} } = await chrome.storage.session.get('tabNotebooks');
    ids = tabNotebooks[tabId] || [];
    delete tabNotebooks[tabId];
    await chrome.storage.session.set({ tabNotebooks });
  } catch (_) {
    ids = [];
  }
  if (ids.length) await saveChanged({ auto: true, ids });
}

// ---------- Fliwyee 0.4 sessions -> notebooks ----------

// Runs once after the update. The old sessions are kept as they were in "backupV04".
async function migrate() {
  const st = await chrome.storage.local.get({ current: null, sessions: null });
  const sessions = [st.current, ...(st.sessions || [])].filter((s) => s && Array.isArray(s.items));
  if (st.current === null && st.sessions === null) return;
  const byId = new Map();
  const items = sessions.flatMap((s) => s.items).sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const it of items) {
    const site = SITES.has(it.site) ? it.site : 'youtube';
    const id = F.notebookId(site, it.videoId || '');
    let nb = byId.get(id) || (await getNotebook(id));
    if (!nb) nb = F.newNotebook({ site, videoId: it.videoId || '', title: it.title || '', created: it.at || Date.now() });
    byId.set(id, nb);
    if (!nb.title && it.title) nb.title = it.title;
    if (it.auto) nb.auto = true;
    if (it.at) {
      const day = F.dayKey(it.at);
      if (!nb.days.includes(day)) nb.days.push(day);
      nb.created = Math.min(nb.created, it.at);
    }
    const isWord = it.type !== 'sentence';
    const sentence = isWord ? it.context || '' : it.text;
    const words = isWord ? [{ text: it.text, note: it.note || '' }] : [];
    F.mergeNotebook(nb, {
      lines: [F.normalizeLine({ at: it.at, time: it.time, sentence, words, tags: [isWord ? 'word' : 'sentence'], note: isWord ? '' : it.note || '' })],
      days: nb.days,
      title: nb.title,
      auto: nb.auto,
      created: nb.created,
    });
  }
  const write = { backupV04: { current: st.current, sessions: st.sessions, at: Date.now() } };
  for (const nb of byId.values()) {
    nb.days.sort();
    nb.dirty = true;
    write[F.storageKey(nb.id)] = nb;
  }
  await chrome.storage.local.set(write);
  await chrome.storage.local.remove(['current', 'sessions', 'lastSaved']);
}

// ---------- on / off ----------

async function setEnabled(on) {
  await chrome.storage.local.set({ enabled: !!on });
  return { status: 'ok', enabled: !!on };
}

async function toggle() {
  const { enabled } = await chrome.storage.local.get({ enabled: false });
  return setEnabled(!enabled);
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
      const { enabled } = await chrome.storage.local.get({ enabled: false });
      if (!enabled) await setEnabled(true);
      return { status: 'added' };
    }
  }
  return toggle();
}

// ---------- the side panel ----------

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
    // closing the panel writes the files of notebooks you changed
    serial(() => saveChanged({ auto: true }));
  });
});

// N on the video: open your notes (this video's notebook) in the side panel, with the editor
// for the last capture. If Chrome doesn't let Fliwyee open the side panel from here, they open
// in a small window instead.
// Called straight from onMessage (no waiting first): opening the side panel needs your key press.
function openNotes(m, sender) {
  const windowId = sender && sender.tab ? sender.tab.windowId : null;
  const request = { notebookId: m.notebookId || null, lineId: m.lineId || null, word: m.word || null, at: Date.now() };
  const panel = openPanels.get(windowId);
  if (panel) {
    panel.postMessage({ type: 'open', request });
    return Promise.resolve({ status: 'panel' });
  }
  let opening;
  try {
    opening = windowId != null && chrome.sidePanel && chrome.sidePanel.open ? chrome.sidePanel.open({ windowId }) : Promise.reject();
  } catch (e) {
    opening = Promise.reject(e);
  }
  return chrome.storage.local
    .set({ panelRequest: request })
    .then(() => opening)
    .then(() => ({ status: 'panel' }))
    .catch(async () => {
      await chrome.storage.local.set({ panelRequest: null });
      const q = new URLSearchParams({ nb: request.notebookId || '' });
      if (request.lineId) q.set('editor', request.lineId);
      if (request.word) q.set('word', request.word);
      const url = chrome.runtime.getURL(`sidepanel/sidepanel.html?${q}`);
      const size = request.lineId ? { width: 460, height: 620 } : { width: 460, height: 760 };
      await chrome.windows.create({ url, type: 'popup', focused: true, ...size });
      return { status: 'window' };
    });
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
  const { settings: saved } = await chrome.storage.local.get({ settings: null });
  const settings = F.mergedSettings(saved);

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
  const { enabled, today } = await chrome.storage.local.get({ enabled: false, today: null });
  const n = today && today.day === F.dayKey(Date.now()) ? today.count : 0;
  // green while capturing, grey while paused: the number is what you captured today
  const text = enabled ? (n ? String(n) : 'ON') : n ? String(n) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#008C45' : '#6B7075' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await chrome.action.setTitle({
    title: `Fliwyee: ${enabled ? 'capturing' : 'paused'}${n ? ` · ${n} today` : ''}`,
  });
}

// ---------- wiring ----------

const HANDLERS = {
  capture: (m, sender) => capture(m.item, sender),
  undo: (m) => undo(m.id),
  toggleTag: (m) => toggleTag(m),
  editLine: (m) => editLine(m),
  removeLine: (m) => removeLine(m),
  deleteNotebook: (m) => deleteNotebook(m.id),
  importNotebooks: (m) => importNotebooks(m),
  toggle: () => toggle(),
  setEnabled: (m) => setEnabled(!!m.on),
  saveChanged: () => saveChanged({}),
  saveNotebook: (m) => saveNotebook(m.id),
  showFile: (m) => showFile(m.id),
  // you left a video (another video, reload, tab closed): write its file if it changed
  leftVideo: (m) => saveChanged({ auto: true, ids: [m.notebookId] }),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'openNotes') {
    // not queued: the side panel must be opened while your key press still counts
    openNotes(msg, sender).then(sendResponse, () => sendResponse({ status: 'error' }));
    return true;
  }
  if (msg && msg.type === 'askAI') {
    // not queued: it only reads state, and it waits for other tabs
    askAI(msg.text).then(sendResponse, (err) => sendResponse({ status: 'error', message: String((err && err.message) || err) }));
    return true;
  }
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  serial(() => handler(msg, sender)).then(sendResponse, (err) =>
    sendResponse({ status: 'error', message: String((err && err.message) || err) })
  );
  return true; // answer asynchronously
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-capture') serial(() => toggleFromShortcut(tab));
  else if (command === 'end-session') serial(() => saveChanged({})); // Ctrl+Shift+E: save the files now
});

chrome.tabs.onRemoved.addListener((tabId) => serial(() => tabClosed(tabId)));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.today)) refreshBadge();
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

// Chrome starts: capture is off, Chrome's download message is back on (in case Chrome was
// closed while it was hidden), and notebooks changed last time get their files written.
chrome.runtime.onStartup.addListener(() => {
  if (chrome.downloads.setUiOptions) chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
  serial(() => setEnabled(false));
  serial(() => saveChanged({ auto: true }));
});

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
serial(migrate); // first, before anything else in the queue
refreshBadge();
