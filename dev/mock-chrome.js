// A tiny fake of the Chrome extension APIs Fliwyee uses, for dev/mock-youtube.html.
// Background, content script and side panel all share this one object, like they share
// the real chrome.* APIs inside the browser.
(() => {
  'use strict';
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const later = (fn) => setTimeout(fn, 0);
  const event = () => {
    const listeners = [];
    return { listeners, addListener: (fn) => listeners.push(fn), removeListener: (fn) => listeners.splice(listeners.indexOf(fn) >>> 0, 1) };
  };

  const data = {};
  const log = {
    downloads: [],
    badge: '',
    badgeColor: '',
    title: '',
    clipboard: [],
    tabsCreated: [],
    tabsUpdated: [],
    sent: [],
    scripted: [],
    shown: [],
    opened: [],
  };

  const onChanged = event();
  const onMessage = event();
  const onCommand = event();
  const onUpdated = event();

  function dispatchMessage(msg) {
    return new Promise((resolve) => {
      let done = false;
      const respond = (r) => {
        if (!done) {
          done = true;
          resolve(clone(r));
        }
      };
      let waiting = false;
      for (const fn of onMessage.listeners.slice()) {
        const keep = fn(clone(msg), { id: 'fliwyee-dev' }, respond);
        if (done) return;
        if (keep === true) waiting = true;
      }
      if (!waiting) respond(undefined);
    });
  }

  const fake = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return clone(data);
          if (typeof keys === 'string') keys = [keys];
          const out = {};
          if (Array.isArray(keys)) {
            for (const k of keys) if (k in data) out[k] = clone(data[k]);
          } else {
            for (const [k, def] of Object.entries(keys)) out[k] = k in data ? clone(data[k]) : clone(def);
          }
          return out;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
            data[k] = clone(v);
          }
          later(() => onChanged.listeners.slice().forEach((fn) => fn(clone(changes), 'local')));
        },
        async clear() {
          for (const k of Object.keys(data)) delete data[k];
        },
      },
      onChanged,
    },
    runtime: {
      id: 'fliwyee-dev',
      onMessage,
      onInstalled: event(),
      onStartup: event(),
      sendMessage(msg) {
        log.sent.push(clone(msg));
        return dispatchMessage(msg);
      },
    },
    tabs: {
      onUpdated,
      // AI-site queries (an array of patterns) return window.mockAiTabs; anything else the YouTube tab.
      async query(q) {
        if (q && Array.isArray(q.url)) return clone(window.mockAiTabs || []);
        return [{ id: 1, windowId: 1, url: `https://www.youtube.com/watch${location.search}` }];
      },
      async update(id, props) {
        log.tabsUpdated.push({ id, ...props });
        return { id };
      },
      async create(props) {
        log.tabsCreated.push(props);
        const tab = { id: 2, windowId: 1, pendingUrl: props.url };
        setTimeout(() => onUpdated.listeners.slice().forEach((fn) => fn(2, { status: 'complete' }, tab)), 50);
        return tab;
      },
      sendMessage(_tabId, msg) {
        return dispatchMessage(msg);
      },
    },
    windows: { async update() {} },
    // The "AI tab" is this page: the injected function runs here, against the fake message box.
    scripting: {
      async executeScript({ target, func, args }) {
        log.scripted.push({ tabId: target.tabId, args });
        return [{ result: await func(...(args || [])) }];
      },
    },
    downloads: {
      async download(opts) {
        const text = decodeURIComponent(String(opts.url).replace(/^data:[^,]*,/, ''));
        log.downloads.push({ filename: opts.filename, conflictAction: opts.conflictAction, text });
        return log.downloads.length;
      },
      async search({ id }) {
        return log.downloads[id - 1] ? [{ id, exists: true, state: 'complete' }] : [];
      },
      show(id) {
        log.shown.push(id);
      },
      async open(id) {
        log.opened.push(id);
      },
      showDefaultFolder() {
        log.shown.push('folder');
      },
    },
    action: {
      async setBadgeText({ text }) {
        log.badge = text;
      },
      async setBadgeBackgroundColor({ color }) {
        log.badgeColor = color;
      },
      async setBadgeTextColor() {},
      async setTitle({ title }) {
        log.title = title;
      },
    },
    sidePanel: { setPanelBehavior: async () => {} },
    commands: {
      onCommand,
      async getAll() {
        return [
          { name: 'toggle-capture', shortcut: 'Ctrl+Shift+X' },
          { name: 'end-session', shortcut: 'Ctrl+Shift+E' },
        ];
      },
    },
  };

  window.fakeChrome = fake;
  window.fakeLog = log;
  window.fakeData = data;
  window.fakeCommand = (name) => onCommand.listeners.forEach((fn) => fn(name));
  window.importScripts = () => {}; // background.js calls importScripts('lib/format.js'); the page loads it directly
  Object.defineProperty(window, 'chrome', { value: fake, configurable: true, writable: true });

  // Record what gets copied (the browser pane may not allow real clipboard access).
  const clip = navigator.clipboard;
  const orig = clip && clip.writeText ? clip.writeText.bind(clip) : null;
  const spy = async (text) => {
    log.clipboard.push(text);
    if (orig) await orig(text).catch(() => {});
  };
  try {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });
  } catch (_) {
    if (clip) clip.writeText = spy;
  }
})();
