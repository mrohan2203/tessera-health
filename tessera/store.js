/* Tessera Health — data layer (Phase 1 of the backend plan).
   Every read and write of persisted data goes through one store with a pluggable adapter:
     demo  Today's behaviour. Synthetic data in this browser's localStorage, session in
           sessionStorage. Used by the published link and the offline iPhone app.
     live  The future API (see backend/README.md). Not configured yet, so asking for it falls
           back to demo with a notice. In live mode nothing containing health data is written to
           browser storage (persistsPHI: false).
   Adapter contract (what a live adapter must implement):
     loadState() -> state | null        saveState(state)          resetState()
     loadSession() -> session | null    saveSession(session|null)
     appendAudit(event, state)          flash.get() / flash.set(text)
     info: { mode, persistsPHI, label }
   Tracing (?trace=1 or TesseraStore.trace(true)) records which screen or action reads or writes
   each collection, to build the API map (backend/data-access-map.md). Off by default: no
   proxies, no overhead, no behaviour change. */
(function () {
  'use strict';
  const LS = 'tessera-state-v2', SK = 'tessera-session-v2', FLASH = 'tessera-flash';
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

  const DemoAdapter = {
    info: { mode: 'demo', persistsPHI: true, label: 'Demo · synthetic data stored in this browser' },
    loadState: () => safe(() => JSON.parse(localStorage.getItem(LS)), null),
    saveState: (s) => safe(() => localStorage.setItem(LS, JSON.stringify(s))),
    resetState: () => safe(() => localStorage.removeItem(LS)),
    loadSession: () => safe(() => JSON.parse(sessionStorage.getItem(SK)), null),
    saveSession: (s) => safe(() => (s ? sessionStorage.setItem(SK, JSON.stringify(s)) : sessionStorage.removeItem(SK))),
    appendAudit: (ev, state) => { state.audit.push(ev); DemoAdapter.saveState(state); },
    flash: { get: () => safe(() => { const f = sessionStorage.getItem(FLASH); sessionStorage.removeItem(FLASH); return f; }, null), set: (t) => safe(() => sessionStorage.setItem(FLASH, t)) }
  };

  /* Live adapter stub: documents the calls a server-backed adapter will make. Every method fails
     clearly until a base URL is configured, so nothing silently falls back to local storage. */
  function LiveAdapter(cfg) {
    const base = cfg && cfg.apiBase;
    const notReady = (what) => { throw new Error(`Live mode is not configured (${what}). Set TESSERA_CONFIG.apiBase.`); };
    return {
      info: { mode: 'live', persistsPHI: false, label: 'Live · data from the Tessera API, nothing stored on this device' },
      // GET  {base}/api/bootstrap  -> the signed-in user's permitted slice of state (server-filtered)
      loadState: () => (base ? notReady('GET /api/bootstrap') : notReady('apiBase')),
      // Writes go to resource endpoints (POST/PATCH /api/<collection>), never a whole-state save.
      saveState: () => {},
      resetState: () => notReady('reset is not available in live mode'),
      // Session lives in an HttpOnly cookie issued by the identity provider; only a display copy is kept in memory.
      loadSession: () => null, saveSession: () => {},
      // The server writes the authoritative audit row in the same transaction as each access.
      appendAudit: (ev, state) => { state.audit.push(ev); },
      flash: { get: () => null, set: () => {} }
    };
  }

  const cfg = Object.assign({ mode: 'demo' }, window.TESSERA_CONFIG || {});
  const params = new URLSearchParams(location.search);
  const wanted = params.get('mode') || cfg.mode;
  let adapter = DemoAdapter, notice = '';
  if (wanted === 'live') {
    if (cfg.apiBase) adapter = LiveAdapter(cfg);
    else notice = "Live mode isn't configured yet, so this is the demo with synthetic data.";
  }

  /* ---------- Tracing: who reads and writes what ---------- */
  let tracing = params.get('trace') === '1';
  let ctx = 'boot';
  const map = new Map(); // "collection|context|r/w" -> count
  const note = (coll, kind) => { if (!tracing) return; const k = `${coll}|${ctx}|${kind}`; map.set(k, (map.get(k) || 0) + 1); };
  const cache = new WeakMap(), RAW = new WeakMap(); // target -> proxy, proxy -> target
  const unwrap = (v) => (v && typeof v === 'object' && RAW.has(v) ? RAW.get(v) : v); // never store a traced object inside the state
  function track(obj, coll) {
    if (!tracing || obj === null || typeof obj !== 'object' || RAW.has(obj)) return obj;
    const key = obj; if (cache.has(key)) return cache.get(key);
    const px = new Proxy(obj, {
      get(t, p, r) { const v = Reflect.get(t, p, r); if (typeof p === 'string' && p !== 'length' && typeof v !== 'function') note(coll, 'r'); return v && typeof v === 'object' ? track(v, coll) : v; },
      set(t, p, v) { note(coll, 'w'); return Reflect.set(t, p, unwrap(v)); },
      deleteProperty(t, p) { note(coll, 'w'); return Reflect.deleteProperty(t, p); }
    });
    cache.set(key, px); RAW.set(px, key); return px;
  }
  function trackState(state) {
    if (!tracing) return state;
    return new Proxy(state, {
      get(t, p, r) { const v = Reflect.get(t, p, r); return typeof p === 'string' && v && typeof v === 'object' ? track(v, p) : v; },
      set(t, p, v) { note(String(p), 'w'); return Reflect.set(t, p, unwrap(v)); }
    });
  }
  /* Label reads and writes with the screen or the action/form that caused them. */
  function attach(T) {
    if (!tracing) return;
    const wrap = (obj, kind) => Object.keys(obj).forEach((k) => { const f = obj[k]; if (typeof f !== 'function' || f.__store) return; const g = function (...a) { const prev = ctx; ctx = `${kind}:${k}`; try { return f.apply(this, a); } finally { ctx = prev; } }; g.__store = true; obj[k] = g; });
    wrap(T.ACT, 'action'); wrap(T.FORMS, 'form'); if (T.CHANGE) wrap(T.CHANGE, 'change');
    const wrapView = (obj, kind) => Object.keys(obj || {}).forEach((k) => { const f = obj[k]; if (typeof f !== 'function' || f.__store) return; const g = function (...a) { const prev = ctx; ctx = `${kind}:${k}`; try { return f.apply(this, a); } finally { ctx = prev; } }; g.__store = true; obj[k] = g; });
    wrapView(T.VIEWS, 'screen'); wrapView(T.HOME, 'home');
    Object.keys(T.CHART || {}).forEach((k) => { const f = T.CHART[k]; if (f.__store) return; const g = function (...a) { const prev = ctx; ctx = `chart:${k}`; try { return f.apply(this, a); } finally { ctx = prev; } }; g.__store = true; T.CHART[k] = g; });
  }
  function accessMap() {
    const out = {};
    map.forEach((n, k) => { const [coll, c, kind] = k.split('|'); const o = out[coll] = out[coll] || { reads: {}, writes: {} }; (kind === 'w' ? o.writes : o.reads)[c] = ((kind === 'w' ? o.writes : o.reads)[c] || 0) + n; });
    return out;
  }

  window.TesseraStore = {
    get info() { return adapter.info; }, notice,
    loadState: () => adapter.loadState(), saveState: (s) => { const t = tracing; tracing = false; try { adapter.saveState(s); } finally { tracing = t; } }, resetState: () => adapter.resetState(),
    loadSession: () => adapter.loadSession(), saveSession: (s) => adapter.saveSession(s),
    appendAudit: (ev, s) => adapter.appendAudit(ev, s), flash: { get: () => adapter.flash.get(), set: (t) => adapter.flash.set(t) },
    trackState, attach, note, setContext: (c) => { ctx = c; }, accessMap,
    trace: (on) => { tracing = !!on; map.clear(); }, get tracing() { return tracing; },
    adapters: { DemoAdapter, LiveAdapter }
  };
})();
