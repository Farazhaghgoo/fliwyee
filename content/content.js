// Fliwyee on a video page (isolated world). The site details come from content/sites.js.
// When capture is ON:
//   click a word        -> copy + save the word (with its sentence)
//   drag across words   -> copy + save the phrase (with its sentence)
//   S                   -> copy + save the whole subtitle line
//   R / Shift+R         -> replay the current line (Shift = 0.75x), then pause at its end
//   Q                   -> ask your AI chat about the last capture (or the line on screen)
//   N                   -> edit the last capture / add a note (opens the editor in the side panel)
//   Ctrl+Z              -> undo the last capture
// When capture is OFF nothing changes on the page.
(() => {
  'use strict';
  // Already running here? (An old copy cut off by an update doesn't count.)
  const prev = window.__fliwyeeContent;
  if (prev && typeof prev.alive === 'function' && prev.alive()) return;

  const F = window.FliwyeeFormat; // lib/format.js
  const SITE = window.FliwyeeSites.pick(); // content/sites.js
  const ON_CLASS = 'fliwyee-on';
  const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
  const APOSTROPHES = "'’";

  let enabled = false;
  let sessionCount = 0;
  let settings = null; // prompts etc., from storage
  let lastCapture = null; // { id, type, text, context } of the last capture in this tab
  let ui = null; // { host, layer, pill, toast, hl, subs, fixed }
  let toastTimer = 0;
  let pressInCaption = false;
  let suppressClick = false;
  let lastMouse = null;
  let hlFrame = 0;
  let hlRecheck = 0;
  let replay = null;
  let contextGone = false;
  let ticker = 0; // keeps the layer and Fliwyee's own subtitles up to date while on
  const tracks = new Map(); // videoId -> { cues: [{start, end, text}], auto }

  // ---------- small helpers ----------

  const $player = () => SITE.player();
  const $video = () => SITE.video();
  const currentVideoId = () => SITE.videoId();
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
    return el ? el.closest(SITE.captionWindow) : null;
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
  const isShown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Text of one subtitle box, or (no box given) of all subtitle boxes on screen.
  function captionText(win) {
    if (win) return SITE.captionText(win);
    const root = (SITE.id === 'youtube' && $player()) || document;
    const boxes = Array.from(root.querySelectorAll(SITE.captionWindow)).filter(isShown);
    const outer = boxes.filter((b) => !boxes.some((o) => o !== b && o.contains(b)));
    return clean(outer.map((b) => SITE.captionText(b)).join(' '));
  }

  // Jump in the video. Netflix breaks when the time is changed directly, so there Fliwyee asks
  // Netflix's own player (page-hook.js does that inside the page).
  function seekTo(v, t) {
    const time = Math.max(0, t);
    if (SITE.seek === 'netflix') window.postMessage({ __fliwyee: 'netflix-seek', time }, location.origin);
    else v.currentTime = time;
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
    if (!parent || !parent.closest(SITE.textSelector)) return null;
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

  // ---------- subtitle timing ----------
  // From the subtitle file the player downloads (page-hook.js: YouTube, Netflix), or from the
  // video's own subtitle track (other websites).

  function decodeEntities(s) {
    return String(s)
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }

  // YouTube json3
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

  // TTML times: "12345t" (ticks), "1.5s", "00:01:02.345", "00:01:02:12" (frames)
  function ttmlTime(v, tickRate, frameRate) {
    const s = String(v || '').trim();
    let m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(s);
    if (m) {
      const n = parseFloat(m[1]);
      return { h: n * 3600, m: n * 60, s: n, ms: n / 1000, f: n / frameRate, t: n / tickRate }[m[2]];
    }
    m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(s);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? parseFloat(`0.${m[4]}`) : 0);
    m = /^(\d+):(\d{2}):(\d{2}):(\d+)$/.exec(s);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / frameRate;
    return NaN;
  }

  // YouTube srv3 / srv1, and TTML (Netflix and many others)
  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const rootEl = doc.documentElement;
    const cues = [];
    const textOfNode = (node) => {
      const copy = node.cloneNode(true);
      for (const br of Array.from(copy.getElementsByTagNameNS('*', 'br'))) br.replaceWith(' ');
      return clean(decodeEntities(copy.textContent));
    };
    if (rootEl && rootEl.localName === 'tt') {
      const attr = (name) => rootEl.getAttribute(`ttp:${name}`) || rootEl.getAttribute(name);
      const tickRate = parseFloat(attr('tickRate')) || 10000000;
      const frameRate = parseFloat(attr('frameRate')) || 30;
      for (const p of Array.from(doc.getElementsByTagNameNS('*', 'p'))) {
        const start = ttmlTime(p.getAttribute('begin'), tickRate, frameRate);
        let end = ttmlTime(p.getAttribute('end'), tickRate, frameRate);
        if (!Number.isFinite(end)) end = start + (ttmlTime(p.getAttribute('dur'), tickRate, frameRate) || 0);
        const text = textOfNode(p);
        if (text && Number.isFinite(start)) cues.push({ start, end, text });
      }
      return cues;
    }
    for (const p of Array.from(doc.getElementsByTagNameNS('*', 'p'))) {
      // srv3: <p t="ms" d="ms">
      const text = textOfNode(p);
      if (!text) continue;
      const start = (Number(p.getAttribute('t')) || 0) / 1000;
      cues.push({ start, end: start + (Number(p.getAttribute('d')) || 0) / 1000, text });
    }
    if (!cues.length) {
      for (const t of Array.from(doc.getElementsByTagNameNS('*', 'text'))) {
        // srv1: <text start="s" dur="s">
        const text = textOfNode(t);
        if (!text) continue;
        const start = Number(t.getAttribute('start')) || 0;
        cues.push({ start, end: start + (Number(t.getAttribute('dur')) || 0), text });
      }
    }
    return cues;
  }

  // WebVTT
  function vttTime(s) {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(String(s || '').trim());
    return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : NaN;
  }

  function parseVtt(text) {
    const cues = [];
    for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->').map((x) => x.trim().split(/\s+/)[0]);
      const start = vttTime(a);
      const end = vttTime(b);
      const body = clean(decodeEntities(lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '')));
      if (body && Number.isFinite(start)) cues.push({ start, end: Number.isFinite(end) ? end : start, text: body });
    }
    return cues;
  }

  function parseCaptions(body) {
    const trimmed = String(body || '').replace(/^﻿/, '').trimStart();
    let cues = [];
    if (trimmed.startsWith('{')) cues = parseJson3(JSON.parse(trimmed));
    else if (trimmed.startsWith('WEBVTT')) cues = parseVtt(trimmed);
    else if (trimmed.startsWith('<')) cues = parseXml(trimmed);
    return cues.sort((a, b) => a.start - b.start);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__fliwyee !== 'timedtext') return;
    try {
      const url = new URL(e.data.url, location.href);
      const cues = parseCaptions(e.data.body);
      if (!cues.length) return;
      const vid = (SITE.id === 'youtube' && url.searchParams.get('v')) || currentVideoId();
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

  // ---------- Fliwyee's own subtitle line (other websites) ----------
  // Some pages show subtitles in a way that can't be clicked (the browser draws them). There,
  // Fliwyee hides that drawing while capture is on and shows the same text itself, clickable.

  let ownTrack = null; // { track, prevMode } of the subtitle track whose drawing Fliwyee hid
  let ownKey = '';

  const cueText = (c) => clean(decodeEntities(String(c.text || '').replace(/<[^>]+>/g, '')));

  function subtitleTracks(v) {
    return Array.from((v && v.textTracks) || []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  }

  function pageCaptionsShown() {
    return Array.from(document.querySelectorAll(SITE.captionWindow)).some(
      (el) => !el.classList.contains('fliwyee-subs-line') && isShown(el) && clean(el.textContent)
    );
  }

  function restoreOwnTrack() {
    if (ownTrack) {
      try {
        ownTrack.track.mode = ownTrack.prevMode;
      } catch (_) {
        /* the track is gone */
      }
      ownTrack = null;
    }
    ownKey = '';
    if (ui && ui.subs) ui.subs.textContent = '';
  }

  function updateOwnSubtitles() {
    if (!SITE.ownSubtitles) return;
    const v = $video();
    const list = subtitleTracks(v);
    // timing for R and the saved minute: any track with its lines loaded
    const timing = list.find((t) => t.mode !== 'disabled' && t.cues && t.cues.length);
    if (timing) {
      const vid = currentVideoId();
      const known = tracks.get(vid);
      if (!known || known.from !== timing || known.count !== timing.cues.length) {
        const cues = Array.from(timing.cues)
          .map((c) => ({ start: c.startTime, end: c.endTime, text: cueText(c) }))
          .filter((c) => c.text)
          .sort((a, b) => a.start - b.start);
        tracks.set(vid, { cues, auto: false, from: timing, count: timing.cues.length });
      }
    }
    if (!enabled || !v || pageCaptionsShown()) return restoreOwnTrack();
    const showing = list.find((t) => t.mode === 'showing');
    if (showing) {
      if (ownTrack && ownTrack.track !== showing) restoreOwnTrack();
      ownTrack = { track: showing, prevMode: 'showing' };
      showing.mode = 'hidden'; // keeps its lines loaded, the browser just stops drawing them
    }
    const track = ownTrack && ownTrack.track;
    const u = ensureUi();
    if (!track || !u) return;
    const now = v.currentTime;
    const active = Array.from(track.cues || []).filter((c) => c.startTime <= now && now < c.endTime);
    const lines = active.flatMap((c) => cueText({ text: String(c.text || '').replace(/\n/g, '\u0000') }).split('\u0000'));
    const key = lines.join('\n');
    if (key === ownKey) return;
    ownKey = key;
    u.subs.textContent = '';
    for (const line of lines.map(clean).filter(Boolean)) {
      const div = document.createElement('div');
      const span = document.createElement('span');
      span.className = 'fliwyee-subs-line';
      span.lang = 'it';
      span.textContent = line;
      div.append(span);
      u.subs.append(div);
    }
  }

  // ---------- on-player UI: a layer with the pill, the message, the highlight ----------
  // YouTube: inside its player. Elsewhere: a layer that sits exactly over the video.

  function ensureUi() {
    const player = $player();
    const fixed = !player;
    const host = player || document.fullscreenElement || document.documentElement;
    if (fixed && !$video()) return null;
    if (ui && ui.host === host && host.contains(ui.layer)) {
      if (fixed) syncLayer();
      return ui;
    }
    if (ui) ui.layer.remove();
    const layer = document.createElement('div');
    layer.className = `fliwyee-layer${fixed ? ' fliwyee-layer-fixed' : ''}`;
    const make = (cls) => {
      const d = document.createElement('div');
      d.className = cls;
      layer.appendChild(d);
      return d;
    };
    ui = { host, layer, fixed, subs: make('fliwyee-subs'), pill: make('fliwyee-pill'), toast: make('fliwyee-toast'), hl: make('fliwyee-hl') };
    host.appendChild(layer);
    ownKey = '';
    // Clicks on the message (Undo, Ask AI) must not reach the player, or it would pause/play.
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) =>
      ui.toast.addEventListener(type, (e) => e.stopPropagation())
    );
    // Keep the message (and its buttons) while the mouse is on it.
    ui.toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    ui.toast.addEventListener('mouseleave', () => hideToastSoon(1200));
    if (fixed) syncLayer();
    updatePill();
    return ui;
  }

  // Keep the layer exactly over the video (scrolling, resizing, full screen).
  function syncLayer() {
    if (!ui || !ui.fixed) return;
    const v = $video();
    const s = ui.layer.style;
    if (!v) {
      s.display = 'none';
      return;
    }
    const r = v.getBoundingClientRect();
    s.display = r.width && r.height ? '' : 'none';
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
    s.setProperty('--fliwyee-subs-size', `${Math.round(Math.max(16, Math.min(42, r.height * 0.05)))}px`);
  }

  function tick() {
    if (!enabled) return;
    if (!$player() && ui && document.fullscreenElement && ui.host !== document.fullscreenElement) ensureUi();
    syncLayer();
    updateOwnSubtitles();
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
    const lr = u.layer.getBoundingClientRect();
    const s = u.hl.style;
    s.left = `${w.rect.left - lr.left - 2}px`;
    s.top = `${w.rect.top - lr.top}px`;
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
      site: SITE.id,
      videoId: currentVideoId(),
      title: SITE.title(),
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
      showToast('No subtitle on screen. Turn on the subtitles (CC).');
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
        showToast('Click a word first, or turn on the subtitles (CC).');
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
    // the sentence: all subtitle lines on screen when they are separate boxes (most players),
    // just this box on YouTube (one box holds the whole line there)
    const sentence = SITE.id === 'youtube' ? captionText(win) : captionText(null) || captionText(win);
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

  // N: edit the last capture (its text, sentence and your note) in the side panel.
  // Nothing opens unless you press N.
  async function openEditor() {
    if (!lastCapture || !lastCapture.id) {
      showToast('Capture a word first, then press N to add a note.');
      return;
    }
    const res = await send({ type: 'openEditor', id: lastCapture.id });
    if (!res || res.status === 'gone') return;
    if (res.status === 'error') showToast('Could not open the editor. Use ✎ in the side panel.');
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
    seekTo(v, start);
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
    // Netflix jumps a moment later (through its own player), so give it a little longer.
    replay.timer = setTimeout(check, SITE.seek === 'netflix' ? 400 : 30);

    if (i < 0) showToast('↺ Last 3 seconds (subtitle timing not loaded yet)');
    else if (slow) showToast('↺ Slow replay 0.75×');
  }

  // ---------- events ----------

  // Mouse presses on the subtitles are ours while capture is on:
  // the player must not drag the subtitle box or pause the video.
  // After Fliwyee is updated or removed, this copy in an already-open tab is cut off from the
  // extension. It then switches itself off so the page works normally until you reload.
  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };
  window.__fliwyeeContent = { alive };

  let retired = false;
  function retire() {
    if (retired) return;
    retired = true;
    enabled = false;
    stopReplay();
    clearInterval(ticker);
    restoreOwnTrack();
    for (const [type, fn] of LISTENERS) window.removeEventListener(type, fn, true);
    if (ui) ui.layer.remove();
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
    } else if (noMods && !e.shiftKey && key === 'n') {
      block(e, true);
      openEditor();
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
  document.addEventListener('fullscreenchange', () => enabled && ensureUi());

  // ---------- on/off state ----------

  const visible = () => document.visibilityState === 'visible';

  function applyEnabled(on, announce) {
    enabled = on;
    if (document.documentElement) document.documentElement.classList.toggle(ON_CLASS, on);
    clearInterval(ticker);
    if (on) {
      ensureUi();
      if (!$player()) ticker = setInterval(tick, 250); // other websites: follow the video, own subtitles
      tick();
    } else {
      hideHighlight();
      stopReplay();
      restoreOwnTrack();
    }
    if (!announce || !visible()) return;
    if (on) showToast('Fliwyee ON · click a word · drag a phrase · S line · R replay · Q ask AI', { ms: 3000 });
    else if (sessionCount) showToast(`Fliwyee paused · the session keeps going (${F.plural(sessionCount)})`);
    else showToast('Fliwyee paused');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || retired) return;
    if (changes.current) {
      const cur = changes.current.newValue;
      sessionCount = cur && cur.items ? cur.items.length : 0;
      updatePill();
    }
    if (changes.settings) settings = changes.settings.newValue || null;
    if (changes.enabled) applyEnabled(!!changes.enabled.newValue, true);
    // The session was ended (Ctrl+Shift+E or the side panel).
    const saved = changes.lastSaved && changes.lastSaved.newValue;
    if (saved && changes.current && !changes.current.newValue && visible() && $video()) {
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
    if (!msg || retired) return false;
    if (msg.type === 'ping') {
      sendResponse({ ok: true, site: SITE.id });
      return false;
    }
    if (msg.type !== 'seek') return false;
    const v = $video();
    if (v && currentVideoId() === msg.videoId) {
      stopReplay();
      seekTo(v, Number(msg.time) || 0);
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
      sendResponse({ ok: true });
    } else sendResponse({ ok: false });
    return false;
  });

  chrome.storage.local.get({ enabled: false, current: null, settings: null }).then((st) => {
    sessionCount = st.current && st.current.items ? st.current.items.length : 0;
    settings = st.settings;
    // Added to this page by Ctrl+Shift+X (other websites): say so.
    applyEnabled(!!st.enabled, !!window.__fliwyeeAnnounce);
    window.__fliwyeeAnnounce = false;
  });
})();
