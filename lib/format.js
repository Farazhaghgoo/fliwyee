// Shared helpers: the session file layout, AI prompts, times and links.
// Loaded by the background worker, the YouTube content script and the side panel.
(function (root) {
  'use strict';

  const FOLDER = 'italian-subtitles';

  // AI chats Fliwyee can send a prompt to. The most recently used open one wins.
  const AI_SITES = [
    { id: 'chatgpt', name: 'ChatGPT', match: 'https://chatgpt.com/*', newUrl: 'https://chatgpt.com/' },
    { id: 'claude', name: 'Claude', match: 'https://claude.ai/*', newUrl: 'https://claude.ai/new' },
    { id: 'gemini', name: 'Gemini', match: 'https://gemini.google.com/*', newUrl: 'https://gemini.google.com/app' },
  ];

  const DEFAULT_SETTINGS = {
    ai: 'chatgpt',
    prompts: {
      word:
        'I\'m learning Italian. Explain "{text}" as it is used in this sentence:\n{sentence}\n\n' +
        'Give the English meaning, the base form, and one more example sentence.',
      sentence:
        "I'm learning Italian. Explain this sentence:\n{sentence}\n\n" +
        'Translate it into English and explain the grammar and any expressions in it.',
      session:
        "I'm learning Italian. For each line below, explain the words after the arrow as they are used in " +
        'their sentence (English meaning, base form, one more example). For lines without an arrow, ' +
        'translate the sentence and explain it.\n\n{items}',
    },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s || '').toLocaleLowerCase('it').replace(/\s+/g, ' ').trim();

  // 754 -> "12:34", 3754 -> "1:02:34"
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  // 2026-11-19_15-30 (local time), used in file names
  function stamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  }

  // "Thu 19 Nov 2026, 15:30"
  function dateLabel(ms) {
    const d = new Date(ms);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const month = d.toLocaleDateString('en-GB', { month: 'short' });
    return `${day} ${d.getDate()} ${month} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const plural = (n) => `${n} item${n === 1 ? '' : 's'}`;

  // Downloads/italian-subtitles/fliwyee_<start>.html (and .txt)
  function sessionFilename(session, ext) {
    return `${FOLDER}/fliwyee_${stamp(session.startedAt)}.${ext || 'html'}`;
  }

  const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' / ').trim();

  // Links. item.site: 'youtube' (default), 'netflix', or 'web' (any other website: videoId is
  // the page address, and there's no general way to link to a moment in it).
  function videoUrl(videoId, site) {
    if (site === 'netflix') return `https://www.netflix.com/watch/${encodeURIComponent(videoId)}`;
    if (site === 'web') return /^https?:\/\//.test(videoId) ? videoId : '';
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  function watchUrl(item) {
    const t = Math.max(0, Math.floor(item.time || 0));
    const base = videoUrl(item.videoId, item.site);
    if (item.site === 'netflix') return `${base}?t=${t}`;
    if (item.site === 'web') return base;
    return `${base}&t=${t}s`;
  }

  const SITE_NAMES = { youtube: 'YouTube video', netflix: 'Netflix', web: 'Video' };

  // Group a session: videos (in the order you first captured from them) -> sentences (in video
  // order) -> the words and phrases you took from each sentence.
  function groupSession(session) {
    const videos = [];
    const byVideo = new Map();
    for (const it of (session && session.items) || []) {
      const vid = it.videoId || '';
      const site = it.site || 'youtube';
      let v = byVideo.get(`${site}|${vid}`);
      if (!v) {
        v = { videoId: vid, site, title: it.title || '', auto: false, lines: [], byLine: new Map() };
        byVideo.set(`${site}|${vid}`, v);
        videos.push(v);
      }
      if (!v.title && it.title) v.title = it.title;
      if (it.auto) v.auto = true;
      const sentence = it.type === 'sentence' ? it.text : it.context || '';
      const key = norm(sentence) || `#${it.id}`; // no sentence: its own line
      let line = v.byLine.get(key);
      if (!line) {
        line = { sentence, time: it.time || 0, words: [], notes: [] };
        v.byLine.set(key, line);
        v.lines.push(line);
      }
      line.time = Math.min(line.time, it.time || 0);
      if (it.type !== 'sentence' && !line.words.includes(it.text)) line.words.push(it.text);
      // your notes: for a word, "word: note"; for the sentence itself, just the note
      if (it.note && it.note.trim()) line.notes.push({ label: it.type === 'sentence' ? '' : it.text, note: it.note.trim() });
    }
    for (const v of videos) v.lines.sort((a, b) => a.time - b.time);
    return videos;
  }

  function lineText(line, withTime) {
    const words = line.words.join(', ');
    let body;
    if (!line.sentence) body = words;
    else body = words ? `${line.sentence}  →  ${words}` : line.sentence;
    return withTime ? `${fmtTime(line.time)}  ${body}` : body;
  }

  // The session file: a header, then per video its title, link, and one line per sentence.
  function sessionText(session) {
    const items = (session && session.items) || [];
    const out = [`Fliwyee · ${dateLabel(session.startedAt)} · ${plural(items.length)}`];
    for (const v of groupSession(session)) {
      out.push('');
      out.push(v.title || SITE_NAMES[v.site]);
      if (videoUrl(v.videoId, v.site)) out.push(videoUrl(v.videoId, v.site));
      for (const line of v.lines) {
        out.push(lineText(line, true));
        for (const n of line.notes) out.push(`      ${n.label ? `${n.label}: ` : 'note: '}${oneLine(n.note)}`);
      }
    }
    return out.join('\n') + '\n';
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The sentence as HTML, with the words you took from it highlighted.
  function markWords(sentence, words) {
    const ranges = [];
    for (const w of words.slice().sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'giu');
      for (const m of sentence.matchAll(re)) {
        const a = m.index;
        const b = a + m[0].length;
        if (!ranges.some((r) => a < r[1] && b > r[0])) ranges.push([a, b]);
      }
    }
    ranges.sort((x, y) => x[0] - y[0]);
    let out = '';
    let pos = 0;
    for (const [a, b] of ranges) {
      out += `${esc(sentence.slice(pos, a))}<mark>${esc(sentence.slice(a, b))}</mark>`;
      pos = b;
    }
    return out + esc(sentence.slice(pos));
  }

  const HTML_STYLE = `
:root{color-scheme:light dark;--bg:#fff;--text:#1d1f21;--muted:#6b7075;--line:#e3e5e8;--accent:#008c45;--mark:#ffe98a;--chip:#eceef0}
@media (prefers-color-scheme:dark){:root{--bg:#1b1c1e;--text:#e9eaec;--muted:#9a9fa5;--line:#34363a;--accent:#2fb36d;--mark:#6b5600;--chip:#303236}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:780px;margin:0 auto;padding:32px 16px 56px}
h1{margin:0;font-size:24px}
.sub{margin:4px 0 8px;color:var(--muted);font-size:14px}
h2{margin:32px 0 6px;font-size:18px}
h2 a{color:inherit;text-decoration:none}
h2 a:hover{text-decoration:underline}
.tag{margin-left:6px;padding:1px 7px;border-radius:5px;background:var(--chip);color:var(--muted);font-size:12px;font-weight:500;vertical-align:middle}
ol{margin:0;padding:0;list-style:none}
li{display:grid;grid-template-columns:4.2em 1fr;gap:4px 12px;padding:11px 0;border-bottom:1px solid var(--line)}
.time{color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums;text-decoration:none}
.time:hover{text-decoration:underline}
mark{padding:0 2px;border-radius:3px;background:var(--mark);color:inherit}
.words{grid-column:2;display:flex;flex-wrap:wrap;gap:6px}
.word{padding:1px 9px;border-radius:999px;background:var(--chip);font-size:14px;font-weight:600}
.notes{grid-column:2;margin-top:2px;padding-left:10px;border-left:3px solid var(--accent);color:var(--muted);font-size:15px;white-space:pre-line}
.notes b{color:var(--text);font-weight:600}
details{margin-top:36px}
summary{cursor:pointer;color:var(--muted);font-size:14px}
pre{margin:10px 0 0;padding:12px;border-radius:8px;background:var(--chip);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}`;

  // The session file: a small web page. Each minute is a link to that moment in the video;
  // all links open in the same YouTube tab. The plain text is at the bottom, for copying.
  function sessionHtml(session) {
    const items = (session && session.items) || [];
    const heading = `Fliwyee · ${dateLabel(session.startedAt)}`;
    const body = [];
    for (const v of groupSession(session)) {
      const title = esc(v.title || SITE_NAMES[v.site]);
      const home = v.videoId ? videoUrl(v.videoId, v.site) : '';
      const tag = v.auto ? '<span class="tag" title="The text may contain mistakes">auto subtitles</span>' : '';
      body.push(
        `<section><h2>${home ? `<a href="${esc(home)}" target="fliwyee-video">${title}</a>` : title}${tag}</h2><ol>`
      );
      for (const line of v.lines) {
        const t = fmtTime(line.time);
        // YouTube and Netflix links start at the minute; other websites just open the page
        const tip = v.site === 'web' ? `Open the page (the moment is at ${t})` : `Play from ${t}`;
        const time = home
          ? `<a class="time" href="${esc(watchUrl({ videoId: v.videoId, site: v.site, time: line.time }))}" target="fliwyee-video" title="${tip}">${t}</a>`
          : `<span class="time">${t}</span>`;
        const sentence = line.sentence ? `<div class="sentence" lang="it">${markWords(line.sentence, line.words)}</div>` : '<div></div>';
        const words = line.words.length
          ? `<div class="words" lang="it">${line.words.map((w) => `<span class="word">${esc(w)}</span>`).join('')}</div>`
          : '';
        const notes = line.notes.length
          ? `<div class="notes">${line.notes
              .map((n) => `<div>${n.label ? `<b lang="it">${esc(n.label)}</b> · ` : ''}${esc(n.note)}</div>`)
              .join('')}</div>`
          : '';
        body.push(`<li>${time}${sentence}${words}${notes}</li>`);
      }
      body.push('</ol></section>');
    }
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<main>
<h1>${esc(heading)}</h1>
<p class="sub">${plural(items.length)} · click a minute to hear it again</p>
${body.join('\n')}
<details><summary>Plain text (to copy)</summary><pre>${esc(sessionText(session))}</pre></details>
</main>
</body>
</html>
`;
  }

  // The lines that go into {items} of the session prompt (no times or links).
  function promptLines(session) {
    return groupSession(session)
      .flatMap((v) => v.lines)
      .map((l) => lineText(l, false))
      .join('\n');
  }

  function mergedSettings(s) {
    const src = s || {};
    const prompts = { ...DEFAULT_SETTINGS.prompts };
    for (const k of Object.keys(prompts)) {
      const p = src.prompts && src.prompts[k];
      if (typeof p === 'string' && p.trim()) prompts[k] = p;
    }
    return { ai: AI_SITES.some((a) => a.id === src.ai) ? src.ai : DEFAULT_SETTINGS.ai, prompts };
  }

  const fill = (template, vars) => String(template).replace(/\{(text|sentence|items)\}/g, (_, k) => vars[k] || '');

  function itemPrompt(item, settings) {
    const { prompts } = mergedSettings(settings);
    if (item.type === 'sentence') return fill(prompts.sentence, { text: item.text, sentence: item.text });
    return fill(prompts.word, { text: item.text, sentence: item.context || item.text });
  }

  function sessionPrompt(session, settings) {
    const { prompts } = mergedSettings(settings);
    return fill(prompts.session, { items: promptLines(session) });
  }

  function aiSiteForUrl(url) {
    return AI_SITES.find((a) => String(url || '').startsWith(a.match.replace('*', ''))) || null;
  }

  root.FliwyeeFormat = {
    FOLDER,
    AI_SITES,
    DEFAULT_SETTINGS,
    norm,
    plural,
    fmtTime,
    stamp,
    dateLabel,
    sessionFilename,
    videoUrl,
    watchUrl,
    groupSession,
    sessionText,
    sessionHtml,
    promptLines,
    mergedSettings,
    itemPrompt,
    sessionPrompt,
    aiSiteForUrl,
  };
})(typeof self !== 'undefined' ? self : this);
