// Shared helpers used by the background worker and the side panel.
(function (root) {
  'use strict';

  const FOLDER = 'italian-subtitles';

  // One session -> one line: "word (its sentence) | phrase (its sentence) | a whole sentence"
  function sessionLine(session) {
    return (session.items || [])
      .map((it) => (it.type !== 'sentence' && it.context && it.context !== it.text ? `${it.text} (${it.context})` : it.text))
      .join(' | ');
  }

  const pad = (n) => String(n).padStart(2, '0');

  // 2026-11-19_15-30 (local time)
  function stamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  }

  function sessionFilename(session) {
    return `${FOLDER}/fliwyee_${stamp(session.startedAt)}.txt`;
  }

  // 754 -> "12:34", 3754 -> "1:02:34"
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  function watchUrl(item) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}&t=${Math.max(0, Math.floor(item.time || 0))}s`;
  }

  root.FliwyeeFormat = { FOLDER, sessionLine, stamp, sessionFilename, fmtTime, watchUrl };
})(typeof self !== 'undefined' ? self : this);
