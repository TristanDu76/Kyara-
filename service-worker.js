'use strict';

const extension = typeof browser !== 'undefined' ? browser : chrome;
const CHANNEL = 'kyara-plus:booster-alarm';
const PREFIX = 'kyara-plus:booster-wake:';
const queues = new Map();

function enqueue(tabId, task) {
  const next = (queues.get(tabId) || Promise.resolve()).catch(() => {}).then(task);
  queues.set(tabId, next);
  void next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); }).catch(() => {});
  return next;
}
async function cancel(tabId) {
  const name = PREFIX + tabId;
  await extension.alarms.clear(name);
  await extension.storage.session.remove(name);
}

extension.runtime.onMessage.addListener((message, sender) => {
  if (message?.channel !== CHANNEL || !Number.isInteger(sender.tab?.id)) return;
  try {
    const url = new URL(sender.url || '');
    if (url.protocol !== 'https:' || !['kyara.games', 'www.kyara.games'].includes(url.hostname)) return;
  } catch { return; }
  const tabId = sender.tab.id;
  if (message.type === 'cancel') return enqueue(tabId, () => cancel(tabId));
  if (message.type !== 'schedule' || !Number.isFinite(message.when)) return;
  return enqueue(tabId, async () => {
    const when = Math.max(Date.now() + 500, message.when);
    const name = PREFIX + tabId;
    await extension.storage.session.set({ [name]: { tabId, when } });
    await extension.alarms.create(name, { when });
    return { ok: true };
  });
});
extension.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(PREFIX)) return;
  const tabId = Number(alarm.name.slice(PREFIX.length));
  if (!Number.isInteger(tabId)) return;
  return enqueue(tabId, async () => {
    const stored = await extension.storage.session.get(alarm.name);
    const target = stored[alarm.name];
    if (!target || target.when > Date.now()) return;
    try {
      await extension.tabs.sendMessage(target.tabId, { channel: CHANNEL, type: 'wake' });
    } catch {
      await cancel(target.tabId);
    }
  });
});
extension.tabs.onRemoved.addListener((tabId) => enqueue(tabId, () => cancel(tabId)).catch(() => {}));
