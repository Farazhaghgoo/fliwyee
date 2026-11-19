// Fliwyee side panel: on/off, the current session, past sessions.
(() => {
  'use strict';

  const { sessionLine, fmtTime, watchUrl } = self.FliwyeeFormat;
  const $ = (id) => document.getElementById(id);
  let state = { enabled: false, current: null, sessions: [] };
  let statusTimer = 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function status(message) {
    const s = $('status');
    s.textContent = message;
    s.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => s.classList.remove('show'), 2200);
  }

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return { status: 'error', message: String((e && e.message) || e) };
    }
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      status(label || 'Copied');
    } catch (_) {
      status('Could not copy');
    }
  }

  const dateLabel = (ms) =>
    new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // Jump to the moment in the video: reuse an open tab with that video, otherwise open it.
  async function openAt(item) {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
      const tab = tabs.find((t) => {
        try {
          return new URL(t.url).searchParams.get('v') === item.videoId;
        } catch (_) {
          return false;
        }
      });
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        try {
          const r = await chrome.tabs.sendMessage(tab.id, { type: 'seek', videoId: item.videoId, time: item.time });
          if (r && r.ok) return;
        } catch (_) {
          /* tab not ready: reload it at the right time */
        }
        await chrome.tabs.update(tab.id, { url: watchUrl(item) });
      } else {
        await chrome.tabs.create({ url: watchUrl(item) });
      }
    } catch (_) {
      chrome.tabs.create({ url: watchUrl(item) });
    }
  }

  function itemRow(session, it) {
    const li = el('li', `item item-${it.type}`);
    const text = el('button', 'text', it.text);
    text.type = 'button';
    text.title = 'Click to copy';
    text.addEventListener('click', () => copy(it.text, `Copied: ${it.text}`));
    li.append(text);

    if (it.context) li.append(el('div', 'ctx', it.context));

    const meta = el('div', 'meta');
    if (it.type !== 'word') meta.append(el('span', 'tag', it.type));
    if (it.videoId) {
      const a = el('a', 'time', `▶ ${fmtTime(it.time)}`);
      a.href = watchUrl(it);
      a.title = 'Play from here';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openAt(it);
      });
      meta.append(a);
    }
    if (it.title) {
      const t = el('span', 'title', it.title);
      t.title = it.title;
      meta.append(t);
    }
    if (it.auto) {
      const tag = el('span', 'tag warn', 'auto subs');
      tag.title = 'From auto-generated subtitles: the text may contain mistakes';
      meta.append(tag);
    }
    li.append(meta);

    const del = el('button', 'del', '✕');
    del.type = 'button';
    del.title = 'Remove';
    del.setAttribute('aria-label', `Remove ${it.text}`);
    del.addEventListener('click', () => send({ type: 'remove', sessionId: session.id, id: it.id }));
    li.append(del);
    return li;
  }

  function renderCurrent() {
    const cur = state.current;
    const items = cur ? cur.items : [];
    $('count').textContent = String(items.length);
    $('started').textContent = cur ? `started ${dateLabel(cur.startedAt)}` : '';
    const list = $('items');
    list.textContent = '';
    for (const it of items.slice().reverse()) list.append(itemRow(cur, it));
    $('empty').hidden = items.length > 0;
    $('empty').textContent = state.enabled
      ? 'Capture is on. Click a word in the YouTube subtitles.'
      : 'Turn Fliwyee on, then click a word in the YouTube subtitles.';
    for (const id of ['copy-all', 'save-file', 'end-session']) $(id).disabled = items.length === 0;
  }

  function renderPast() {
    const box = $('past-list');
    const open = new Set(Array.from(box.querySelectorAll('details[open]')).map((d) => d.dataset.id));
    box.textContent = '';
    for (const s of state.sessions) {
      const d = el('details', 'past-session');
      d.dataset.id = s.id;
      if (open.has(s.id)) d.open = true;
      const sum = el('summary');
      sum.append(el('span', 'when', dateLabel(s.startedAt)), el('span', 'count', String(s.items.length)));
      d.append(sum);

      const actions = el('div', 'actions');
      const copyBtn = el('button', null, 'Copy all');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', () => copy(sessionLine(s), `Copied ${s.items.length} items`));
      const saveBtn = el('button', null, 'Save file');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', async () => {
        const r = await send({ type: 'saveFile', sessionId: s.id });
        status(r && r.status === 'saved' ? `Saved to Downloads/${r.filename}` : 'Could not save the file');
      });
      const delBtn = el('button', 'danger', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => {
        if (confirm('Delete this session from Fliwyee? A file you already saved in Downloads stays.')) {
          send({ type: 'deleteSession', sessionId: s.id });
        }
      });
      actions.append(copyBtn, saveBtn, delBtn);
      d.append(actions);

      const list = el('ol', 'items');
      for (const it of s.items.slice().reverse()) list.append(itemRow(s, it));
      d.append(list);
      box.append(d);
    }
    $('past-empty').hidden = state.sessions.length > 0;
  }

  function renderToggle() {
    const b = $('toggle');
    b.setAttribute('aria-pressed', String(state.enabled));
    b.classList.toggle('on', state.enabled);
    $('toggle-label').textContent = state.enabled ? 'On' : 'Off';
    b.title = state.enabled ? 'Turn capture off (ends the session and saves the file)' : 'Turn capture on';
  }

  function render() {
    renderToggle();
    renderCurrent();
    renderPast();
  }

  async function load() {
    state = await chrome.storage.local.get({ enabled: false, current: null, sessions: [] });
    render();
  }

  async function showShortcut() {
    try {
      const cmds = await chrome.commands.getAll();
      const c = cmds.find((x) => x.name === 'toggle-capture');
      $('shortcut').textContent = c && c.shortcut ? c.shortcut : 'not set';
    } catch (_) {
      $('shortcut').textContent = 'Ctrl+Shift+X';
    }
  }

  // ---------- wiring ----------

  $('toggle').addEventListener('click', async () => {
    const r = await send({ type: 'setEnabled', on: !state.enabled });
    if (r && r.saved && r.saved.filename) status(`Saved ${r.saved.count} items to Downloads/${r.saved.filename}`);
  });

  $('copy-all').addEventListener('click', () => {
    if (state.current) copy(sessionLine(state.current), `Copied ${state.current.items.length} items`);
  });

  $('save-file').addEventListener('click', async () => {
    const r = await send({ type: 'saveFile' });
    status(r && r.status === 'saved' ? `Saved to Downloads/${r.filename}` : 'Could not save the file');
  });

  $('end-session').addEventListener('click', async () => {
    const r = await send({ type: 'endSession' });
    status(r && r.saved ? `Session ended · saved to Downloads/${r.saved.filename || r.saved.folder}` : 'Nothing to save');
  });

  $('change-shortcut').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    for (const key of ['enabled', 'current', 'sessions']) {
      if (changes[key]) {
        state[key] = changes[key].newValue != null ? changes[key].newValue : key === 'sessions' ? [] : key === 'enabled' ? false : null;
        dirty = true;
      }
    }
    if (dirty) render();
  });

  // Keep the help open on first use only.
  try {
    if (!localStorage.getItem('fliwyee-help-seen')) {
      $('help').open = true;
      localStorage.setItem('fliwyee-help-seen', '1');
    }
  } catch (_) {
    /* storage blocked: leave it closed */
  }

  load();
  showShortcut();
})();
