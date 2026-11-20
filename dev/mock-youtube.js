// Fake YouTube player for testing Fliwyee without YouTube.
(() => {
  'use strict';

  const CUES = [
    { start: 0.5, end: 3.0, lines: ['Non ho spiccioli per il caffè.'] },
    { start: 3.0, end: 6.5, lines: ['Non posso fare a meno di te.'] },
    { start: 6.5, end: 10.0, lines: ["Ci metto un'ora", 'ad arrivare in ufficio.'] },
    { start: 10.0, end: 14.0, lines: ["Che c'entra questo con me?"] },
    { start: 14.0, end: 18.0, lines: ['Avere a che fare con lui è difficile.'] },
    // like auto-generated subtitles: two lines on screen at once (the older one on top)
    { start: 18.0, end: 22.5, lines: ['e poi siamo andati'] },
    { start: 20.0, end: 24.0, lines: ['a mangiare una pizza'] },
  ];
  const DURATION = 26;
  window.MOCK_CUES_JSON3 = CUES.map((c) => ({
    tStartMs: Math.round(c.start * 1000),
    dDurationMs: Math.round((c.end - c.start) * 1000),
    segs: [{ utf8: c.lines.join('\n') }],
  }));

  const events = [];
  const note = (s) => events.push(`${new Date().toLocaleTimeString()}  ${s}`);
  window.mockEvents = events;

  // ---------- fake <video> with a clock ----------
  const video = document.querySelector('video');
  const clock = { t: 0, playing: false, rate: 1, last: performance.now() };
  const tick = () => {
    const n = performance.now();
    if (clock.playing) clock.t = Math.min(DURATION, clock.t + ((n - clock.last) / 1000) * clock.rate);
    clock.last = n;
    if (clock.t >= DURATION) clock.playing = false;
    return clock.t;
  };
  Object.defineProperties(video, {
    currentTime: {
      get: tick,
      set: (v) => {
        tick();
        clock.t = Math.max(0, Math.min(DURATION, Number(v) || 0));
      },
    },
    paused: { get: () => !clock.playing },
    playbackRate: {
      get: () => clock.rate,
      set: (v) => {
        tick();
        clock.rate = Number(v) || 1;
      },
    },
    play: {
      value: () => {
        tick();
        clock.playing = true;
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        tick();
        clock.playing = false;
      },
    },
  });
  window.mockVideo = video;

  // ---------- subtitles, rendered like YouTube ----------
  const container = document.getElementById('captions');
  let shown = '';
  function render() {
    const t = video.currentTime;
    const active = CUES.filter((c) => t >= c.start && t < c.end);
    const key = active.map((c) => c.start).join(',');
    if (key !== shown) {
      shown = key;
      container.textContent = '';
      if (active.length) {
        const win = document.createElement('div');
        win.className = 'caption-window ytp-caption-window-bottom';
        const text = document.createElement('span');
        text.className = 'captions-text';
        for (const line of active.flatMap((c) => c.lines)) {
          const vl = document.createElement('span');
          vl.className = 'caption-visual-line';
          const seg = document.createElement('span');
          seg.className = 'ytp-caption-segment';
          seg.textContent = line;
          vl.append(seg);
          text.append(vl);
        }
        win.append(text);
        // YouTube lets you drag the subtitle box and blocks text selection on it.
        win.addEventListener('mousedown', (e) => {
          e.preventDefault();
          note('YouTube: subtitle drag started (should NOT happen while Fliwyee is on)');
        });
        container.append(win);
      }
    }
    const m = Math.floor(t / 60);
    document.getElementById('clock').textContent = `${m}:${(t % 60).toFixed(1).padStart(4, '0')}${clock.playing ? '' : ' ⏸'}`;
  }
  setInterval(render, 40); // a timer, not animation frames: keeps working in a background pane

  // YouTube toggles play when you click the player.
  document.getElementById('movie_player').addEventListener('click', () => {
    if (video.paused) video.play();
    else video.pause();
    note(`YouTube: player click -> ${video.paused ? 'pause' : 'play'}`);
  });

  // ---------- controls & log ----------
  document.getElementById('play').addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  document.getElementById('cmd').addEventListener('click', () => window.fakeCommand('toggle-capture'));
  document.getElementById('end').addEventListener('click', () => window.fakeCommand('end-session'));
  // Pretend a ChatGPT tab is open; the fake message box below stands in for it.
  window.mockAiTabs = [{ id: 5, windowId: 1, url: 'https://chatgpt.com/c/demo', lastAccessed: 100 }];
  document.getElementById('reset').addEventListener('click', async () => {
    const keys = Object.keys(window.fakeData).filter((k) => k !== 'settings');
    await chrome.storage.local.remove(keys);
    window.fakeLog.downloads.length = 0;
    window.fakeLog.clipboard.length = 0;
    window.fakeLog.clipboardHtml.length = 0;
    events.length = 0;
  });

  const logEl = document.getElementById('log');
  setInterval(() => {
    const d = window.fakeData;
    const nbs = Object.keys(d).filter((k) => k.startsWith('nb:'));
    const lines = nbs.flatMap((k) => [
      `  ${k}  "${d[k].title}"  ${d[k].dirty ? 'unsaved' : 'saved'}  ${d[k].filename || ''}`,
      ...d[k].lines.map((l) => `    @${l.time}s  ${l.sentence}  ->  ${l.words.map((w) => w.text).join(', ')}  [${l.tags.join(',')}]`),
    ]);
    logEl.textContent = [
      `enabled: ${!!d.enabled}   badge: "${window.fakeLog.badge}" ${window.fakeLog.badgeColor}   today: ${JSON.stringify(d.today || null)}`,
      `notebooks (${nbs.length}):`,
      ...lines,
      `clipboard: ${JSON.stringify(window.fakeLog.clipboard.slice(-2))}`,
      `clipboard html: ${JSON.stringify(window.fakeLog.clipboardHtml.slice(-1))}`,
      `downloads: ${window.fakeLog.downloads.map((x) => `${x.filename}${x.uiHidden ? ' (quiet)' : ''}`).join(' | ')}`,
      `events:`,
      ...events.slice(-6).map((e) => `  ${e}`),
    ].join('\n');
  }, 300);

  // ---------- side panel in an iframe, sharing the fake chrome APIs ----------
  fetch('../sidepanel/sidepanel.html')
    .then((r) => r.text())
    .then((html) => {
      const inject =
        '<script>Object.defineProperty(window, "chrome", { value: parent.fakeChrome, configurable: true, writable: true });<\/script>';
      document.getElementById('panel').srcdoc = html
        .replace(/(src|href)="(?![a-z]+:|#|\/)/g, '$1="/sidepanel/') // make the panel's relative paths absolute
        .replace('<head>', `<head>${inject}`);
    });

  // "Turn on CC": the player downloads the subtitle track.
  fetch(`/api/timedtext?v=${new URLSearchParams(location.search).get('v') || 'demo123'}&lang=it&fmt=json3`);
})();
