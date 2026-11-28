/* Tessera Health — pitch prototype. Vanilla JS, hash routing, no backend.
   State is read and written through window.TesseraStore (store.js): the demo adapter keeps it in
   this browser's storage; a live adapter will use the API. Not real-time by design. */
(function () {
  'use strict';
  const SEED = window.TESSERA_SEED;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const store = window.TesseraStore;
  const LIVE = !!store.live; // live mode: sign-in, census, charts and break-the-glass come from the Tessera API
  const idleMin = () => (S && S.config && S.config.idleMin) || 15;
  const IDLE_MS_FN = () => idleMin() * 60 * 1000;
  const DEPT = SEED.departments, UNIT = SEED.units;

  /* ---------------- state ---------------- */
  function freshState() {
    return {
      audit: [], btg: [], orders: clone(SEED.orders), results: clone(SEED.results), notes: clone(SEED.notes),
      users: clone(SEED.users), mar: clone(SEED.marCharted), claims: clone(SEED.claims), controlled: clone(SEED.controlled),
      counts: [], roleRequests: [], review: {}, reviewSigned: null, verified: {}, gapsDone: {}, seq: 100, appts: clone(SEED.appointments)
    };
  }
  const T = window.Tessera = { SEED, VIEWS: null, ACT: null, FORMS: null, CHART: null, HOME: {}, inits: [], after: [] };
  function withModules(s) { T.inits.forEach((fn) => fn(s)); return s; }
  let S = null; // created in boot(), after modules have registered their state
  const save = () => (LIVE ? liveSync() : store.saveState(S)); // live: send changed clinical records to the API

  let session = null;
  session = store.loadSession();
  const saveSession = () => store.saveSession(session);

  const UI = T.UI = { revealed: new Set(), pending: null, msg: '', modal: null, scan: null, marPatient: null, selClaim: null, search: '', auditFilter: { q: '', btg: false }, identified: null, addendumFor: null, chainResult: null };

  /* ---------------- helpers ---------------- */
  const allPts = () => SEED.patients.concat((S && S.extraPatients) || []);
  const P = (id) => { if (store.tracing) store.note('patients', 'r'); return allPts().find((p) => p.id === id); };
  const U = (id) => S.users.find((u) => u.id === id);
  const me = () => (session ? U(session.userId) : null);
  const nid = (prefix) => LIVE ? prefix + '-' + (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).toUpperCase() : prefix + '-' + (++S.seq); // live: unique across users
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); }
  const tok = (p) => !p ? '—' : p.token || 'PT-' + fnv('bayview|' + p.mrn).slice(0, 6).toUpperCase(); // live: the server's keyed token; '—' for a record not loaded
  const maskPhone = (n) => '(•••) •••-' + n.slice(-4);
  const fmtPhone = (n) => `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  const maskId = (m) => '••••' + m.slice(-4);
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dayStr = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const ago = (m) => m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min ago` : `${Math.floor(m / 1440)} d ago`;
  const initials = (n) => n.replace(/^Dr\.\s*/, '').replace(/,.*$/, '').split(/\s+/).map((s) => s[0]).slice(0, 2).join('');
  const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const timeStr = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ROLE_LABEL = { admin: 'Admin', doctor: 'Physician', nurse: 'Nurse', pharmacist: 'Pharmacist', billing: 'Billing', quality: 'Quality', receptionist: 'Front desk', lab: 'Lab', pathologist: 'Pathologist', radiologist: 'Radiologist', insurance: 'Insurance', executive: 'Executive', patient: 'Patient', platform: 'Platform' };
  const scopeOf = (u) => ({ doctor: DEPT[u.dept], nurse: UNIT[u.unit], pharmacist: 'Medication profiles', billing: 'Accounts & claims', quality: 'De-identified by default', receptionist: 'Demographics & scheduling', lab: 'Specimens & results', pathologist: 'Result verification', radiologist: 'Imaging orders only', insurance: 'Authorizations & claims', executive: 'Aggregates only, no PHI', patient: 'Own record only', platform: 'No tenant patient data' }[u.role] || 'No chart access');
  const purposeOf = (u) => ({ doctor: 'Treatment', nurse: 'Treatment', pharmacist: 'Treatment', lab: 'Treatment', pathologist: 'Treatment', radiologist: 'Treatment', receptionist: 'Treatment (registration)', billing: 'Payment', insurance: 'Payment', quality: 'Health care operations', executive: 'Health care operations', admin: 'Administration', patient: 'Individual access', platform: 'Platform operations' }[u.role] || '—');
  const location_ = (p) => p.unit ? `${UNIT[p.unit]} · ${p.bed}` : p.status === 'Day surgery' ? 'Day surgery' : 'Outpatient';

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* ---------------- audit (append-only, hash-chained) ---------------- */
  let lastKey = '', lastAt = 0;
  function audit(action, o = {}) {
    const u = me();
    const key = [action, o.patient ? o.patient.id : '', o.resource || '', o.detail || '', o.outcome || ''].join('|');
    if (key === lastKey && Date.now() - lastAt < 4000) return; // collapse duplicate events from re-renders
    lastKey = key; lastAt = Date.now();
    const prev = S.audit.length ? S.audit[S.audit.length - 1].hash : '00000000';
    const ev = {
      seq: S.audit.length + 1, ts: new Date().toISOString(),
      actor: o.actor || (u ? u.id : 'anonymous'), role: o.role || (u ? u.role : '—'),
      action, resource: o.resource || '', patient: o.patient ? tok(o.patient) : (o.patients || ''),
      purpose: o.purpose || (u ? purposeOf(u) : '—'), outcome: o.outcome || 'success', detail: o.detail || '',
      facility: SEED.org.facility, prev
    };
    ev.hash = fnv(prev + JSON.stringify(ev));
    store.appendAudit(ev, S);
  }
  function verifyChain() {
    let prev = '00000000';
    for (const ev of S.audit) {
      const { hash, ...rest } = ev;
      if (rest.prev !== prev || fnv(prev + JSON.stringify(rest)) !== hash) return { ok: false, at: ev.seq };
      prev = hash;
    }
    return { ok: true, n: S.audit.length };
  }

  /* ---------------- access policy (default deny) ---------------- */
  function careRel(u, p) {
    if (!u || !p) return false;
    if (LIVE) return u.role !== 'patient' && (p._access === 'care' || p._access === 'pharmacy'); // the server decided, from care relationships
    if (u.role === 'doctor') return p.dept === u.dept || (p.consults || []).includes(u.dept) || (u.dept === 'EMER' && (S.er || []).some((e) => e.patient === p.id));
    if (u.role === 'nurse') return (!!p.unit && (p.unit === u.unit || (SEED.unitGroups[u.unit] || []).includes(p.unit))) || (u.unit === 'PERIOP' && (S.ot || []).some((c) => c.patient === p.id));
    if (u.role === 'pharmacist') return true; // medication profile only
    return false;
  }
  const btgActive = (u, p) => S.btg.find((g) => g.user === u.id && g.patient === p.id && new Date(g.expires) > new Date());
  function chartAccess(u, p) {
    if (!['doctor', 'nurse', 'pharmacist'].includes(u.role)) return 'none';
    if (careRel(u, p)) return 'care';
    if (btgActive(u, p)) return 'btg';
    return 'btg-required';
  }
  const myPatients = (u) => allPts().filter((p) => careRel(u, p));
  const openResults = (u) => S.results.filter((r) => r.state !== 'Closed' && (u.role === 'doctor' || u.role === 'nurse') && careRel(u, P(r.patient)));
  const pendingSign = (u) => S.orders.filter((o) => o.status === 'Pending signature' && careRel(u, P(o.patient)));
  const verifyQueue = () => S.orders.filter((o) => o.type === 'Medication' && o.status === 'Signed' && !S.verified[o.id]);
  const invStatus = (i) => i.expDays < 0 ? ['crit', 'Quarantined — expired'] : i.qty < i.reorder ? ['warn', 'Low — reorder'] : i.expDays <= 60 ? ['warn', 'Near expiry'] : ['ok', 'OK'];

  function navFor(u) {
    const safety = ['Safety', [['report', 'Report incident']]];
    switch (u.role) {
      case 'admin': return [['Administration', [['home', 'Overview'], ['users', 'Users & roles'], ['audit', 'Audit log'], ['review', 'Access review']]], ['Privacy & safety', [['privacy', 'Privacy Sentinel'], ['alerts', 'Alert burden']]], ['Operations', [['credentials', 'Credentials & privileges'], ['assets', 'Assets & maintenance'], ['shifts', 'Staff & shifts'], ['twin', 'Hospital map']]], ['Configuration', [['config', 'Hospital configuration'], ['interop', 'Data exchange (FHIR)']]], ['Me', [['mywork', 'My work']]]];
      case 'executive': return [['Leadership', [['home', 'Command center'], ['forecast', 'Capacity forecast'], ['twin', 'Hospital map'], ['analytics', 'Analytics'], ['finance', 'Finance']]]];
      case 'platform': return [['Platform', [['home', 'Tenants & recovery']]]];
      case 'doctor': {
        const top = [['home', 'My day'], ['live', 'Doctor Live'], ['mywork', 'My work'], ['patients', 'Patients'], ['twins', 'Patient twins']];
        if (u.dept === 'EMER') top.splice(1, 0, ['er', 'Emergency board']);
        if (u.dept === 'SURG') top.splice(1, 0, ['ot', 'OT suite']);
        return [['Overview', top], ['Clinic', [['ambient', 'Ambient Doctor'], ['casesheet', 'OP case sheet'], ['rx', 'Prescriptions'], ['schedule', 'Clinic schedule'], ['encounters', 'Encounters'], ['tele', 'Telemedicine']]],
          ['Inpatient', [['beds', 'Bed board'], ['icu', 'ICU board'], ['events', 'Rapid response'], ['assess', 'Risk assessments'], ['medrec', 'Med reconciliation'], ['handover', 'Handover (ISBAR)'], ['pathways', 'Clinical pathways'], ['discharge', 'Discharge']]],
          ['Orders & results', [['orders', 'Orders (CPOE)'], ['results', 'Critical results'], ['gaps', 'Care gaps']]], ['Records', [['docintel', 'Document intelligence'], ['consents', 'Consents'], ['sdoh', 'Social needs']]], safety];
      }
      case 'nurse':
        if (u.unit === 'PERIOP') return [['Peri-op', [['home', 'Peri-op board'], ['mywork', 'My work'], ['ot', 'OT suite'], ['daycare', 'Day care'], ['patients', 'Patients'], ['twins', 'Patient twins'], ['results', 'Critical results']]], ['Inpatient', [['assess', 'Risk assessments'], ['handover', 'Handover (ISBAR)'], ['beds', 'Bed board']]], safety];
        return [['Unit', [['home', 'Unit board'], ['mywork', 'My work'], ['patients', 'Unit patients'], ['twins', 'Patient twins'], ['mar', 'eMAR'], ['results', 'Critical results']]],
          ['Inpatient', [['beds', 'Bed board'], ['icu', 'ICU board'], ['events', 'Rapid response'], ['assess', 'Risk assessments'], ['sdoh', 'Social needs'], ['handover', 'Handover (ISBAR)'], ['discharge', 'Discharge']]], ['Safety', [['infection', 'Infection control'], ['report', 'Report incident']]]];
      case 'pharmacist': return [['Pharmacy', [['home', 'Overview'], ['mywork', 'My work'], ['verify', 'Order verification'], ['inventory', 'Inventory'], ['patients', 'Medication profiles']]], ['Inpatient', [['medrec', 'Med reconciliation'], ['discharge', 'Discharge']]], safety];
      case 'lab': return [['Laboratory', [['home', 'Lab overview'], ['mywork', 'My work'], ['lab', 'Lab worklist'], ['bloodbank', 'Blood bank']]], safety];
      case 'pathologist': return [['Laboratory', [['home', 'Lab overview'], ['mywork', 'My work'], ['lab', 'Verification queue'], ['bloodbank', 'Blood bank']]], safety];
      case 'radiologist': return [['Radiology', [['home', 'Overview'], ['mywork', 'My work'], ['radiology', 'Worklist & reporting']]], safety];
      case 'receptionist': return [['Front desk', [['home', 'OPD queue'], ['mywork', 'My work'], ['registration', 'Registration'], ['appointments', 'Appointments'], ['encounters', 'Encounters']]], ['Capacity', [['beds', 'Bed board'], ['forecast', 'Capacity forecast'], ['twin', 'Hospital map']]], ['Engagement', [['engagement', 'Reminders & follow-up'], ['sdoh', 'Social needs referrals']]], safety];
      case 'billing': return [['Revenue cycle', [['home', 'Overview'], ['mywork', 'My work'], ['accounts', 'Accounts & claims'], ['estimates', 'Good faith estimates']]], ['Inpatient', [['discharge', 'Discharge']]]];
      case 'insurance': return [['Insurance desk', [['home', 'Overview'], ['mywork', 'My work'], ['insurance', 'Pre-auth & claims']]], ['Inpatient', [['discharge', 'Discharge']]]];
      case 'quality': return [['Quality', [['home', 'Overview'], ['mywork', 'My work'], ['measures', 'HEDIS measures'], ['gaps', 'Care gaps'], ['sdoh', 'Social needs (SDOH)'], ['alerts', 'Alert burden'], ['research', 'Research & cohorts']]], ['Safety', [['infection', 'Infection control'], ['incidents', 'Incidents'], ['report', 'Report incident']]]];
      case 'patient': return [['My health', [['home', 'Home'], ['visits', 'Visits'], ['mytwin', 'My health twin'], ['myresults', 'Results'], ['mymeds', 'Medications'], ['bills', 'Bills'], ['vault', 'My vault'], ['myconsents', 'Consents'], ['people', 'Family updates'], ['access', 'Who viewed my record']]]];
      default: return [];
    }
  }
  const navIds = (u) => navFor(u).flatMap((sec) => sec[1].map((n) => n[0]));
  function navCount(u, id) {
    if (id === 'results') { const n = openResults(u).length; return n ? `<span class="count crit">${n}</span>` : ''; }
    if (id === 'orders') { const n = pendingSign(u).length; return n ? `<span class="count">${n}</span>` : ''; }
    if (id === 'verify') { const n = verifyQueue().length; return n ? `<span class="count">${n}</span>` : ''; }
    if (id === 'accounts') { const n = S.claims.filter((c) => c.status === 'Denied').length; return n ? `<span class="count crit">${n}</span>` : ''; }
    if (id === 'users') { const n = S.roleRequests.filter((r) => r.status === 'pending').length; return n ? `<span class="count">${n}</span>` : ''; }
    if (id === 'audit') { const n = S.btg.filter((g) => !g.reviewed).length; return n ? `<span class="count crit">${n}</span>` : ''; }
    if (T.counts && T.counts[id]) return T.counts[id](u) || '';
    return '';
  }

  /* ---------------- shared fragments ---------------- */
  const LOGO = `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2" fill="#4fbfc3"/><rect x="15" y="1" width="12" height="12" rx="2" fill="#2c8f94"/><rect x="1" y="15" width="12" height="12" rx="2" fill="#2c8f94"/><rect x="15" y="15" width="12" height="12" rx="2" fill="#e2ecee"/></svg>`;
  const pill = (cls, txt) => `<span class="pill ${cls}">${esc(txt)}</span>`;
  const statePill = (s) => {
    const map = { 'Pending signature': 'warn', Signed: 'info', Active: 'info', Completed: 'ok', Discontinued: '', 'Rejected by pharmacy': 'crit', New: 'crit', Acknowledged: 'warn', Owned: 'info', Closed: 'ok',
      Paid: 'ok', Denied: 'crit', Submitted: 'info', 'Ready to submit': 'accent', 'Prior auth pending': 'warn', 'Open encounter': '', active: 'ok', suspended: 'crit', Admitted: 'info', Outpatient: '',
      'In room': 'info', Arrived: 'accent', Waiting: 'warn', Scheduled: '', 'No-show': 'crit', Emergency: 'crit', 'Day care': 'accent', 'Day surgery': 'accent',
      Done: 'ok', Pending: 'warn', Blocked: 'crit', Approved: 'ok', 'Payer query': 'crit', 'Documents needed': 'warn', 'In treatment': 'info', 'In session': 'info', 'Waiting room': 'warn', Released: 'ok', Resulted: 'warn', Ordered: '', Collected: 'accent', Received: 'accent', Reported: 'ok', 'In progress': 'info', Crossmatched: 'accent', Requested: 'warn', Issued: 'ok', Recovery: 'accent', Preparation: 'warn', 'In surgery': 'info' };
    return pill(map[s] ?? '', s);
  };
  const allergyChips = (p) => p.allergiesUnknown ? pill('warn', 'Allergies unknown') : p.allergies.length ? p.allergies.map((a) => pill(a.severity === 'Severe' ? 'crit' : 'warn', `${a.agent} · ${a.reaction}`)).join('') : pill('ok', 'No known allergies');
  const phoneCell = (p) => !p.phone ? '<span class="muted">—</span>' : UI.revealed.has(p.id) ? `<span class="mono">${fmtPhone(p.phone)}</span>` : `<span class="mono">${maskPhone(p.phone)}</span> <button class="linkbtn" data-act="reveal" data-p="${p.id}">Reveal</button>`;
  const tiles = (arr) => `<div class="tiles">${arr.map(([n, l, cls]) => `<div class="tile ${cls || ''}"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
  const panel = (title, body, extra = '', flush = false) => `<section class="panel"><header><h2>${title}</h2>${extra}</header><div class="body${flush ? ' flush' : ''}">${body}</div></section>`;
  const table = (heads, rows) => `<div class="tbl"><table class="t"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="muted">Nothing here.</td></tr>`}</tbody></table></div>`;

  /* ---------------- auth views ---------------- */
  // Pitch mode: entry shows only the demo accounts. Set to true to bring back username + password.
  const SHOW_PASSWORD_SIGNIN = false;
  const ENTRY_GROUPS = [['clinical', 'Clinical', ['doctor', 'nurse', 'pharmacist']], ['dx', 'Diagnostics', ['lab', 'pathologist', 'radiologist']], ['front', 'Front office & revenue', ['receptionist', 'billing', 'insurance']], ['lead', 'Quality, leadership & admin', ['quality', 'executive', 'admin', 'platform']], ['patient', 'Patient', ['patient']]];
  const entryMosaic = (n, cols) => Array.from({ length: n }, (_, i) => { const h = (i * 2654435761 >>> 0) % 97; const c = h < 30 ? 'g1' : h < 52 ? 'g2' : h < 70 ? 'g3' : h < 84 ? 'g4' : h < 93 ? 'g0' : 'gl'; return `<i class="${c}" style="--d:${(h % 29) * 110}ms"></i>`; }).join('');
  function viewLogin() {
    const f = UI.loginFilter || 'all';
    const card = (u, g) => `<button class="e-card g-${g}" data-act="demo" data-u="${u.id}">
        <span class="e-av">${esc(initials(u.name))}</span>
        <span class="e-who"><b>${esc(u.name)}</b><span>${esc(ROLE_LABEL[u.role])} · ${esc(u.role === 'doctor' ? DEPT[u.dept] : u.role === 'nurse' ? UNIT[u.unit] : u.title)}</span></span>
        ${u.status !== 'active' ? '<span class="e-tag">Suspended</span>' : '<span class="e-go" aria-hidden="true">→</span>'}</button>`;
    const groups = ENTRY_GROUPS.filter(([id]) => f === 'all' || f === id).map(([id, label, roles]) => {
      const us = S.users.filter((u) => roles.includes(u.role)); if (!us.length) return '';
      return `<section class="e-group"><h3><span class="e-dot g-${id}"></span>${label}<small>${us.length}</small></h3><div class="e-grid">${us.map((u) => card(u, id)).join('')}</div></section>`;
    }).join('');
    const chips = [['all', 'Everyone']].concat(ENTRY_GROUPS.map(([id]) => [id, { clinical: 'Clinical', dx: 'Diagnostics', front: 'Front office', lead: 'Leadership', patient: 'Patient' }[id]])).map(([id, l]) => `<button class="e-chip ${f === id ? 'on' : ''}" data-act="login-filter" data-g="${id}" aria-pressed="${f === id}">${esc(l)}</button>`).join('');
    const pwForm = `<form data-form="login" autocomplete="on" class="e-pw" ${SHOW_PASSWORD_SIGNIN ? '' : 'hidden'}>
          <div class="field"><label for="lg-user">Username</label><input id="lg-user" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>
          <div class="field"><label for="lg-pass">Password</label><input id="lg-pass" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn primary" type="submit">Continue</button></form>`;
    return `<div class="entry">
      <div class="e-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="e-mosaic" aria-hidden="true">${entryMosaic(96)}</div>
      <header class="e-top"><div class="e-brand">${LOGO}<div><b>Tessera Health</b><small>${esc(SEED.org.name)}</small></div></div><span class="e-live"><i></i>Pitch demo</span></header>
      <div class="e-body">
        <div class="e-pitch">
          <span class="e-kicker">Hospital management, reimagined</span>
          <h1>One record.<br><em>Every role</em> sees<br>only what it needs.</h1>
          <p>Pick a seat below and walk the hospital as that person — doctor, nurse, pharmacist, front desk, billing, leadership or patient.</p>
          <div class="e-stats"><span><b>${S.users.filter((u) => u.status === 'active').length}</b>accounts to try</span><span><b>40+</b>modules</span><span><b>100%</b>views audited</span></div>
          <div class="e-trust">${['Designed to HIPAA', 'SOC 2 controls mapped', 'HEDIS MY2026'].map((t) => `<span>${t}</span>`).join('')}</div>
        </div>
        <div class="e-panel">
          <div class="e-panel-head"><h2>Choose who you are</h2><p>One tap signs you in. Each account still passes a simulated second factor.</p></div>
          ${UI.msg ? `<div class="e-msg" role="alert">${esc(UI.msg)}</div>` : ''}
          ${pwForm}
          <div class="e-chips" role="group" aria-label="Filter accounts">${chips}</div>
          ${groups}
          <footer class="e-foot"><span>Synthetic data only · not for clinical use</span><button class="linkbtn" data-act="reset">Reset demo data</button></footer>
        </div>
      </div>
    </div>`;
  }
  function viewMfa() {
    const u = U(UI.pending);
    const g = (ENTRY_GROUPS.find(([, , roles]) => roles.includes(u.role)) || ['clinical'])[0];
    return `<div class="entry e-mfa">
      <div class="e-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="e-mosaic" aria-hidden="true">${entryMosaic(96)}</div>
      <header class="e-top"><div class="e-brand">${LOGO}<div><b>Tessera Health</b><small>Multi-factor sign-in</small></div></div></header>
      <div class="e-mfa-card">
        <div class="e-key" aria-hidden="true"><span></span><span></span><span></span><b class="g-${g}">${esc(initials(u.name))}</b></div>
        <span class="e-kicker">Confirm it's you</span>
        <h1>${esc(u.name)}</h1>
        <p class="e-role">${esc(u.title)}</p>
        <div class="e-factor"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></svg>Second factor: <b>${esc(u.mfa === 'Not enrolled' ? 'Authenticator app' : u.mfa)}</b></div>
        <button class="e-approve" data-act="mfa-ok">Approve sign-in <span aria-hidden="true">→</span></button>
        <button class="e-cancel" data-act="mfa-cancel">Choose a different account</button>
        <p class="e-note">Prototype: approval is simulated · session locks after ${idleMin()} min idle</p>
      </div>
    </div>`;
  }

  /* ---------------- shell ---------------- */
  function shell(u, route, v) {
    const nav = navFor(u).map(([sec, items]) => `<span class="navsec">${sec}</span>` + items.map(([id, label]) => `<a href="#${id}" ${route === id ? 'aria-current="page"' : ''}><span>${label}</span>${navCount(u, id)}</a>`).join('')).join('');
    return `<div class="shell">
      <aside class="rail">
        <div class="brand">${LOGO}<div><b>Tessera Health</b><small>${esc(SEED.org.name)}</small></div></div>
        <nav aria-label="Main">${nav}</nav>
        <div class="who"><div class="row" style="gap:10px;flex-wrap:nowrap"><span class="usertile role-${u.role}" aria-hidden="true">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><br><span>${esc(u.title)}</span></div></div><button data-act="signout">Sign out</button><span class="lockline">Locks after ${idleMin()} min idle</span></div>
      </aside>
      <div class="main">
        <div class="topbar"><div class="crumbs">${(() => { const sec = navFor(u).find((x) => x[1].some((n) => n[0] === route)); return sec ? `<span class="eyebrow">${sec[0]}</span>` : route === 'patient' ? '<span class="eyebrow">Chart</span>' : ''; })()}<h1>${v.title}</h1>${v.sub ? `<small>${v.sub}</small>` : ''}</div>
          <div class="row" style="gap:8px">${T.topbarExtras ? T.topbarExtras(u) : ''}<span class="rolechip"><i>${ROLE_LABEL[u.role]}</i>${esc(scopeOf(u))}</span></div></div>
        <div class="strip" aria-hidden="true"></div>
        <div class="content">${LIVE && route === 'home' ? `<div class="banner info"><p><b>Live mode.</b> Sign-in, your patient list, charts, orders, results, notes, lab orders, the eMAR, pharmacist verification, vitals, care plans, rapid-response records, medication reconciliation, break-the-glass and the audit log come from the Tessera API, which checks every change. Nothing is stored on this device. Front office, billing, diagnostics and other modules still use synthetic demo data until Phase 4.</p></div>` : ''}${v.body}</div>
        <div class="demo-foot">Tessera Health prototype · synthetic patients · data stays on this device · not real-time</div>
      </div>
    </div>${UI.modal ? modalHtml() : ''}`;
  }
  function modalHtml() {
    const m = UI.modal;
    return `<div class="modal-back" data-act="close-modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <h2 id="m-title">${m.title}</h2>
      <form data-form="${m.form}" class="stack">${m.body}
        <div class="row"><button type="submit" class="btn ${m.danger ? 'danger' : 'primary'}">${m.submit || 'Save'}</button><button type="button" class="btn" data-act="close-modal">Cancel</button></div>
      </form></div></div>`;
  }
  function openModal(m) { UI.modal = m; render(); setTimeout(() => { const f = document.querySelector('.modal input, .modal select, .modal textarea'); f && f.focus(); }, 0); }

  /* ---------------- views ---------------- */
  const VIEWS = {};

  VIEWS.home = (u) => {
    const mh = T.HOME[u.role + ':' + (u.unit || u.dept || '')] || T.HOME[u.role];
    if (mh) return mh(u);
    if (u.role === 'doctor') {
      const mine = myPatients(u), appts = S.appts.filter((a) => a.provider === u.id), res = openResults(u);
      const gaps = SEED.gaps.filter((g) => g.attributed === u.id && !S.gapsDone[g.patient + g.measure]);
      const resRows = res.map((r) => { const p = P(r.patient); return `<tr class="clickable" data-act="go" data-href="#results"><td>${esc(r.test)} <b>${esc(r.value)}</b><span class="sub">${esc(p.name)} · ${ago(r.mOff)}</span></td><td>${statePill(r.state)}</td></tr>`; });
      const apRows = appts.map((a) => { const p = P(a.patient); return `<tr class="clickable" data-act="go" data-href="#patient-${p.id}-overview"><td class="mono">${a.time}</td><td>${esc(p.name)}<span class="sub">${p.age}${p.sex} · MRN ${p.mrn}</span></td><td>${esc(a.reason)}</td><td>${statePill(a.status)}</td></tr>`; });
      return { title: `Good day, ${esc(u.name.replace(/,.*/, ''))}`, sub: `${DEPT[u.dept]} · ${dayStr(0)}`, body:
        tiles([[mine.length, 'Patients in my care'], [appts.length, 'Clinic visits today'], [pendingSign(u).length, 'Orders to sign', pendingSign(u).length ? 'warn' : ''], [res.length, 'Open critical results', res.length ? 'crit' : ''], [gaps.length, 'Care gaps (HEDIS)']]) +
        (() => { if (!appts.length) return ''; const start = 8 * 60, span = 10 * 60; const pos = (t) => (toMin(t) - start) / span * 100; const nm = nowMin();
          const lanes = []; const tilesHtml = appts.slice().sort((x, y) => toMin(x.time) - toMin(y.time)).map((a) => { const p = P(a.patient); const l = pos(a.time); let lane = lanes.findIndex((e) => e <= l); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = l + 10.5;
            return `<a class="vt ${a.status.replace(' ', ' ')}" href="#patient-${p.id}-overview" style="left:calc(12px + (100% - 24px) * ${l / 100});width:calc((100% - 24px) * .1);top:${34 + lane * 42}px" title="${esc(a.time + ' · ' + p.name + ' · ' + a.status)}"><b>${a.time} ${esc(p.name.split(' ')[0])}</b>${esc(a.status)}</a>`; }).join('');
          return `<div class="ribbon-wrap"><div class="ribbon" style="min-height:${60 + lanes.length * 42}px" aria-label="Today's visits on a timeline">${Array.from({ length: 10 }, (_, i) => `<div class="hr"><span>${String(8 + i).padStart(2, '0')}:00</span></div>`).join('')}${nm >= start && nm <= start + span ? `<i class="now" style="left:calc(12px + (100% - 24px) * ${(nm - start) / span})"></i>` : ''}${tilesHtml}</div></div>`; })() +
        `<div class="grid-2">${panel("Today's clinic", table(['Time', 'Patient', 'Reason', 'Status'], apRows), '<a href="#schedule">Full schedule</a>', true)}${panel('Critical results waiting on you', table(['Result', 'State'], resRows), '<a href="#results">Open results</a>', true)}</div>` };
    }
    if (u.role === 'nurse') {
      const pts = myPatients(u), res = openResults(u);
      let due = 0, missed = 0;
      SEED.mar.filter((m) => P(m.patient).unit === u.unit).forEach((m) => m.times.forEach((t) => { const s = marState(m, t); if (s === 'Due') due++; if (s === 'Missed') missed++; }));
      const rows = pts.map((p) => `<tr class="clickable" data-act="go" data-href="#patient-${p.id}-overview"><td class="mono">${esc(p.bed)}</td><td>${esc(p.name)}<span class="sub">${p.age}${p.sex} · MRN ${p.mrn}</span></td><td>${esc(p.code)}</td><td><div class="chips">${allergyChips(p)}</div></td><td class="mono">BP ${p.vitals.bp} · HR ${p.vitals.hr} · SpO₂ ${p.vitals.spo2}%</td></tr>`);
      return { title: UNIT[u.unit], sub: `Unit board · ${dayStr(0)} · day shift`, body:
        tiles([[pts.length, 'Census'], [due, 'Doses due', due ? 'warn' : ''], [missed, 'Missed doses', missed ? 'crit' : ''], [res.length, 'Open critical results', res.length ? 'crit' : '']]) +
        panel('Patients on unit', table(['Bed', 'Patient', 'Code status', 'Allergies', 'Latest vitals'], rows), '<a href="#mar">Open eMAR</a>', true) };
    }
    if (u.role === 'pharmacist') {
      const q = verifyQueue(), flags = S.orders.filter((o) => o.flag && o.status === 'Pending signature');
      const quarantined = SEED.inventory.filter((i) => i.expDays < 0).length, low = SEED.inventory.filter((i) => i.qty < i.reorder).length;
      const due = S.controlled.filter((c) => c.lastCount < 0).length;
      const rows = flags.map((o) => { const p = P(o.patient); return `<tr><td>${esc(o.text)}<span class="sub">${esc(p.name)} · MRN ${p.mrn}</span></td><td>${pill(o.flag.kind === 'allergy' || o.flag.kind === 'interaction' ? 'crit' : 'warn', o.flag.kind)}</td><td class="muted">Awaiting prescriber</td></tr>`; });
      return { title: 'Pharmacy', sub: 'Verification, safety and stock', body:
        tiles([[q.length, 'Orders to verify', q.length ? 'warn' : ''], [flags.length, 'Safety flags open', flags.length ? 'crit' : ''], [quarantined, 'Lots quarantined', quarantined ? 'crit' : ''], [low, 'Low stock'], [due, 'Controlled counts due', due ? 'warn' : '']]) +
        panel('Safety flags on unsigned orders', table(['Order', 'Flag', 'Status'], rows), '<a href="#verify">Verification queue</a>', true) };
    }
    if (u.role === 'billing') {
      const c = S.claims, ar = c.filter((x) => x.status !== 'Paid').reduce((s, x) => s + x.charge, 0), paid = c.reduce((s, x) => s + (x.paid || 0), 0);
      const work = c.filter((x) => ['Denied', 'Prior auth pending', 'Ready to submit'].includes(x.status)).map((x) => { const p = P(x.patient); return `<tr class="clickable" data-act="claim" data-c="${x.id}"><td class="mono">${x.id}</td><td>${esc(p.name)}<span class="sub">MRN ${p.mrn}</span></td><td>${esc(p.payer)}</td><td class="num">${money(x.charge)}</td><td>${statePill(x.status)}${x.note ? `<span class="sub">${esc(x.note)}</span>` : ''}</td></tr>`; });
      return { title: 'Revenue cycle', sub: 'Accounts, claims and remittances', body:
        tiles([[c.filter((x) => x.status === 'Ready to submit').length, 'Ready to submit'], [c.filter((x) => x.status === 'Submitted').length, 'Submitted'], [c.filter((x) => x.status === 'Denied').length, 'Denied', 'crit'], [c.filter((x) => x.status === 'Prior auth pending').length, 'Prior auth pending', 'warn'], [money(ar), 'Open A/R'], [money(paid), 'Collected']]) +
        `<div class="banner info"><p>Billing sees demographics, coverage, codes and charges. Notes, results and medication details aren't available to this role.</p></div>` +
        panel('Work queue', table(['Claim', 'Patient', 'Payer', 'Charge', 'Status'], work), '<a href="#accounts">All accounts</a>', true) };
    }
    if (u.role === 'quality') {
      const m = SEED.measures.slice(0, 4).map((x) => [Math.round(x.num / x.den * 100) + '%', `${x.code} · ${x.inverse ? 'lower is better' : 'target ' + x.target + '%'}`, (x.inverse ? x.num / x.den * 100 > x.target : x.num / x.den * 100 < x.target) ? 'warn' : '']);
      return { title: 'Quality overview', sub: 'HEDIS measurement year 2026 · synthetic plan population', body: tiles(m) +
        `<div class="banner info"><p>You see rates and de-identified gap lists by default. Revealing names takes a stated purpose and is logged.</p></div>` +
        panel('Open care gaps', `<p>${SEED.gaps.length} open gaps across ${new Set(SEED.gaps.map((g) => g.measure)).size} measures. Each gap goes to the attributed clinician's worklist.</p><div><a class="btn" href="#gaps">Review gaps</a> <a class="btn" href="#measures">All measures</a></div>`) };
    }
    // admin
    const today = new Date().toDateString();
    const evToday = S.audit.filter((e) => new Date(e.ts).toDateString() === today).length;
    const recent = S.audit.slice(-8).reverse().map(auditRow);
    return { title: 'Administration', sub: `${SEED.org.name} · tenant ${SEED.org.tenant}`, body:
      tiles([[S.users.filter((x) => x.status === 'active').length, 'Active users'], [S.users.filter((x) => x.status !== 'active').length, 'Suspended'], [S.users.filter((x) => x.mfa === 'Not enrolled').length, 'MFA not enrolled', 'warn'], [S.btg.filter((g) => !g.reviewed).length, 'Break-the-glass to review', S.btg.some((g) => !g.reviewed) ? 'crit' : ''], [evToday, 'Audit events today'], [S.roleRequests.filter((r) => r.status === 'pending').length, 'Role changes pending']]) +
      `<div class="banner info"><p>Administrators manage users, roles and audit. They can't open patient charts. <a href="#patient-P01-overview">Try opening one</a> to see the block and the audit entry it creates.</p></div>` +
      panel('Latest audit events', table(['#', 'Time', 'Who', 'Action', 'Patient token', 'Outcome'], recent), '<a href="#audit">Full audit log</a>', true) };
  };

  VIEWS.patients = (u) => {
    const q = UI.search.trim().toLowerCase();
    let list = myPatients(u);
    if (q) list = allPts().filter((p) => (p._stub ? p._match === q : p.name.toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q)));
    audit('list-patients', { resource: q ? `search "${q}"` : 'my patients', patients: list.map(tok).join(' '), detail: `${list.length} returned` });
    const rows = list.map((p) => {
      const acc = chartAccess(u, p);
      const lock = acc === 'btg-required';
      return `<tr class="clickable ${lock ? 'locked' : ''}" data-act="go" data-href="#patient-${p.id}-${u.role === 'pharmacist' ? 'meds' : 'overview'}">
        <td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn} · ${p.age}${p.sex}</span></td><td>${esc(DEPT[p.dept])}<span class="sub">${esc(location_(p))}</span></td>
        <td>${statePill(p.status)}</td><td><div class="chips">${allergyChips(p)}</div></td><td>${phoneCell(p)}</td>
        <td>${lock ? pill('crit', 'No care relationship') : acc === 'btg' ? pill('warn', 'Break-the-glass active') : pill('ok', u.role === 'pharmacist' ? 'Medication profile' : (p.dept === u.dept || p.unit === u.unit) ? 'Care team' : 'Consult')}</td></tr>`;
    });
    return { title: u.role === 'nurse' ? 'Unit patients' : u.role === 'pharmacist' ? 'Medication profiles' : 'Patients', sub: q ? `Hospital-wide search · ${list.length} result(s)` : `Showing patients in your scope: ${esc(scopeOf(u))}`, body:
      `<form data-form="psearch" class="row"><input class="search" name="q" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(UI.search)}" placeholder="Search hospital by name or MRN" aria-label="Search patients"><button class="btn" type="submit">Search</button>${q ? '<button class="btn" type="button" data-act="clear-search">Back to my patients</button>' : ''}</form>` +
      (q ? '<div class="banner info"><p>Hospital-wide search returns a minimal header only. Opening a patient outside your care relationship needs break-the-glass.</p></div>' : '') +
      panel('Patient list', table(['Patient', 'Department / location', 'Status', 'Allergies', 'Phone', 'Access'], rows), `<span class="muted" style="font-size:12px">${list.length} patients · this list view is logged</span>`, true) };
  };

  VIEWS.patient = (u, args) => {
    const p = P(args[0]);
    if (!p) return viewDenied(u, 'unknown patient');
    const acc = chartAccess(u, p);
    if (acc === 'none') { audit('chart-access', { patient: p, outcome: 'denied', detail: `role ${u.role} has no chart permission` }); return viewDenied(u, 'patient charts', true); }
    if (acc === 'btg-required') { audit('chart-access', { patient: p, outcome: 'blocked', detail: 'no care relationship' }); return viewBtg(u, p); }
    const tabsFor = u.role === 'doctor' ? [['overview', 'Overview'], ['vitals', 'Vitals'], ['careplan', 'Care plan'], ['meds', 'Medications'], ['results', 'Results'], ['notes', 'Notes'], ['orders', 'Orders'], ['consents', 'Consents'], ['timeline', 'Timeline'], ['twin', 'Twin']]
      : u.role === 'nurse' ? [['overview', 'Overview'], ['vitals', 'Vitals'], ['careplan', 'Care plan'], ['meds', 'Medications'], ['results', 'Results'], ['notes', 'Notes'], ['timeline', 'Timeline'], ['twin', 'Twin']] : [['meds', 'Medication profile']];
    let tab = args[1] || tabsFor[0][0];
    if (!tabsFor.some((t) => t[0] === tab)) tab = tabsFor[0][0];
    const g = acc === 'btg' ? btgActive(u, p) : null;
    audit('view-chart', { patient: p, resource: tab, purpose: g ? 'Emergency (break-the-glass)' : purposeOf(u) });
    const att = U(p.attending);
    const lastMorse = (S.assessments || []).filter((a) => a.patient === p.id && a.tool === 'morse').slice(-1)[0];
    const bands = [];
    if (p.allergiesUnknown) bands.push(['red', 'Allergies unknown']);
    else if (p.allergies.some((a) => !/latex/i.test(a.agent))) bands.push(['red', 'Allergy: ' + p.allergies.filter((a) => !/latex/i.test(a.agent)).map((a) => a.agent).join(', ')]);
    if (p.allergies.some((a) => /latex/i.test(a.agent))) bands.push(['green', 'Latex allergy']);
    if (p.code !== 'Full code') bands.push(['purple', p.code]);
    if (lastMorse && lastMorse.score >= 45) bands.push(['yellow', 'Fall risk']);
    if ((SEED.isolation || []).some((i) => i.patient === p.id)) bands.push(['grey', SEED.isolation.find((i) => i.patient === p.id).type + ' precautions']);
    const wrist = bands.length ? `<div class="wrist" aria-label="Alert bands">${bands.map(([c, t]) => `<span class="band ${c}">${esc(t)}</span>`).join('')}</div>` : '';
    const header = `<section class="panel ptpanel">${wrist}<div class="body">
      <div class="ptheader"><div class="row" style="align-items:flex-start"><div class="avatar">${esc(initials(p.name))}</div>
        <div class="stack" style="gap:2px"><h2>${esc(p.name)}</h2><span class="muted">${p.age} y · ${p.sex === 'M' ? 'Male' : 'Female'} · DOB ${p.dob} · MRN <span class="mono">${p.mrn}</span></span></div></div>
        <div class="chips">${statePill(p.status)}${pill(p.code === 'Full code' ? '' : 'crit', p.code)}</div></div>
      <dl class="kv" style="margin:0"><div><dt>Department</dt><dd style="margin:0">${esc(DEPT[p.dept])}</dd></div><div><dt>Location</dt><dd style="margin:0">${esc(location_(p))}</dd></div>
        <div><dt>Attending</dt><dd style="margin:0">${esc(att ? att.name : '—')}</dd></div><div><dt>Phone</dt><dd style="margin:0">${phoneCell(p)}</dd></div>
        <div><dt>Weight / height</dt><dd style="margin:0">${p.weightKg} kg · ${p.heightCm} cm</dd></div></dl>
      <div class="chips"><span class="muted" style="font-size:12px;margin-right:4px">ALLERGIES</span>${allergyChips(p)}</div></div></section>`;
    const btgBanner = g ? `<div class="banner crit"><p><b>Break-the-glass access.</b> Reason: ${esc(g.reason)}. Expires ${timeStr(g.expires)}. The Privacy Office has been notified and will review this access.</p></div>` : '';
    const tabs = `<nav class="tabs" aria-label="Chart sections">${tabsFor.map(([id, l]) => `<a href="#patient-${p.id}-${id}" ${tab === id ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
    return { title: esc(p.name), sub: `Chart · ${g ? 'emergency access' : u.role === 'pharmacist' ? 'medication profile only' : 'care team access'} · every view is logged`, body: btgBanner + header + tabs + CHART[tab](u, p) };
  };

  const CHART = {
    overview(u, p) {
      const v = p.vitals;
      const labs = p.labs.slice(0, 4).map((l) => `<tr><td>${esc(l.test)}</td><td class="num"><b>${esc(l.value)}</b> ${esc(l.unit)}</td><td>${l.flag ? pill(l.flag.length > 1 ? 'crit' : 'warn', l.flag) : ''}</td></tr>`);
      return `<div class="grid">${panel('Problem list', `<ul style="margin:0;padding-left:18px">${p.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`)}
        ${panel('Latest vitals', (() => { const vs = T.hist ? T.hist.vitals(p) : []; const pv = vs[vs.length - 2]; const sp = (k) => (vs.length > 2 ? T.hist.spark(vs.slice(-12).map((x) => x[k]).filter((x) => x != null), { w: 64, h: 18 }) : '');
          const dd = (k, cur) => { if (!pv || pv[k] == null) return ''; const d = cur - pv[k]; return Math.abs(d) < (k === 'temp' ? 0.05 : 0.5) ? '' : `<small class="dl ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${k === 'temp' ? Math.abs(d).toFixed(1) : Math.abs(Math.round(d))}</small>`; };
          const sb = +String(v.bp).split('/')[0];
          return `<dl class="kv vkv" style="margin:0"><div><dt>BP</dt><dd class="num" style="margin:0">${v.bp}${dd('sbp', sb)}${sp('sbp')}</dd></div><div><dt>Heart rate</dt><dd class="num" style="margin:0">${v.hr}${dd('hr', v.hr)}${sp('hr')}</dd></div><div><dt>Resp. rate</dt><dd class="num" style="margin:0">${v.rr}${dd('rr', v.rr)}${sp('rr')}</dd></div><div><dt>Temp °F</dt><dd class="num" style="margin:0">${v.temp}${dd('temp', v.temp)}${sp('temp')}</dd></div><div><dt>SpO₂</dt><dd class="num" style="margin:0">${v.spo2}%${dd('spo2', v.spo2)}${sp('spo2')}</dd></div></dl>${vs.length && (u.role === 'doctor' || u.role === 'nurse') ? `<p class="kpi-note" style="margin:8px 0 0">Charted ${esc(T.hist.fmtT(vs[vs.length - 1].at))} · <a href="#patient-${p.id}-vitals">Flowsheet and trends</a></p>` : ''}`; })())}
        ${panel('Recent results', table(['Test', 'Value', 'Flag'], labs), '', true)}</div>`;
    },
    meds(u, p) {
      const flags = S.orders.filter((o) => o.patient === p.id && o.flag && o.status === 'Pending signature');
      const rows = p.meds.map((m) => `<tr><td><b>${esc(m.drug)}</b></td><td>${esc(m.dose || '—')}</td><td>${esc(m.route)}</td><td>${esc(m.freq)}</td><td>${statePill(m.status)}</td></tr>`);
      let extra = '';
      if (u.role === 'pharmacist') {
        const renal = p.labs.filter((l) => /creatinine|egfr|potassium|inr|alt|ast/i.test(l.test)).map((l) => `<tr><td>${esc(l.test)}</td><td class="num"><b>${esc(l.value)}</b> ${esc(l.unit)}</td><td>${l.flag ? pill('crit', l.flag) : ''}</td></tr>`);
        extra = panel('Dosing labs', table(['Test', 'Value', 'Flag'], renal), `<span class="muted" style="font-size:12px">Renal, hepatic, electrolytes, coagulation only</span>`, true);
      }
      return `${flags.map((o) => `<div class="flag ${o.flag.kind === 'missing-dose' || o.flag.kind === 'duplicate' ? 'warn' : ''}"><h4>${esc(o.flag.kind.replace('-', ' '))}: ${esc(o.text)}</h4><p>${esc(o.flag.text)}</p></div>`).join('')}
        ${panel('Medications', table(['Drug', 'Dose', 'Route', 'Frequency', 'Status'], rows), u.role === 'nurse' ? '<a href="#mar">Open eMAR</a>' : u.role === 'doctor' ? '<a href="#orders">Open CPOE</a>' : '<a href="#verify">Verification queue</a>', true)}${extra}`;
    },
    results(u, p) {
      const rows = p.labs.map((l) => { const c = T.hist ? T.hist.labCell(p, l) : { spark: '', delta: '' }; const open = UI.labTrend === p.id + '|' + l.test;
        return `<tr><td>${esc(l.test)}<span class="sub mono">LOINC ${l.loinc}</span></td><td class="num"><b>${esc(l.value)}</b> ${esc(l.unit)}${c.delta}</td><td>${c.spark}</td><td class="mono">${esc(l.ref)}</td><td>${l.flag ? pill(l.flag.length > 1 || l.flag === 'A' ? 'crit' : 'warn', l.flag) : pill('ok', 'Normal')}</td><td>${dayStr(l.dOff)}</td></tr>${open ? `<tr class="trendrow"><td colspan="6">${T.hist.labDetail(p, l.test)}</td></tr>` : ''}`; });
      const lis = (S.labOrders || []).filter((o) => o.patient === p.id && o.status === 'Released' && !p.labs.some((l) => l.fromOrder === o.id)).map((o) => `<tr><td>${esc(o.test)}<span class="sub mono">LOINC ${o.loinc} · released</span></td><td class="num"><b>${esc(o.value)}</b> ${esc(o.unit)}</td><td class="mono">${esc(o.ref)}</td><td></td><td>${o.flag ? pill('crit', o.flag) : pill('ok', 'Normal')}</td><td>Today</td></tr>`);
      const imaging = (S.radOrders || []).filter((o) => o.patient === p.id).map((o) => `<tr><td><b>${esc(o.study)}</b><span class="sub mono">${o.acc}</span></td><td>${statePill(o.status)}</td><td>${o.report && o.status === 'Reported' ? `${o.report.critical ? pill('crit', 'Critical finding') + ' ' : ''}${esc(o.report.impression)}<span class="sub">${esc(o.report.by)}</span>` : '<span class="muted">No final report yet</span>'}</td></tr>`);
      return panel('Laboratory results', table(['Test', 'Value', 'Trend', 'Reference', 'Flag', 'Date'], rows.concat(lis)), '', true) + panel('Imaging', table(['Study', 'Status', 'Impression'], imaging), '', true);
    },
    notes(u, p) {
      const notes = S.notes.filter((n) => n.patient === p.id).sort((a, b) => a.mOff - b.mOff);
      const list = notes.map((n) => `<article class="note ${n.signed ? '' : 'draft'}">
        <div class="row between"><b>${esc(n.kind)}</b><span class="muted" style="font-size:12px">${esc(n.author)} · ${n.at ? timeStr(n.at) : ago(n.mOff)}</span></div>
        ${n.ai && !n.signed ? `<div>${pill('info', 'AI draft · unsigned · review before signing')}</div>` : ''}
        <pre>${esc(n.text)}</pre>
        ${n.addenda.map((a) => `<div class="addendum"><b>Addendum</b> · ${esc(a.author)} · ${timeStr(a.at)}<br>${esc(a.text)}</div>`).join('')}
        <div class="row">${n.signed ? `${pill('ok', 'Signed · locked')}${u.role === 'doctor' ? `<button class="btn small" data-act="addendum" data-n="${n.id}">Add addendum</button>` : ''}` : (n.author === u.name ? `<button class="btn small primary" data-act="sign-note" data-n="${n.id}">Review and sign</button><button class="btn small" data-act="discard-note" data-n="${n.id}">Discard draft</button>` : pill('warn', 'Draft'))}</div>
        ${UI.addendumFor === n.id ? `<form data-form="addendum" class="stack"><input type="hidden" name="n" value="${n.id}"><div class="field"><label for="ad-${n.id}">Addendum</label><textarea id="ad-${n.id}" name="text" required></textarea><small>Signed notes can't be edited. An addendum is added with your name and time.</small></div><div class="row"><button class="btn primary small" type="submit">Sign addendum</button><button class="btn small" type="button" data-act="addendum" data-n="">Cancel</button></div></form>` : ''}
      </article>`).join('') || '<p class="muted">No notes yet.</p>';
      const form = u.role === 'doctor'
        ? `<form data-form="note" class="stack"><input type="hidden" name="p" value="${p.id}"><div class="field"><label for="nt-text">New progress note</label><textarea id="nt-text" name="text" required placeholder="S / O / A / P"></textarea></div><div class="row"><button class="btn primary" type="submit">Save draft</button><button class="btn" type="button" data-act="ambient" data-p="${p.id}">Draft with ambient AI</button></div></form>`
        : `<form data-form="nnote" class="stack"><input type="hidden" name="p" value="${p.id}"><div class="field"><label for="nn-text">Nursing note</label><textarea id="nn-text" name="text" required></textarea></div><div><button class="btn primary" type="submit">Sign nursing note</button></div></form>`;
      return `<div class="grid-2">${panel('Notes', list)}${panel(u.role === 'doctor' ? 'Write' : 'Document', form)}</div>`;
    },
    consents(u, p) {
      const list = (S.consents || []).filter((c) => c.patient === p.id).map((c) => `<tr><td><b>${esc(c.kind)}</b><span class="sub">${esc(c.detail || '')}</span></td><td>${statePill(c.state)}</td><td>${esc(c.by)}</td><td>${timeStr(c.at)}</td></tr>`);
      return panel('Consents', table(['Consent', 'Status', 'Recorded by', 'When'], list), '<span class="muted" style="font-size:12px">Consent state is enforced: OT stages and ambient recording check it</span>', true);
    },
    orders(u, p) {
      const rows = S.orders.filter((o) => o.patient === p.id).map((o) => `<tr><td>${esc(o.text)}${o.flag ? `<span class="sub">⚠ ${esc(o.flag.kind)}${o.flag.override ? ' · overridden: ' + esc(o.flag.override.reason) : ''}</span>` : ''}</td><td>${esc(o.type)}</td><td>${esc(o.priority)}</td><td>${statePill(o.status)}</td></tr>`);
      return panel('Orders', table(['Order', 'Type', 'Priority', 'Status'], rows), '<a href="#orders">Open CPOE</a>', true);
    }
  };

  function viewBtg(u, p) {
    return { title: 'Restricted record', sub: 'No care relationship', body:
      `<div class="banner crit"><p>${p._stub ? `This patient (${p.age}${p.sex})` : `<b>${esc(p.name)}</b> (MRN ${p.mrn}, ${p.age}${p.sex})`} is under ${esc(DEPT[p.dept])}${p.unit ? ', ' + esc(UNIT[p.unit]) : ''}. You don't have a care relationship with this patient, so the chart is closed. This attempt was logged.</p></div>` +
      panel('Break the glass', `<p>Use emergency access only when delay would harm the patient. Access lasts ${(S.config && S.config.btgHours) || 4} hours, the Privacy Office is notified now, and the access is reviewed within 24 hours.</p>
        <form data-form="btg" class="stack"><input type="hidden" name="p" value="${p.id}">
          <div class="field"><label for="btg-r">Reason</label><select id="btg-r" name="reason" required><option value="">Choose a reason</option><option>Emergency treatment</option><option>Consult requested, not yet entered</option><option>Covering for a colleague</option><option>Rapid response / code team</option></select></div>
          <div class="field"><label for="btg-t">Clinical justification</label><textarea id="btg-t" name="text" required minlength="20" placeholder="What is happening and why you need this record now"></textarea><small>At least 20 characters.</small></div>
          <label class="row" style="gap:8px"><input type="checkbox" name="ack" required> I understand this access is logged and reviewed.</label>
          <div class="row"><button class="btn danger" type="submit">Open chart with emergency access</button><a class="btn" href="#patients">Cancel</a></div>
        </form>`) };
  }
  function viewDenied(u, what, isChart) {
    return { title: 'Access denied', sub: 'Least privilege by default', body:
      `<div class="banner crit"><p>Your role (${esc(ROLE_LABEL[u.role])}) doesn't include ${esc(what)}. This attempt was recorded in the audit log.${isChart && u.role === 'admin' ? ' Administrators manage access but never read clinical records.' : ''}${isChart && u.role === 'billing' ? ' Billing works from codes and charges, not clinical content.' : ''}</p></div><div><a class="btn" href="#home">Back to overview</a></div>` };
  }

  VIEWS.schedule = (u) => {
    const rows = S.appts.filter((a) => a.provider === u.id).map((a) => { const p = P(a.patient); return `<tr class="clickable" data-act="go" data-href="#patient-${p.id}-overview"><td class="mono">${a.time}</td><td><b>${esc(p.name)}</b><span class="sub">${p.age}${p.sex} · MRN ${p.mrn}</span></td><td>${esc(a.reason)}</td><td><div class="chips">${allergyChips(p)}</div></td><td>${statePill(a.status)}</td></tr>`; });
    return { title: 'Clinic schedule', sub: `${dayStr(0)} · ${esc(u.name)}`, body: panel('Appointments', table(['Time', 'Patient', 'Reason', 'Allergies', 'Status'], rows), '', true) };
  };

  VIEWS.orders = (u) => {
    const scoped = S.orders.filter((o) => careRel(u, P(o.patient)));
    const flagged = scoped.filter((o) => o.flag && o.status === 'Pending signature' && !o.flag.override);
    const flagHtml = flagged.map((o) => { const p = P(o.patient); return `<div class="flag ${o.flag.kind === 'missing-dose' || o.flag.kind === 'duplicate' ? 'warn' : ''}">
      <h4>${esc(o.text)} · ${esc(p.name)}</h4><p>${esc(o.flag.text)}</p>
      <div class="row">${o.flag.kind === 'missing-dose' ? `<button class="btn small primary" data-act="add-dose" data-o="${o.id}">Add dose</button>` : `<button class="btn small" data-act="override" data-o="${o.id}">Override and sign</button>`}<button class="btn small danger" data-act="dc" data-o="${o.id}">Discontinue</button></div></div>`; }).join('');
    const rows = scoped.map((o) => { const p = P(o.patient); const canSign = o.status === 'Pending signature' && (!o.flag || o.flag.override);
      return `<tr><td><b>${esc(o.text)}</b><span class="sub">${esc(p.name)} · MRN ${p.mrn}</span>${o.flag && o.flag.override ? `<span class="sub">Override: ${esc(o.flag.override.reason)}</span>` : ''}</td><td>${esc(o.type)}</td><td>${o.priority === 'STAT' ? pill('crit', 'STAT') : esc(o.priority)}</td><td>${statePill(o.status)}${o.type === 'Medication' && S.verified[o.id] ? '<span class="sub">Pharmacist verified</span>' : ''}</td>
      <td>${canSign ? `<button class="btn small primary" data-act="sign" data-o="${o.id}">Sign</button>` : ''}${['Active', 'Signed', 'Pending signature'].includes(o.status) && !(o.flag && !o.flag.override && o.status === 'Pending signature') ? ` <button class="btn small" data-act="dc" data-o="${o.id}">Discontinue</button>` : ''}</td></tr>`; });
    const opts = myPatients(u).map((p) => `<option value="${p.id}">${esc(p.name)} · MRN ${p.mrn}</option>`).join('');
    return { title: 'Orders (CPOE)', sub: 'Allergy, interaction, duplicate and dose checks run before signing', body:
      (flagHtml ? panel(`Resolve before signing · ${flagged.length}`, flagHtml) : `<div class="banner ok"><p>No unresolved safety checks.</p></div>`) +
      `<div class="grid-2">${panel('Orders', table(['Order', 'Type', 'Priority', 'Status', ''], rows), '', true)}
      ${panel('New order', `<form data-form="order" class="stack">
        <div class="field"><label for="o-p">Patient</label><select id="o-p" name="p" required>${opts}</select></div>
        <div class="field"><label for="o-t">Type</label><select id="o-t" name="type"><option>Medication</option><option>Lab</option><option>Imaging</option><option>Nursing</option><option>Diet</option></select></div>
        <div class="field"><label for="o-x">Order</label><input id="o-x" name="text" required placeholder="e.g. Cefazolin 1 g IV q8h"><small>Try "Amoxicillin 500 mg PO TID" for a patient with a penicillin allergy.</small></div>
        <div class="field"><label for="o-pr">Priority</label><select id="o-pr" name="priority"><option>Routine</option><option>Urgent</option><option>STAT</option></select></div>
        <div><button class="btn primary" type="submit">Check and queue for signature</button></div></form>`)}</div>` };
  };

  function cds(p, type, text) {
    if (type !== 'Medication') return null;
    const t = text.toLowerCase();
    const pcn = p.allergies.some((a) => /penicillin/i.test(a.agent));
    if (pcn && /(cillin|amoxi|ampi|piperacillin)/.test(t)) return { kind: 'allergy', text: `Documented penicillin allergy (${p.allergies.find((a) => /penicillin/i.test(a.agent)).reaction}). This is a penicillin-class drug.` };
    if (p.allergies.some((a) => /sulf/i.test(a.agent)) && /(sulfa|sulfameth|bactrim)/.test(t)) return { kind: 'allergy', text: 'Documented sulfonamide allergy.' };
    const k = p.labs.find((l) => l.test === 'Potassium' && /H/.test(l.flag));
    const on = (x) => !(S.config && S.config.cds && S.config.cds[x] === false);
    if (on('interaction') && k && /(sartan|pril|spironolactone)/.test(t)) return { kind: 'interaction', text: `Raises potassium; current K⁺ ${k.value} ${k.unit}.` };
    if (on('duplicate') && /prazole/.test(t) && p.meds.some((m) => /prazole/i.test(m.drug) && m.status === 'Active')) return { kind: 'duplicate', text: 'A proton-pump inhibitor is already active.' };
    if (on('missingDose') && !/\d/.test(t)) return { kind: 'missing-dose', text: 'No dose found in the order.' };
    return null;
  }

  VIEWS.results = (u) => {
    const list = S.results.filter((r) => careRel(u, P(r.patient))).sort((a, b) => (a.state === 'Closed') - (b.state === 'Closed') || a.mOff - b.mOff);
    const cards = list.map((r) => {
      const p = P(r.patient); const breached = r.state === 'New' && r.mOff > r.slaMin;
      const isDoc = u.role === 'doctor';
      const acts = r.state === 'Closed' ? '' : `<div class="row">
        ${r.state === 'New' ? `<button class="btn small primary" data-act="res" data-r="${r.id}" data-s="ack">Acknowledge</button>` : ''}
        ${r.state === 'Acknowledged' && isDoc ? `<button class="btn small primary" data-act="res" data-r="${r.id}" data-s="own">Take ownership</button>` : ''}
        ${r.state === 'Owned' && isDoc ? `<button class="btn small primary" data-act="res" data-r="${r.id}" data-s="close">Close loop</button>` : ''}
        <button class="btn small" data-act="res" data-r="${r.id}" data-s="esc">Escalate</button></div>`;
      return `<article class="panel"><div class="body">
        <div class="row between"><div class="stack" style="gap:2px"><h3>${esc(r.test)} · <a href="#patient-${p.id}-results">${esc(p.name)}</a></h3><span class="muted" style="font-size:12.5px">MRN ${p.mrn} · ${esc(r.lab)} · reported ${ago(r.mOff)}</span></div>
          <div class="chips">${pill('crit', r.flag)}${statePill(r.state)}${breached ? pill('crit', `Acknowledgement SLA missed by ${r.mOff - r.slaMin} min`) : ''}</div></div>
        <p><b style="font-size:20px" class="num">${esc(r.value)}</b> <span class="muted">reference ${esc(r.ref)}</span></p>
        ${r.trail.length ? `<div class="trail">${r.trail.map((t) => `<span>${t.at ? timeStr(t.at) : ago(t.mOff)} · <b>${esc(t.who)}</b> — ${esc(t.what)}</span>`).join('')}</div>` : ''}
        ${acts}</div></article>`;
    }).join('');
    return { title: 'Critical results', sub: 'Acknowledge → own → close. Opening a result is not acknowledgement.', body: `<div class="stack">${cards || '<p class="muted">No critical results in your scope.</p>'}</div>` };
  };

  function marState(m, t) {
    const key = `${m.patient}|${m.drug}|${t}`;
    if (S.mar[key]) return S.mar[key].state;
    // First uncharted slot per drug is "Due" so the demo works at any hour; later slots are scheduled.
    const firstOpen = m.times.find((x) => !S.mar[`${m.patient}|${m.drug}|${x}`]);
    if (toMin(t) <= nowMin() || t === firstOpen) return 'Due';
    return 'Scheduled';
  }
  VIEWS.mar = (u) => {
    const pts = myPatients(u).filter((p) => SEED.mar.some((m) => m.patient === p.id));
    if (!UI.marPatient || !pts.some((p) => p.id === UI.marPatient)) UI.marPatient = pts[0] && pts[0].id;
    const p = P(UI.marPatient);
    if (!p) return { title: 'eMAR', sub: UNIT[u.unit] || '', body: '<p class="muted">No scheduled medications on this unit today.</p>' };
    audit('view-mar', { patient: p });
    const entries = SEED.mar.filter((m) => m.patient === p.id);
    const slots = [...new Set(entries.flatMap((m) => m.times))].sort();
    const rows = entries.map((m) => `<tr><td><b>${esc(m.drug)}</b><span class="sub mono">${esc(m.barcode)}</span></td>${slots.map((t) => {
      if (!m.times.includes(t)) return '<td class="slot"></td>';
      const st = marState(m, t), c = S.mar[`${m.patient}|${m.drug}|${t}`];
      return `<td class="slot">${st === 'Due' ? `<button class="dose Due" style="border:0;cursor:pointer" data-act="scan-start" data-k="${esc(m.patient + '|' + m.drug + '|' + t)}">Due<br>Administer</button>` : `<span class="dose ${st}" title="${esc(c && (c.note || c.by) || '')}">${st}${c && c.by ? `<small>${esc(c.by.split(',')[0])}</small>` : ''}</span>`}</td>`; }).join('')}</tr>`);
    let scan = '';
    if (UI.scan) {
      const [pid, drug, t] = UI.scan.key.split('|'); const m = SEED.mar.find((x) => x.patient === pid && x.drug === drug);
      scan = `<div class="scan"><h3>Barcode medication administration · ${esc(drug)} · ${t}</h3>
        <div class="step ${UI.scan.step > 0 ? 'done' : ''}"><span class="dot"></span><span>Scan patient wristband ${UI.scan.step > 0 ? `— matched ${esc(P(pid).name)}, MRN ${P(pid).mrn}` : ''}</span>${UI.scan.step === 0 ? '<button class="btn small primary" data-act="scan-step">Simulate wristband scan</button>' : ''}</div>
        <div class="step ${UI.scan.step > 1 ? 'done' : ''}"><span class="dot"></span><span>Scan medication ${UI.scan.step > 1 ? `— ${esc(m.barcode)} matches order` : ''}</span>${UI.scan.step === 1 ? '<button class="btn small primary" data-act="scan-step">Simulate medication scan</button>' : ''}</div>
        ${UI.scan.step > 1 ? `<p>${pill('ok', 'Right patient')} ${pill('ok', 'Right drug')} ${pill('ok', 'Right dose')} ${pill('ok', 'Right route')} ${pill('ok', 'Right time')}</p>
          <div class="row"><button class="btn primary" data-act="mar-give">Record as given</button><button class="btn" data-act="mar-hold">Hold dose…</button><button class="btn" data-act="scan-cancel">Cancel</button></div>` : '<div><button class="btn small" data-act="scan-cancel">Cancel</button></div>'}</div>`;
    }
    const tabs = `<nav class="tabs" aria-label="Patients">${pts.map((x) => `<a href="#mar" data-act="mar-p" data-p="${x.id}" ${x.id === p.id ? 'aria-current="page"' : ''}>${esc(x.bed)} · ${esc(x.name)}</a>`).join('')}</nav>`;
    return { title: 'eMAR', sub: `${UNIT[u.unit]} · saved to the patient record, not just this screen`, body: tabs +
      `<div class="row"><div class="chips">${allergyChips(p)}</div><span class="muted">${p.weightKg} kg · ${esc(p.code)}</span></div>` + scan +
      panel(`Medication administration · ${dayStr(0)}`, `<div class="tbl"><table class="t mar"><thead><tr><th>Medication</th>${slots.map((t) => `<th style="text-align:center">${t}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`, '', true) };
  };

  VIEWS.verify = () => {
    const q = verifyQueue().map((o) => { const p = P(o.patient); const egfr = p.labs.find((l) => l.test === 'eGFR');
      return `<tr><td><b>${esc(o.text)}</b><span class="sub">${esc(p.name)} · MRN ${p.mrn} · ${p.weightKg} kg${egfr ? ` · eGFR ${egfr.value}` : ''}</span></td><td><div class="chips">${allergyChips(p)}</div></td><td>${esc(U(o.by).name)}</td>
        <td><button class="btn small primary" data-act="verify" data-o="${o.id}">Verify</button> <button class="btn small danger" data-act="reject" data-o="${o.id}">Reject…</button></td></tr>`; });
    const done = S.orders.filter((o) => S.verified[o.id]).map((o) => `<tr><td>${esc(o.text)}<span class="sub">${esc(P(o.patient).name)}</span></td><td>${esc(S.verified[o.id].by)}</td><td>${timeStr(S.verified[o.id].at)}</td></tr>`);
    return { title: 'Order verification', sub: 'Pharmacist review before first dispense', body:
      panel('Waiting for verification', table(['Order', 'Allergies', 'Prescriber', ''], q), '', true) + panel('Verified this session', table(['Order', 'Pharmacist', 'Time'], done), '', true) };
  };

  VIEWS.inventory = () => {
    const rows = SEED.inventory.slice().sort((a, b) => a.expDays - b.expDays).map((i) => { const [c, l] = invStatus(i);
      return `<tr><td><b>${esc(i.item)}</b><span class="sub">${esc(i.location)}</span></td><td class="mono">${i.lot}</td><td>${dayStr(i.expDays)}<span class="sub">${i.expDays < 0 ? `${-i.expDays} days ago` : `in ${i.expDays} days`}</span></td><td class="num">${i.qty.toLocaleString()}</td><td class="num">${i.reorder.toLocaleString()}</td><td>${pill(c, l)}${i.expDays < 0 ? '<span class="sub">Blocked from dispensing</span>' : ''}</td></tr>`; });
    const cs = S.controlled.map((c, i) => `<tr><td><b>${esc(c.item)}</b></td><td>${pill('crit', c.schedule)}</td><td class="num">${c.onHand}</td><td>${c.lastCount === 0 ? 'Today' : `${-c.lastCount} day(s) ago`}${c.lastCount < 0 ? ' ' + pill('warn', 'Count due') : ''}</td><td><button class="btn small" data-act="count" data-i="${i}">Record count…</button></td></tr>`);
    const log = S.counts.slice().reverse().map((c) => `<tr><td>${timeStr(c.at)}</td><td>${esc(c.item)}</td><td class="num">${c.qty}</td><td>${esc(c.by)} + ${esc(c.witness)}</td><td>${c.qty === c.expected ? pill('ok', 'Matches') : pill('crit', `Discrepancy ${c.qty - c.expected}`)}</td></tr>`);
    return { title: 'Inventory', sub: 'First-expiry-first-out · expired lots are quarantined automatically', body:
      panel('Stock by expiry', table(['Item', 'Lot', 'Expiry', 'On hand', 'Reorder at', 'Status'], rows), '', true) +
      `<div class="grid-2">${panel('Controlled substances', table(['Item', 'Schedule', 'On hand', 'Last count', ''], cs), '<span class="muted" style="font-size:12px">Two-person count required</span>', true)}${panel('Count log', table(['Time', 'Item', 'Counted', 'By', 'Result'], log), '', true)}</div>` };
  };

  VIEWS.accounts = (u) => {
    const rows = S.claims.map((c) => { const p = P(c.patient); return `<tr class="clickable" data-act="claim" data-c="${c.id}" ${UI.selClaim === c.id ? 'style="outline:2px solid var(--accent);outline-offset:-2px"' : ''}><td class="mono">${c.id}</td><td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn}</span></td><td>${esc(p.payer)}<span class="sub mono">${maskId(p.memberId)}</span></td><td>${dayStr(c.dOff)}<span class="sub">${c.setting}</span></td><td class="mono">${c.cpt.join(', ')}<span class="sub">${c.icd.join(', ')}</span></td><td class="num">${money(c.charge)}</td><td>${statePill(c.status)}</td></tr>`; });
    audit('list-accounts', { patients: S.claims.map((c) => tok(P(c.patient))).join(' '), detail: `${S.claims.length} accounts` });
    let detail = '<p class="muted">Select an account to see coverage, codes and actions.</p>';
    const c = S.claims.find((x) => x.id === UI.selClaim);
    if (c) {
      const p = P(c.patient); const showId = UI.revealed.has('m' + p.id);
      detail = `<dl class="kv" style="margin:0"><div><dt>Patient</dt><dd style="margin:0">${esc(p.name)}</dd></div><div><dt>DOB</dt><dd style="margin:0">${p.dob}</dd></div><div><dt>Phone</dt><dd style="margin:0">${phoneCell(p)}</dd></div>
        <div><dt>Payer</dt><dd style="margin:0">${esc(p.payer)}</dd></div><div><dt>Member ID</dt><dd style="margin:0"><span class="mono">${showId ? esc(p.memberId) : maskId(p.memberId)}</span> ${showId ? '' : `<button class="linkbtn" data-act="reveal-member" data-p="${p.id}">Reveal</button>`}</dd></div>
        <div><dt>Date of service</dt><dd style="margin:0">${dayStr(c.dOff)}</dd></div><div><dt>CPT / HCPCS</dt><dd class="mono" style="margin:0">${c.cpt.join(', ')}</dd></div><div><dt>ICD-10-CM</dt><dd class="mono" style="margin:0">${c.icd.join(', ')}</dd></div>
        <div><dt>Charge</dt><dd class="num" style="margin:0">${money(c.charge)}</dd></div><div><dt>Paid</dt><dd class="num" style="margin:0">${money(c.paid || 0)}</dd></div></dl>
        <div>${statePill(c.status)} ${c.note ? `<span class="muted">${esc(c.note)}</span>` : ''}</div>
        <div class="row">
          <button class="btn small" data-act="elig" data-c="${c.id}">Check eligibility (270/271)</button>
          ${c.status === 'Ready to submit' ? `<button class="btn small primary" data-act="submit-claim" data-c="${c.id}">Submit claim (837${c.setting === 'Inpatient' ? 'I' : 'P'})</button>` : ''}
          ${c.status === 'Denied' ? `<button class="btn small primary" data-act="resubmit" data-c="${c.id}">Correct and resubmit</button>` : ''}
          ${c.status === 'Submitted' ? `<button class="btn small primary" data-act="remit" data-c="${c.id}">Post remittance (835)</button>` : ''}
          ${c.status === 'Prior auth pending' ? `<button class="btn small primary" data-act="auth" data-c="${c.id}">Record prior auth approval (278)</button>` : ''}
          <button class="btn small" data-act="query" data-c="${c.id}">Coding query to physician…</button></div>
        <p class="muted" style="font-size:12.5px">Notes, results and medications aren't shown to billing. <a href="#patient-${p.id}-overview">Clinical chart (restricted)</a></p>`;
    }
    return { title: 'Accounts & claims', sub: 'US revenue cycle: X12 eligibility, prior auth, claims and remittance', body: `<div class="grid-2">${panel('Accounts', table(['Claim', 'Patient', 'Payer / member', 'Service', 'Codes', 'Charge', 'Status'], rows), '', true)}${panel(c ? `Account ${c.id}` : 'Account', detail)}</div>` };
  };

  VIEWS.measures = () => {
    const rows = SEED.measures.map((m) => { const r = m.num / m.den * 100; const ok = m.inverse ? r <= m.target : r >= m.target;
      return `<tr><td class="mono"><b>${m.code}</b></td><td><b>${esc(m.name)}</b><span class="sub">${esc(m.desc)}</span></td><td class="num">${m.num.toLocaleString()} / ${m.den.toLocaleString()}</td><td class="num"><b>${r.toFixed(1)}%</b></td>
      <td style="min-width:160px"><div class="bar" title="Target ${m.target}%"><i style="width:${Math.min(r, 100)}%"></i><b style="left:${m.target}%"></b></div><span class="sub">target ${m.inverse ? '≤' : '≥'} ${m.target}%</span></td><td>${ok ? pill('ok', 'Meets target') : pill('warn', 'Below target')}</td></tr>`; });
    return { title: 'HEDIS measures', sub: 'Measurement year 2026 · computed from coded data (LOINC, CPT II, SNOMED, ICD-10) · synthetic population', body:
      panel('Measure rates', table(['Measure', 'Description', 'Numerator / denominator', 'Rate', 'Progress', 'Status'], rows), '', true) +
      `<div class="banner info"><p>Each numerator hit links back to the source record (for example the LOINC 4548-4 HbA1c result) so an NCQA auditor can trace it.</p></div>` };
  };

  VIEWS.gaps = (u) => {
    const isQ = u.role === 'quality';
    const list = SEED.gaps.filter((g) => isQ || g.attributed === u.id);
    const ident = !isQ || (UI.identified && UI.identified.user === u.id);
    if (isQ) audit('view-gaps', { detail: ident ? 'identified' : 'de-identified', patients: list.map((g) => tok(P(g.patient))).join(' ') });
    const rows = list.map((g) => { const p = P(g.patient); const done = S.gapsDone[g.patient + g.measure];
      return `<tr><td>${ident ? `<b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn}</span>` : `<span class="mono">${tok(p)}</span><span class="sub">${Math.floor(p.age / 10) * 10}–${Math.floor(p.age / 10) * 10 + 9} y · ${p.sex}</span>`}</td><td class="mono"><b>${g.measure}</b></td><td>${esc(g.detail)}</td><td>${esc(g.action)}</td><td>${ident ? esc(U(g.attributed).name) : 'Attributed clinician'}</td>
      <td>${done ? pill('ok', 'Addressed') : !isQ ? `<button class="btn small" data-act="gap-done" data-g="${g.patient + g.measure}">Mark addressed</button> <a class="btn small" href="#patient-${p.id}-overview">Chart</a>` : pill('warn', 'Open')}</td></tr>`; });
    return { title: 'Care gaps', sub: isQ ? (ident ? 'Identified view · purpose logged' : 'De-identified by default') : 'Patients attributed to you', body:
      (isQ && !ident ? `<div class="banner info"><p>Patients appear as tokens. To work an outreach list, state the purpose; the reveal is logged.</p><button class="btn small" data-act="identify">Show identified list…</button></div>` : '') +
      panel('Open gaps', table(['Patient', 'Measure', 'Finding', 'Suggested action', 'Owner', ''], rows), '', true) };
  };

  function auditRow(e) {
    const a = U(e.actor);
    const cls = e.outcome === 'success' ? 'ok' : 'crit';
    return `<tr ${/break-the-glass/.test(e.action) ? 'style="background:var(--crit-bg)"' : ''}><td class="mono">${e.seq}</td><td>${timeStr(e.ts)}</td><td>${esc(a ? a.name : e.actor)}<span class="sub">${esc(e.role)}</span></td><td><b>${esc(e.action)}</b>${e.resource ? `<span class="sub">${esc(e.resource)}</span>` : ''}${e.detail ? `<span class="sub">${esc(e.detail)}</span>` : ''}</td><td class="mono" style="max-width:240px;word-break:break-word">${esc(e.patient || '—')}</td><td>${pill(cls, e.outcome)}</td></tr>`;
  }
  VIEWS.audit = () => {
    const f = UI.auditFilter;
    let list = (LIVE ? (UI.liveAudit || { events: [] }).events : S.audit).slice().reverse();
    if (f.btg) list = list.filter((e) => /break-the-glass|btg/.test(e.action));
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((e) => JSON.stringify(e).toLowerCase().includes(q) || ((U(e.actor) || {}).name || '').toLowerCase().includes(q)); }
    const btg = (LIVE ? (UI.liveAudit || { grants: [] }).grants : S.btg).slice().reverse().map((g) => `<tr><td>${timeStr(g.at)}</td><td>${esc((U(g.user) || { name: g.user }).name)}</td><td class="mono">${esc(g.token || tok(P(g.patient)))}</td><td>${esc(g.reason)}<span class="sub">${esc(g.text)}</span></td><td>${g.reviewed ? pill('ok', 'Reviewed') : `<button class="btn small primary" data-act="btg-review" data-g="${g.id}">Mark reviewed</button>`}</td></tr>`);
    const cr = UI.chainResult;
    return { title: 'Audit log', sub: 'Append-only · hash-chained · patient tokens instead of names', body:
      `<div class="row between"><form data-form="afilter" class="row"><input class="search" name="q" value="${esc(f.q)}" placeholder="Filter by user, action, token" aria-label="Filter audit"><label class="row" style="gap:6px"><input type="checkbox" name="btg" ${f.btg ? 'checked' : ''}> Break-the-glass only</label><button class="btn" type="submit">Apply</button></form>
      <button class="btn" data-act="verify-chain">Verify chain</button></div>` +
      (cr ? `<div class="banner ${cr.ok ? 'ok' : 'crit'}"><p>${cr.ok ? `Chain intact: ${cr.n} events, each hash links to the one before.` : `Chain broken at event ${cr.at}.`}</p></div>` : '') +
      panel('Break-the-glass reviews', table(['When', 'Who', 'Patient token', 'Reason', 'Review'], btg), '', true) +
      panel(`Events · ${list.length}`, table(['#', 'Time', 'Who', 'Action', 'Patient token(s)', 'Outcome'], list.slice(0, 200).map(auditRow)), '', true) };
  };

  VIEWS.users = (u) => {
    const rows = S.users.map((x) => `<tr><td><b>${esc(x.name)}</b><span class="sub mono">${esc(x.username)}</span></td><td>${esc(ROLE_LABEL[x.role])}<span class="sub">${esc(x.role === 'doctor' ? DEPT[x.dept] : x.role === 'nurse' ? UNIT[x.unit] : x.title)}</span></td>
      <td>${x.mfa === 'Not enrolled' ? pill('warn', 'Not enrolled') : esc(x.mfa)}</td><td>${statePill(x.status)}</td><td>${x.lastSignIn === 0 ? 'Today' : `${-x.lastSignIn} d ago`}</td>
      <td>${x.id === u.id ? '<span class="muted">You</span>' : `${x.status === 'active' ? `<button class="btn small danger" data-act="suspend" data-u="${x.id}">Suspend</button>` : `<button class="btn small" data-act="reactivate" data-u="${x.id}">Reactivate</button>`} <button class="btn small" data-act="role-change" data-u="${x.id}">Change role…</button>`}</td></tr>`);
    const reqs = S.roleRequests.slice().reverse().map((r) => `<tr><td>${esc(U(r.user).name)}</td><td>${esc(r.fromLabel)} → <b>${esc(r.toLabel)}</b><span class="sub">${esc(r.why)}</span></td><td>${esc(U(r.by).name)}</td>
      <td>${r.status !== 'pending' ? pill(r.status === 'approved' ? 'ok' : r.status === 'withdrawn' ? '' : 'crit', r.status) : r.by === u.id ? `${pill('warn', 'Waiting for a second administrator')} <button class="btn small" data-act="withdraw" data-r="${r.id}">Withdraw</button>` : r.user === u.id ? pill('warn', 'Your own role: another administrator decides') : `<button class="btn small primary" data-act="approve" data-r="${r.id}">Approve</button> <button class="btn small" data-act="deny" data-r="${r.id}">Reject</button>`}</td></tr>`);
    return { title: 'Users & roles', sub: 'Role changes need a second administrator', body:
      panel('Users', table(['User', 'Role / scope', 'MFA', 'Status', 'Last sign-in', ''], rows), '', true) +
      panel('Role change requests', table(['User', 'Change', 'Requested by', 'Decision'], reqs), '<span class="muted" style="font-size:12px">Sign in as Leo Brandt to approve a request Dana made</span>', true) };
  };

  VIEWS.review = (u) => {
    const rows = S.users.filter((x) => x.id !== u.id).map((x) => { const d = S.review[x.id];
      return `<tr><td><b>${esc(x.name)}</b><span class="sub">${esc(x.title)}</span></td><td>${esc(ROLE_LABEL[x.role])}</td><td>${x.lastSignIn === 0 ? 'Today' : `${-x.lastSignIn} d ago`}${x.lastSignIn < -30 ? ' ' + pill('warn', 'Dormant') : ''}</td><td>${statePill(x.status)}</td>
      <td>${S.reviewSigned ? pill(d === 'revoke' ? 'crit' : 'ok', d === 'revoke' ? 'Revoked' : 'Kept') : `<div class="row" style="gap:6px"><button class="btn small ${d === 'keep' ? 'primary' : ''}" data-act="rv" data-u="${x.id}" data-d="keep">Keep</button><button class="btn small ${d === 'revoke' ? 'danger' : ''}" data-act="rv" data-u="${x.id}" data-d="revoke">Revoke</button></div>`}</td></tr>`; });
    const n = S.users.filter((x) => x.id !== u.id).length, decided = Object.keys(S.review).length;
    return { title: 'Access review', sub: 'Quarterly certification · Q4 2026', body:
      (S.reviewSigned ? `<div class="banner ok"><p>Signed off by ${esc(U(S.reviewSigned.by).name)} on ${timeStr(S.reviewSigned.at)}. Kept as SOC 2 evidence.</p></div>` : `<div class="banner info"><p>${decided} of ${n} decided. Every account needs a decision before sign-off.</p></div>`) +
      panel('Accounts', table(['User', 'Role', 'Last sign-in', 'Status', 'Decision'], rows), S.reviewSigned ? '' : `<button class="btn primary" data-act="rv-sign" ${decided < n ? 'disabled' : ''}>Sign off review</button>`, true) };
  };

  /* ---------------- render ---------------- */
  function render() {
    const app = $('#app');
    const u = me();
    if (!u) { app.innerHTML = LIVE ? viewLiveLogin() : UI.pending ? viewMfa() : viewLogin(); return; }
    if (u.status !== 'active') { signOut('This account is suspended.'); return; }
    const [route, ...args] = (location.hash.slice(1) || 'home').split('-');
    const allowed = route === 'patient' || navIds(u).includes(route) || ((T.extraRoutes || {})[u.role] || []).includes(route);
    let v;
    if (!allowed || !VIEWS[route]) { audit('route-denied', { resource: '#' + route, outcome: 'denied' }); v = viewDenied(u, `the "${route}" page`); }
    else if (!LIVE) v = VIEWS[route](u, args);
    else {
      // Live mode: modules not yet moved onto the API (Phase 3) may expect records this role is not sent
      try { v = VIEWS[route](u, args); } catch (e) { console.error(e); v = { title: 'Not connected yet', sub: 'Live mode', body: '<div class="banner info"><p>This module still runs on synthetic demo data and needs records your role is not sent in live mode. It moves onto the Tessera API in Phase 4. Nothing was shown or changed.</p></div><div><a class="btn" href="#home">Back to overview</a></div>' }; }
    }
    app.innerHTML = shell(u, route, v);
    T.after.forEach((fn) => { try { fn(u, route, args); } catch (e) { console.error(e); } });
  }

  function startSession(uid, how) {
    session = { userId: uid, at: Date.now(), last: Date.now() }; saveSession();
    const u = U(uid); u.lastSignIn = 0;
    UI.pending = null; UI.msg = '';
    audit('sign-in', { detail: `MFA: ${u.mfa}${how ? ' · ' + how : ''}` });
    if (location.hash === '#home') render(); else location.hash = 'home';
  }
  function signOut(msg) {
    if (me()) audit(msg && /inactiv/.test(msg) ? 'session-timeout' : 'sign-out');
    if (LIVE) { const pending = liveFlight; liveLogout = pending.then(() => store.api('POST', '/api/auth/logout')); liveForget(); }
    session = null; saveSession();
    // Clear every per-user screen state so nothing one user saw carries over to the next sign-in
    const keep = { revealed: UI.revealed, auditFilter: { q: '', btg: false } };
    Object.keys(UI).forEach((k) => { delete UI[k]; });
    Object.assign(UI, keep, { pending: null, modal: null, search: '' }, LIVE ? { live: { stage: 'password' } } : {});
    UI.revealed.clear();
    UI.msg = msg || '';
    history.replaceState(null, '', location.pathname + location.search);
    render();
  }

  /* ---------------- actions ---------------- */
  const ACT = {
    go: (d) => { location.hash = d.href.slice(1); },
    reset: () => { S = withModules(freshState()); save(); store.flash.set('Demo data reset.'); location.reload(); },
    demo: (d) => {
      const u = U(d.u);
      if (u.status !== 'active') { audit('sign-in', { actor: u.id, role: u.role, outcome: 'denied', detail: 'account suspended' }); UI.msg = `${u.name}'s account is suspended. Sign-in blocked and logged.`; render(); return; }
      UI.pending = u.id; UI.how = 'demo quick sign-in'; render();
    },
    'mfa-ok': () => startSession(UI.pending, UI.how),
    'mfa-cancel': () => { UI.pending = null; render(); },
    'login-filter': (d) => { UI.loginFilter = d.g; render(); },
    signout: () => signOut('You signed out.'),
    'close-modal': () => { UI.modal = null; render(); },
    'close-modal-bg': (d, el, e) => { if (e.target === el) { UI.modal = null; render(); } },
    reveal: (d) => { const p = P(d.p); UI.revealed.add(p.id); audit('reveal-contact', { patient: p, detail: 'phone number unmasked' }); render(); },
    'reveal-member': (d) => { const p = P(d.p); UI.revealed.add('m' + p.id); audit('reveal-member-id', { patient: p }); render(); },
    'clear-search': () => { UI.search = ''; render(); },
    ambient: (d) => {
      const p = P(d.p), u = me();
      const text = `S: ${p.name.split(' ')[0]} reports ${p.problems[0].split(' (')[0].toLowerCase()} symptoms are stable since last review. No new complaints.\nO: BP ${p.vitals.bp}, HR ${p.vitals.hr}, SpO₂ ${p.vitals.spo2}%. ${p.labs[0] ? `${p.labs[0].test} ${p.labs[0].value} ${p.labs[0].unit}.` : ''}\nA: ${p.problems.slice(0, 2).map((x) => x.split(' (')[0]).join('; ')}.\nP: Continue current regimen; review results; follow up as scheduled.`;
      S.notes.push({ id: nid('N'), patient: p.id, author: u.name, kind: 'Progress note (ambient)', mOff: 0, at: new Date().toISOString(), signed: false, ai: true, text, addenda: [] });
      audit('ai-draft-created', { patient: p, detail: 'ambient transcription; audio discarded on sign' }); save(); render(); toast('AI draft added. Review it before signing.');
    },
    'sign-note': (d) => { const n = S.notes.find((x) => x.id === d.n); n.signed = true; n.at = new Date().toISOString(); audit('note-sign', { patient: P(n.patient), resource: n.id }); save(); render(); toast('Note signed and locked.'); },
    'discard-note': (d) => { S.notes = S.notes.filter((x) => x.id !== d.n); save(); render(); },
    addendum: (d) => { UI.addendumFor = d.n || null; render(); },
    sign: (d) => { const o = S.orders.find((x) => x.id === d.o); o.status = 'Signed'; audit('order-sign', { patient: P(o.patient), resource: o.id, detail: o.text }); save(); render(); toast('Order signed. Sent to pharmacy for verification.'); },
    dc: (d) => { const o = S.orders.find((x) => x.id === d.o); o.status = 'Discontinued'; audit('order-discontinue', { patient: P(o.patient), resource: o.id }); save(); render(); toast('Order discontinued.'); },
    override: (d) => { const o = S.orders.find((x) => x.id === d.o); openModal({ title: 'Override safety check', form: 'override', submit: 'Override and sign', danger: true,
      body: `<input type="hidden" name="o" value="${o.id}"><div class="flag"><h4>${esc(o.text)}</h4><p>${esc(o.flag.text)}</p></div>
        <div class="field"><label for="ov-r">Override reason</label><select id="ov-r" name="reason" required><option value="">Choose a reason</option><option>Benefit outweighs risk — monitoring in place</option><option>Patient has tolerated this drug before</option><option>Allergy history inaccurate — allergy list to be updated</option><option>Specialist recommendation</option></select></div>
        <div class="field"><label for="ov-t">Comment</label><textarea id="ov-t" name="text" required></textarea><small>Overrides are logged and reviewed weekly by pharmacy and patient safety.</small></div>` }); },
    'add-dose': (d) => { const o = S.orders.find((x) => x.id === d.o); openModal({ title: 'Add dose', form: 'dose', submit: 'Update order', body: `<input type="hidden" name="o" value="${o.id}"><p>${esc(o.text)}</p><div class="field"><label for="ds">Dose</label><input id="ds" name="dose" required placeholder="e.g. 40 mg"></div>` }); },
    res: (d) => {
      const r = S.results.find((x) => x.id === d.r), u = me(), p = P(r.patient);
      if (d.s === 'ack') { r.state = 'Acknowledged'; r.trail.push({ who: u.name, what: 'Acknowledged', at: new Date().toISOString() }); audit('result-acknowledge', { patient: p, resource: r.id }); save(); render(); return; }
      if (d.s === 'esc') { r.trail.push({ who: u.name, what: 'Escalated to attending and rapid response', at: new Date().toISOString() }); audit('result-escalate', { patient: p, resource: r.id }); save(); render(); toast('Escalated. Attending and rapid response paged.'); return; }
      openModal({ title: d.s === 'own' ? 'Take ownership' : 'Close the loop', form: 'res', submit: d.s === 'own' ? 'Take ownership' : 'Close loop',
        body: `<input type="hidden" name="r" value="${r.id}"><input type="hidden" name="s" value="${d.s}"><p><b>${esc(r.test)} ${esc(r.value)}</b> · ${esc(p.name)}</p><div class="field"><label for="rs-t">${d.s === 'own' ? 'Plan' : 'Action taken'}</label><textarea id="rs-t" name="text" required></textarea></div>` });
    },
    'mar-p': (d) => { UI.marPatient = d.p; UI.scan = null; render(); },
    'scan-start': (d) => { UI.scan = { key: d.k, step: 0 }; render(); },
    'scan-step': () => { UI.scan.step++; render(); },
    'scan-cancel': () => { UI.scan = null; render(); },
    'mar-give': () => { const u = me(); const [pid, drug] = UI.scan.key.split('|'); S.mar[UI.scan.key] = { state: 'Given', by: u.name, at: new Date().toISOString() }; audit('mar-administer', { patient: P(pid), detail: drug + ' · BCMA verified' }); UI.scan = null; save(); render(); toast('Dose recorded to the patient record.'); },
    'mar-hold': () => openModal({ title: 'Hold dose', form: 'hold', submit: 'Hold dose', body: `<div class="field"><label for="hd">Reason</label><select id="hd" name="reason" required><option value="">Choose</option><option>Patient NPO</option><option>Parameters not met (BP/HR)</option><option>Patient refused</option><option>Prescriber instruction</option></select></div>` }),
    verify: (d) => { const o = S.orders.find((x) => x.id === d.o); S.verified[o.id] = { by: me().name, at: new Date().toISOString() }; audit('pharmacy-verify', { patient: P(o.patient), resource: o.id }); save(); render(); toast('Verified. Released for dispensing.'); },
    reject: (d) => openModal({ title: 'Reject order', form: 'reject', submit: 'Reject and notify prescriber', danger: true, body: `<input type="hidden" name="o" value="${d.o}"><div class="field"><label for="rj">Intervention</label><textarea id="rj" name="text" required placeholder="e.g. Renal dose adjustment needed: eGFR 48"></textarea></div>` }),
    count: (d) => { const c = S.controlled[+d.i]; const others = S.users.filter((x) => x.id !== me().id && ['nurse', 'pharmacist'].includes(x.role));
      openModal({ title: `Count · ${c.item}`, form: 'count', submit: 'Record count', body: `<input type="hidden" name="i" value="${d.i}"><p>Expected on hand: <b>${c.onHand}</b></p><div class="field"><label for="cq">Counted quantity</label><input id="cq" name="qty" type="number" min="0" required value="${c.onHand}"></div><div class="field"><label for="cw">Witness</label><select id="cw" name="witness" required><option value="">Choose a second licensed person</option>${others.map((x) => `<option>${esc(x.name)}</option>`).join('')}</select></div>` }); },
    claim: (d) => { UI.selClaim = d.c; audit('view-account', { patient: P(S.claims.find((c) => c.id === d.c).patient), resource: d.c }); render(); },
    elig: (d) => { const c = S.claims.find((x) => x.id === d.c), p = P(c.patient); audit('eligibility-check', { patient: p, detail: '270 sent / 271 received' }); toast(`271: coverage active with ${p.payer}. Copay $30, deductible met.`); },
    'submit-claim': (d) => { const c = S.claims.find((x) => x.id === d.c); c.status = 'Submitted'; c.note = '837 accepted by clearinghouse'; audit('claim-submit', { patient: P(c.patient), resource: c.id }); save(); render(); toast('Claim submitted.'); },
    resubmit: (d) => { const c = S.claims.find((x) => x.id === d.c); c.status = 'Submitted'; c.note = 'Corrected: rendering NPI added; resubmitted (frequency code 7)'; audit('claim-resubmit', { patient: P(c.patient), resource: c.id }); save(); render(); toast('Corrected claim resubmitted.'); },
    remit: (d) => { const c = S.claims.find((x) => x.id === d.c); c.status = 'Paid'; c.paid = Math.round(c.charge * 0.68 * 100) / 100; c.note = '835 remittance posted'; audit('remit-post', { patient: P(c.patient), resource: c.id }); save(); render(); toast(`Payment of ${money(c.paid)} posted.`); },
    auth: (d) => { const c = S.claims.find((x) => x.id === d.c); c.status = 'Open encounter'; c.note = 'Prior auth approved, ref PA-' + (40000 + S.seq); audit('prior-auth', { patient: P(c.patient), resource: c.id }); save(); render(); },
    query: (d) => openModal({ title: 'Coding query', form: 'query', submit: 'Send to physician', body: `<input type="hidden" name="c" value="${d.c}"><div class="field"><label for="cqy">Question</label><textarea id="cqy" name="text" required placeholder="e.g. Please clarify heart failure type and acuity for I50.x"></textarea><small>Billing can ask; only the physician can change the diagnosis.</small></div>` }),
    identify: () => openModal({ title: 'Show identified list', form: 'identify', submit: 'Show names', body: `<div class="field"><label for="idp">Purpose</label><select id="idp" name="purpose" required><option value="">Choose</option><option>Care-gap outreach for attributed patients</option><option>Medical record review for hybrid measure</option><option>NCQA audit primary-source verification</option></select></div><p class="muted">The reveal lasts until you sign out and is logged.</p>` }),
    'gap-done': (d) => { S.gapsDone[d.g] = true; const g = SEED.gaps.find((x) => x.patient + x.measure === d.g); audit('gap-addressed', { patient: P(g.patient), detail: g.measure }); save(); render(); },
    'verify-chain': () => { if (LIVE) return liveVerify(); UI.chainResult = verifyChain(); audit('audit-chain-verify', { detail: UI.chainResult.ok ? 'intact' : 'broken' }); render(); },
    'btg-review': (d) => { if (LIVE) return liveReview(d.g); const g = S.btg.find((x) => x.id === d.g); g.reviewed = true; audit('btg-review', { patient: P(g.patient), detail: 'appropriate' }); save(); render(); },
    suspend: (d) => { const x = U(d.u); x.status = 'suspended'; audit('user-suspend', { resource: x.id }); save(); render(); toast(`${x.name} suspended. Active sessions ended.`); },
    reactivate: (d) => { const x = U(d.u); x.status = 'active'; audit('user-reactivate', { resource: x.id }); save(); render(); },
    'role-change': (d) => { const x = U(d.u); openModal({ title: `Change role · ${x.name}`, form: 'role', submit: 'Request change', body: `<input type="hidden" name="u" value="${x.id}">
      <div class="field"><label for="rl">New role and scope</label><select id="rl" name="to" required><option value="">Choose</option>${Object.entries(DEPT).map(([k, v]) => `<option value="doctor:${k}">Physician · ${v}</option>`).join('')}${Object.entries(UNIT).map(([k, v]) => `<option value="nurse:${k}">Nurse · ${v}</option>`).join('')}<option value="pharmacist:">Pharmacist</option><option value="billing:">Billing</option><option value="quality:">Quality analyst</option><option value="admin:">Administrator</option></select></div>
      <div class="field"><label for="rw">Justification</label><textarea id="rw" name="why" required></textarea><small>A second administrator must approve before the change takes effect.</small></div>` }); },
    approve: (d) => { const r = S.roleRequests.find((x) => x.id === d.r), x = U(r.user);
      if (r.by === me().id || r.user === me().id) { audit('role-change-approve', { resource: x.id, outcome: 'denied', detail: 'separation of duties' }); toast('You can\'t approve a change you requested or one to your own role.'); return; } const [role, sc] = r.to.split(':'); x.role = role; delete x.dept; delete x.unit; if (role === 'doctor') x.dept = sc; if (role === 'nurse') x.unit = sc; x.title = r.toLabel; r.status = 'approved'; r.approver = me().id; audit('role-change-approve', { resource: x.id, detail: r.toLabel }); save(); render(); toast('Role change applied.'); },
    withdraw: (d) => { const r = S.roleRequests.find((x) => x.id === d.r); if (r.by !== me().id) return; r.status = 'withdrawn'; audit('role-change-withdraw', { resource: r.user }); save(); render(); },
    deny: (d) => { const r = S.roleRequests.find((x) => x.id === d.r); r.status = 'rejected'; audit('role-change-reject', { resource: r.user }); save(); render(); },
    rv: (d) => { S.review[d.u] = d.d; save(); render(); },
    'rv-sign': () => { Object.entries(S.review).forEach(([id, v]) => { if (v === 'revoke') U(id).status = 'suspended'; }); S.reviewSigned = { by: me().id, at: new Date().toISOString() }; audit('access-review-signoff', { detail: `${Object.values(S.review).filter((v) => v === 'revoke').length} revoked` }); save(); render(); }
  };

  const FORMS = {
    async login(f) {
      const u = S.users.find((x) => x.username === f.username.trim().toLowerCase());
      let ok = false;
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.password));
        ok = !!u && [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') === SEED.passwordHash;
      } catch (e) { UI.msg = 'This browser blocks secure hashing here. Use a demo account button.'; render(); return; }
      if (!ok) { audit('sign-in', { actor: f.username || 'unknown', role: '—', outcome: 'failure', detail: 'bad username or password' }); UI.msg = 'Username or password is incorrect.'; render(); return; }
      if (u.status !== 'active') { audit('sign-in', { actor: u.id, role: u.role, outcome: 'denied', detail: 'account suspended' }); UI.msg = 'This account is suspended. Contact your administrator.'; render(); return; }
      UI.pending = u.id; UI.how = 'password'; UI.msg = ''; render();
    },
    psearch(f) { UI.search = f.q || ''; render(); if (LIVE && UI.search.trim()) liveSearch(UI.search.trim()); },
    btg(f) {
      if (LIVE) return liveBtg(f);
      const p = P(f.p), u = me();
      if ((f.text || '').trim().length < 20) { toast('Add a clinical justification of at least 20 characters.'); return; }
      const g = { id: nid('BTG'), user: u.id, patient: p.id, reason: f.reason, text: f.text.trim(), at: new Date().toISOString(), expires: new Date(Date.now() + ((S.config && S.config.btgHours) || 4) * 3600e3).toISOString(), reviewed: false };
      S.btg.push(g); audit('break-the-glass', { patient: p, purpose: 'Emergency (break-the-glass)', detail: `${f.reason}: ${g.text}` }); save();
      toast(`Emergency access granted for ${(S.config && S.config.btgHours) || 4} hours. Privacy Office notified.`); render();
    },
    note(f) { const u = me(); S.notes.push({ id: nid('N'), patient: f.p, author: u.name, kind: 'Progress note', mOff: 0, at: new Date().toISOString(), signed: false, text: f.text, addenda: [] }); audit('note-draft', { patient: P(f.p) }); save(); render(); },
    nnote(f) { const u = me(); S.notes.push({ id: nid('N'), patient: f.p, author: u.name, kind: 'Nursing note', mOff: 0, at: new Date().toISOString(), signed: true, text: f.text, addenda: [] }); audit('note-sign', { patient: P(f.p), detail: 'nursing note' }); save(); render(); toast('Nursing note signed.'); },
    addendum(f) { const n = S.notes.find((x) => x.id === f.n); n.addenda.push({ author: me().name, at: new Date().toISOString(), text: f.text }); UI.addendumFor = null; audit('note-addendum', { patient: P(n.patient), resource: n.id }); save(); render(); },
    order(f) {
      const p = P(f.p), u = me(); const flag = cds(p, f.type, f.text);
      const o = { id: nid('O'), patient: p.id, type: f.type, text: f.text.trim(), priority: f.priority, status: 'Pending signature', by: u.id };
      if (flag) o.flag = flag;
      S.orders.unshift(o); audit('order-create', { patient: p, resource: o.id, detail: flag ? `CDS ${flag.kind}` : 'no CDS alerts' }); save(); render();
      toast(flag ? `Safety check: ${flag.kind.replace('-', ' ')}. Resolve before signing.` : 'Order queued. Sign to release it.');
    },
    override(f) { const o = S.orders.find((x) => x.id === f.o); o.flag.override = { reason: f.reason, text: f.text, by: me().id, at: new Date().toISOString() }; o.status = 'Signed'; UI.modal = null; audit('cds-override', { patient: P(o.patient), resource: o.id, detail: `${o.flag.kind}: ${f.reason}` }); save(); render(); toast('Override recorded and order signed.'); },
    dose(f) { const o = S.orders.find((x) => x.id === f.o); o.text = o.text.replace(/ PO /, ` ${f.dose} PO `); if (!/\d/.test(o.text)) o.text += ' ' + f.dose; delete o.flag; UI.modal = null; audit('order-edit', { patient: P(o.patient), resource: o.id, detail: 'dose added' }); save(); render(); },
    res(f) { const r = S.results.find((x) => x.id === f.r), u = me(); r.state = f.s === 'own' ? 'Owned' : 'Closed'; r.trail.push({ who: u.name, what: (f.s === 'own' ? 'Took ownership — ' : 'Closed — ') + f.text, at: new Date().toISOString() }); UI.modal = null; audit(f.s === 'own' ? 'result-own' : 'result-close', { patient: P(r.patient), resource: r.id }); save(); render(); },
    hold(f) { const [pid, drug] = UI.scan.key.split('|'); S.mar[UI.scan.key] = { state: 'Held', by: me().name, note: f.reason, at: new Date().toISOString() }; audit('mar-hold', { patient: P(pid), detail: `${drug}: ${f.reason}` }); UI.scan = null; UI.modal = null; save(); render(); },
    reject(f) { const o = S.orders.find((x) => x.id === f.o); o.status = 'Rejected by pharmacy'; o.intervention = f.text; UI.modal = null; audit('pharmacy-reject', { patient: P(o.patient), resource: o.id, detail: f.text }); save(); render(); toast('Rejected. Prescriber notified.'); },
    count(f) { const c = S.controlled[+f.i], u = me(); const qty = +f.qty; S.counts.push({ item: c.item, qty, expected: c.onHand, by: u.name, witness: f.witness, at: new Date().toISOString() }); c.lastCount = 0; c.onHand = qty; UI.modal = null; audit('controlled-count', { detail: `${c.item}: ${qty} (witness ${f.witness})` }); save(); render(); },
    query(f) { const c = S.claims.find((x) => x.id === f.c); UI.modal = null; audit('coding-query', { patient: P(c.patient), resource: c.id }); render(); toast('Query sent to the attending physician\'s inbox.'); },
    identify(f) { if (LIVE) liveFlight = liveFlight.then(() => liveReveal(f.purpose)).catch((e) => console.error(e)); UI.identified = { user: me().id, purpose: f.purpose }; UI.modal = null; audit('phi-reveal', { detail: `care gaps identified view · ${f.purpose}` }); render(); },
    afilter(f) { UI.auditFilter = { q: f.q || '', btg: !!f.btg }; render(); },
    role(f) {
      const x = U(f.u), [role, sc] = f.to.split(':');
      const toLabel = role === 'doctor' ? `Attending, ${DEPT[sc]}` : role === 'nurse' ? `Nurse, ${UNIT[sc]}` : { pharmacist: 'Clinical pharmacist', billing: 'Revenue cycle specialist', quality: 'Quality & HEDIS analyst', admin: 'Tenant administrator' }[role];
      S.roleRequests.push({ id: nid('RQ'), user: x.id, to: f.to, toLabel, fromLabel: x.title, why: f.why, by: me().id, status: 'pending', at: new Date().toISOString() });
      UI.modal = null; audit('role-change-request', { resource: x.id, detail: `→ ${toLabel}` }); save(); render(); toast('Request created. A second administrator must approve it.');
    }
  };

  /* ---------------- wiring ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACT[el.dataset.act];
    if (!fn) return;
    if (el.dataset.act === 'close-modal-bg') { fn(el.dataset, el, e); return; }
    e.preventDefault();
    fn(el.dataset, el, e);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (e.submitter && e.submitter.name) data[e.submitter.name] = e.submitter.value; // which button submitted (Safari doesn't focus buttons)
    const fn = FORMS[f.dataset.form];
    fn && fn(data, f, e.submitter);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.modal) { UI.modal = null; render(); } });
  window.addEventListener('hashchange', () => { UI.scan = null; UI.modal = null; UI.addendumFor = null; if (!/^#accounts/.test(location.hash)) UI.selClaim = null; render(); window.scrollTo(0, 0); });

  // Idle lock (HIPAA automatic logoff)
  let lastTouch = 0;
  ['click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
    if (!session || Date.now() - lastTouch < 5000) return;
    lastTouch = Date.now(); session.last = Date.now(); saveSession();
  }));
  setInterval(() => { if (session && Date.now() - session.last > IDLE_MS_FN()) signOut(`Your session locked after ${idleMin()} minutes of inactivity.`); }, 30000);


  /* ---------------- live mode (Tessera API) ----------------
     The census from /api/bootstrap replaces the synthetic patients. Synthetic records about anyone
     outside it are dropped, so no screen can show a patient the server didn't permit. Opening a chart
     fetches it again so the server records that view. Signing out clears it all from memory. */

  /* ---------- live clinical records (Phase 3) ----------
     The server holds orders, results, notes, lab orders, MAR, pharmacist verification, vitals, care
     plans, rapid-response events, medication reconciliation and chart updates. save() sends what
     changed, with the version it was based on. A refused write is explained and that patient's
     records are reloaded from the server, so the screen never shows something the server rejected. */
  /* Every collection the server holds, and how its items map to a patient (mirrors backend/src/policy.ts):
     arr: array items with .patient · mar: "patient|drug|time" · verified: keyed by order · dcsum: keyed by
     discharge · pt: keyed by patient · ops / opsobj: operational, no patient · scalar: a single value. */
  const LIVE_COLLS = {};
  'orders results notes labOrders rrEvents appts er ot daycare handovers pathways discharges tele rpm erx consents ambientNotes radOrders crossmatch reminders followups claims insCases hai docs assessments sdoh sdohRefs gfe familyMsgs portalRequests shares shareLog bedRequests'.split(' ').forEach((c) => { LIVE_COLLS[c] = 'arr'; });
  'vitalsLog carePlans medrec patientPatches caseDrafts family'.split(' ').forEach((c) => { LIVE_COLLS[c] = 'pt'; });
  'controlled counts roleRequests incidents assets workOrders orderSets bloodUnits donors processing tenants supportReq extracts'.split(' ').forEach((c) => { LIVE_COLLS[c] = 'ops'; });
  'review gapsDone bedStatus config interop notifRead todos credReminders privacyCases'.split(' ').forEach((c) => { LIVE_COLLS[c] = 'opsobj'; });
  Object.assign(LIVE_COLLS, { mar: 'mar', verified: 'verified', dcsum: 'dcsum', reviewSigned: 'scalar', forecastWhatIf: 'scalar' });
  const isArr = (c) => LIVE_COLLS[c] === 'arr' || LIVE_COLLS[c] === 'ops';
  const isOps = (c) => /^ops|scalar/.test(LIVE_COLLS[c]);
  const itemKey = (x) => x && (x.id || x._k);
  const userKey = (x) => JSON.stringify([x.role, x.dept || null, x.unit || null, x.status]);
  let liveUsersSnap = new Map();
  let liveSnap = new Map(), liveVer = {}, liveBusy = new Set(), liveQueued = false;
  let liveFlight = Promise.resolve(), liveLogout = Promise.resolve(), liveEpoch = 0; // saves in order; sign-out waits for them; a new sign-in waits for sign-out
  T.liveIdle = () => liveFlight.then(() => liveLogout);
  const ownerOf = (c, k, x) => { const t = LIVE_COLLS[c]; return t === 'arr' ? x && x.patient : t === 'mar' ? k.split('|')[0] : t === 'verified' ? ((S.orders || []).find((o) => o.id === k) || {}).patient : t === 'dcsum' ? ((S.discharges || []).find((d) => d.id === k) || {}).patient : t === 'pt' ? k : ''; };
  function liveEach(fn, onlyPid) {
    Object.keys(LIVE_COLLS).forEach((c) => {
      if (onlyPid && isOps(c)) return;
      if (LIVE_COLLS[c] === 'scalar') { fn(c, '_', S[c] === undefined ? null : S[c]); return; }
      const v = S[c]; if (!v) return;
      if (isArr(c)) v.forEach((x) => { const k = itemKey(x); if (k && (!onlyPid || x.patient === onlyPid)) fn(c, k, x); });
      else Object.keys(v).forEach((k) => { if (!onlyPid || ownerOf(c, k, v[k]) === onlyPid) fn(c, k, v[k]); });
    });
  }
  const newKeys = () => Object.keys(LIVE_COLLS).forEach((c) => { if (isArr(c)) (S[c] || []).forEach((x) => { if (x && typeof x === 'object' && !x.id && !x._k) x._k = 'K-' + (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase(); }); });
  const applyPatches = (pid) => { const p = P(pid), f = (S.patientPatches || {})[pid]; if (p && f) Object.assign(p, clone(f)); };
  function liveInstall(d) {
    Object.keys(LIVE_COLLS).forEach((c) => { const v = (d.records || {})[c]; S[c] = LIVE_COLLS[c] === 'scalar' ? (v === undefined ? null : clone(v)) : clone(v || (isArr(c) ? [] : {})); }); // roles with no census get none
    liveVer = Object.assign({}, d.versions); liveSnap = new Map(); liveBusy = new Set();
    liveEach((c, k, x) => liveSnap.set(c + '|' + k, JSON.stringify(x)));
    Object.keys(S.patientPatches).forEach(applyPatches);
  }
  function liveMerge(pid, d) {
    liveEach((c, k) => liveSnap.delete(c + '|' + k), pid);
    Object.keys(LIVE_COLLS).forEach((c) => {
      if (isOps(c)) return;
      const inc = clone((d.records || {})[c] || (isArr(c) ? [] : {}));
      if (isArr(c)) S[c] = (S[c] || []).filter((x) => x.patient !== pid).concat(inc);
      else { S[c] = S[c] || {}; Object.keys(S[c]).forEach((k) => { if (ownerOf(c, k, S[c][k]) === pid) delete S[c][k]; }); Object.assign(S[c], inc); }
    });
    Object.assign(liveVer, d.versions || {});
    liveEach((c, k, x) => liveSnap.set(c + '|' + k, JSON.stringify(x)), pid);
    applyPatches(pid);
  }
  function liveRevertOps(c, k, cur) {
    const ck = c + '|' + k;
    if (LIVE_COLLS[c] === 'scalar') S[c] = cur ? cur.body : null;
    else if (isArr(c)) { const i = S[c].findIndex((x) => itemKey(x) === k); if (cur) { if (i >= 0) S[c][i] = cur.body; else S[c].push(cur.body); } else if (i >= 0) S[c].splice(i, 1); }
    else if (cur) S[c][k] = cur.body; else delete S[c][k];
    if (cur) { liveVer[ck] = cur.version; liveSnap.set(ck, JSON.stringify(cur.body)); } else { delete liveVer[ck]; liveSnap.delete(ck); }
  }
  async function liveReveal(purpose) {
    const ids = [...new Set((SEED.gaps || []).map((g) => g.patient))];
    const r = await store.api('POST', '/api/reveal', { ids, purpose });
    if (r.status === 401) return liveExpired();
    if (!r.ok) { toast(r.data.error || 'Names were not revealed.'); return; }
    r.data.patients.forEach((x) => { const p = P(x.id); if (p) Object.assign(p, { name: x.name, mrn: x.mrn }); });
    render();
  }
  function liveRefresh(pid) { liveFlight = liveFlight.then(() => liveRefreshNow(pid)).catch((e) => console.error(e)); }
  async function liveRefreshNow(pid) {
    const r = await store.api('GET', '/api/patients/' + encodeURIComponent(pid));
    if (r.status === 401) return liveExpired();
    if (r.ok) { const p = P(pid); const np = livePatient(Object.assign({}, r.data.patient, { _access: r.data.access })); if (p) { Object.keys(p).forEach((k) => { if (!(k in np)) delete p[k]; }); Object.assign(p, np); } liveMerge(pid, r.data); }
    if (me()) render();
  }
  function liveSync() {
    if (!me() || liveQueued) return;
    liveQueued = true;
    const ep = liveEpoch;
    liveFlight = liveFlight.then(() => new Promise((r) => queueMicrotask(r))).then(async () => {
      liveQueued = false;
      if (ep !== liveEpoch) return;
      // 1. New patients are registered first, so records about them can follow
      for (const p of (S.extraPatients || []).filter((x) => !x._stub && !x._saved && !x._sending)) {
        p._sending = true;
        const { _forced, _sending, ...body } = p;
        const r = await store.api('POST', '/api/patients/register', { patient: body, force: !!_forced });
        if (ep !== liveEpoch) return;
        delete p._sending;
        if (r.status === 401) return liveExpired();
        if (r.ok) { Object.assign(p, { _saved: true, mrn: r.data.mrn, token: r.data.token, _access: p.unidentified ? 'care' : p._access }); }
        else { toast('Not registered: ' + (r.data.error || 'refused')); S.extraPatients = S.extraPatients.filter((x) => x !== p); }
      }
      newKeys();
      const writes = [];
      liveEach((c, k, x) => {
        const ck = c + '|' + k, j = JSON.stringify(x);
        if (liveSnap.get(ck) === j || liveBusy.has(ck)) return;
        const patient = isOps(c) ? '' : ownerOf(c, k, x); if (!isOps(c) && !patient) return;
        if (!isOps(c) && (S.extraPatients || []).some((p) => p.id === patient && !p._saved && !p._stub)) return; // wait for its registration
        writes.push({ coll: c, key: k, patient, version: liveVer[ck] || 0, body: j === undefined ? null : JSON.parse(j), _j: j });
      });
      // 2. Account changes go last, after any role request they depend on
      (S.users || []).forEach((x) => { const j = userKey(x); if (liveUsersSnap.has(x.id) && liveUsersSnap.get(x.id) !== j && !liveBusy.has('users|' + x.id)) writes.push({ coll: 'users', key: x.id, patient: '', version: 0, body: { role: x.role, dept: x.dept || null, unit: x.unit || null, status: x.status }, _j: j }); });
      if (!writes.length) return;
      writes.forEach((w) => liveBusy.add(w.coll + '|' + w.key));
      const refused = new Set(); let msg = '';
      for (let i = 0; i < writes.length; i += 50) {
        const batch = writes.slice(i, i + 50);
        const r = await store.api('POST', '/api/records', { writes: batch.map(({ _j, ...w }) => w) });
        if (ep !== liveEpoch) return; // signed out meanwhile: the write landed (or not) under the old session
        if (r.status === 401) { liveBusy.clear(); return liveExpired(); }
        const res = r.ok ? r.data.results : batch.map(() => ({ ok: false, error: r.data.error || 'Not saved.' }));
        res.forEach((x, n) => {
          const w = batch[n], ck = w.coll + '|' + w.key;
          liveBusy.delete(ck);
          if (x.ok) { if (w.coll === 'users') liveUsersSnap.set(w.key, w._j); else { liveVer[ck] = x.version; liveSnap.set(ck, w._j); } }
          else {
            msg = msg || x.error;
            if (w.coll === 'users') { const v = U(w.key), b = (x.current || {}).body; if (v && b) { Object.assign(v, { role: b.role, dept: b.dept || undefined, unit: b.unit || undefined, status: b.status }); liveUsersSnap.set(w.key, userKey(v)); } }
            else if (isOps(w.coll)) liveRevertOps(w.coll, w.key, x.current);
            else refused.add(w.patient);
          }
        });
      }
      if (msg) { toast('Not saved: ' + msg); refused.forEach((pid) => liveRefresh(pid)); if (!refused.size) render(); }
      liveSync(); // anything changed while these were in flight
    }).catch((e) => console.error(e));
  }

  let SEED0 = null; // pristine copy, taken at boot once every module has loaded
  function liveRestoreSeed(ids) {
    Object.keys(SEED0).forEach((k) => {
      const v = SEED[k], o = clone(SEED0[k]);
      if (k === 'patients') return;
      if (Array.isArray(v)) v.splice(0, v.length, ...o.filter((x) => !x || typeof x !== 'object' || !('patient' in x) || ids.has(x.patient)));
      else if (v && typeof v === 'object') { Object.keys(v).forEach((key) => delete v[key]); Object.keys(o).forEach((key) => { const m = /^(P\d+)\b/.exec(key); if (!m || ids.has(m[1])) v[key] = o[key]; }); }
    });
  }
  const VITALS0 = { bp: '—', hr: null, rr: null, temp: null, spo2: null };
  const livePatient = (p) => Object.assign({ allergies: [], problems: [], meds: [], labs: [], consults: [], phone: '', vitals: Object.assign({}, VITALS0), _stub: false }, p, p.vitals ? { vitals: Object.assign({}, VITALS0, p.vitals) } : {});
  function liveForget() {
    SEED.patients.length = 0;
    liveRestoreSeed(new Set());
    S = withModules(freshState());
    UI.live = { stage: 'password' }; UI.liveChart = null; UI.liveAudit = null;
    liveSnap = new Map(); liveVer = {}; liveBusy = new Set(); liveUsersSnap = new Map(); liveEpoch++;
  }
  function liveLoad(d, how) {
    const ids = new Set(d.patients.map((p) => p.id));
    liveRestoreSeed(ids);
    SEED.patients.splice(0, SEED.patients.length, ...d.patients.map(livePatient));
    S = withModules(freshState());
    if (!S.config) S.config = { idleMin: d.config.idleMinutes, btgHours: d.config.btgHours }; // the server's configuration record is the source; never write it from here
    (d.users || []).forEach((x) => { const v = U(x.id); if (v) Object.assign(v, { role: x.role, dept: x.dept || undefined, unit: x.unit || undefined, title: x.title || v.title, status: x.status }, x.name ? { name: x.name } : {}); else S.users.push(Object.assign({}, x, { name: x.name || 'Patient' })); });
    liveUsersSnap = new Map(S.users.map((x) => [x.id, userKey(x)]));
    liveInstall(d);
    S.btg = (d.btg || []).map((g, i) => ({ id: 'BTG-L' + i, user: d.user.id, patient: g.patient_id, reason: g.reason, text: g.justification, at: g.granted_at, expires: g.expires_at, reviewed: false }));
    let u = U(d.user.id);
    if (!u) { u = { id: d.user.id }; S.users.push(u); }
    const own = d.user.role === 'patient' ? SEED.patients.find((p) => p.id === d.user.patientId) : null;
    Object.assign(u, { username: d.user.username, role: d.user.role, dept: d.user.dept, unit: d.user.unit, title: d.user.title || u.title, patientId: d.user.patientId, status: 'active', mfa: 'Authenticator app' }, { name: d.user.name || (own && own.name) || u.name });
    session = { userId: u.id, at: Date.now(), last: Date.now() };
    UI.live = { stage: 'in' }; UI.msg = ''; UI.liveChart = null;
    audit('sign-in', { detail: how === 'resume' ? 'session resumed (API cookie)' : 'password + authenticator (API)' });
    if (location.hash === '#home' || how === 'resume') render(); else location.hash = 'home';
  }
  async function liveBoot() {
    SEED0 = clone(SEED); SEED.patients.length = 0;
    S = withModules(freshState());
    UI.live = { stage: 'loading' };
    S = store.trackState(S); T.store = store; store.attach(T);
    render();
    const r = await store.api('GET', '/api/bootstrap');
    if (r.ok) liveLoad(r.data, 'resume');
    else { UI.live = { stage: 'password' }; UI.msg = r.status === 0 ? r.data.error : ''; render(); }
  }
  function liveExpired() { session = null; liveForget(); UI.msg = 'Your session ended on the server (signed out, idle timeout or expired). Sign in again.'; history.replaceState(null, '', location.pathname + location.search); render(); }
  function viewLiveLogin() {
    const st = (UI.live || {}).stage || 'loading';
    const form = st === 'loading' ? '<p class="e-note">Connecting to the Tessera API…</p>'
      : st === 'mfa' ? `<form data-form="live-mfa" class="e-pw" autocomplete="off">
          <div class="field"><label for="lg-code">6-digit code from your authenticator app</label><input id="lg-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required autofocus></div>
          <button class="btn primary" type="submit">Verify and sign in</button><button class="btn" type="button" data-act="live-restart">Start again</button></form>`
      : `<form data-form="live-pw" class="e-pw" autocomplete="on">
          <div class="field"><label for="lg-user">Username</label><input id="lg-user" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(UI.liveUser || '')}" required ${UI.liveUser ? '' : 'autofocus'}></div>
          <div class="field"><label for="lg-pass">Password</label><input id="lg-pass" name="password" type="password" autocomplete="current-password" required ${UI.liveUser ? 'autofocus' : ''}></div>
          <button class="btn primary" type="submit">Continue</button></form>`;
    return `<div class="entry">
      <div class="e-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="e-top"><div class="e-brand">${LOGO}<div><b>Tessera Health</b><small>${esc(SEED.org.name)}</small></div></div><span class="e-live"><i></i>Live</span></header>
      <div class="e-body"><div class="e-panel" style="max-width:440px;margin:0 auto">
        <div class="e-panel-head"><h2>${st === 'mfa' ? 'Confirm it’s you' : 'Sign in'}</h2><p>${st === 'mfa' ? 'Enter the code your authenticator app shows now. Codes change every 30 seconds.' : 'Password, then a code from your authenticator app. The session locks after ' + idleMin() + ' minutes idle.'}</p></div>
        ${UI.msg ? `<div class="e-msg" role="alert">${esc(UI.msg)}</div>` : ''}
        ${form}
        <p class="e-note">Live mode · connected to ${esc(store.info.label.split('·')[0])}API · nothing about patients is stored on this device</p>
      </div></div></div>`;
  }
  FORMS['live-pw'] = async (f) => {
    await liveLogout; // the previous session's sign-out must finish first: it shares the cookie
    UI.liveUser = f.username;
    const r = await store.api('POST', '/api/auth/password', { username: f.username, password: f.password });
    if (r.ok) { UI.live = { stage: 'mfa' }; UI.msg = ''; } else UI.msg = r.data.error || 'Sign-in failed.';
    render();
  };
  FORMS['live-mfa'] = async (f) => {
    const r = await store.api('POST', '/api/auth/mfa', { code: f.code });
    if (r.status === 401 && /Start again/.test(r.data.error || '')) { UI.live = { stage: 'password' }; UI.msg = r.data.error; render(); return; }
    if (!r.ok) { UI.msg = r.data.error || 'Sign-in failed.'; render(); return; }
    const b = await store.api('GET', '/api/bootstrap');
    if (!b.ok) { UI.live = { stage: 'password' }; UI.msg = b.data.error || 'Signed in, but the record list could not be loaded.'; render(); return; }
    liveLoad(b.data, 'signin');
  };
  ACT['live-restart'] = () => { UI.live = { stage: 'password' }; UI.msg = ''; render(); };

  function liveFetchChart(u, id) {
    UI.liveChart = id; UI.liveChartState = 'loading';
    store.api('GET', '/api/patients/' + encodeURIComponent(id)).then((r) => {
      if (UI.liveChart !== id || !me()) return;
      if (r.status === 401) return liveExpired();
      const p = P(id);
      if (r.ok) {
        const np = livePatient(Object.assign({}, r.data.patient, { _access: r.data.access }));
        if (p) { Object.keys(p).forEach((k) => { if (!(k in np)) delete p[k]; }); Object.assign(p, np); } else { S.extraPatients = S.extraPatients || []; S.extraPatients.push(np); }
        liveMerge(id, r.data);
        UI.liveChartState = 'ok';
      } else if (r.status === 403 && r.data.btg) {
        if (p) p._access = 'none';
        else { const h = r.data.header || {}; S.extraPatients = S.extraPatients || []; S.extraPatients.push(livePatient({ id, token: h.token, age: h.age, sex: h.sex, dept: h.dept, unit: h.unit, name: 'Restricted record', mrn: '—', status: '—', code: 'Full code', _access: 'none', _stub: true })); }
        audit('chart-access', { patient: P(id), outcome: 'blocked', detail: 'no care relationship (API)' });
        UI.liveChartState = 'ok';
      } else { audit('chart-access', { resource: id, outcome: 'denied', detail: `API ${r.status}` }); UI.liveChartState = 'missing'; UI.liveChartErr = r.data.error; }
      render();
    });
  }
  const viewPatientDemo = VIEWS.patient;
  VIEWS.patient = (u, args) => {
    if (!LIVE || u.role === 'patient') return viewPatientDemo(u, args);
    const id = args[0];
    if (UI.liveChart !== id) liveFetchChart(u, id); // each time a chart is opened, so the server records the view
    if (UI.liveChartState === 'loading') return { title: 'Opening chart', sub: 'Fetching from the Tessera API · every view is logged', body: '<div class="banner info"><p>Loading the record…</p></div>' };
    if (UI.liveChartState === 'missing') return viewDenied(u, 'this record');
    return viewPatientDemo(u, args);
  };
  const viewAuditDemo = VIEWS.audit;
  VIEWS.audit = (u, args) => {
    if (LIVE && !UI.liveAudit) {
      UI.liveAudit = { events: [], grants: [] };
      Promise.all([store.api('GET', '/api/audit?limit=300'), store.api('GET', '/api/btg')]).then(([a, b]) => {
        if (a.status === 401) return liveExpired();
        UI.liveAudit = {
          events: (a.data.events || []).slice().reverse().map((e) => ({ seq: e.seq, ts: e.ts, actor: e.actor, role: e.role, action: e.action, resource: e.resource, detail: e.detail, patient: e.patient_token, outcome: e.outcome })),
          grants: (b.data.grants || []).map((g) => ({ id: g.id, user: g.user_id, patient: g.patient_id, token: g.token, reason: g.reason, text: g.justification, at: g.granted_at, reviewed: !!g.reviewed_at, own: g.user_id === u.id }))
        };
        render();
      });
    }
    const v = viewAuditDemo(u, args);
    if (LIVE) v.sub = 'From the Tessera API · append-only · hash-chained in the database · this view is logged';
    return v;
  };
  T.after.push((u, route) => { if (!LIVE) return; if (route !== 'patient') UI.liveChart = null; if (route !== 'audit') UI.liveAudit = null; });
  async function liveVerify() {
    const r = await store.api('GET', '/api/audit/verify');
    UI.chainResult = r.ok ? { ok: r.data.ok, n: r.data.checked, at: r.data.broken_at } : { ok: false, at: '?' };
    render();
  }
  async function liveReview(id) {
    const r = await store.api('POST', `/api/btg/${encodeURIComponent(id)}/review`, { outcome: 'appropriate' });
    toast(r.ok ? 'Review recorded.' : r.data.error || 'Could not record the review.');
    UI.liveAudit = null; render();
  }
  function liveBtg(f) { liveFlight = liveFlight.then(() => liveBtgNow(f)).catch((e) => console.error(e)); return liveFlight; }
  async function liveBtgNow(f) {
    const r = await store.api('POST', `/api/patients/${encodeURIComponent(f.p)}/btg`, { reason: f.reason, justification: (f.text || '').trim() });
    if (r.status === 401) return liveExpired();
    if (!r.ok) { toast(r.data.error || 'Emergency access was not granted.'); return; }
    S.btg.push({ id: 'BTG-' + r.data.grant, user: me().id, patient: f.p, reason: f.reason, text: f.text.trim(), at: new Date().toISOString(), expires: r.data.expires, reviewed: false });
    audit('break-the-glass', { patient: P(f.p), purpose: 'Emergency (break-the-glass)', detail: `${f.reason} (API grant ${r.data.grant})` });
    toast(`Emergency access granted for ${S.config.btgHours} hours. Privacy Office notified.`);
    UI.liveChart = null; render(); // refetch: the server now opens the chart under the grant
    for (let i = 0; i < 200 && UI.liveChartState === 'loading'; i++) await new Promise((r) => setTimeout(r, 25));
  }
  async function liveSearch(q) {
    const u = me(); if (!u || !['doctor', 'nurse'].includes(u.role)) return;
    const r = await store.api('GET', '/api/search?q=' + encodeURIComponent(q));
    if (r.status === 401) return liveExpired();
    if (!r.ok) return;
    S.extraPatients = S.extraPatients || [];
    r.data.matches.forEach((m) => {
      if (SEED.patients.some((p) => p.id === m.id)) return; // already in the census
      const ex = S.extraPatients.find((p) => p.id === m.id);
      if (ex) { ex._match = q.toLowerCase(); return; }
      S.extraPatients.push(livePatient({ id: m.id, token: m.token, age: m.age, sex: m.sex, dept: m.dept, unit: m.unit, name: 'Restricted record', mrn: '—', status: '—', code: 'Full code', _access: 'none', _stub: true, _match: q.toLowerCase() }));
    });
    if (UI.search.trim().toLowerCase() === q.toLowerCase()) render();
  }

  Object.assign(T, { verifyChain, marState: (m, t) => marState(m, t), VIEWS, ACT, FORMS, CHART, allPts, esc, clone, P, U, me, nid, tok, fnv, pill, statePill, allergyChips, phoneCell, tiles, panel, table, money, dayStr, ago, timeStr, toMin, nowMin, initials, toast, audit, careRel, chartAccess, btgActive, myPatients, openModal, render, save, DEPT, UNIT, ROLE_LABEL, location_, purposeOf, maskId, cds, counts: {} });
  Object.defineProperty(T, 'S', { get: () => S });
  T.patchPatient = (id, fields) => { if (store.tracing) store.note('patients', 'w'); const p = P(id); Object.assign(p, fields); S.patientPatches = S.patientPatches || {}; S.patientPatches[id] = Object.assign(S.patientPatches[id] || {}, fields); save(); };
  T.iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  T.navFor = navFor;
  T.boot = function () {
    if (LIVE) return liveBoot();
    S = store.loadState();
    S = (!S || !Array.isArray(S.audit)) ? freshState() : S;
    if (!S.appts) S.appts = clone(SEED.appointments);
    withModules(S); // fills any module state missing from a saved session
    Object.entries(S.patientPatches || {}).forEach(([id, f]) => { const p = P(id); if (p) Object.assign(p, f); });
    if (session && (!me() || Date.now() - session.last > IDLE_MS_FN())) { session = null; saveSession(); }
    const f = store.flash.get(); if (f) UI.msg = f; else if (store.notice) UI.msg = store.notice;
    S = store.trackState(S); T.store = store; store.attach(T);
    render();
  };
})();
