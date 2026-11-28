/* Tessera Health — data layer (Phase 1 of the backend plan).
   Every read and write of persisted data goes through one store with a pluggable adapter:
     demo  Today's behaviour. Synthetic data in this browser's localStorage, session in
           sessionStorage. Used by the published link and the offline iPhone app.
     live  The Tessera API (backend/). Turned on with ?mode=live and an API base URL, from
           TESSERA_CONFIG.apiBase or ?api=. Without a base URL it falls back to the demo with a
           notice. In live mode nothing containing health data is written to browser storage
           (persistsPHI: false).
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

  /* Live adapter: the Tessera API (backend/). The session is an HttpOnly cookie the browser holds;
     nothing about patients is written to localStorage or sessionStorage. State lives in memory for
     the open tab only and is rebuilt from GET /api/bootstrap after sign-in or a reload. */
  function LiveAdapter(cfg) {
    const base = String(cfg.apiBase).replace(/\/$/, '');
    let flashMsg = null;
    async function api(method, path, body) {
      const headers = {};
      if (method !== 'GET') headers['X-Tessera'] = '1'; // required on writes (CSRF); GETs stay simple requests
      if (body) headers['Content-Type'] = 'application/json';
      try {
        const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'include', cache: 'no-store' });
        let data = {}; try { data = await r.json(); } catch (e) {}
        return { ok: r.ok, status: r.status, data: data || {} };
      } catch (e) { return { ok: false, status: 0, data: { error: `Can't reach the Tessera API at ${base}. Check that it is running.` } }; }
    }
    return {
      info: { mode: 'live', persistsPHI: false, label: 'Live · data from the Tessera API, nothing stored on this device' },
      apiBase: base, api,
      // A sign-out still on its way to the server (it waits for pending saves). Survives a reload of this
      // tab so the next load can finish it. Holds no health data.
      pendingSignOut: { get: () => safe(() => sessionStorage.getItem('tessera-live-signout') === '1', false), set: (on) => safe(() => (on ? sessionStorage.setItem('tessera-live-signout', '1') : sessionStorage.removeItem('tessera-live-signout'))) },
      loadState: () => null, saveState: () => {}, resetState: () => {},
      loadSession: () => null, saveSession: () => {},
      // The server writes the authoritative audit row in the same transaction as each access; the
      // app's own events stay in memory for this tab.
      appendAudit: (ev, state) => { state.audit.push(ev); },
      flash: { get: () => { const f = flashMsg; flashMsg = null; return f; }, set: (t) => { flashMsg = t; } }
    };
  }

  const cfg = Object.assign({ mode: 'demo' }, window.TESSERA_CONFIG || {});
  const params = new URLSearchParams(location.search);
  const wanted = params.get('mode') || cfg.mode;
  let adapter = DemoAdapter, notice = '';
  if (wanted === 'live') {
    // ?api= is for local development only: a link must never be able to point the sign-in form at
    // another server. Deployed builds set TESSERA_CONFIG.apiBase instead.
    const devApi = safe(() => { const u = new URL(params.get('api')); return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && /^https?:$/.test(u.protocol) ? u.origin : ''; }, '');
    const apiBase = cfg.apiBase || devApi;
    if (apiBase) adapter = LiveAdapter(Object.assign({}, cfg, { apiBase }));
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
    get info() { return adapter.info; }, notice, live: adapter.info.mode === 'live',
    api: (m, p, b) => (adapter.api ? adapter.api(m, p, b) : Promise.reject(new Error('demo mode has no API'))),
    pendingSignOut: adapter.pendingSignOut || { get: () => false, set: () => {} },
    loadState: () => adapter.loadState(), saveState: (s) => { const t = tracing; tracing = false; try { adapter.saveState(s); } finally { tracing = t; } }, resetState: () => adapter.resetState(),
    loadSession: () => adapter.loadSession(), saveSession: (s) => adapter.saveSession(s),
    appendAudit: (ev, s) => adapter.appendAudit(ev, s), flash: { get: () => adapter.flash.get(), set: (t) => adapter.flash.set(t) },
    trackState, attach, note, setContext: (c) => { ctx = c; }, accessMap,
    trace: (on) => { tracing = !!on; map.clear(); }, get tracing() { return tracing; },
    adapters: { DemoAdapter, LiveAdapter }
  };
})();
