(() => {
  'use strict';

  const CHANNEL = 'kyara-plus:booster-alarm';
  if (window.top !== window) return;
  const extension = typeof browser !== 'undefined' ? browser : chrome;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || !['schedule', 'cancel'].includes(message.type)) return;
    extension.runtime.sendMessage({ channel: CHANNEL, type: message.type, when: message.when }).catch(() => {});
  });

  extension.runtime.onMessage.addListener((message) => {
    if (message?.channel !== CHANNEL || message.type !== 'wake') return;
    window.postMessage({ channel: CHANNEL, type: 'wake' }, location.origin);
  });

  extension.runtime.sendMessage({ channel: CHANNEL, type: 'ready' }).catch(() => {});
})();
