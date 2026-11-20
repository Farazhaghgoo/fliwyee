// Site adapters: what Fliwyee needs to know about one video site.
//   captionWindow  the box that holds one subtitle line (clicks and drags inside it are ours)
//   captionText    the text of such a box
//   video          the video element
//   player         where Fliwyee's messages go (null: a layer over the video)
//   videoId/title  what the saved items point to
//   seek           how to jump: 'video' (normal) or 'netflix' (Netflix's own player controls)
//   ownSubtitles   draw Fliwyee's own clickable subtitle line from the video's subtitle track,
//                  when the page shows its subtitles in a way that can't be clicked
// YouTube is the main site; Netflix and the general adapter are best effort.
(function (root) {
  'use strict';

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => clean(el ? el.innerText || el.textContent : '');

  // The biggest visible video on the page.
  function largestVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  const youtube = {
    id: 'youtube',
    name: 'YouTube',
    test: () => /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname),
    player: () => document.querySelector('#movie_player') || document.querySelector('.html5-video-player'),
    video() {
      const p = this.player();
      return (p && p.querySelector('video')) || document.querySelector('video');
    },
    captionWindow: '.caption-window',
    textSelector: '.ytp-caption-segment',
    // YouTube splits a line into segments: join segments within a line, lines with a space
    captionText(win) {
      const lines = win.querySelectorAll('.caption-visual-line');
      if (lines.length) {
        return clean(
          Array.from(lines)
            .map((line) => Array.from(line.querySelectorAll('.ytp-caption-segment')).map((s) => s.textContent).join(''))
            .join(' ')
        );
      }
      return clean(Array.from(win.querySelectorAll('.ytp-caption-segment')).map((s) => s.textContent).join(' '));
    },
    // watch?v=ID, or an embedded player (/embed/ID), /shorts/ID, /live/ID
    videoId: () =>
      new URLSearchParams(location.search).get('v') || (location.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/) || [])[1] || '',
    title() {
      const h1 = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata');
      const fromPage = h1 && clean(h1.textContent);
      if (fromPage) return fromPage;
      const embedTitle = document.querySelector('.ytp-title-link');
      if (embedTitle && clean(embedTitle.textContent)) return clean(embedTitle.textContent);
      return clean(document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, ''));
    },
    seek: 'video',
    ownSubtitles: false,
  };

  const netflix = {
    id: 'netflix',
    name: 'Netflix',
    test: () => /(^|\.)netflix\.com$/.test(location.hostname),
    player: () => null,
    video: () => document.querySelector('.watch-video video') || largestVideo(),
    captionWindow: '.player-timedtext-text-container',
    textSelector: '.player-timedtext-text-container',
    captionText: textOf,
    videoId: () => (location.pathname.match(/\/watch\/(\d+)/) || [])[1] || '',
    title() {
      const el = document.querySelector('[data-uia="video-title"]');
      if (el && el.innerText) return clean(el.innerText.split('\n').join(' · '));
      return clean(document.title.replace(/\s*[-|]\s*Netflix\s*$/i, '')) || 'Netflix';
    },
    seek: 'netflix',
    ownSubtitles: false,
  };

  // Subtitle boxes of common web video players. Fliwyee's own line comes first.
  const PLAYER_CAPTIONS = [
    '.fliwyee-subs-line', // Fliwyee's own line, drawn from the video's subtitle track
    '.player-timedtext-text-container', // Netflix
    '.atvwebplayersdk-captions-text', // Prime Video
    '.dss-subtitle-renderer-line', // Disney+
    '.vjs-text-track-cue', // Video.js (used by many sites)
    '.jw-text-track-cue', // JW Player
    '.shaka-text-container span', // Shaka Player
    '.plyr__caption', // Plyr
    '.bmpui-ui-subtitle-label', // Bitmovin
  ].join(', ');

  const web = {
    id: 'web',
    name: 'Website',
    test: () => true,
    player: () => null,
    video: largestVideo,
    captionWindow: PLAYER_CAPTIONS,
    textSelector: PLAYER_CAPTIONS,
    captionText: textOf,
    // the page itself (there's no general way to link to a moment)
    videoId: () => location.origin + location.pathname + location.search,
    title: () => clean(document.title) || location.hostname,
    seek: 'video',
    ownSubtitles: true,
  };

  const all = { youtube, netflix, web };
  root.FliwyeeSites = {
    // __fliwyeeForceSite: only for the test pages in dev/ (a page can't reach this from its own scripts)
    pick: () => all[root.__fliwyeeForceSite] || [youtube, netflix].find((s) => s.test()) || web,
    largestVideo,
  };
})(typeof self !== 'undefined' ? self : this);
