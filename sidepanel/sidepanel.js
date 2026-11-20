// Fliwyee side panel: pause/resume, the open session, past sessions, Ask AI and settings.
(() => {
  'use strict';

  const F = self.FliwyeeFormat;
  const $ = (id) => document.getElementById(id);
  let state = { enabled: false, current: null, sessions: [], settings: null };
  let statusTimer = 0;
  let settingsTimer = 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, cls, onClick, title) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function status(message, ms) {
    const s = $('status');
    s.textContent = message;
    s.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => s.classList.remove('show'), ms || 2400);
  }

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return { status: 'error', message: String((e && e.message) || e) };
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  async function copy(text, label) {
    status((await copyText(text)) ? label || 'Copied' : 'Could not copy');
  }

  // Copy the prompt, then let Fliwyee put it in the AI chat you used last (or open one).
  async function ask(prompt) {
    const copied = await copyText(prompt);
    status('Opening your AI chat…', 6000);
    const r = await send({ type: 'askAI', text: prompt });
    if (r && r.status === 'ok') {
      status(r.inserted ? `Sent to ${r.site}. Press Enter there.` : `Copied. Paste it in ${r.site} (Ctrl+V).`, 4000);
    } else status(copied ? 'Copied. Paste it in your AI chat (Ctrl+V).' : 'Could not reach your AI chat.', 4000);
  }

  // Save the latest version of the session's page, then open it (it opens in your browser).
  async function openFile(sessionId) {
    status('Saving…', 5000);
    const r = await send({ type: 'saveFile', sessionId });
    if (!r || r.status !== 'saved') {
      status('Could not save the file');
      return;
    }
    // wait until the file is written
    for (let i = 0; i < 30; i++) {
      const [d] = await chrome.downloads.search({ id: r.downloadId }).catch(() => []);
      if (d && d.state === 'complete') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    try {
      await chrome.downloads.open(r.downloadId);
      status(`Opened Downloads/${r.filename}`);
    } catch (_) {
      send({ type: 'showFile', sessionId });
      status(`Saved to Downloads/${r.filename}. Double-click it to open.`, 4000);
    }
  }

  // Jump to the moment in the video: reuse an open tab with that video, otherwise open it.
  async function openAt(item) {
    const url = F.watchUrl(item);
    try {
      const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
      const tab = tabs.find((t) => {
        try {
          return new URL(t.url).searchParams.get('v') === item.videoId;
        } catch (_) {
          return false;
        }
      });
      if (!tab) {
        await chrome.tabs.create({ url });
        return;
      }
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'seek', videoId: item.videoId, time: item.time });
        if (r && r.ok) return;
      } catch (_) {
        /* the tab was opened before Fliwyee was (re)loaded: load it at the right moment */
      }
      await chrome.tabs.update(tab.id, { url });
    } catch (_) {
      chrome.tabs.create({ url });
    }
  }

  // ---------- rendering ----------

  function itemRow(session, it) {
    const li = el('li', `item item-${it.type}`);
    li.append(button(it.text, 'text', () => copy(it.text, `Copied: ${it.text}`), 'Click to copy'));
    if (it.context) li.append(el('div', 'ctx', it.context));
    if (it.note) li.append(el('div', 'note', it.note));

    const meta = el('div', 'meta');
    if (it.type !== 'word') meta.append(el('span', 'tag', it.type));
    if (it.videoId) {
      const a = el('a', 'time', `▶ ${F.fmtTime(it.time)}`);
      a.href = F.watchUrl(it);
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

    const tools = el('div', 'tools');
    tools.append(button('AI', 'ai', () => ask(F.itemPrompt(it, state.settings)), 'Ask your AI chat about this'));
    const edit = button('✎', 'edit', () => showEditor(it.id, false), 'Edit / add a note');
    edit.setAttribute('aria-label', `Edit ${it.text}`);
    tools.append(edit);
    const del = button('✕', 'del', () => send({ type: 'remove', sessionId: session.id, id: it.id }), 'Remove');
    del.setAttribute('aria-label', `Remove ${it.text}`);
    tools.append(del);
    li.append(tools);
    return li;
  }

  function renderCurrent() {
    const cur = state.current;
    const items = cur ? cur.items : [];
    $('count').textContent = String(items.length);
    $('started').textContent = cur ? `started ${F.dateLabel(cur.startedAt)}` : '';
    const list = $('items');
    list.textContent = '';
    for (const it of items.slice().reverse()) list.append(itemRow(cur, it));
    const empty = $('empty');
    empty.hidden = items.length > 0;
    empty.textContent = state.enabled
      ? 'Capturing. Click a word in the YouTube subtitles.'
      : 'Turn Fliwyee on, then click a word in the YouTube subtitles.';
    for (const id of ['ask-all', 'copy-all', 'open-file', 'end-session']) $(id).disabled = items.length === 0;
    $('show-file').disabled = !(cur && cur.downloadId != null);
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
      sum.append(el('span', 'when', F.dateLabel(s.startedAt)), el('span', 'count', String(s.items.length)));
      d.append(sum);

      const actions = el('div', 'actions');
      actions.append(
        button('Ask AI about all', 'primary', () => ask(F.sessionPrompt(s, state.settings))),
        button('Copy all', null, () => copy(F.sessionText(s), `Copied ${F.plural(s.items.length)}`)),
        button('Open file', null, () => openFile(s.id), 'Save the file and open it'),
        button('Show in folder', null, () => send({ type: 'showFile', sessionId: s.id })),
        button('Delete', 'danger', () => {
          if (confirm('Delete this session from Fliwyee? A file you already saved in Downloads stays.')) {
            send({ type: 'deleteSession', sessionId: s.id });
          }
        })
      );
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
    const open = !!(state.current && state.current.items.length);
    b.setAttribute('aria-pressed', String(state.enabled));
    b.classList.toggle('on', state.enabled);
    $('toggle-label').textContent = state.enabled ? 'On' : open ? 'Paused' : 'Off';
    b.title = state.enabled ? 'Pause capture (the session keeps going)' : 'Turn capture on';
  }

  function renderSettings() {
    const s = F.mergedSettings(state.settings);
    const fields = { 'p-word': s.prompts.word, 'p-sentence': s.prompts.sentence, 'p-session': s.prompts.session };
    for (const [id, value] of Object.entries(fields)) {
      if (document.activeElement !== $(id)) $(id).value = value; // don't overwrite while you type
    }
    if (document.activeElement !== $('ai')) $('ai').value = s.ai;
  }

  function render() {
    renderToggle();
    renderCurrent();
    renderPast();
    renderSettings();
  }

  // ---------- settings ----------

  for (const a of F.AI_SITES) {
    const o = el('option', null, a.name);
    o.value = a.id;
    $('ai').append(o);
  }

  function saveSettings() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(async () => {
      const settings = {
        ai: $('ai').value,
        prompts: { word: $('p-word').value, sentence: $('p-sentence').value, session: $('p-session').value },
      };
      await chrome.storage.local.set({ settings });
      $('settings-saved').textContent = 'Saved';
      setTimeout(() => ($('settings-saved').textContent = ''), 1500);
    }, 400);
  }

  for (const id of ['p-word', 'p-sentence', 'p-session']) $(id).addEventListener('input', saveSettings);
  $('ai').addEventListener('change', saveSettings);
  $('reset-prompts').addEventListener('click', async () => {
    const { prompts } = F.DEFAULT_SETTINGS;
    $('p-word').value = prompts.word;
    $('p-sentence').value = prompts.sentence;
    $('p-session').value = prompts.session;
    saveSettings();
  });

  // ---------- buttons ----------

  $('toggle').addEventListener('click', () => send({ type: 'setEnabled', on: !state.enabled }));

  $('ask-all').addEventListener('click', () => {
    if (state.current) ask(F.sessionPrompt(state.current, state.settings));
  });

  $('copy-all').addEventListener('click', () => {
    if (state.current) copy(F.sessionText(state.current), `Copied ${F.plural(state.current.items.length)}`);
  });

  $('open-file').addEventListener('click', () => openFile(state.current && state.current.id));

  $('show-file').addEventListener('click', () => send({ type: 'showFile' }));

  $('end-session').addEventListener('click', async () => {
    const r = await send({ type: 'endSession' });
    if (r && r.saved) {
      status(r.saved.filename ? `Session saved to Downloads/${r.saved.filename}` : 'Session ended, but the file could not be written', 3500);
    } else status('Nothing to save');
  });

  $('change-shortcut').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // ---------- data ----------

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const defaults = { enabled: false, current: null, sessions: [], settings: null };
    let dirty = false;
    for (const key of Object.keys(defaults)) {
      if (changes[key]) {
        state[key] = changes[key].newValue != null ? changes[key].newValue : defaults[key];
        dirty = true;
      }
    }
    if (dirty) render();
  });

  async function showShortcuts() {
    let cmds = [];
    try {
      cmds = await chrome.commands.getAll();
    } catch (_) {
      cmds = [];
    }
    const sc = (name, fallback) => {
      const c = cmds.find((x) => x.name === name);
      return c ? c.shortcut || 'not set' : fallback;
    };
    $('sc-toggle').textContent = sc('toggle-capture', 'Ctrl+Shift+X');
    $('sc-end').textContent = sc('end-session', 'Ctrl+Shift+E');
    $('sc-end-2').textContent = sc('end-session', 'Ctrl+Shift+E');
  }

  // ---------- the editor (only when you press N on the video, or click ✎) ----------

  // ?editor=<itemId>: this page was opened as a small window just for editing.
  const editorOnlyId = new URLSearchParams(location.search).get('editor');
  let editing = null; // { id, closeAfter }

  function findLocal(itemId) {
    for (const s of [state.current, ...(state.sessions || [])]) {
      const it = s && s.items.find((i) => i.id === itemId);
      if (it) return it;
    }
    return null;
  }

  async function showEditor(itemId, closeAfter) {
    let it = findLocal(itemId);
    if (!it) {
      const r = await send({ type: 'getItem', id: itemId });
      it = r && r.item;
    }
    if (!it) {
      status('That item is gone');
      if (closeAfter) window.close();
      return;
    }
    editing = { id: itemId, closeAfter: !!closeAfter };
    const isSentence = it.type === 'sentence';
    $('ed-text-row').hidden = isSentence;
    $('ed-text').value = it.text;
    $('ed-sentence').value = isSentence ? it.text : it.context || '';
    $('ed-note').value = it.note || '';
    $('editor-title').textContent = isSentence ? 'Edit sentence' : `Edit “${it.text}”`;
    $('editor').hidden = false;
    window.scrollTo({ top: 0 });
    const note = $('ed-note');
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
  }

  function closeEditor() {
    const closeAfter = editing && editing.closeAfter;
    editing = null;
    $('editor').hidden = true;
    if (closeAfter || editorOnlyId) window.close(); // back to the video
  }

  async function saveEditor() {
    if (!editing) return;
    const isSentence = $('ed-text-row').hidden;
    const sentence = $('ed-sentence').value.replace(/\s+/g, ' ').trim();
    const r = await send({
      type: 'editItem',
      id: editing.id,
      text: isSentence ? sentence : $('ed-text').value,
      sentence,
      note: $('ed-note').value,
    });
    if (r && r.status === 'saved') status('Saved');
    else status('Could not save');
    closeEditor();
  }

  $('ed-save').addEventListener('click', saveEditor);
  $('ed-cancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      saveEditor();
    }
  });

  // A request from N on the video: kept in storage when this panel had to be opened for it.
  function takeEditRequest(req) {
    if (!req || Date.now() - req.at > 15000) return;
    chrome.storage.local.set({ editRequest: null });
    showEditor(req.id, req.closeAfter);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.editRequest && !editorOnlyId) takeEditRequest(changes.editRequest.newValue);
  });

  // Tell the background this side panel is open (so N goes straight here). Reconnect if the
  // background was asleep and dropped the connection.
  function connectPanel() {
    if (editorOnlyId) return;
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    chrome.windows.getCurrent().then((w) => port.postMessage({ type: 'hello', windowId: w.id }));
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'edit') showEditor(msg.request.id, msg.request.closeAfter);
    });
    port.onDisconnect.addListener(() => setTimeout(connectPanel, 1000));
  }

  // Keep the help open on first use only.
  try {
    if (!editorOnlyId && !localStorage.getItem('fliwyee-help-seen')) {
      $('help').open = true;
      localStorage.setItem('fliwyee-help-seen', '1');
    }
  } catch (_) {
    /* storage blocked: leave it closed */
  }

  if (editorOnlyId) document.body.classList.add('editor-only');

  chrome.storage.local.get({ enabled: false, current: null, sessions: [], settings: null, editRequest: null }).then((st) => {
    const { editRequest, ...rest } = st;
    state = rest;
    render();
    if (editorOnlyId) showEditor(editorOnlyId, true);
    else takeEditRequest(editRequest);
  });
  connectPanel();
  showShortcuts();
})();
