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

  function sessionFilename(session) {
    return `${FOLDER}/fliwyee_${stamp(session.startedAt)}.txt`;
  }

  function videoUrl(videoId) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  function watchUrl(item) {
    return `${videoUrl(item.videoId)}&t=${Math.max(0, Math.floor(item.time || 0))}s`;
  }

  // Group a session: videos (in the order you first captured from them) -> sentences (in video
  // order) -> the words and phrases you took from each sentence.
  function groupSession(session) {
    const videos = [];
    const byVideo = new Map();
    for (const it of (session && session.items) || []) {
      const vid = it.videoId || '';
      let v = byVideo.get(vid);
      if (!v) {
        v = { videoId: vid, title: it.title || '', lines: [], byLine: new Map() };
        byVideo.set(vid, v);
        videos.push(v);
      }
      if (!v.title && it.title) v.title = it.title;
      const sentence = it.type === 'sentence' ? it.text : it.context || '';
      const key = norm(sentence) || `#${it.id}`; // no sentence: its own line
      let line = v.byLine.get(key);
      if (!line) {
        line = { sentence, time: it.time || 0, words: [] };
        v.byLine.set(key, line);
        v.lines.push(line);
      }
      line.time = Math.min(line.time, it.time || 0);
      if (it.type !== 'sentence' && !line.words.includes(it.text)) line.words.push(it.text);
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
      out.push(v.title || 'YouTube video');
      if (v.videoId) out.push(videoUrl(v.videoId));
      for (const line of v.lines) out.push(lineText(line, true));
    }
    return out.join('\n') + '\n';
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
    promptLines,
    mergedSettings,
    itemPrompt,
    sessionPrompt,
    aiSiteForUrl,
  };
})(typeof self !== 'undefined' ? self : this);
