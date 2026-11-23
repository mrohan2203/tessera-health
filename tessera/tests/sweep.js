/* Tessera QA sweep. Load in a running page (http://localhost:8765) with:
     await import('/tests/sweep.js?' + Date.now()).then((m) => m.run())
   For every active account: open every page in its menu, click every action button, fill and
   submit every form (and any dialog it opens). Records exceptions, console errors, "undefined" /
   "NaN" / "[object Object]" leaking into the screen, links to pages the role can't open, and
   horizontal overflow. Destructive account actions (sign out, suspend, reset) are skipped. */
export async function run(opts = {}) {
  window.__qaDone = false;
  const T = window.Tessera; const q = (s) => document.querySelector(s);
  // MessageChannel ticks aren't throttled in hidden tabs the way timers are
  const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const wait = async (ms) => { for (let i = 0; i < Math.max(2, ms / 10); i++) await tick(); };
  const issues = []; let ctx = ''; const stats = { pages: 0, actions: 0, forms: 0, modals: 0 };
  const log = (kind, detail) => { const key = kind + '|' + ctx.split(' › ').slice(0, 2).join(' › ') + '|' + String(detail).slice(0, 160); if (!issues.some((i) => i.key === key)) issues.push({ key, kind, where: ctx, detail: String(detail).slice(0, 300) }); };
  const oe = console.error; console.error = (...a) => { log('console.error', a.map((x) => (x && x.stack) || String(x)).join(' ')); oe.apply(console, a); };
  const onErr = (e) => log('exception', (e.error && e.error.stack) || e.message); window.addEventListener('error', onErr);
  const onRej = (e) => log('unhandled rejection', (e.reason && (e.reason.stack || e.reason.code || e.reason.message)) || e.reason); window.addEventListener('unhandledrejection', onRej);
  // Wrap actions and forms so exceptions are attributed
  const wrap = (obj, label) => Object.keys(obj).forEach((k) => { const f = obj[k]; if (f.__qa) return; obj[k] = function (...a) { try { const r = f.apply(this, a); if (r && r.catch) r.catch((e) => log(label + ' rejected', k + ': ' + (e && e.stack || e))); return r; } catch (e) { log(label + ' threw', k + ': ' + (e && e.stack || e)); } }; obj[k].__qa = true; });
  wrap(T.ACT, 'action'); wrap(T.FORMS, 'form');
  const SKIP = new Set(['signout', 'reset', 'demo', 'mfa-ok', 'mfa-cancel', 'suspend', 'close-modal-bg', 'search-open', 'notif-go', 'go', 'rv-sign', 'amb-listen', 'vault-revoke', 'fam-remove', 'pt-revoke', 'cons-revoke', 'mr-verify', 'approve', 'deny', 'role-change']); // role changes are covered by the use-case script
  const scan = () => {
    const app = q('#app'); if (!app) return; const txt = app.innerText;
    const m = txt.match(/[^\n]{0,40}(undefined|NaN|\[object Object\]|null)[^\n]{0,30}/);
    if (m && !/null and void/i.test(m[0])) log('bad text', m[0].trim());
    if (document.documentElement.scrollWidth > window.innerWidth + 1) log('overflow', `${document.documentElement.scrollWidth}px > ${window.innerWidth}px`);
  };
  const fill = (form) => {
    form.querySelectorAll('input,select,textarea').forEach((el) => {
      if (el.disabled || el.type === 'hidden' || el.type === 'file' || el.type === 'range') return;
      if (el.tagName === 'SELECT') { if (!el.value || el.required) { const o = [...el.options].find((x) => x.value); if (o) el.value = o.value; } return; }
      if (el.type === 'checkbox') { if (el.required) el.checked = true; return; }
      if (el.value && !el.required) return; if (el.value) return;
      if (el.type === 'number') el.value = el.min && +el.min > 0 ? el.min : '2';
      else if (el.type === 'date') el.value = '1980-05-04';
      else if (el.pattern === '[0-9]{10}') el.value = '4155550100';
      else el.value = el.name === 'text' || el.tagName === 'TEXTAREA' ? 'QA test entry with enough detail for validation' : 'QA test';
    });
  };
  const submitForm = async (form) => { fill(form); const sub = form.querySelector('button[type=submit]:not([disabled])'); if (!sub) return; if (!form.checkValidity()) { log('form invalid after fill', form.dataset.form + ': ' + [...form.elements].filter((e) => !e.checkValidity()).map((e) => e.name || e.id).join(',')); return; } form.requestSubmit(sub); stats.forms++; await wait(40); };
  const handleModal = async () => { const mf = q('.modal form[data-form]'); if (mf) { stats.modals++; ctx += ' › modal ' + mf.dataset.form; await submitForm(mf); const still = q('.modal form[data-form]'); if (still) { const c = q('[data-act=close-modal]'); if (c) c.click(); await wait(20); } } };
  const signIn = async (u) => { const so = q('[data-act=signout]'); if (so) { so.click(); await wait(40); } const b = q(`[data-act=demo][data-u="${u.id}"]`); if (!b) { log('login', 'no demo button for ' + u.username); return false; } b.click(); await wait(30); q('[data-act=mfa-ok]').click(); await wait(60); return !!T.me(); };
  // Chrome ignores history updates beyond ~100 per 10 s (flood protection). Verify each one landed; back off if throttled.
  const go = async (h) => { for (let i = 0; i < 12; i++) { history.replaceState(null, '', '#' + h); if (location.hash === '#' + h) break; stats.throttled = (stats.throttled || 0) + 1; await new Promise((r) => setTimeout(r, 1000)); } T.UI.modal = null; T.render(); await wait(10); };
  const users = T.S.users.filter((u) => u.status === 'active' && (!opts.only || opts.only.includes(u.username)));
  for (const u of users) {
    if (!(await signIn(u))) continue;
    const routes = T.navFor(u).flatMap((s) => s[1].map((n) => n[0]));
    for (const r of routes) {
      ctx = `${u.username} › #${r}`; await go(r); scan(); stats.pages++;
      if (/Access denied/.test((q('.topbar') || {}).innerText || '')) log('denied in own menu', `${r} (signed in as ${(T.me() || {}).username || 'nobody'}; hash ${location.hash}; title ${(q('.topbar h1') || {}).innerText}; app has ${document.querySelectorAll('#app .topbar').length} topbar(s))`);
      // links on the page that lead to pages this role can't open
      const allowed = new Set(routes.concat(['patient'], (T.extraRoutes || {})[u.role] || []));
      [...document.querySelectorAll('.content a[href^="#"]')].forEach((a) => { const t = a.getAttribute('href').slice(1).split('-')[0]; if (t && !allowed.has(t)) log('link to forbidden page', `${a.innerText.trim().slice(0, 40)} → #${t}`); });
      // every action button, re-queried after each click since the page re-renders
      const seen = new Set();
      for (let guard = 0; guard < 60; guard++) {
        const btn = [...document.querySelectorAll('#app [data-act]')].find((b) => { const k = b.dataset.act + '|' + JSON.stringify(b.dataset); return !SKIP.has(b.dataset.act) && !seen.has(k) && !b.disabled && b.offsetParent !== null; });
        if (!btn) break; seen.add(btn.dataset.act + '|' + JSON.stringify(btn.dataset));
        ctx = `${u.username} › #${r} › [${btn.dataset.act}]`;
        btn.click(); stats.actions++; await wait(40); await handleModal(); scan();
        if (location.hash !== '#' + r && !location.hash.startsWith('#' + r + '-')) await go(r);
      }
      // every form on the page
      const formsSeen = new Set();
      for (let guard = 0; guard < 20; guard++) {
        const form = [...document.querySelectorAll('#app form[data-form]')].find((f) => !formsSeen.has(f.dataset.form + (f.querySelector('[name=p]') || {}).value) && !['login'].includes(f.dataset.form));
        if (!form) break; formsSeen.add(form.dataset.form + (form.querySelector('[name=p]') || {}).value);
        ctx = `${u.username} › #${r} › form ${form.dataset.form}`; await submitForm(form); await handleModal(); scan();
        if (location.hash !== '#' + r && !location.hash.startsWith('#' + r + '-')) await go(r);
      }
    }
    // chart tabs for roles with chart access
    if (['doctor', 'nurse', 'pharmacist'].includes(u.role)) {
      const p = T.myPatients(u)[0]; if (p) for (const tab of ['overview', 'meds', 'results', 'notes', 'orders', 'consents', 'timeline']) { ctx = `${u.username} › #patient-${p.id}-${tab}`; await go(`patient-${p.id}-${tab}`); scan(); for (const b of [...document.querySelectorAll('#app [data-act]')].filter((b) => !SKIP.has(b.dataset.act)).slice(0, 8)) { ctx = `${u.username} › chart ${tab} › [${b.dataset.act}]`; if (document.contains(b)) { b.click(); await wait(30); await handleModal(); scan(); } } }
    }
  }
  console.error = oe; window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej);
  window.__qa = issues; window.__qaDone = true; return { stats, count: issues.length, issues: issues.map((i) => `${i.kind} :: ${i.where} :: ${i.detail}`) };
}
