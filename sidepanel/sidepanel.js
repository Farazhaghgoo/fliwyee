// Fliwyee side panel: pause/resume, the notebook of the video you're watching (tags, filter,
// search, notes, jump to a minute), all notebooks, loading a notebook file, settings.
(() => {
  'use strict';

  const F = self.FliwyeeFormat;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  // Opened as a small window (when Chrome didn't let Fliwyee open the side panel):
  //   ?nb=<notebook>                 the notes of that video
  //   ?nb=<notebook>&editor=<line>   just the editor for that line
  const popupNb = params.get('nb');
  const editorOnlyId = params.get('editor');

  let enabled = false;
  let settings = null;
  const notebooks = new Map(); // id -> notebook
  const view = { id: null, tag: '', q: '' };
  let active = null; // the video in the active tab: { notebookId, title, site, videoId }
  let statusTimer = 0;
  let settingsTimer = 0;
  let activeTimer = 0;

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

  // A message at the bottom, optionally with one button (Undo).
  function status(message, ms, action) {
    const s = $('status');
    s.textContent = '';
    s.append(el('span', null, message));
    if (action) {
      s.append(
        button(action.label, 'status-action', () => {
          s.classList.remove('show');
          action.run();
        })
      );
    }
    s.classList.toggle('has-action', !!action);
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

  async function copyText(text, html) {
    try {
      if (html && window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      } else await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
      document.body.append(ta);
      ta.select();
      const onCopy = (e) => {
        e.clipboardData.setData('text/plain', text);
        if (html) e.clipboardData.setData('text/html', html);
        e.preventDefault();
      };
      document.addEventListener('copy', onCopy, true);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {
        ok = false;
      }
      document.removeEventListener('copy', onCopy, true);
      ta.remove();
      return ok;
    }
  }

  async function copy(text, label, html) {
    status((await copyText(text, html)) ? label || 'Copied' : 'Could not copy');
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

  // ---------- which notebook is shown ----------

  const current = () => notebooks.get(view.id) || null;
  const byRecent = () => Array.from(notebooks.values()).sort((a, b) => b.updated - a.updated);

  function showNotebook(id) {
    view.id = id;
    view.tag = '';
    view.q = '';
    $('search').value = '';
  }

  // The lines you see: by time in the video, filtered by tag and search.
  function visibleLines(nb) {
    const q = F.norm(view.q);
    return F.sortLines(nb.lines).filter(
      (l) =>
        F.hasTag(l, view.tag) &&
        (!q || F.norm([l.sentence, l.note, ...l.words.flatMap((w) => [w.text, w.note])].join(' ')).includes(q))
    );
  }

  function filterLabel() {
    const parts = [];
    if (view.tag) parts.push(F.tagLabel(view.tag));
    if (view.q) parts.push(`"${view.q}"`);
    return parts.join(' · ');
  }

  // The video in the active tab (where Fliwyee runs), so the panel shows its notebook.
  async function detectActive() {
    if (popupNb) return null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
      return r && r.ok && r.notebookId ? { notebookId: r.notebookId, title: r.title, site: r.site, videoId: r.videoId } : null;
    } catch (_) {
      return null;
    }
  }

  function refreshActive() {
    clearTimeout(activeTimer);
    activeTimer = setTimeout(async () => {
      const a = await detectActive();
      const moved = (a && a.notebookId) !== (active && active.notebookId);
      active = a;
      if (moved && a && !editing) showNotebook(a.notebookId);
      render();
    }, 200);
  }

  // ---------- files and the video ----------

  // Save the latest version of the notebook's file, then open it (it opens in your browser).
  async function openFile(id) {
    status('Saving…', 5000);
    const r = await send({ type: 'saveNotebook', id });
    if (!r || r.status !== 'saved') {
      status('Could not save the file');
      return;
    }
    for (let i = 0; i < 30; i++) {
      const [d] = await chrome.downloads.search({ id: r.downloadId }).catch(() => []);
      if (d && d.state === 'complete') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    try {
      await chrome.downloads.open(r.downloadId);
      status(`Opened Downloads/${r.filename}`);
    } catch (_) {
      send({ type: 'showFile', id });
      status(`Saved to Downloads/${r.filename}. Double-click it to open.`, 4000);
    }
  }

  // Jump to a moment in the video (time null: just go to the video). Every tab where Fliwyee
  // runs is asked; the one playing that video jumps and comes to the front. If none has it,
  // the video (or page) opens in a new tab.
  async function openAt(nb, time) {
    const url = time == null ? F.videoUrl(nb.videoId, nb.site) : F.watchUrl({ videoId: nb.videoId, site: nb.site, time });
    const msg = { type: 'seek', videoId: nb.videoId, time };
    try {
      const tabs = await chrome.tabs.query({});
      const answers = await Promise.all(
        tabs.map((t) =>
          chrome.tabs
            .sendMessage(t.id, msg)
            .then((r) => (r && r.ok ? t : null))
            .catch(() => null)
        )
      );
      const tab = answers.find(Boolean);
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
      }
      if (url) await chrome.tabs.create({ url });
      if (nb.site === 'web' && time != null) status(`Opened the page. The moment is at ${F.fmtTime(time)}.`, 4000);
    } catch (_) {
      if (url) chrome.tabs.create({ url });
    }
  }

  // ---------- rendering ----------

  function lineRow(nb, line) {
    const li = el('li', 'line');
    li.dataset.id = line.id;
    const words = line.words.map((w) => w.text);

    const head = el('div', 'line-head');
    const time = el('a', 'time', `▶ ${F.fmtTime(line.time)}`);
    time.href = F.watchUrl({ videoId: nb.videoId, site: nb.site, time: line.time }) || '#';
    time.title = 'Play from here';
    time.addEventListener('click', (e) => {
      e.preventDefault();
      openAt(nb, line.time);
    });
    head.append(time);
    if (line.sentence) {
      const s = button('', 'sentence', () => copy(line.sentence, 'Copied the sentence'), 'Click to copy the sentence');
      s.lang = 'it';
      s.innerHTML = F.markWords(line.sentence, words); // escaped by markWords
      head.append(s);
    }
    li.append(head);

    if (line.words.length) {
      const box = el('div', 'words');
      for (const w of line.words) {
        const wrap = el('span', 'w');
        const b = button(
          w.text,
          'word',
          () => {
            const out = line.sentence ? F.boldCopy(line.sentence, w.text) : { plain: w.text, html: '' };
            copy(out.plain, `Copied: ${w.text} (in its sentence)`, out.html);
          },
          'Click to copy it in its sentence'
        );
        b.lang = 'it';
        wrap.append(b);
        if (w.note) wrap.append(el('span', 'wnote', w.note));
        box.append(wrap);
      }
      li.append(box);
    }

    const tags = el('div', 'tags');
    for (const t of F.TAGS) {
      const on = line.tags.includes(t.id);
      const b = button(
        t.label,
        `tag-chip t-${t.id}${on ? ' on' : ''}`,
        () => send({ type: 'toggleTag', notebookId: nb.id, lineId: line.id, tag: t.id }),
        on ? `Remove the tag ${t.label}` : `Add the tag ${t.label}`
      );
      b.setAttribute('aria-pressed', String(on));
      tags.append(b);
    }
    li.append(tags);

    if (line.note) li.append(el('div', 'note', line.note));

    const tools = el('div', 'tools');
    tools.append(button('AI', 'ai', () => ask(F.linePrompt(line, settings)), 'Ask your AI chat about this'));
    const edit = button('✎', 'edit', () => showEditor(nb.id, line.id, null, false), 'Edit / add a note');
    edit.setAttribute('aria-label', 'Edit this line');
    tools.append(edit);
    const del = button(
      '✕',
      'del',
      async () => {
        const r = await send({ type: 'removeLine', notebookId: nb.id, lineId: line.id });
        if (r && r.status === 'removed') {
          status('Line removed', 5000, { label: 'Undo', run: () => send({ type: 'undo', id: r.undoId }) });
        }
      },
      'Remove this line'
    );
    del.setAttribute('aria-label', 'Remove this line');
    tools.append(del);
    li.append(tools);
    return li;
  }

  function renderNotebook() {
    const nb = current();
    const isActive = !!(active && view.id === active.notebookId);
    $('nb-kicker').textContent = isActive ? 'This video' : 'Notebook';

    const title = $('nb-title');
    title.textContent = '';
    const name = nb ? F.nbTitle(nb) : isActive ? active.title || 'This video' : 'No notes yet';
    if (nb && F.videoUrl(nb.videoId, nb.site)) {
      const a = el('a', null, name);
      a.href = F.videoUrl(nb.videoId, nb.site);
      a.title = 'Go to the video';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openAt(nb, null);
      });
      title.append(a);
    } else title.textContent = name;

    const lines = nb ? nb.lines : [];
    const meta = $('nb-meta');
    meta.textContent = nb ? `Practiced ${nb.days.map(F.dayLabel).join(', ')} · ${F.plural(lines.length)}` : '';
    if (nb && nb.auto) {
      const tag = el('span', 'tag warn', 'auto subs');
      tag.title = 'From auto-generated subtitles: the text may contain mistakes';
      meta.append(' ', tag);
    }
    $('nb-file').textContent = !nb
      ? ''
      : !nb.savedAt
        ? 'Not in a file yet (saved in Fliwyee)'
        : nb.dirty
          ? `Newest changes not in the file yet · ${nb.filename}`
          : `Saved · Downloads/${nb.filename}`;
    $('nb-file').classList.toggle('pending', !!(nb && (nb.dirty || !nb.savedAt)));

    const shown = nb ? visibleLines(nb) : [];
    const filtered = !!(view.tag || view.q);
    $('ask-all').textContent = filtered ? `Ask AI about these (${shown.length})` : 'Ask AI about all';
    $('copy-all').textContent = filtered ? 'Copy these' : 'Copy all';
    for (const id of ['ask-all', 'copy-all']) $(id).disabled = !shown.length;
    for (const id of ['save-file', 'open-file']) $(id).disabled = !lines.length;
    $('show-file').disabled = !(nb && nb.downloadId != null);

    const filters = $('filters');
    filters.textContent = '';
    const chip = (tag, label, n) => {
      const b = button('', `chip${tag ? ` t-${tag}` : ''}`, () => {
        view.tag = tag && view.tag === tag ? '' : tag;
        renderNotebook();
      });
      b.append(label, el('span', 'n', String(n)));
      b.setAttribute('aria-pressed', String(view.tag === tag));
      filters.append(b);
    };
    chip('', 'All', lines.length);
    for (const t of F.TAGS) chip(t.id, t.label, lines.filter((l) => l.tags.includes(t.id)).length);
    $('notebook').classList.toggle('no-lines', !lines.length);

    const list = $('lines');
    list.textContent = '';
    for (const line of shown) list.append(lineRow(nb, line));
    const empty = $('nb-empty');
    if (!nb) {
      empty.textContent = isActive
        ? `No notes for this video yet. ${enabled ? '' : 'Turn Fliwyee on, then '}click a word in the subtitles.`
        : 'Play a video with subtitles, turn Fliwyee on and click a word. Each video gets its own notebook.';
    } else if (!lines.length) empty.textContent = 'No lines yet.';
    else empty.textContent = shown.length ? '' : 'Nothing here with this tag or search.';
    empty.hidden = !empty.textContent;
    $('nb-delete').hidden = !nb;
  }

  function renderList() {
    const list = $('nb-list');
    list.textContent = '';
    const all = byRecent();
    for (const nb of all) {
      const li = el('li');
      const b = button('', 'nb-item', () => {
        showNotebook(nb.id);
        render();
        window.scrollTo({ top: 0 });
      });
      if (nb.id === view.id) b.setAttribute('aria-current', 'true');
      const t = el('span', 'nb-name', F.nbTitle(nb));
      t.title = F.nbTitle(nb);
      const day = nb.days[nb.days.length - 1];
      const meta = el('span', 'nb-sub', `${day ? F.dayLabel(day) : ''} · ${F.plural(nb.lines.length)}`);
      b.append(t, meta);
      if (nb.dirty || !nb.savedAt) {
        const dot = el('span', 'dot');
        dot.title = 'Newest changes not in the file yet';
        b.append(dot);
      }
      li.append(b);
      list.append(li);
    }
    $('nb-count').textContent = String(all.length);
  }

  function renderToggle() {
    const b = $('toggle');
    b.setAttribute('aria-pressed', String(enabled));
    b.classList.toggle('on', enabled);
    $('toggle-label').textContent = enabled ? 'On' : 'Off';
    b.title = enabled ? 'Pause capture' : 'Turn capture on';
  }

  function renderSettings() {
    const s = F.mergedSettings(settings);
    const fields = { 'p-word': s.prompts.word, 'p-sentence': s.prompts.sentence, 'p-notebook': s.prompts.notebook };
    for (const [id, value] of Object.entries(fields)) {
      if (document.activeElement !== $(id)) $(id).value = value; // don't overwrite while you type
    }
    if (document.activeElement !== $('ai')) $('ai').value = s.ai;
  }

  function render() {
    if (!current() && !(active && view.id === active.notebookId)) {
      // the notebook shown is gone (deleted): the video you're watching, or the newest one
      view.id = (active && active.notebookId) || (byRecent()[0] || {}).id || null;
    }
    renderToggle();
    renderNotebook();
    renderList();
    renderSettings();
  }

  // A capture just landed on this line: show it.
  function flashLine(lineId) {
    const li = document.querySelector(`.line[data-id="${CSS.escape(lineId)}"]`);
    if (!li) return;
    li.classList.remove('flash');
    void li.offsetWidth;
    li.classList.add('flash');
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
      const next = {
        ai: $('ai').value,
        prompts: { word: $('p-word').value, sentence: $('p-sentence').value, notebook: $('p-notebook').value },
      };
      await chrome.storage.local.set({ settings: next });
      $('settings-saved').textContent = 'Saved';
      setTimeout(() => ($('settings-saved').textContent = ''), 1500);
    }, 400);
  }

  for (const id of ['p-word', 'p-sentence', 'p-notebook']) $(id).addEventListener('input', saveSettings);
  $('ai').addEventListener('change', saveSettings);
  $('reset-prompts').addEventListener('click', () => {
    const { prompts } = F.DEFAULT_SETTINGS;
    $('p-word').value = prompts.word;
    $('p-sentence').value = prompts.sentence;
    $('p-notebook').value = prompts.notebook;
    saveSettings();
  });

  // ---------- buttons ----------

  $('toggle').addEventListener('click', () => send({ type: 'setEnabled', on: !enabled }));

  $('ask-all').addEventListener('click', () => {
    const nb = current();
    if (nb) ask(F.notebookPrompt(visibleLines(nb), settings));
  });

  $('copy-all').addEventListener('click', () => {
    const nb = current();
    if (!nb) return;
    const lines = visibleLines(nb);
    copy(F.notebookText(nb, lines, filterLabel()), `Copied ${F.plural(lines.length)}`);
  });

  $('save-file').addEventListener('click', async () => {
    const nb = current();
    if (!nb) return;
    const r = await send({ type: 'saveNotebook', id: nb.id });
    status(r && r.status === 'saved' ? `Saved to Downloads/${r.filename}` : 'Could not save the file. Your notes are safe in Fliwyee.', 3500);
  });

  $('open-file').addEventListener('click', () => current() && openFile(current().id));
  $('show-file').addEventListener('click', () => current() && send({ type: 'showFile', id: current().id }));

  $('search').addEventListener('input', () => {
    view.q = $('search').value.trim();
    renderNotebook();
  });

  $('nb-delete').addEventListener('click', () => {
    const nb = current();
    if (!nb) return;
    if (confirm(`Delete the notebook "${F.nbTitle(nb)}" from Fliwyee? A file you already saved in Downloads stays.`)) {
      send({ type: 'deleteNotebook', id: nb.id });
    }
  });

  $('change-shortcut').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // ---------- loading a notebook file ----------

  async function loadFiles(files) {
    const done = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const found = F.readNotebookFile(text, file.lastModified);
        if (!found.length) {
          status(`${file.name} is not a Fliwyee notebook`, 3500);
          continue;
        }
        // Keep saving to this file only if it's a notebook file (one video). An older Fliwyee
        // file can hold several videos: each gets a new file of its own.
        const own = found.length === 1 && text.includes('id="fliwyee-data"');
        const r = await send({ type: 'importNotebooks', notebooks: found, filename: own ? file.name : null });
        if (r && r.status === 'ok') done.push(...r.results);
        else status(`Could not load ${file.name}`, 3500);
      } catch (_) {
        status(`Could not read ${file.name}`, 3500);
      }
    }
    if (!done.length) return;
    showNotebook(done[0].id);
    render();
    window.scrollTo({ top: 0 });
    const r = done[0];
    const more = done.length > 1 ? ` (+${done.length - 1} more)` : '';
    status(
      r.merged
        ? `Loaded "${r.title}"${more}: joined with the notes you already had (${F.plural(r.count)})`
        : `Loaded "${r.title}"${more} · ${F.plural(r.count)}`,
      4000
    );
  }

  $('load').addEventListener('click', () => $('load-file').click());
  $('load-file').addEventListener('change', () => {
    const files = Array.from($('load-file').files || []);
    $('load-file').value = '';
    if (files.length) loadFiles(files);
  });

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $('drop').hidden = false;
  });
  document.addEventListener('dragleave', (e) => {
    if (e.target === $('drop') || !e.relatedTarget) $('drop').hidden = true;
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $('drop').hidden = true;
    loadFiles(Array.from(e.dataTransfer.files || []));
  });

  // ---------- the editor (only when you press N on the video, or click ✎) ----------

  let editing = null; // { notebookId, lineId, closeAfter }

  function wordRow(text, note) {
    const row = el('div', 'ed-word');
    const t = el('input', 'ed-w-text');
    t.type = 'text';
    t.value = text || '';
    t.placeholder = 'word or phrase';
    t.spellcheck = false;
    t.setAttribute('aria-label', 'Word or phrase');
    const n = el('input', 'ed-w-note');
    n.type = 'text';
    n.value = note || '';
    n.placeholder = 'meaning / note';
    n.setAttribute('aria-label', `Note on ${text || 'this word'}`);
    const x = button('✕', 'ed-w-del', () => row.remove(), 'Remove this word');
    x.setAttribute('aria-label', 'Remove this word');
    row.append(t, n, x);
    return row;
  }

  function showEditor(notebookId, lineId, word, closeAfter) {
    const nb = notebooks.get(notebookId);
    const line = nb && nb.lines.find((l) => l.id === lineId);
    if (!line) {
      status('That line is gone');
      if (closeAfter) window.close();
      return;
    }
    editing = { notebookId, lineId, closeAfter: !!closeAfter };
    $('editor-title').textContent = `Edit the line at ${F.fmtTime(line.time)}`;
    $('ed-sentence').value = line.sentence;
    const picker = $('ed-tags');
    picker.textContent = '';
    for (const t of F.TAGS) {
      const b = button(t.label, `tag-chip t-${t.id}${line.tags.includes(t.id) ? ' on' : ''}`, () => {
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      b.dataset.tag = t.id;
      b.setAttribute('aria-pressed', String(line.tags.includes(t.id)));
      picker.append(b);
    }
    const words = $('ed-words');
    words.textContent = '';
    for (const w of line.words) words.append(wordRow(w.text, w.note));
    $('ed-note').value = line.note;
    $('editor').hidden = false;
    window.scrollTo({ top: 0 });
    // the word you just clicked: straight to its note; otherwise the note on the sentence
    const rows = Array.from(words.children);
    const row = word && rows.find((r) => F.norm(r.querySelector('.ed-w-text').value) === F.norm(word));
    const target = row ? row.querySelector('.ed-w-note') : $('ed-note');
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function closeEditor() {
    const closeAfter = editing && editing.closeAfter;
    editing = null;
    $('editor').hidden = true;
    if (closeAfter || editorOnlyId) window.close(); // back to the video
  }

  async function saveEditor() {
    if (!editing) return;
    const words = Array.from($('ed-words').children).map((r) => ({
      text: r.querySelector('.ed-w-text').value,
      note: r.querySelector('.ed-w-note').value,
    }));
    const tags = Array.from($('ed-tags').children)
      .filter((b) => b.classList.contains('on'))
      .map((b) => b.dataset.tag);
    const r = await send({
      type: 'editLine',
      notebookId: editing.notebookId,
      lineId: editing.lineId,
      sentence: $('ed-sentence').value,
      note: $('ed-note').value,
      words,
      tags,
    });
    if (r && r.status === 'saved') status('Saved');
    else if (r && r.status === 'empty') {
      status('A line needs a sentence or a word');
      return;
    } else status('Could not save');
    closeEditor();
  }

  $('ed-add-word').addEventListener('click', () => {
    const row = wordRow('', '');
    $('ed-words').append(row);
    row.querySelector('input').focus();
  });
  $('ed-save').addEventListener('click', saveEditor);
  $('ed-cancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      saveEditor();
    }
  });

  // N on the video: show that video's notes, and the editor for the last capture.
  function takeRequest(req) {
    if (!req || Date.now() - req.at > 15000) return;
    chrome.storage.local.set({ panelRequest: null });
    if (req.notebookId) showNotebook(req.notebookId);
    render();
    if (req.lineId) showEditor(req.notebookId, req.lineId, req.word, false);
  }

  // ---------- data ----------

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    let flash = null;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(F.NB_PREFIX)) continue;
      const id = key.slice(F.NB_PREFIX.length);
      const nb = change.newValue ? F.normalizeNotebook(change.newValue) : null;
      if (nb) notebooks.set(id, nb);
      else notebooks.delete(id);
      dirty = true;
      // a new capture: show its notebook and the line
      const before = change.oldValue && change.oldValue.lastCaptureAt;
      if (nb && nb.lastCaptureAt && nb.lastCaptureAt !== before && Date.now() - nb.lastCaptureAt < 10000) {
        flash = { id, lineId: nb.lastLineId };
      }
    }
    if (changes.enabled) {
      enabled = !!changes.enabled.newValue;
      dirty = true;
    }
    if (changes.settings) {
      settings = changes.settings.newValue || null;
      dirty = true;
    }
    if (flash && !editing && flash.id !== view.id) showNotebook(flash.id);
    if (dirty) render();
    if (flash && flash.id === view.id) flashLine(flash.lineId);
    if (changes.panelRequest && !editorOnlyId) takeRequest(changes.panelRequest.newValue);
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
    $('sc-toggle-2').textContent = sc('toggle-capture', 'Ctrl+Shift+X');
    $('sc-save').textContent = sc('end-session', 'Ctrl+Shift+E');
    $('sc-save-2').textContent = sc('end-session', 'Ctrl+Shift+E');
  }

  // Tell the background this side panel is open (so N goes straight here, and closing it saves
  // the files). Reconnect if the background was asleep and dropped the connection.
  function connectPanel() {
    if (popupNb) return;
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    chrome.windows.getCurrent().then((w) => port.postMessage({ type: 'hello', windowId: w.id }));
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'open') takeRequest(msg.request);
    });
    port.onDisconnect.addListener(() => setTimeout(connectPanel, 1000));
  }

  // Keep the help open on first use only.
  try {
    if (!popupNb && !localStorage.getItem('fliwyee-help-seen-05')) {
      $('help').open = true;
      localStorage.setItem('fliwyee-help-seen-05', '1');
    }
  } catch (_) {
    /* storage blocked: leave it closed */
  }

  if (editorOnlyId) document.body.classList.add('editor-only');

  if (!popupNb) {
    chrome.tabs.onActivated.addListener(refreshActive);
    chrome.tabs.onUpdated.addListener((_id, info, tab) => {
      if (tab && tab.active && (info.status === 'complete' || info.url || info.title)) refreshActive();
    });
  }

  (async () => {
    const all = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(F.NB_PREFIX)) continue;
      const nb = F.normalizeNotebook(value);
      if (nb) notebooks.set(nb.id, nb);
    }
    enabled = !!all.enabled;
    settings = all.settings || null;
    active = await detectActive();
    view.id = popupNb || (active && active.notebookId) || (byRecent()[0] || {}).id || null;
    render();
    if (editorOnlyId) showEditor(popupNb, editorOnlyId, params.get('word'), true);
    else takeRequest(all.panelRequest);
  })();
  connectPanel();
  showShortcuts();
})();
