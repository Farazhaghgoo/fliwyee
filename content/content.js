// Fliwyee on YouTube (isolated world).
// When capture is ON:
//   click a word        -> copy + save the word (with its sentence)
//   drag across words   -> copy + save the phrase (with its sentence)
//   S                   -> copy + save the whole subtitle line
//   R / Shift+R         -> replay the current line (Shift = 0.75x), then pause at its end
//   Q                   -> ask your AI chat about the last capture (or the line on screen)
//   Ctrl+Z              -> undo the last capture
// When capture is OFF nothing changes on YouTube.
(() => {
  'use strict';
  if (window.__fliwyeeContent) return;
  window.__fliwyeeContent = true;

  const F = window.FliwyeeFormat; // lib/format.js, loaded just before this file
  const ON_CLASS = 'fliwyee-on';
  const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
  const APOSTROPHES = "'’";

  let enabled = false;
  let sessionCount = 0;
  let settings = null; // prompts etc., from storage
  let lastCapture = null; // { id, type, text, context } of the last capture in this tab
  let ui = null; // { player, pill, toast, hl }
  let toastTimer = 0;
  let pressInCaption = false;
  let suppressClick = false;
  let lastMouse = null;
  let hlFrame = 0;
  let hlRecheck = 0;
  let replay = null;
  let contextGone = false;
  const tracks = new Map(); // videoId -> { cues: [{start, end, text}], auto }

  // ---------- small helpers ----------

  const $player = () => document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
  const $video = () => {
    const p = $player();
    return (p && p.querySelector('video')) || document.querySelector('video');
  };
  const currentVideoId = () => new URLSearchParams(location.search).get('v') || '';
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isWordChar = (ch) => !!ch && WORD_CHAR.test(ch);
  // Letters, plus an apostrophe between letters, so c'entra / un'ora / dov'è stay one word.
  const inWord = (s, k) =>
    k >= 0 && k < s.length && (isWordChar(s[k]) || (APOSTROPHES.includes(s[k]) && isWordChar(s[k - 1]) && isWordChar(s[k + 1])));
  // "un po'": keep an apostrophe that ends a word.
  const trailingApostrophe = (s, end) => (end < s.length && APOSTROPHES.includes(s[end]) && isWordChar(s[end - 1]) ? 1 : 0);
  const asElement = (node) => (node ? (node.nodeType === 1 ? node : node.parentElement) : null);
  const captionWindowOf = (node) => {
    const el = asElement(node);
    return el ? el.closest('.caption-window') : null;
  };
  const block = (e, preventDefault) => {
    e.stopImmediatePropagation();
    e.stopPropagation();
    if (preventDefault) e.preventDefault();
  };
  const isTyping = (e) => {
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  };

  function videoTitle() {
    const h1 = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata');
    const fromPage = h1 && clean(h1.textContent);
    if (fromPage) return fromPage;
    return clean(document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, ''));
  }

  // Text of the subtitles on screen. With a caption window: just that window.
  function captionText(win) {
    const root = win || $player() || document;
    const lines = root.querySelectorAll('.caption-visual-line');
    if (lines.length) {
      return clean(
        Array.from(lines)
          .map((line) => Array.from(line.querySelectorAll('.ytp-caption-segment')).map((s) => s.textContent).join(''))
          .join(' ')
      );
    }
    return clean(Array.from(root.querySelectorAll('.ytp-caption-segment')).map((s) => s.textContent).join(' '));
  }

  // ---------- words under the mouse ----------

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  }

  function wordAtPoint(x, y) {
    const c = caretAt(x, y);
    if (!c || !c.node || c.node.nodeType !== Node.TEXT_NODE) return null;
    const parent = c.node.parentElement;
    if (!parent || !parent.closest('.ytp-caption-segment')) return null;
    const text = c.node.data;
    let i = Math.min(c.offset, text.length);
    if (!inWord(text, i) && inWord(text, i - 1)) i -= 1;
    if (!inWord(text, i)) return null;
    let start = i;
    let end = i + 1;
    while (inWord(text, start - 1)) start--;
    while (inWord(text, end)) end++;
    end += trailingApostrophe(text, end);
    const range = document.createRange();
    range.setStart(c.node, start);
    range.setEnd(c.node, end);
    const rect = range.getBoundingClientRect();
    // The caret APIs snap to the nearest text, so make sure the mouse is really on this word.
    if (x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) return null;
    return { text: text.slice(start, end), rect };
  }

  // "fare a men" -> "fare a meno" (complete cut words using the full sentence)
  function expandToWords(selected, sentence) {
    const s = clean(selected);
    const full = clean(sentence);
    let out = s;
    const idx = full.indexOf(s);
    if (idx >= 0) {
      let a = idx;
      let b = idx + s.length;
      while (inWord(full, a - 1) && inWord(full, a)) a--;
      while (inWord(full, b) && inWord(full, b - 1)) b++;
      b += trailingApostrophe(full, b);
      out = full.slice(a, b);
    }
    return out.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}'’]+$/u, '');
  }

  // ---------- subtitle timing (from page-hook.js) ----------

  function decodeEntities(s) {
    return String(s)
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function parseJson3(data) {
    const cues = [];
    for (const ev of (data && data.events) || []) {
      if (!ev.segs) continue;
      const text = clean(ev.segs.map((s) => s.utf8 || '').join(''));
      if (!text) continue;
      const start = (ev.tStartMs || 0) / 1000;
      cues.push({ start, end: start + (ev.dDurationMs || 0) / 1000, text });
    }
    return cues;
  }

  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const cues = [];
    for (const p of doc.querySelectorAll('p')) {
      // srv3: <p t="ms" d="ms">
      const text = clean(decodeEntities(p.textContent));
      if (!text) continue;
      const start = (Number(p.getAttribute('t')) || 0) / 1000;
      cues.push({ start, end: start + (Number(p.getAttribute('d')) || 0) / 1000, text });
    }
    if (!cues.length) {
      for (const t of doc.querySelectorAll('text')) {
        // srv1: <text start="s" dur="s">
        const text = clean(decodeEntities(t.textContent));
        if (!text) continue;
        const start = Number(t.getAttribute('start')) || 0;
        cues.push({ start, end: start + (Number(t.getAttribute('dur')) || 0), text });
      }
    }
    return cues;
  }

  function parseCaptions(body) {
    const trimmed = String(body || '').trimStart();
    let cues = [];
    if (trimmed.startsWith('{')) cues = parseJson3(JSON.parse(trimmed));
    else if (trimmed.startsWith('<')) cues = parseXml(trimmed);
    return cues.sort((a, b) => a.start - b.start);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__fliwyee !== 'timedtext') return;
    try {
      const url = new URL(e.data.url, location.href);
      const cues = parseCaptions(e.data.body);
      if (!cues.length) return;
      const vid = url.searchParams.get('v') || currentVideoId();
      tracks.set(vid, { cues, auto: url.searchParams.get('kind') === 'asr' });
    } catch (_) {
      /* not a format we know: fall back to on-screen text */
    }
  });

  // Index of the line playing at time t (the last line that has started).
  function cueIndexAt(cues, t) {
    let lo = 0;
    let hi = cues.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t + 0.05) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  function currentCue() {
    const track = tracks.get(currentVideoId());
    const v = $video();
    if (!track || !v) return null;
    const i = cueIndexAt(track.cues, v.currentTime);
    return i >= 0 ? track.cues[i] : null;
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lower = (s) => clean(s).toLocaleLowerCase('it');

  // When was this word / phrase / line said? Auto-generated subtitles show the previous line
  // too, so look back a few lines for the one that really contains it, and use its start.
  function startTimeFor(text, type) {
    const v = $video();
    const now = v ? v.currentTime : 0;
    const track = tracks.get(currentVideoId());
    const cues = track ? track.cues : [];
    const i = cues.length ? cueIndexAt(cues, now) : -1;
    if (i < 0) return Math.max(0, now - 3); // no timing data: a few seconds back
    const first = Math.max(0, i - 4);
    if (type === 'sentence') {
      // the on-screen text can hold two lines: take the earliest line that is part of it
      const shown = lower(text);
      let best = -1;
      for (let k = i; k >= first; k--) {
        if (shown.includes(lower(cues[k].text))) best = k;
        else if (best >= 0) break;
      }
      return cues[best >= 0 ? best : i].start;
    }
    const firstWord = lower(text).split(' ')[0];
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(firstWord)}($|[^\\p{L}\\p{N}])`, 'u');
    for (let k = i; k >= first; k--) if (re.test(lower(cues[k].text))) return cues[k].start;
    return cues[i].start;
  }

  // ---------- on-player UI: pill, toast, highlight ----------

  function ensureUi() {
    const player = $player();
    if (!player) return null;
    if (ui && ui.player === player && player.contains(ui.toast)) return ui;
    if (ui) [ui.pill, ui.toast, ui.hl].forEach((el) => el.remove());
    const make = (cls) => {
      const d = document.createElement('div');
      d.className = cls;
      player.appendChild(d);
      return d;
    };
    ui = { player, pill: make('fliwyee-pill'), toast: make('fliwyee-toast'), hl: make('fliwyee-hl') };
    // Clicks on the toast (Undo) must not reach the player, or it would pause/play the video.
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) =>
      ui.toast.addEventListener(type, (e) => e.stopPropagation())
    );
    // Keep the message (and its Undo) while the mouse is on it.
    ui.toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    ui.toast.addEventListener('mouseleave', () => hideToastSoon(1200));
    updatePill();
    return ui;
  }

  function hideToastSoon(ms) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui && ui.toast.classList.remove('show'), ms);
  }

  function updatePill() {
    if (!ui) return;
    ui.pill.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = sessionCount ? `Fliwyee · ${sessionCount}` : 'Fliwyee ON';
    ui.pill.append(dot, label);
    ui.pill.title = 'Capture is on. Ctrl+Shift+X pauses it, Ctrl+Shift+E ends the session.';
  }

  // A small message on the player. Optional buttons: Ask AI (about `askItem`) and Undo.
  function showToast(message, opts) {
    const { undoId, askItem, ms } = opts || {};
    const u = ensureUi();
    if (!u) return;
    const t = u.toast;
    t.textContent = '';
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = message;
    t.append(msg);
    const button = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      t.append(b);
    };
    if (askItem) button('Ask AI', () => askAI(askItem));
    if (undoId) button('Undo', () => undo(undoId));
    t.classList.add('show');
    hideToastSoon(ms || (undoId || askItem ? 4000 : 2000));
  }

  function hideHighlight() {
    clearTimeout(hlRecheck);
    if (ui) ui.hl.classList.remove('show');
  }

  function scheduleHighlight() {
    if (!hlFrame) hlFrame = requestAnimationFrame(updateHighlight);
  }

  function updateHighlight() {
    hlFrame = 0;
    const m = lastMouse;
    if (!enabled || !m || m.dragging) return hideHighlight();
    const el = document.elementFromPoint(m.x, m.y);
    const w = captionWindowOf(el) ? wordAtPoint(m.x, m.y) : null;
    const u = w && ensureUi();
    if (!u) return hideHighlight();
    const pr = u.player.getBoundingClientRect();
    const s = u.hl.style;
    s.left = `${w.rect.left - pr.left - 2}px`;
    s.top = `${w.rect.top - pr.top}px`;
    s.width = `${w.rect.width + 4}px`;
    s.height = `${w.rect.height}px`;
    u.hl.classList.add('show');
    // Subtitles change while the video plays: check again soon even if the mouse doesn't move.
    clearTimeout(hlRecheck);
    hlRecheck = setTimeout(scheduleHighlight, 250);
  }

  // ---------- talking to the background ----------

  async function send(msg) {
    if (contextGone) return { status: 'gone' };
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (/context invalidated/i.test(String(e && e.message))) {
        contextGone = true;
        showToast('Fliwyee was updated. Reload this tab to keep using it.');
        return { status: 'gone' };
      }
      return { status: 'error' };
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
      (document.body || document.documentElement).appendChild(ta);
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

  // ---------- capture ----------

  async function capture(type, text, context) {
    text = clean(text);
    if (!text) return;
    const track = tracks.get(currentVideoId());
    const ctx = type === 'sentence' ? '' : clean(context);
    const item = {
      type,
      text,
      context: ctx === text ? '' : ctx,
      videoId: currentVideoId(),
      title: videoTitle(),
      // 1 second before the line starts, so the link plays the whole line
      time: Math.max(0, Math.floor(startTimeFor(text, type) - 1)),
      auto: !!(track && track.auto),
    };
    const copied = await copyText(text);
    const res = await send({ type: 'capture', item });
    if (!res || res.status === 'gone') return;
    if (res.status === 'added' || res.status === 'duplicate') {
      lastCapture = { id: res.id || null, type: item.type, text: item.text, context: item.context };
    }
    if (res.status === 'added') {
      showToast(`${copied ? 'Copied ✓' : 'Saved ✓'}  ${text}`, { undoId: res.id, askItem: lastCapture });
    } else if (res.status === 'duplicate') {
      showToast(`${copied ? 'Copied ✓' : 'Already saved'}  ${text}  (already saved)`, { askItem: lastCapture });
    } else if (res.status === 'off') showToast('Fliwyee is off');
    else showToast(copied ? `Copied ✓  ${text}  (could not save)` : 'Could not copy or save');
  }

  function screenLine() {
    let text = captionText(null);
    if (!text) {
      const cue = currentCue();
      text = cue ? cue.text : '';
    }
    return text;
  }

  function captureSentence() {
    const text = screenLine();
    if (!text) {
      showToast('No subtitle on screen. Turn on CC.');
      return;
    }
    capture('sentence', text, '');
  }

  // Ask your AI chat: copies the prompt, pauses the video, and Fliwyee switches to the AI tab
  // you used last (or opens one) and puts the prompt in its message box.
  async function askAI(item) {
    let it = item || lastCapture;
    if (!it) {
      const line = screenLine();
      if (!line) {
        showToast('Click a word first, or turn on CC.');
        return;
      }
      it = { type: 'sentence', text: line, context: '' };
    }
    const prompt = F.itemPrompt(it, settings);
    const v = $video();
    if (v && !v.paused) v.pause();
    stopReplay();
    const copied = await copyText(prompt);
    showToast('Opening your AI chat…');
    const res = await send({ type: 'askAI', text: prompt });
    if (!res || res.status === 'gone') return;
    if (res.status !== 'ok') showToast(copied ? 'Prompt copied. Paste it in your AI chat (Ctrl+V).' : 'Could not reach your AI chat.');
    else if (!res.inserted) showToast(`Prompt copied. Paste it in ${res.site} (Ctrl+V).`);
    else showToast(`Sent to ${res.site}. Press Enter there.`);
  }

  function handleRelease(e) {
    const sel = window.getSelection();
    const selected = sel && !sel.isCollapsed ? clean(sel.toString()) : '';
    const win = captionWindowOf(e.target) || (sel && captionWindowOf(sel.anchorNode));
    const sentence = captionText(win);
    if (selected) {
      const inside = captionWindowOf(sel.anchorNode) && captionWindowOf(sel.focusNode);
      sel.removeAllRanges();
      if (!inside) return;
      const phrase = expandToWords(selected, sentence);
      if (phrase) capture(/\s/.test(phrase) ? 'phrase' : 'word', phrase, sentence);
      return;
    }
    const w = wordAtPoint(e.clientX, e.clientY);
    if (w) capture('word', w.text, sentence);
  }

  async function undo(id) {
    const res = await send({ type: 'undo', id });
    if (!res || res.status === 'gone') return;
    if (res.status === 'removed' && lastCapture && lastCapture.id === res.id) lastCapture = null;
    showToast(res.status === 'removed' ? `Removed  ${res.text}` : 'Nothing to undo');
  }

  // ---------- replay ----------

  function stopReplay() {
    if (!replay) return;
    clearTimeout(replay.timer);
    const v = $video();
    if (v && replay.prevRate != null) v.playbackRate = replay.prevRate;
    replay = null;
  }

  function replayLine(slow) {
    const v = $video();
    if (!v) return;
    const track = tracks.get(currentVideoId());
    const cues = track ? track.cues : [];
    const t = v.currentTime;
    let i = cues.length ? cueIndexAt(cues, t) : -1;
    let start;
    let end;
    if (i >= 0) {
      // Pressed right after a new line started? You most likely meant the line you just heard.
      if (i > 0 && !replay && !v.paused && t - cues[i].start < 0.3) i -= 1;
      const cue = cues[i];
      const next = cues[i + 1];
      start = cue.start;
      end = next ? Math.min(cue.end, next.start) : cue.end;
      if (end - start < 0.3) end = start + Math.max(0.3, cue.end - cue.start);
      end -= 0.05; // stop just inside the line, so pressing R again repeats the same line
    } else {
      // No timing data (yet): replay the last 3 seconds.
      start = Math.max(0, t - 3);
      end = t;
    }

    const prevRate = replay && replay.prevRate != null ? replay.prevRate : v.playbackRate;
    stopReplay();
    replay = { end, start, timer: 0, prevRate: slow ? prevRate : null };
    if (slow) v.playbackRate = 0.75;
    v.currentTime = start;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});

    // A timer (not animation frames) so the stop is on time even when the page draws few frames.
    const check = () => {
      if (!replay) return;
      const ct = v.currentTime;
      if (ct >= replay.end - 0.01) {
        v.pause();
        stopReplay();
        return;
      }
      if (ct < replay.start - 0.5 || ct > replay.end + 1.5) {
        stopReplay(); // you jumped somewhere else
        return;
      }
      const msLeft = ((replay.end - ct) / (v.playbackRate || 1)) * 1000;
      replay.timer = setTimeout(check, Math.max(5, Math.min(200, msLeft - 15)));
    };
    replay.timer = setTimeout(check, 30);

    if (i < 0) showToast('↺ Last 3 seconds (subtitle timing not loaded yet)');
    else if (slow) showToast('↺ Slow replay 0.75×');
  }

  // ---------- events ----------

  // Mouse presses on the subtitles are ours while capture is on:
  // YouTube must not drag the subtitle box or pause the video.
  // After Fliwyee is updated or removed, this copy in an already-open tab is cut off from the
  // extension. It then switches itself off so YouTube works normally until you reload.
  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };
  let retired = false;
  function retire() {
    if (retired) return;
    retired = true;
    enabled = false;
    stopReplay();
    for (const [type, fn] of LISTENERS) window.removeEventListener(type, fn, true);
    if (ui) [ui.pill, ui.toast, ui.hl].forEach((node) => node.remove());
    ui = null;
    if (document.documentElement) document.documentElement.classList.remove(ON_CLASS);
  }

  function onPress(e) {
    if (!alive()) return retire();
    if (!enabled || e.button !== 0) return;
    if (e.type === 'pointerdown') pressInCaption = !!captionWindowOf(e.target);
    if (pressInCaption) block(e);
  }

  function onRelease(e) {
    if (!enabled || !pressInCaption || e.button !== 0) return;
    block(e);
    if (e.type !== 'mouseup') return;
    pressInCaption = false;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    if (e.detail > 1) {
      // second click of a double-click: the first click already captured the word
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      return;
    }
    handleRelease(e);
  }

  function onClick(e) {
    if (!enabled) return;
    if (suppressClick || captionWindowOf(e.target)) block(e, true);
  }

  function onMove(e) {
    if (!enabled) return;
    if (!alive()) return retire();
    lastMouse = { x: e.clientX, y: e.clientY, dragging: (e.buttons & 1) === 1 };
    scheduleHighlight();
  }

  function onKeyDown(e) {
    if (!alive()) return retire();
    if (!enabled || e.repeat || isTyping(e) || !$video()) return;
    const key = (e.key || '').toLowerCase();
    const noMods = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (noMods && !e.shiftKey && key === 's') {
      block(e, true);
      captureSentence();
    } else if (noMods && key === 'r') {
      block(e, true);
      replayLine(e.shiftKey);
    } else if (noMods && !e.shiftKey && key === 'q') {
      block(e, true);
      askAI(null);
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'z') {
      block(e, true);
      undo();
    }
  }

  const LISTENERS = [
    ['pointerdown', onPress],
    ['mousedown', onPress],
    ['pointerup', onRelease],
    ['mouseup', onRelease],
    ['click', onClick],
    ['dblclick', onClick],
    ['mousemove', onMove],
    ['keydown', onKeyDown],
  ];
  for (const [type, fn] of LISTENERS) window.addEventListener(type, fn, true);

  // YouTube changes video without reloading the page.
  window.addEventListener('yt-navigate-finish', () => {
    stopReplay();
    hideHighlight();
    if (enabled) ensureUi();
  });

  // ---------- on/off state ----------

  const visible = () => document.visibilityState === 'visible';

  function applyEnabled(on, announce) {
    enabled = on;
    if (document.documentElement) document.documentElement.classList.toggle(ON_CLASS, on);
    if (on) ensureUi();
    else {
      hideHighlight();
      stopReplay();
    }
    if (!announce || !visible()) return;
    if (on) showToast('Fliwyee ON · click a word · drag a phrase · S line · R replay · Q ask AI', { ms: 3000 });
    else if (sessionCount) showToast(`Fliwyee paused · the session keeps going (${F.plural(sessionCount)})`);
    else showToast('Fliwyee paused');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.current) {
      const cur = changes.current.newValue;
      sessionCount = cur && cur.items ? cur.items.length : 0;
      updatePill();
    }
    if (changes.settings) settings = changes.settings.newValue || null;
    if (changes.enabled) applyEnabled(!!changes.enabled.newValue, true);
    // The session was ended (Ctrl+Shift+E or the side panel).
    const saved = changes.lastSaved && changes.lastSaved.newValue;
    if (saved && changes.current && !changes.current.newValue && visible() && $player()) {
      lastCapture = null;
      showToast(
        saved.filename
          ? `Session saved · ${F.plural(saved.count)} → Downloads/${saved.folder}`
          : `Session ended · ${F.plural(saved.count)} (the file could not be written; use the side panel)`,
        { ms: 3500 }
      );
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'seek') return false;
    const v = $video();
    if (v && currentVideoId() === msg.videoId) {
      stopReplay();
      v.currentTime = Math.max(0, Number(msg.time) || 0);
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
      sendResponse({ ok: true });
    } else sendResponse({ ok: false });
    return false;
  });

  chrome.storage.local.get({ enabled: false, current: null, settings: null }).then((st) => {
    sessionCount = st.current && st.current.items ? st.current.items.length : 0;
    settings = st.settings;
    applyEnabled(!!st.enabled, false);
  });
})();
