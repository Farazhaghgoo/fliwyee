// Runs inside the video page itself (MAIN world).
// 1. When you turn on subtitles, the player downloads the subtitle file (YouTube: /api/timedtext;
//    Netflix: a TTML/WebVTT file). We pass a copy to the extension, so it knows when each line
//    starts and ends (needed for "replay this line" and the saved minute).
// 2. Netflix only: jumping in the video has to go through Netflix's own player.
// Nothing is changed and nothing is sent anywhere.
(() => {
  'use strict';
  if (window.__fliwyeeHooked) return;
  window.__fliwyeeHooked = true;

  const onNetflix = /(^|\.)netflix\.com$/.test(location.hostname);
  const MAX = 3 * 1024 * 1024; // subtitle files are small; skip anything big (video data)

  const isYouTubeCaption = (url) => typeof url === 'string' && url.includes('/api/timedtext');
  const maybeNetflixCaption = (url) => onNetflix && typeof url === 'string' && /nflxvideo\.net|netflix\.com/.test(url);
  const looksLikeSubtitles = (s) => /^\s*(﻿)?(WEBVTT|<\?xml[^>]*>\s*<tt[\s>]|<tt[\s>])/.test(s);

  const send = (url, body) => {
    if (!body) return;
    try {
      window.postMessage({ __fliwyee: 'timedtext', url: String(url), body }, location.origin);
    } catch (_) {
      /* ignore */
    }
  };

  // Text from a small binary body, only if it starts like text ('<' or 'W' or a BOM).
  const smallText = (buf) => {
    if (!buf || buf.byteLength > MAX) return '';
    const first = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    const startsLikeText = first[0] === 0x3c || first[0] === 0x57 || (first[0] === 0xef && first[1] === 0xbb);
    return startsLikeText ? new TextDecoder().decode(buf) : '';
  };

  // ---------- fetch ----------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const promise = origFetch.apply(window, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (isYouTubeCaption(url)) {
          promise
            .then((res) => res.clone().text().then((body) => send(res.url || url, body)))
            .catch(() => {});
        } else if (maybeNetflixCaption(url)) {
          promise
            .then((res) => {
              const len = Number(res.headers.get('content-length'));
              if (!len || len > MAX) return null;
              return res
                .clone()
                .arrayBuffer()
                .then((buf) => {
                  const body = smallText(buf);
                  if (looksLikeSubtitles(body)) send(res.url || url, body);
                });
            })
            .catch(() => {});
        }
      } catch (_) {
        /* ignore */
      }
      return promise;
    };
  }

  // ---------- XMLHttpRequest ----------
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function (method, url) {
    try {
      this.__fliwyeeUrl = String(url);
    } catch (_) {
      /* ignore */
    }
    return origOpen.apply(this, arguments);
  };

  XHR.send = function () {
    const url = this.__fliwyeeUrl;
    const youTube = isYouTubeCaption(url);
    if (youTube || maybeNetflixCaption(url)) {
      this.addEventListener('load', () => {
        try {
          let body = '';
          if (this.responseType === '' || this.responseType === 'text') body = this.responseText;
          else if (this.responseType === 'json') body = JSON.stringify(this.response);
          else if (this.responseType === 'arraybuffer') body = smallText(this.response);
          if (youTube || looksLikeSubtitles(body)) send(this.responseURL || url, body);
        } catch (_) {
          /* ignore */
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  // ---------- Netflix: jump through its own player ----------
  if (onNetflix) {
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.__fliwyee !== 'netflix-seek') return;
      try {
        const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
        const ids = api.getAllPlayerSessionIds();
        const id = ids.find((s) => s.includes('watch')) || ids[ids.length - 1];
        api.getVideoPlayerBySessionId(id).seek(Math.max(0, Math.round(Number(e.data.time) * 1000)));
      } catch (_) {
        /* Netflix changed its player: replay and links won't jump there */
      }
    });
  }
})();
