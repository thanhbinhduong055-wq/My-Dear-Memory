// Faithful-enough stand-in for the SillyTavern 1.18.0 globals the plugin touches.
(function () {
  const log = [];
  window.__HARNESS_LOG = log;
  const origInfo = console.info, origErr = console.error, origWarn = console.warn;
  console.info = (...a) => { log.push(['info', a.map(String).join(' | ')]); origInfo(...a); };
  console.error = (...a) => { log.push(['error', a.map(String).join(' | ')]); origErr(...a); };
  console.warn = (...a) => { log.push(['warn', a.map(String).join(' | ')]); origWarn(...a); };

  const handlers = new Map();
  const eventSource = {
    on(name, fn) { (handlers.get(name) || handlers.set(name, []).get(name)).push(fn); },
    off(name, fn) { const l = handlers.get(name) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    emit(name, ...args) { for (const fn of (handlers.get(name) || []).slice()) fn(...args); },
  };
  const extensionSettings = {};
  window.SillyTavern = {
    version: '1.18.0',
    libs: { localforage: window.localforage },
    getContext: () => ({
      eventSource,
      eventTypes: {
        CHAT_CHANGED: 'chat_changed', GENERATION_STARTED: 'generation_started',
        GENERATION_ENDED: 'generation_ended', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
      },
      extensionSettings,
      saveSettingsDebounced: () => {},
      chat: [{ is_user: false, name: 'Ayla', mes: '你好呀。' }],
      characters: [{ name: 'Ayla', avatar: 'ayla.png' }],
      characterId: 0,
      chatId: 'chat-1',
      name1: 'User', name2: 'Ayla',
      chatMetadata: {},
      saveMetadata: async () => {},
      generateQuietPrompt: async () => '<title>x</title>',
      extensionSettings2: null,
    }),
  };
  window.toastr = {
    info: (m, t) => log.push(['toastr:info', String(m)]),
    warning: (m, t) => log.push(['toastr:warning', String(m)]),
    error: (m, t) => log.push(['toastr:error', String(m)]),
    success: (m, t) => log.push(['toastr:success', String(m)]),
  };

  // ST toggles the wand menu with jQuery .toggle() -> inline display.
  document.getElementById('extensionsMenuButton').addEventListener('click', () => {
    document.getElementById('extensionsMenu').classList.toggle('closed');
  });

  // ST loads third-party extension JS as <script type="module">.
  // That is why document.currentScript is null inside the plugin.
  const src = new URLSearchParams(location.search).get('src') || 'plugin';
  const s = document.createElement('script');
  s.type = 'module';
  s.src = `/${src}/index.js`;
  document.body.appendChild(s);
})();
