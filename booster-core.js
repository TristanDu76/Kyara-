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
    const match = /Gratuit\s*[·•-]\s*(\d+)\s+restants?/i.exec(String(text || ''));
    return match ? Number(match[1]) : null;
  }

  function routeFor(type) {
    if (!TYPES.includes(type)) throw new Error(`Type de booster invalide : ${type}`);
    return `/ouvrir/${type}`;
  }

  function nextWakeAt(stock, now = Date.now()) {
    if (stock?.count > 0) return now;
    if (!stock || !Number.isFinite(stock.seconds)) return now + 30000;
    return now + Math.max(0, stock.seconds) * 1000 + 750;
  }

  function consumptionConfirmed(before, after) {
    return Number.isInteger(before) && before > 0 && Number.isInteger(after) && after >= 0 && after < before;
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
   * @param {{active:()=>boolean,onRoute:()=>boolean,ready:()=>Promise<void>,reset:()=>Promise<void>,stock:()=>number|null,button:()=>{textContent:string|null,disabled:boolean}|null,single:()=>Promise<void>,open:(button:object)=>Promise<unknown>,confirm:(before:number)=>Promise<unknown>,reveal:()=>Promise<void>,rewards:(response:Promise<unknown>)=>Promise<object[]>,record:(cards:object[])=>void,cleanup:()=>void,status:(text:string)=>void,sleep:(ms:number)=>Promise<void>}} adapter
   * @param {{max:number,spacingMs?:number}} options
   * @returns {Promise<{opened:number,reason:string,uncertain:boolean}>}
   */
  async function runBatch(adapter, { max, spacingMs = 4000 }) {
    let opened = 0, reason = '', uncertain = false;
    try {
      for (let i = 0; i < max; i++) {
        if (!adapter.active() || !adapter.onRoute()) { reason = 'Ouverture arrêtée'; break; }
        if (adapter.stock() === 0) break;
        await adapter.ready();
        if (!adapter.active() || !adapter.onRoute()) { reason = 'Ouverture arrêtée'; break; }
        if (/^\s*Ouvrir\s+un\s+autre\b/i.test(adapter.button()?.textContent || '')) {
          await adapter.reset();
          await adapter.ready();
        }
        await adapter.single();
        if (!adapter.active() || !adapter.onRoute()) { reason = 'Ouverture arrêtée'; break; }
        const before = adapter.stock();
        const button = adapter.button();
        const free = freeCountInButton(button?.textContent);
        if (!Number.isInteger(before) || before < 1 || !button || button.disabled || free === null || free < 1) {
          reason = 'Stock gratuit ou bouton indisponible'; break;
        }
        adapter.status(`Ouverture gratuite ${opened + 1}/${max}…`);
        const response = adapter.open(button);
        try { await adapter.confirm(before); }
        catch { uncertain = true; reason = 'Compteur non confirmé : reprise manuelle nécessaire'; break; }
        opened++;
        let cards = [];
        try { await adapter.reveal(); cards = await adapter.rewards(response); }
        finally { adapter.record(cards); }
        if (i < max - 1 && adapter.stock() !== 0) await adapter.sleep(spacingMs);
      }
    } catch (error) { reason = error.message || 'Ouverture interrompue'; }
    finally { adapter.cleanup(); }
    return { opened, reason, uncertain };
  }

  return Object.freeze({ TYPES, parseFreeStock, freeCountInButton, routeFor, nextWakeAt, consumptionConfirmed, cardIdsInReward, runBatch });
});
