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
    windowsCreated: [],
    sidePanelOpened: [],
    uiHidden: false,
    uiChanges: [],
    clipboardHtml: [],
  };

  const onChanged = event();
  const onMessage = event();
  const onCommand = event();
  const onUpdated = event();
  const onActivated = event();
  const onRemoved = event();
  const onConnect = event();
  const sessionData = {};

  // runtime.connect: a pair of ports, like the real thing
  function portPair(name) {
    const make = () => ({
      name,
      other: null,
      onMessage: event(),
      onDisconnect: event(),
      postMessage(m) {
        const o = this.other;
        later(() => o.onMessage.listeners.slice().forEach((fn) => fn(clone(m), o)));
      },
      disconnect() {
        const o = this.other;
        later(() => o.onDisconnect.listeners.slice().forEach((fn) => fn(o)));
      },
    });
    const a = make();
    const b = make();
    a.other = b;
    b.other = a;
    return [a, b];
  }

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
        const keep = fn(clone(msg), { id: 'fliwyee-dev', tab: { id: 1, windowId: 1 } }, respond);
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
        async remove(keys) {
          const changes = {};
          for (const k of [].concat(keys)) {
            if (!(k in data)) continue;
            changes[k] = { oldValue: clone(data[k]) };
            delete data[k];
          }
          if (Object.keys(changes).length) later(() => onChanged.listeners.slice().forEach((fn) => fn(clone(changes), 'local')));
        },
        async clear() {
          for (const k of Object.keys(data)) delete data[k];
        },
      },
      // chrome.storage.session: kept while the browser runs
      session: {
        async get(key) {
          return key in sessionData ? { [key]: clone(sessionData[key]) } : {};
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) sessionData[k] = clone(v);
        },
      },
      onChanged,
    },
    runtime: {
      id: 'fliwyee-dev',
      onMessage,
      onInstalled: event(),
      onStartup: event(),
      onConnect,
      sendMessage(msg) {
        log.sent.push(clone(msg));
        return dispatchMessage(msg);
      },
      connect({ name }) {
        const [client, server] = portPair(name);
        later(() => onConnect.listeners.slice().forEach((fn) => fn(server)));
        window.mockPorts = (window.mockPorts || []).concat([client]);
        return client;
      },
      getURL(path) {
        return `/${path}`;
      },
    },
    tabs: {
      onUpdated,
      onActivated,
      onRemoved,
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
      // tabs listed in window.mockTabsWithoutFliwyee act like tabs where Fliwyee isn't running
      sendMessage(tabId, msg) {
        if ((window.mockTabsWithoutFliwyee || []).includes(tabId)) {
          return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
        }
        return dispatchMessage(msg);
      },
    },
    windows: {
      async update() {},
      async getCurrent() {
        return { id: 1 };
      },
      async create(props) {
        log.windowsCreated.push(props);
        return { id: 9 };
      },
    },
    // The "AI tab" is this page: the injected function runs here, against the fake message box.
    scripting: {
      async executeScript({ target, func, args, files, world }) {
        if (files) {
          // adding Fliwyee to a tab: just record it (this page already has it)
          log.scripted.push({ tabId: target.tabId, files, world: world || 'ISOLATED' });
          return [{ result: undefined }];
        }
        log.scripted.push({ tabId: target.tabId, args });
        return [{ result: await func(...(args || [])) }];
      },
      async insertCSS({ target, files }) {
        log.scripted.push({ tabId: target.tabId, css: files });
      },
    },
    downloads: {
      async download(opts) {
        const url = String(opts.url);
        const body = url.replace(/^data:[^,]*,/, '');
        const text = /^data:[^,]*;base64,/.test(url)
          ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))
          : decodeURIComponent(body);
        log.downloads.push({ filename: opts.filename, conflictAction: opts.conflictAction, text, uiHidden: log.uiHidden });
        return log.downloads.length;
      },
      // chrome.downloads.setUiOptions: Chrome's download message on/off
      async setUiOptions({ enabled }) {
        log.uiHidden = !enabled;
        log.uiChanges.push(enabled);
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
    // window.mockSidePanelOpens = false makes open() fail, like Chrome without a key press
    sidePanel: {
      setPanelBehavior: async () => {},
      async open(opts) {
        log.sidePanelOpened.push(opts);
        if (window.mockSidePanelOpens === false) throw new Error('needs a user gesture');
      },
    },
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
  // fakeCommand('toggle-capture', { id, url }): a keyboard shortcut pressed in that tab
  window.fakeCommand = (name, tab) =>
    onCommand.listeners.forEach((fn) => fn(name, tab || { id: 1, windowId: 1, url: location.href }));
  window.importScripts = () => {}; // background.js calls importScripts('lib/format.js'); the page loads it directly
  Object.defineProperty(window, 'chrome', { value: fake, configurable: true, writable: true });

  // Record what gets copied (the browser pane may not allow real clipboard access).
  const clip = navigator.clipboard;
  const orig = clip && clip.writeText ? clip.writeText.bind(clip) : null;
  const spy = async (text) => {
    log.clipboard.push(text);
    log.clipboardHtml.push('');
    if (orig) await orig(text).catch(() => {});
  };
  // navigator.clipboard.write([ClipboardItem]): plain text and a formatted (bold) version
  const spyWrite = async (items) => {
    for (const item of items) {
      const read = async (type) => (item.types.includes(type) ? (await item.getType(type)).text() : '');
      log.clipboard.push(await read('text/plain'));
      log.clipboardHtml.push(await read('text/html'));
    }
  };
  try {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy, write: spyWrite }, configurable: true });
  } catch (_) {
    if (clip) {
      clip.writeText = spy;
      clip.write = spyWrite;
    }
  }
})();
