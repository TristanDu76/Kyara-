(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  root.KyaraPlusBoosterCore = core;
})(globalThis, function () {
  'use strict';

  const TYPES = Object.freeze(['all', 'shonen', 'isekai', 'seinen', 'shojo', 'sport', 'mecha', 'waifu', 'husbando']);

  function parseFreeStock(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    const slash = /(\d+)\s*\/\s*(\d+)\s*boosters?\s+gratuits?/i.exec(normalized);
    const words = /(\d+)\s+boosters?\s+gratuits?\s+sur\s+(\d+)/i.exec(normalized);
    const match = slash || words;
    if (!match) return null;
    const count = Number(match[1]), max = Number(match[2]);
    return max > 0 && count >= 0 && count <= max ? { count, max } : null;
  }

  function freeCountInButton(text) {
    if (/[◆♦]|payant/i.test(String(text || ''))) return null;
    const label = String(text || '');
    const remaining = /Gratuit\s*[·•-]\s*(\d+)\s+restants?/i.exec(label);
    const batch = /(?:^|\s)(\d+)\s+gratuits?\s*$/i.exec(label);
    return remaining ? Number(remaining[1]) : batch ? Number(batch[1]) : null;
  }

  function routeFor(type) {
    if (!TYPES.includes(type)) throw new Error(`Type de booster invalide : ${type}`);
    return `/ouvrir/${type}`;
  }

  function nextWakeAt(stock, now = Date.now(), target = 1) {
    if (stock?.count >= target) return now;
    if (Number.isFinite(stock?.refillAt)) return stock.refillAt > now ? stock.refillAt + 750 : now + 30000;
    if (!stock || !Number.isFinite(stock.seconds)) return now + 30000;
    return now + Math.max(0, stock.seconds) * 1000 + 750;
  }

  function consumptionConfirmed(before, after, quantity = 1) {
    return Number.isInteger(before) && before >= quantity && Number.isInteger(after) && after >= 0 && before - after === quantity;
  }

  /** Autorisation locale : seuls les endpoints observés de Kyara et un plafond serveur de zéro sont admis. */
  function freeRequestAllowed(path, body, permit) {
    if (!permit || !TYPES.includes(permit.type) || ![1, 5, 10].includes(permit.quantity)) return false;
    const endpoint = `/api/packs/${permit.type}/${permit.quantity === 1 ? 'open' : 'open-many'}`;
    if (path !== endpoint) return false;
    try {
      const data = JSON.parse(body);
      return data?.maxChakra === 0 && (permit.quantity === 1 ? data.count === undefined || data.count === 1 : data.count === permit.quantity);
    } catch { return false; }
  }

  function cardIdsInReward(text) {
    const ids = [];
    const visit = (value, depth = 0, context = false) => {
      if (!value || depth > 8) return;
      if (Array.isArray(value)) { value.forEach((v) => visit(v, depth + 1, context)); return; }
      if (typeof value !== 'object') return;
      let id = value.characterId ?? value.character_id ?? value.cardId ?? value.card_id ?? (context ? value.id : null);
      if (id && typeof id === 'object') id = id.id;
      if (id != null && /^\d+$/.test(String(id))) { ids.push(String(id)); return; }
      for (const key of ['cards', 'characters', 'drops', 'rewards', 'opened', 'results', 'items', 'card', 'character', 'data', 'result']) {
        if (value[key] !== undefined) visit(value[key], depth + 1, true);
      }
    };
    try { visit(JSON.parse(text)); } catch { /* un résumé DOM reste possible */ }
    return ids;
  }

  /**
   * Moteur indépendant du DOM. L’adaptateur fournit les contrôles du site.
   * @param {{active:()=>boolean,onRoute:()=>boolean,ready:()=>Promise<void>,reset:()=>Promise<void>,stock:()=>number|null,button:()=>{textContent:string|null,disabled:boolean}|null,quantity:(quantity:number)=>Promise<void>,open:(button:object,quantity:number)=>Promise<unknown>,confirm:(before:number,quantity:number)=>Promise<unknown>,reveal:()=>Promise<void>,rewards:(response:Promise<unknown>)=>Promise<object[]>,record:(cards:object[],quantity:number)=>void,cleanup:()=>void,status:(text:string)=>void,sleep:(ms:number)=>Promise<void>}} adapter
   * @param {{size:number,spacingMs?:number}} options
   * @returns {Promise<{opened:number,reason:string,uncertain:boolean}>}
   */
  async function runBatch(adapter, { size, spacingMs = 4000 }) {
    let opened = 0, reason = '', uncertain = false;
    try {
      if (!Number.isInteger(size) || size < 1 || size > 10) throw new Error('Taille de lot invalide');
      while (opened < size) {
        if (!adapter.active() || !adapter.onRoute()) { reason = 'Ouverture arrêtée'; break; }
        await adapter.ready();
        if (!adapter.active() || !adapter.onRoute()) { reason = 'Ouverture arrêtée'; break; }
        const remaining = size - opened;
        if (!Number.isInteger(adapter.stock()) || adapter.stock() < remaining) { reason = `En attente du lot complet (${adapter.stock() ?? '?'}/${remaining})`; break; }
        if (/^\s*Ouvrir\s+(?:un\s+autre|encore)\b/i.test(adapter.button()?.textContent || '')) {
          await adapter.reset();
          await adapter.ready();
        }
        const quantity = remaining >= 10 ? 10 : remaining >= 5 ? 5 : 1;
        await adapter.quantity(quantity);
        if (!adapter.active() || !adapter.onRoute()) { reason = 'Ouverture arrêtée'; break; }
        const before = adapter.stock();
        const button = adapter.button();
        const free = freeCountInButton(button?.textContent);
        if (!Number.isInteger(before) || before < remaining || !button || button.disabled || free === null || free < quantity) {
          reason = 'Stock gratuit ou bouton indisponible'; break;
        }
        adapter.status(`Lot de ${size} · ouverture gratuite ×${quantity} (${opened}/${size})…`);
        const response = adapter.open(button, quantity);
        try { await adapter.confirm(before, quantity); }
        catch (error) { uncertain = true; reason = `${error.message || 'Compteur non confirmé'} : reprise manuelle nécessaire`; break; }
        opened += quantity;
        let cards = [];
        try { await adapter.reveal(); cards = await adapter.rewards(response); }
        finally { adapter.record(cards, quantity); }
        if (opened < size) await adapter.sleep(spacingMs);
      }
    } catch (error) { reason = error.message || 'Ouverture interrompue'; }
    finally { adapter.cleanup(); }
    return { opened, reason, uncertain };
  }

  return Object.freeze({ TYPES, parseFreeStock, freeCountInButton, routeFor, nextWakeAt, consumptionConfirmed, freeRequestAllowed, cardIdsInReward, runBatch });
});
