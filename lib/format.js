// Shared helpers: notebooks (one per video), tags, the notebook file, AI prompts, times and links.
// Loaded by the background worker, the content script on video pages and the side panel.
//
// Notebook = { id, site, videoId, title, auto, created, updated, days: ['2026-11-20', ...],
//              lines: Line[], filename?, downloadId?, savedAt?, dirty?, lastLineId?, lastCaptureAt? }
// Line     = { id, at, time, sentence, words: [{ text, note }], tags: ['word', ...], note }
// One line per sentence: the words you click in it are added to that line.
(function (root) {
  'use strict';

  const FOLDER = 'italian-subtitles';
  const VERSION = '0.5.0';
  const NB_PREFIX = 'nb:'; // storage key of a notebook: nb:<id>
  const SITES = ['youtube', 'netflix', 'web'];

  // AI chats Fliwyee can send a prompt to. The most recently used open one wins.
  const AI_SITES = [
    { id: 'chatgpt', name: 'ChatGPT', match: 'https://chatgpt.com/*', newUrl: 'https://chatgpt.com/' },
    { id: 'claude', name: 'Claude', match: 'https://claude.ai/*', newUrl: 'https://claude.ai/new' },
    { id: 'gemini', name: 'Gemini', match: 'https://gemini.google.com/*', newUrl: 'https://gemini.google.com/app' },
  ];

  // Tags. A click or a drag always adds "Word"; S always adds "Sentence / idiom".
  // On the video, keys 1-4 switch a tag on or off for the last capture.
  const TAGS = [
    { id: 'word', label: 'Word', key: '1' },
    { id: 'sentence', label: 'Sentence / idiom', key: '2' },
    { id: 'grammar', label: 'Grammar structure', key: '3' },
    { id: 'listening', label: 'Listening', key: '4' },
  ];
  const TAG_IDS = TAGS.map((t) => t.id);
  const tagLabel = (id) => (TAGS.find((t) => t.id === id) || { label: id }).label;

  const DEFAULT_SETTINGS = {
    ai: 'chatgpt',
    prompts: {
      word:
        'I\'m learning Italian. Explain "{text}" as it is used in this sentence:\n{sentence}\n\n' +
        'Give the English meaning, the base form, and one more example sentence.',
      sentence:
        "I'm learning Italian. Explain this sentence:\n{sentence}\n\n" +
        'Translate it into English and explain the grammar and any expressions in it.',
      notebook:
        "I'm learning Italian. For each line below, explain the words after the arrow as they are used in " +
        'their sentence (English meaning, base form, one more example). For lines without an arrow, ' +
        'translate the sentence and explain it.\n\n{items}',
    },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s || '').toLocaleLowerCase('it').replace(/\s+/g, ' ').trim();
  const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const noteStr = (v) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, 4000);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // 754 -> "12:34", 3754 -> "1:02:34"
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  // "12:34" / "1:02:34" -> seconds
  function parseTime(s) {
    const parts = String(s || '').trim().split(':').map(Number);
    if (!parts.length || parts.some((p) => !Number.isFinite(p))) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  // 2026-11-20 (local time): one practice day
  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // "2026-11-20" -> "Fri 20 Nov 2026"
  function dayLabel(day) {
    const [y, m, d] = String(day).split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    return `${date.toLocaleDateString('en-GB', { weekday: 'short' })} ${date.getDate()} ${date.toLocaleDateString('en-GB', { month: 'short' })} ${y}`;
  }

  // "Fri 20 Nov 2026, 15:30"
  function dateLabel(ms) {
    const d = new Date(ms);
    return `${dayLabel(dayKey(ms))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const plural = (n, word) => `${n} ${word || 'line'}${n === 1 ? '' : 's'}`;

  // ---------- notebooks ----------

  const notebookId = (site, videoId) => `${SITES.includes(site) ? site : 'youtube'}:${videoId || ''}`;
  const storageKey = (id) => `${NB_PREFIX}${id}`;

  function newNotebook({ site, videoId, title, created }) {
    const at = created || Date.now();
    return {
      id: notebookId(site, videoId),
      site: SITES.includes(site) ? site : 'youtube',
      videoId: videoId || '',
      title: title || '',
      auto: false,
      created: at,
      updated: at,
      days: [dayKey(at)],
      lines: [],
      filename: null,
      dirty: true,
    };
  }

  // A file name Windows and Chrome accept: no \ / : * ? " < > | ~ or invisible characters.
  const safeName = (s) =>
    String(s || '')
      .replace(/[\p{Cc}\p{Cf}<>:"/\\|?*~]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
      .replace(/^[.\s]+|[.\s]+$/g, '');

  // "italian-subtitles/<one plain file name>.html": the only kind of path Fliwyee writes to
  const validFilename = (f) =>
    typeof f === 'string' &&
    f.startsWith(`${FOLDER}/`) &&
    !f.includes('..') &&
    /^[^/\\:*?"<>|~\p{Cc}\p{Cf}]+\.html?$/iu.test(f.slice(FOLDER.length + 1));

  // Downloads/italian-subtitles/2026-11-20 - Italiano facile, episodio 1.html
  // (the day you first practiced with the video, then its name)
  function notebookFilename(nb) {
    return `${FOLDER}/${dayKey(nb.created || Date.now())} - ${safeName(nb.title) || 'Video'}.html`;
  }

  const sortLines = (lines) => (lines || []).slice().sort((a, b) => a.time - b.time || a.at - b.at);
  const hasTag = (line, tag) => !tag || (line.tags || []).includes(tag);

  // The line for this sentence: the same sentence, or (auto subtitles, where the text on screen
  // changes while it scrolls) a longer or shorter version of it from about the same moment.
  function findLine(nb, sentence, time) {
    const key = norm(sentence);
    if (!key) return null;
    const same = nb.lines.find((l) => norm(l.sentence) === key);
    if (same || key.length < 12) return same || null;
    return (
      nb.lines.find((l) => {
        const k = norm(l.sentence);
        return k.length >= 12 && (k.includes(key) || key.includes(k)) && Math.abs((l.time || 0) - (time || 0)) <= 20;
      }) || null
    );
  }

  function normalizeWords(list) {
    const out = [];
    for (const w of Array.isArray(list) ? list : []) {
      const word = typeof w === 'string' ? { text: str(w, 500), note: '' } : { text: str(w && w.text, 500), note: noteStr(w && w.note) };
      if (word.text && !out.some((o) => norm(o.text) === norm(word.text))) out.push(word);
    }
    return out;
  }

  const normalizeTags = (list) => TAG_IDS.filter((t) => (Array.isArray(list) ? list : []).includes(t));

  function normalizeLine(raw) {
    const r = raw || {};
    return {
      id: str(r.id, 60) || uid('l'),
      at: num(r.at) || Date.now(),
      time: Math.max(0, Math.floor(num(r.time))),
      sentence: str(r.sentence, 1000),
      words: normalizeWords(r.words),
      tags: normalizeTags(r.tags),
      note: noteStr(r.note),
    };
  }

  // Check a notebook that comes from storage or from a file.
  function normalizeNotebook(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const site = SITES.includes(raw.site) ? raw.site : 'youtube';
    const videoId = str(raw.videoId, 2000);
    const created = num(raw.created) || Date.now();
    const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(normalizeLine).filter((l) => l.sentence || l.words.length);
    const ids = new Set();
    for (const l of lines) {
      if (ids.has(l.id)) l.id = uid('l');
      ids.add(l.id);
    }
    const days = Array.from(new Set((Array.isArray(raw.days) ? raw.days : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort();
    return {
      id: notebookId(site, videoId),
      site,
      videoId,
      title: str(raw.title, 300),
      auto: !!raw.auto,
      created,
      updated: num(raw.updated) || created,
      days: days.length ? days : [dayKey(created)],
      lines,
      filename: validFilename(raw.filename) ? raw.filename : null,
      downloadId: Number.isInteger(raw.downloadId) ? raw.downloadId : undefined,
      savedAt: num(raw.savedAt) || undefined,
      dirty: raw.dirty !== false,
      lastLineId: raw.lastLineId || undefined,
      lastCaptureAt: num(raw.lastCaptureAt) || undefined,
    };
  }

  // Two notes: keep both, unless one already contains the other.
  function mergeText(a, b) {
    const x = noteStr(a);
    const y = noteStr(b);
    if (!y || x.includes(y)) return x;
    if (!x || y.includes(x)) return y;
    return `${x}\n${y}`;
  }

  // Add one notebook's lines to another (loading a file, or older Fliwyee data). Nothing is
  // dropped: same sentences are joined, with all their words, tags and notes.
  function mergeNotebook(target, incoming) {
    let added = 0;
    let merged = 0;
    for (const src of incoming.lines) {
      let line = target.lines.find((l) => l.id === src.id) || findLine(target, src.sentence, src.time);
      if (!line && !src.sentence) {
        line = target.lines.find((l) => !l.sentence && l.words.some((w) => src.words.some((v) => norm(v.text) === norm(w.text))));
      }
      if (!line) {
        const copy = normalizeLine(src);
        if (target.lines.some((l) => l.id === copy.id)) copy.id = uid('l');
        target.lines.push(copy);
        added++;
        continue;
      }
      merged++;
      if (norm(src.sentence).length > norm(line.sentence).length && norm(src.sentence).includes(norm(line.sentence))) {
        line.sentence = src.sentence;
      }
      for (const w of src.words) {
        const have = line.words.find((x) => norm(x.text) === norm(w.text));
        if (have) have.note = mergeText(have.note, w.note);
        else line.words.push({ text: w.text, note: w.note || '' });
      }
      line.tags = normalizeTags(line.tags.concat(src.tags));
      line.note = mergeText(line.note, src.note);
      line.time = Math.min(line.time, src.time);
    }
    target.days = Array.from(new Set(target.days.concat(incoming.days))).sort();
    target.title = target.title || incoming.title;
    target.auto = target.auto || incoming.auto;
    target.created = Math.min(target.created, incoming.created);
    return { added, merged };
  }

  // ---------- links ----------

  // site: 'youtube' (default), 'netflix', or 'web' (any other website: videoId is the page
  // address, and there's no general way to link to a moment in it)
  function videoUrl(videoId, site) {
    if (!videoId) return '';
    if (site === 'netflix') return `https://www.netflix.com/watch/${encodeURIComponent(videoId)}`;
    if (site === 'web') return /^https?:\/\//.test(videoId) ? videoId : '';
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  function watchUrl({ videoId, site, time }) {
    const t = Math.max(0, Math.floor(time || 0));
    const base = videoUrl(videoId, site);
    if (!base || site === 'web') return base;
    return site === 'netflix' ? `${base}?t=${t}` : `${base}&t=${t}s`;
  }

  // A link from an older Fliwyee file -> { site, videoId }
  function parseVideoUrl(href) {
    try {
      const u = new URL(href);
      if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
        const v = u.searchParams.get('v') || (u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/) || [])[1];
        if (v) return { site: 'youtube', videoId: v };
      }
      if (u.hostname === 'youtu.be') return { site: 'youtube', videoId: u.pathname.slice(1) };
      if (/(^|\.)netflix\.com$/.test(u.hostname)) {
        const m = u.pathname.match(/\/watch\/(\d+)/);
        if (m) return { site: 'netflix', videoId: m[1] };
      }
      return { site: 'web', videoId: u.origin + u.pathname + u.search };
    } catch (_) {
      return { site: 'web', videoId: '' };
    }
  }

  const SITE_NAMES = { youtube: 'YouTube video', netflix: 'Netflix', web: 'Video' };
  const nbTitle = (nb) => nb.title || SITE_NAMES[nb.site] || 'Video';

  // ---------- text ----------

  const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' / ').trim();

  // "0:03  Non posso fare a meno di te.  →  fare a meno di   [Word, Sentence / idiom]"
  function lineText(line, withTime, withTags) {
    const words = line.words.map((w) => w.text).join(', ');
    let body;
    if (!line.sentence) body = words;
    else body = words ? `${line.sentence}  →  ${words}` : line.sentence;
    const tags = withTags && line.tags.length ? `   [${line.tags.map(tagLabel).join(', ')}]` : '';
    return `${withTime ? `${fmtTime(line.time)}  ` : ''}${body}${tags}`;
  }

  // The notes under a line: "      fare a meno di: to do without" and "      note: ..."
  function lineNotes(line) {
    const out = [];
    for (const w of line.words) if (w.note) out.push(`      ${w.text}: ${oneLine(w.note)}`);
    if (line.note) out.push(`      note: ${oneLine(line.note)}`);
    return out;
  }

  const lineBlock = (line) => [lineText(line, true, true), ...lineNotes(line)].join('\n');

  function notebookHeader(nb, filterLabel) {
    const out = [nbTitle(nb)];
    const url = videoUrl(nb.videoId, nb.site);
    if (url) out.push(url);
    out.push(`Practiced: ${nb.days.map(dayLabel).join(', ')}`);
    if (filterLabel) out.push(`Showing: ${filterLabel}`);
    return out.join('\n');
  }

  // The whole notebook (or the lines you're looking at) as plain text, to paste anywhere.
  function notebookText(nb, lines, filterLabel) {
    const list = lines || sortLines(nb.lines);
    return `${notebookHeader(nb, filterLabel)}\n\n${list.map(lineBlock).join('\n')}\n`;
  }

  // ---------- HTML ----------

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Where these words are in the sentence: [[start, end], ...], whole words only.
  function wordRanges(sentence, words) {
    const ranges = [];
    for (const w of words.slice().sort((a, b) => b.length - a.length)) {
      if (!w) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'giu');
      for (const m of sentence.matchAll(re)) {
        const a = m.index;
        const b = a + m[0].length;
        if (!ranges.some((r) => a < r[1] && b > r[0])) ranges.push([a, b]);
      }
    }
    return ranges.sort((x, y) => x[0] - y[0]);
  }

  // The sentence as HTML with these words wrapped in <mark> (or another tag).
  function markWords(sentence, words, tag) {
    const t = tag || 'mark';
    let out = '';
    let pos = 0;
    for (const [a, b] of wordRanges(sentence, words)) {
      out += `${esc(sentence.slice(pos, a))}<${t}>${esc(sentence.slice(a, b))}</${t}>`;
      pos = b;
    }
    return out + esc(sentence.slice(pos));
  }

  // What a click copies: the sentence with the clicked word in bold.
  //   plain: "Non posso **fare a meno di** te."   (AI chats read ** as "this part")
  //   html:  "Non posso <b>fare a meno di</b> te." (Word, Google Docs, email)
  function boldCopy(sentence, word) {
    const s = String(sentence || '').trim();
    const w = String(word || '').trim();
    if (!s || !w || norm(s) === norm(w)) return { plain: s || w, html: esc(s || w) };
    const [first] = wordRanges(s, [w]);
    if (!first) return { plain: `${s}\n(**${w}**)`, html: `${esc(s)}<br>(<b>${esc(w)}</b>)` };
    const [a, b] = first;
    return {
      plain: `${s.slice(0, a)}**${s.slice(a, b)}**${s.slice(b)}`,
      html: `${esc(s.slice(0, a))}<b>${esc(s.slice(a, b))}</b>${esc(s.slice(b))}`,
    };
  }

  const HTML_STYLE = `
:root{color-scheme:light dark;--bg:#fff;--text:#1d1f21;--muted:#6b7075;--line:#e3e5e8;--accent:#008c45;--mark:#ffe98a;--chip:#eceef0;
--t-word:#dbe9ff;--t-word-x:#1d4f9c;--t-sentence:#efe0ff;--t-sentence-x:#6326a0;--t-grammar:#ffe6cc;--t-grammar-x:#8a4500;--t-listening:#d6f3ec;--t-listening-x:#0b6650}
@media (prefers-color-scheme:dark){:root{--bg:#1b1c1e;--text:#e9eaec;--muted:#9a9fa5;--line:#34363a;--accent:#2fb36d;--mark:#6b5600;--chip:#303236;
--t-word:#1e3352;--t-word-x:#a9c8ff;--t-sentence:#3a2652;--t-sentence-x:#d9b8ff;--t-grammar:#4a3115;--t-grammar-x:#ffc98f;--t-listening:#15403a;--t-listening-x:#8fe3cf}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:800px;margin:0 auto;padding:28px 16px 56px}
.kicker{margin:0;color:var(--accent);font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
h1{margin:2px 0 0;font-size:25px;line-height:1.25}
h1 a{color:inherit;text-decoration:none}
h1 a:hover{text-decoration:underline}
.sub{margin:6px 0 0;color:var(--muted);font-size:14px}
.bar{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:18px 0 4px;padding:10px 0;border-bottom:1px solid var(--line);background:var(--bg)}
.filters{display:flex;flex-wrap:wrap;gap:6px}
.chip,.bar button{padding:4px 11px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:inherit;cursor:pointer;font:600 13px system-ui,sans-serif}
.chip span{margin-left:4px;color:var(--muted);font-weight:500}
.chip[aria-pressed=true]{border-color:var(--accent);background:var(--accent);color:#fff}
.chip[aria-pressed=true] span{color:inherit}
.bar input{flex:1 1 140px;min-width:120px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:inherit;font:14px system-ui,sans-serif}
#copy{margin-left:auto;border-color:var(--accent);color:var(--accent)}
ol{margin:0;padding:0;list-style:none}
#lines>li{display:grid;grid-template-columns:4.4em 1fr;gap:2px 12px;padding:12px 0;border-bottom:1px solid var(--line)}
.time{color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums;text-decoration:none}
a.time:hover{text-decoration:underline}
mark{padding:0 2px;border-radius:3px;background:var(--mark);color:inherit}
.words{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px;font-size:15px}
.word{padding:1px 9px;border-radius:999px;background:var(--chip);font-weight:600}
.wnote{margin-left:6px;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.tag{padding:0 8px;border-radius:5px;font-size:12px;font-weight:600}
.t-word{background:var(--t-word);color:var(--t-word-x)}
.t-sentence{background:var(--t-sentence);color:var(--t-sentence-x)}
.t-grammar{background:var(--t-grammar);color:var(--t-grammar-x)}
.t-listening{background:var(--t-listening);color:var(--t-listening-x)}
.t-auto{background:var(--chip);color:var(--muted);font-weight:500}
.note{margin-top:6px;padding-left:10px;border-left:3px solid var(--accent);color:var(--muted);font-size:15px;white-space:pre-line}
#none{color:var(--muted)}
footer{margin-top:32px;color:var(--muted);font-size:13px}`;

  // Filter by tag, search, Copy all (copies what you see, as plain text). Runs inside the file.
  const HTML_SCRIPT = `(function(){
var list=document.getElementById('lines');var items=Array.prototype.slice.call(list.children);
var chips=Array.prototype.slice.call(document.querySelectorAll('.chip'));var q=document.getElementById('q');
var copy=document.getElementById('copy');var none=document.getElementById('none');var tag='';
function apply(){var s=(q.value||'').toLowerCase().trim();var n=0;
items.forEach(function(li){var ok=(!tag||(' '+li.getAttribute('data-tags')+' ').indexOf(' '+tag+' ')>=0)&&(!s||li.textContent.toLowerCase().indexOf(s)>=0);li.hidden=!ok;if(ok)n++;});
none.hidden=n>0;chips.forEach(function(c){c.setAttribute('aria-pressed',String(c.getAttribute('data-tag')===tag));});
copy.textContent=(tag||s)?'Copy these':'Copy all';}
chips.forEach(function(c){c.addEventListener('click',function(){var t=c.getAttribute('data-tag');tag=(t&&tag===t)?'':t;apply();});});
q.addEventListener('input',apply);
function fallback(text){var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();var ok=false;try{ok=document.execCommand('copy');}catch(e){}ta.remove();return ok;}
copy.addEventListener('click',function(){var label=tag?chips.filter(function(c){return c.getAttribute('data-tag')===tag;})[0].getAttribute('data-label'):'';
var head=list.getAttribute('data-head')+(label?'\\nShowing: '+label:'');var parts=[];
items.forEach(function(li){if(!li.hidden)parts.push(li.getAttribute('data-text'));});var text=head+'\\n\\n'+parts.join('\\n')+'\\n';
var old=copy.textContent;var done=function(ok){copy.textContent=ok?'Copied ✓':'Could not copy';setTimeout(function(){copy.textContent=old;},1500);};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){done(true);},function(){done(fallback(text));});else done(fallback(text));});
apply();})();`;

  // The notebook file: a small web page. Every minute is a link to that moment in the video
  // (all links open in the same tab). Tags filter it; Copy all copies it as plain text.
  // A full copy of the notebook is kept inside it, so Fliwyee can load it back exactly.
  function notebookHtml(nb) {
    const lines = sortLines(nb.lines);
    const title = nbTitle(nb);
    const home = videoUrl(nb.videoId, nb.site);
    const count = (tag) => lines.filter((l) => hasTag(l, tag)).length;
    const chips = [`<button type="button" class="chip" data-tag="" data-label="">All<span>${lines.length}</span></button>`]
      .concat(
        TAGS.map(
          (t) =>
            `<button type="button" class="chip" data-tag="${t.id}" data-label="${esc(t.label)}">${esc(t.label)}<span>${count(t.id)}</span></button>`
        )
      )
      .join('');
    const rows = lines.map((line) => {
      const t = fmtTime(line.time);
      const tip = nb.site === 'web' ? `Open the page (the moment is at ${t})` : `Play from ${t}`;
      const time = home
        ? `<a class="time" href="${esc(watchUrl({ videoId: nb.videoId, site: nb.site, time: line.time }))}" target="fliwyee-video" title="${tip}">${t}</a>`
        : `<span class="time">${t}</span>`;
      const words = line.words.map((w) => w.text);
      const sentence = line.sentence ? `<div class="sentence" lang="it">${markWords(line.sentence, words)}</div>` : '';
      const wordList = line.words.length
        ? `<div class="words">${line.words
            .map((w) => `<span><span class="word" lang="it">${esc(w.text)}</span>${w.note ? `<span class="wnote">${esc(w.note)}</span>` : ''}</span>`)
            .join('')}</div>`
        : '';
      const tags = line.tags.length
        ? `<div class="tags">${line.tags.map((id) => `<span class="tag t-${id}">${esc(tagLabel(id))}</span>`).join('')}</div>`
        : '';
      const note = line.note ? `<div class="note">${esc(line.note)}</div>` : '';
      return `<li data-tags="${line.tags.join(' ')}" data-text="${esc(lineBlock(line))}">${time}<div>${sentence}${wordList}${tags}${note}</div></li>`;
    });
    const data = {
      fliwyee: 1,
      version: VERSION,
      notebook: { ...nb, lines, downloadId: undefined, dirty: undefined, savedAt: undefined },
    };
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    const auto = nb.auto ? ' · <span class="tag t-auto" title="The text may contain mistakes">auto subtitles</span>' : '';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Fliwyee ${VERSION}">
<title>${esc(title)} · Fliwyee</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<main>
<p class="kicker">Fliwyee notebook</p>
<h1>${home ? `<a href="${esc(home)}" target="fliwyee-video">${esc(title)}</a>` : esc(title)}</h1>
<p class="sub">Practiced ${nb.days.map(dayLabel).join(', ')} · ${plural(lines.length)}${auto} · click a minute to hear it again</p>
<div class="bar"><div class="filters" role="group" aria-label="Show only">${chips}</div><input id="q" type="search" placeholder="Search" aria-label="Search"><button type="button" id="copy">Copy all</button></div>
<ol id="lines" data-head="${esc(notebookHeader(nb))}">
${rows.join('\n')}
</ol>
<p id="none" hidden>Nothing here with this tag or search.</p>
<footer>Made with Fliwyee ${VERSION}. To keep working on this notebook, open Fliwyee's side panel and use <b>Load notebook file</b>.</footer>
</main>
<script type="application/json" id="fliwyee-data">${json}</script>
<script>${HTML_SCRIPT}</script>
</body>
</html>
`;
  }

  // Read a notebook file back (needs DOMParser: the side panel). Also reads the older
  // Fliwyee 0.4 session pages, which can hold several videos. Returns a list of notebooks.
  function readNotebookFile(text, fileDate) {
    const doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
    const data = doc.getElementById('fliwyee-data');
    if (data) {
      const obj = JSON.parse(data.textContent);
      const nb = normalizeNotebook(obj && obj.notebook ? obj.notebook : obj);
      return nb ? [nb] : [];
    }
    const created = fileDate || Date.now();
    const out = [];
    for (const sec of Array.from(doc.querySelectorAll('main section'))) {
      const h2 = sec.querySelector('h2');
      const a = h2 && h2.querySelector('a');
      const { site, videoId } = parseVideoUrl(a ? a.getAttribute('href') : '');
      const title = str(a ? a.textContent : h2 ? h2.firstChild && h2.firstChild.textContent : '', 300);
      const nb = newNotebook({ site, videoId, title, created });
      nb.auto = !!(h2 && /auto/i.test(Array.from(h2.querySelectorAll('.tag')).map((t) => t.textContent).join(' ')));
      for (const li of Array.from(sec.querySelectorAll('ol > li'))) {
        const timeEl = li.querySelector('.time');
        const sentenceEl = li.querySelector('.sentence');
        const words = Array.from(li.querySelectorAll('.word')).map((w) => ({ text: str(w.textContent, 500), note: '' }));
        const line = normalizeLine({
          time: parseTime(timeEl ? timeEl.textContent : ''),
          sentence: sentenceEl ? sentenceEl.textContent : '',
          words,
          tags: [words.length ? 'word' : 'sentence'],
          at: created,
        });
        for (const div of Array.from(li.querySelectorAll('.notes > div'))) {
          const b = div.querySelector('b');
          const label = b ? str(b.textContent, 500) : '';
          const note = noteStr(b ? div.textContent.slice(div.textContent.indexOf(b.textContent) + b.textContent.length).replace(/^\s*·\s*/, '') : div.textContent);
          const word = label && line.words.find((w) => norm(w.text) === norm(label));
          if (word) word.note = mergeText(word.note, note);
          else line.note = mergeText(line.note, label ? `${label}: ${note}` : note);
        }
        if (line.sentence || line.words.length) nb.lines.push(line);
      }
      if (nb.lines.length) out.push(nb);
    }
    return out;
  }

  // ---------- AI prompts ----------

  function mergedSettings(s) {
    const src = s || {};
    const given = src.prompts || {};
    const prompts = { ...DEFAULT_SETTINGS.prompts };
    for (const k of Object.keys(prompts)) {
      const p = k === 'notebook' ? given.notebook || given.session : given[k]; // "session": Fliwyee 0.4
      if (typeof p === 'string' && p.trim()) prompts[k] = p;
    }
    return { ai: AI_SITES.some((a) => a.id === src.ai) ? src.ai : DEFAULT_SETTINGS.ai, prompts };
  }

  const fill = (template, vars) => String(template).replace(/\{(text|sentence|items)\}/g, (_, k) => vars[k] || '');

  // A capture: { kind: 'word'|'phrase'|'sentence', text, sentence }
  function itemPrompt(item, settings) {
    const { prompts } = mergedSettings(settings);
    if (item.kind === 'sentence' || !item.sentence) return fill(prompts.sentence, { text: item.text, sentence: item.sentence || item.text });
    return fill(prompts.word, { text: item.text, sentence: item.sentence });
  }

  // A line in the notes: about its words, or the sentence when it has none.
  function linePrompt(line, settings) {
    const words = line.words.map((w) => w.text).join(', ');
    if (!words) return itemPrompt({ kind: 'sentence', text: line.sentence, sentence: line.sentence }, settings);
    return itemPrompt({ kind: 'word', text: words, sentence: line.sentence || words }, settings);
  }

  function notebookPrompt(lines, settings) {
    const { prompts } = mergedSettings(settings);
    return fill(prompts.notebook, { items: lines.map((l) => lineText(l, false, false)).join('\n') });
  }

  function aiSiteForUrl(url) {
    return AI_SITES.find((a) => String(url || '').startsWith(a.match.replace('*', ''))) || null;
  }

  root.FliwyeeFormat = {
    FOLDER,
    VERSION,
    NB_PREFIX,
    AI_SITES,
    TAGS,
    TAG_IDS,
    DEFAULT_SETTINGS,
    tagLabel,
    norm,
    uid,
    plural,
    fmtTime,
    parseTime,
    dayKey,
    dayLabel,
    dateLabel,
    notebookId,
    storageKey,
    newNotebook,
    notebookFilename,
    validFilename,
    sortLines,
    hasTag,
    findLine,
    normalizeLine,
    normalizeNotebook,
    mergeNotebook,
    mergeText,
    videoUrl,
    watchUrl,
    parseVideoUrl,
    nbTitle,
    lineText,
    notebookText,
    markWords,
    boldCopy,
    notebookHtml,
    readNotebookFile,
    mergedSettings,
    itemPrompt,
    linePrompt,
    notebookPrompt,
    aiSiteForUrl,
  };
})(typeof self !== 'undefined' ? self : this);
