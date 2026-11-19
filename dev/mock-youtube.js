// Fake YouTube player for testing Fliwyee without YouTube.
(() => {
  'use strict';

  const CUES = [
    { start: 0.5, end: 3.0, lines: ['Non ho spiccioli per il caffè.'] },
    { start: 3.0, end: 6.5, lines: ['Non posso fare a meno di te.'] },
    { start: 6.5, end: 10.0, lines: ["Ci metto un'ora", 'ad arrivare in ufficio.'] },
    { start: 10.0, end: 14.0, lines: ["Che c'entra questo con me?"] },
    { start: 14.0, end: 18.0, lines: ['Avere a che fare con lui è difficile.'] },
  ];
  const DURATION = 20;
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
  let shown = null;
  function render() {
    const t = video.currentTime;
    const cue = CUES.find((c) => t >= c.start && t < c.end) || null;
    if (cue !== shown) {
      shown = cue;
      container.textContent = '';
      if (cue) {
        const win = document.createElement('div');
        win.className = 'caption-window ytp-caption-window-bottom';
        const text = document.createElement('span');
        text.className = 'captions-text';
        for (const line of cue.lines) {
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
  document.getElementById('reset').addEventListener('click', async () => {
    await chrome.storage.local.set({ enabled: false, current: null, sessions: [] });
    window.fakeLog.downloads.length = 0;
    window.fakeLog.clipboard.length = 0;
    events.length = 0;
  });

  const logEl = document.getElementById('log');
  setInterval(() => {
    const d = window.fakeData;
    const items = d.current ? d.current.items.map((i) => `  [${i.type}] ${i.text}${i.context ? `  <- ${i.context}` : ''}  @${i.time}s`) : [];
    logEl.textContent = [
      `enabled: ${!!d.enabled}   badge: "${window.fakeLog.badge}"   past sessions: ${(d.sessions || []).length}`,
      `current session (${items.length}):`,
      ...items,
      `clipboard: ${JSON.stringify(window.fakeLog.clipboard.slice(-3))}`,
      `downloads:`,
      ...window.fakeLog.downloads.map((x) => `  ${x.filename}\n  ${x.text}`),
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
