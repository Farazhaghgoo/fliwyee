// Runs inside the YouTube page itself (MAIN world).
// When you turn on CC, the YouTube player downloads the subtitle track (/api/timedtext).
// We pass a copy of that download to the extension, so it knows when each line starts and ends
// (needed for "replay this line"). Nothing is changed and nothing is sent anywhere.
(() => {
  'use strict';
  if (window.__fliwyeeHooked) return;
  window.__fliwyeeHooked = true;

  const isCaptionUrl = (url) => typeof url === 'string' && url.includes('/api/timedtext');

  const send = (url, body) => {
    if (!body) return;
    try {
      window.postMessage({ __fliwyee: 'timedtext', url: String(url), body }, location.origin);
    } catch (_) {
      /* ignore */
    }
  };

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const promise = origFetch.apply(window, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (isCaptionUrl(url)) {
          promise
            .then((res) => res.clone().text().then((body) => send(res.url || url, body)))
            .catch(() => {});
        }
      } catch (_) {
        /* ignore */
      }
      return promise;
    };
  }

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
    if (isCaptionUrl(this.__fliwyeeUrl)) {
      this.addEventListener('load', () => {
        try {
          let body = '';
          if (this.responseType === '' || this.responseType === 'text') body = this.responseText;
          else if (this.responseType === 'json') body = JSON.stringify(this.response);
          else if (this.responseType === 'arraybuffer') body = new TextDecoder().decode(this.response);
          send(this.responseURL || this.__fliwyeeUrl, body);
        } catch (_) {
          /* ignore */
        }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
