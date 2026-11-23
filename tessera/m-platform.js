/* Tessera Health — platform: notifications, role-aware global search, hospital configuration,
   US data exchange (FHIR / SMART / TEFCA), order sets in CPOE. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, esc, clone, P, U, me, nid, pill, statePill, tiles, panel, table, timeStr, toast, audit, careRel, openModal, render, save, DEPT, UNIT } = T;
  const S = () => T.S;
  const UI = T.UI;

  T.inits.push((s) => {
    if (s.config === undefined) s.config = clone(SEED.configDefaults);
    if (s.orderSets === undefined) s.orderSets = clone(SEED.orderSets);
    if (s.interop === undefined) s.interop = clone(SEED.interop);
    if (s.notifRead === undefined) s.notifRead = {};
  });

  /* ======================= Notifications ======================= */
  function notifs(u) {
    const n = []; const add = (id, level, text, href) => n.push({ id, level, text, href });
    const mine = (pid) => careRel(u, P(pid));
    if (u.role === 'doctor' || u.role === 'nurse') {
      S().results.filter((r) => r.state !== 'Closed' && mine(r.patient)).forEach((r) => add('res-' + r.id + r.state, 'crit', `Critical ${r.test} ${r.value} for ${P(r.patient).name} is ${r.state.toLowerCase()}`, '#results'));
      S().handovers.filter((h) => !h.ack && mine(h.patient)).forEach((h) => add('ho-' + h.id, 'warn', `Handover for ${P(h.patient).name} waiting for acknowledgement`, '#handover'));
      const due = T.records ? T.records.inpatientsFor(u).reduce((k, p) => k + Object.keys(T.records.TOOLS).filter((t) => T.records.isDue(p.id, t)).length, 0) : 0;
      if (due) add('assess-' + due, 'warn', `${due} risk assessment(s) due this shift`, '#assess');
    }
    if (u.role === 'doctor') {
      const ps = S().orders.filter((o) => o.status === 'Pending signature' && mine(o.patient)).length; if (ps) add('ord-' + ps, 'warn', `${ps} order(s) waiting for your signature`, '#orders');
      S().discharges.forEach((d) => d.steps.filter((s) => s.owner === 'doctor' && s.state !== 'Done' && mine(d.patient)).forEach(() => add('dc-' + d.id, 'info', `Discharge summary needed for ${P(d.patient).name}`, '#dcsum-' + d.id)));
      S().portalRequests.filter((r) => r.patient && r.state === 'Pending' && mine(r.patient)).forEach((r) => add('rf-' + r.id, 'info', `Refill request from ${P(r.patient).name}: ${r.drug}`, '#rx'));
      S().docs.filter((d) => d.status === 'Quarantined' && d.by === u.name).forEach((d) => add('doc-' + d.id, 'crit', `Outside record quarantined: ${d.title}`, '#docintel'));
      (S().rpm || []).filter((r) => !r.ack && mine(r.patient)).forEach((r) => add('rpm-' + r.patient + r.device, r.level, `${P(r.patient).name}: ${r.device} ${r.reading}`, '#tele'));
    }
    if (u.role === 'pharmacist') {
      const q = S().orders.filter((o) => o.type === 'Medication' && o.status === 'Signed' && !S().verified[o.id]).length; if (q) add('ver-' + q, 'warn', `${q} order(s) to verify`, '#verify');
      Object.entries(S().medrec).forEach(([pid, r]) => Object.entries(r).forEach(([k, x]) => { if (x.by && !x.verifiedBy) add(`mr-${pid}-${k}`, 'info', `${k === 'admission' ? 'Admission' : 'Discharge'} reconciliation for ${P(pid).name} ready to verify`, '#medrec'); }));
    }
    if (u.role === 'lab' || u.role === 'pathologist') { const c = S().labOrders.filter((o) => u.role === 'pathologist' ? o.status === 'Resulted' : o.priority === 'STAT' && o.status !== 'Released').length; if (c) add('lab-' + c, 'warn', u.role === 'pathologist' ? `${c} result(s) waiting for verification` : `${c} STAT specimen(s) open`, '#lab'); }
    if (u.role === 'radiologist') { const c = S().radOrders.filter((o) => o.status === 'Completed').length; if (c) add('rad-' + c, 'warn', `${c} study(ies) waiting for a report`, '#radiology'); }
    if (u.role === 'receptionist') { S().bedRequests.filter((r) => !r.done).forEach((r) => add('br-' + r.id, 'warn', `Admission waiting for a bed in ${UNIT[r.unit]}`, '#beds')); S().appts.filter((a) => a.status === 'No-show').forEach((a) => add('ns-' + a.patient + a.time, 'info', `${P(a.patient).name} missed a ${a.time} visit`, '#home')); }
    if (u.role === 'billing') { S().claims.filter((c) => c.status === 'Denied').forEach((c) => add('den-' + c.id, 'crit', `Claim ${c.id} denied`, '#accounts')); S().discharges.forEach((d) => d.steps.filter((s) => s.owner === 'billing' && s.state !== 'Done').forEach(() => add('dcb-' + d.id, 'info', `Financial clearance pending for a discharge`, '#discharge'))); }
    if (u.role === 'insurance') S().insCases.filter((c) => c.status === 'Payer query').forEach((c) => add('pq-' + c.id, 'crit', `Payer query on ${c.id}`, '#insurance'));
    if (u.role === 'quality') { S().incidents.filter((i) => i.status === 'Reported').forEach((i) => add('ir-' + i.id, 'warn', `New incident ${i.id}: ${i.type}`, '#incidents')); S().hai.filter((h) => h.nhsn !== 'Reported').forEach((h) => add('hai-' + h.id, 'info', `${h.type} not yet reported to NHSN`, '#infection')); }
    if (u.role === 'admin') { S().btg.filter((g) => !g.reviewed).forEach((g) => add('btg-' + g.id, 'crit', `Break-the-glass access by ${U(g.user).name} needs review`, '#audit')); S().roleRequests.filter((r) => r.status === 'pending' && r.by !== u.id).forEach((r) => add('rq-' + r.id, 'warn', `Role change for ${U(r.user).name} needs a second approver`, '#users')); S().assets.filter((a) => a.next < 0).forEach((a) => add('pm-' + a.id, 'warn', `${a.name}: maintenance overdue`, '#assets')); (S().interop.apps || []).filter((a) => /Pending/.test(a.status)).forEach((a) => add('app-' + a.id, 'info', `SMART app "${a.name}" waiting for review`, '#interop')); }
    if (u.role === 'executive') { const late = S().er.filter((e) => !['Discharged', 'Admitted'].includes(e.status) && !e.provider && e.mOff > SEED.esiTarget[e.esi]).length; if (late) add('er-' + late, 'warn', `${late} ER patient(s) over their wait target`, '#home'); }
    if (u.role === 'patient') { const p = P(u.patientId); S().portalRequests.filter((r) => r.patient === p.id && r.state !== 'Pending').forEach((r) => add('rfp-' + r.id + r.state, r.state === 'Approved' ? 'ok' : 'warn', `Refill ${r.state.toLowerCase()}: ${r.drug}`, '#mymeds')); if (S().labOrders.some((o) => o.patient === p.id && o.status === 'Released')) add('res-ready', 'info', 'New results are available', '#myresults'); }
    (T.notifHooks || []).forEach((fn) => { try { fn(u, add); } catch (e) { console.error(e); } });
    return n;
  }
  T.notifs = notifs;
  const BELL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const LENS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  T.topbarExtras = (u) => {
    const list = notifs(u); const read = new Set(S().notifRead[u.id] || []); const unread = list.filter((x) => !read.has(x.id));
    const drop = UI.notifOpen ? `<div class="notif-panel" role="dialog" aria-label="Notifications"><div class="row between"><b>Notifications</b>${unread.length ? '<button class="linkbtn" data-act="notif-readall">Mark all read</button>' : ''}</div>
      ${list.length ? list.map((x) => `<a class="notif-item ${read.has(x.id) ? 'read' : ''}" href="${x.href}" data-act="notif-go" data-id="${esc(x.id)}" data-href="${x.href}"><span class="ndot ${x.level}"></span><span>${esc(x.text)}</span></a>`).join('') : '<p class="muted">Nothing needs you right now.</p>'}</div>` : '';
    return `<button class="btn small searchbtn" data-act="search-open" aria-label="Search (Ctrl or Command + K)">${LENS}<span>Search</span><kbd>⌘K</kbd></button>
      <div class="notif"><button class="btn small" data-act="notif-toggle" aria-expanded="${!!UI.notifOpen}" aria-label="Notifications, ${unread.length} unread">${BELL}${unread.length ? `<span class="nbadge">${unread.length}</span>` : ''}</button>${drop}</div>`;
  };
  Object.assign(ACT, {
    'notif-toggle': () => { UI.notifOpen = !UI.notifOpen; render(); },
    'notif-readall': () => { const u = me(); S().notifRead[u.id] = notifs(u).map((x) => x.id); save(); render(); },
    'notif-go': (d) => { const u = me(); const r = new Set(S().notifRead[u.id] || []); r.add(d.id); S().notifRead[u.id] = [...r]; UI.notifOpen = false; save(); if (location.hash === d.href) render(); else location.hash = d.href.slice(1); }
  });
  document.addEventListener('click', (e) => { if (UI.notifOpen && !e.target.closest('.notif')) { UI.notifOpen = false; render(); } });

  /* ======================= Global search (role-aware) ======================= */
  function patientHits(u, q) {
    const match = (p) => p.name.toLowerCase().includes(q) || String(p.mrn).toLowerCase().includes(q) || (p.alias || '').toLowerCase().includes(q);
    const pts = T.allPts().filter(match).slice(0, 8);
    if (['doctor', 'nurse', 'pharmacist'].includes(u.role)) return pts.map((p) => { const ok = careRel(u, p) || T.btgActive(u, p); return { p, label: p.name, sub: ok ? `MRN ${p.mrn} · ${p.age}${p.sex} · ${T.location_(p)}` : `MRN ${p.mrn} · no care relationship (break-the-glass)`, href: `#patient-${p.id}-${u.role === 'pharmacist' ? 'meds' : 'overview'}`, lock: !ok }; });
    if (u.role === 'receptionist') return pts.map((p) => ({ p, label: p.name, sub: `MRN ${p.mrn} · DOB ${p.dob || '—'} · registry`, href: '#registration', set: () => { UI.regQ = p.mrn; } }));
    if (u.role === 'billing') return pts.filter((p) => S().claims.some((c) => c.patient === p.id)).map((p) => ({ p, label: p.name, sub: `MRN ${p.mrn} · account`, href: '#accounts', set: () => { UI.selClaim = S().claims.find((c) => c.patient === p.id).id; } }));
    if (u.role === 'insurance') return pts.filter((p) => S().insCases.some((c) => c.patient === p.id)).map((p) => ({ p, label: p.name, sub: `MRN ${p.mrn} · case`, href: '#insurance', set: () => { UI.insSel = S().insCases.find((c) => c.patient === p.id).id; } }));
    if (u.role === 'lab' || u.role === 'pathologist') return pts.filter((p) => S().labOrders.some((o) => o.patient === p.id)).map((p) => ({ p, label: p.name, sub: `MRN ${p.mrn} · lab orders`, href: '#lab' }));
    if (u.role === 'radiologist') return pts.filter((p) => S().radOrders.some((o) => o.patient === p.id)).map((p) => ({ p, label: p.name, sub: `MRN ${p.mrn} · imaging orders`, href: '#radiology', set: () => { UI.radSel = S().radOrders.find((o) => o.patient === p.id).id; } }));
    return null; // role does not search patients
  }
  function searchResults(u, raw) {
    const q = raw.trim().toLowerCase(); const out = [];
    T.navFor(u).forEach(([sec, items]) => items.forEach(([id, label]) => { if (!q || label.toLowerCase().includes(q) || sec.toLowerCase().includes(q)) out.push({ group: 'Pages', label, sub: sec, href: '#' + id }); }));
    if (q.length >= 2) {
      const ph = patientHits(u, q);
      if (ph) ph.forEach((h) => out.push(Object.assign({ group: 'Patients' }, h)));
      else out.push({ group: 'Patients', label: 'Patient search isn\'t part of your role', sub: u.role === 'quality' ? 'Use the de-identified care-gap list' : 'Aggregate and administrative views only', disabled: true });
      if (u.role === 'doctor') S().orders.filter((o) => o.text.toLowerCase().includes(q) && careRel(u, P(o.patient))).slice(0, 5).forEach((o) => out.push({ group: 'Orders', label: o.text, sub: `${P(o.patient).name} · ${o.status}`, href: '#orders' }));
    }
    return out.slice(0, 24);
  }
  let sIdx = 0, sList = [], sLogT = null;
  function paintSearch() {
    const root = document.getElementById('search-root'); const u = me(); if (!root || !u) return;
    const q = document.getElementById('gs-q').value; sList = searchResults(u, q); if (sIdx >= sList.length) sIdx = 0;
    let g = ''; document.getElementById('gs-list').innerHTML = sList.map((r, i) => { const h = r.group !== g ? `<li class="gs-group">${r.group}</li>` : ''; g = r.group;
      return h + `<li><button class="gs-item ${i === sIdx ? 'on' : ''} ${r.disabled ? 'dis' : ''}" data-i="${i}" ${r.disabled ? 'disabled' : ''}><span>${esc(r.label)}</span><small>${esc(r.sub || '')}</small></button></li>`; }).join('') || '<li class="muted" style="padding:10px">No matches.</li>';
    clearTimeout(sLogT); const toks = sList.filter((r) => r.p).map((r) => T.tok(r.p));
    sLogPending = toks.length ? () => audit('global-search', { resource: `"${q.trim()}"`, patients: toks.join(' '), detail: `${toks.length} patient result(s)` }) : null;
    if (sLogPending) sLogT = setTimeout(flushSearchLog, 700);
  }
  let sLogPending = null;
  function flushSearchLog() { clearTimeout(sLogT); if (sLogPending) { const f = sLogPending; sLogPending = null; f(); } }
  function openSearch() {
    if (!me()) return; closeSearch(); sIdx = 0;
    const root = document.createElement('div'); root.id = 'search-root'; root.className = 'modal-back';
    root.innerHTML = `<div class="modal gs" role="dialog" aria-modal="true" aria-label="Search"><div class="row" style="gap:8px">${LENS}<input id="gs-q" class="search" style="flex:1;width:auto" placeholder="Search pages, patients, orders" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="Search"></div><ul id="gs-list" class="gs-list" role="listbox"></ul><span class="kpi-note">Results follow your role's access. Patient searches are logged. ↑↓ to move, Enter to open, Esc to close.</span></div>`;
    document.body.appendChild(root); const inp = document.getElementById('gs-q'); inp.focus(); paintSearch();
    inp.addEventListener('input', () => { sIdx = 0; paintSearch(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { sIdx = Math.min(sList.length - 1, sIdx + 1); paintSearch(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sIdx = Math.max(0, sIdx - 1); paintSearch(); e.preventDefault(); } else if (e.key === 'Enter') { choose(sIdx); e.preventDefault(); } });
    root.addEventListener('click', (e) => { const b = e.target.closest('.gs-item'); if (b) { choose(+b.dataset.i); return; } if (e.target === root) closeSearch(); });
  }
  function closeSearch() { flushSearchLog(); const r = document.getElementById('search-root'); if (r) r.remove(); }
  function choose(i) { const r = sList[i]; if (!r || r.disabled) return; if (r.set) r.set(); if (r.p) audit('global-search-open', { patient: r.p, resource: r.href }); closeSearch(); if (location.hash === r.href) render(); else location.hash = r.href.slice(1); }
  ACT['search-open'] = () => openSearch();
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && me()) { e.preventDefault(); openSearch(); } else if (e.key === 'Escape') closeSearch(); });

  /* ======================= Hospital configuration ======================= */
  VIEWS.config = () => {
    const c = S().config;
    const cdsRow = (k, label, locked) => `<tr><td><b>${label}</b></td><td>${locked ? pill('ok', 'Always on') : `<label class="row" style="gap:8px"><input type="checkbox" data-change="cfg-cds" data-k="${k}" ${c.cds[k] !== false ? 'checked' : ''}> ${c.cds[k] !== false ? 'On' : 'Off'}</label>`}</td><td class="kpi-note">${locked ? 'Required: cannot be disabled' : 'Turning this off is logged and reported to the Pharmacy & Therapeutics committee'}</td></tr>`;
    const sets = S().orderSets.map((s) => `<article class="note"><div class="row between"><b>${esc(s.name)}</b><span class="kpi-note">${s.items.length} item(s)</span></div>${s.items.map((it, i) => `<div class="row between" style="font-size:13px"><span>${pill('', it.type)} ${esc(it.text)}</span><button class="linkbtn" data-act="cfg-os-del" data-s="${s.id}" data-i="${i}">Remove</button></div>`).join('')}</article>`).join('');
    const units = Object.entries(UNIT).map(([k, v]) => `<tr><td>${esc(v)}</td><td class="mono">${k}</td><td class="num">${SEED.beds.filter((b) => b.unit === k).length || '—'}</td></tr>`);
    const ret = c.retention.map(([n, y], i) => `<tr><td>${esc(n)}</td><td><input type="number" name="r${i}" min="0" max="30" value="${y}" style="width:70px" aria-label="Years for ${esc(n)}"> years</td></tr>`);
    return { title: 'Hospital configuration', sub: 'Security, clinical decision support, order sets, structure and retention · every change is audited', body:
      `<div class="grid-2">${panel('Security policy', `<form data-form="cfg-security" class="stack">
        <div class="field"><label for="cf-idle">Automatic logoff after inactivity</label><select id="cf-idle" name="idle">${[5, 10, 15, 30].map((m) => `<option value="${m}" ${c.idleMin === m ? 'selected' : ''}>${m} minutes</option>`).join('')}</select><small>HIPAA §164.312(a)(2)(iii). Applies to everyone at their next activity check.</small></div>
        <div class="field"><label for="cf-btg">Break-the-glass access lasts</label><select id="cf-btg" name="btg">${[2, 4, 8].map((h) => `<option value="${h}" ${c.btgHours === h ? 'selected' : ''}>${h} hours</option>`).join('')}</select></div>
        <div class="row"><span>Multi-factor sign-in</span>${pill('ok', 'Required for all users')}</div>
        <div><button class="btn primary" type="submit">Save security policy</button></div></form>`)}
      ${panel('Clinical decision support', table(['Check', 'Status', ''], [cdsRow('allergy', 'Drug–allergy', true), cdsRow('interaction', 'Drug–lab interaction (e.g. potassium)'), cdsRow('duplicate', 'Duplicate therapy'), cdsRow('missingDose', 'Missing dose')]), '', true)}</div>` +
      panel('Order sets', `<div class="grid">${sets}</div><form data-form="cfg-os-add" class="row"><select name="s" aria-label="Order set">${S().orderSets.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}<option value="new">+ New order set…</option></select><select name="type" aria-label="Order type"><option>Medication</option><option>Lab</option><option>Imaging</option><option>Nursing</option></select><input class="search" name="text" required placeholder="Order text, e.g. Magnesium 2 g IV once" aria-label="Order text"><input class="search" name="newname" placeholder="Name (for a new set)" aria-label="New set name" style="width:200px"><button class="btn small" type="submit">Add</button></form><span class="kpi-note">Clinicians use these from CPOE; every item still passes the safety checks.</span>`) +
      `<div class="grid-2">${panel('Departments and units', `<p class="kpi-note">Departments: ${Object.values(DEPT).map(esc).join(' · ')}</p>` + table(['Unit', 'Code', 'Beds'], units), '', false)}
      ${panel('Record retention schedule', `<form data-form="cfg-retention" class="stack">${table(['Record class', 'Keep for'], ret)}<span class="kpi-note">Strictest of HIPAA (6 yrs for documentation), California medical-record law and HEDIS lookbacks applies. 0 = deleted when no longer needed.</span><div><button class="btn small" type="submit">Save retention</button></div></form>`)}</div>` };
  };
  T.CHANGE['cfg-cds'] = (v, el) => { const k = el.dataset.k; S().config.cds[k] = el.checked; audit('config-change', { detail: `CDS ${k} ${el.checked ? 'on' : 'OFF'}` }); save(); render(); toast(el.checked ? 'Safety check turned on.' : 'Safety check turned off. This change is logged and reported.'); };
  Object.assign(FORMS, {
    'cfg-security'(f) { const c = S().config; c.idleMin = +f.idle; c.btgHours = +f.btg; audit('config-change', { detail: `idle ${c.idleMin} min, break-the-glass ${c.btgHours} h` }); save(); render(); toast('Security policy saved.'); },
    'cfg-retention'(f) { S().config.retention.forEach((r, i) => { r[1] = +f['r' + i]; }); audit('config-change', { detail: 'retention schedule' }); save(); render(); toast('Retention schedule saved.'); },
    'cfg-os-add'(f) { let set = S().orderSets.find((s) => s.id === f.s); if (f.s === 'new') { if (!f.newname) { toast('Name the new order set.'); return; } set = { id: nid('OS'), name: f.newname, items: [] }; S().orderSets.push(set); } set.items.push({ type: f.type, text: f.text }); audit('config-change', { detail: `order set "${set.name}": added ${f.text}` }); save(); render(); }
  });
  ACT['cfg-os-del'] = (d) => { const s = S().orderSets.find((x) => x.id === d.s); const [it] = s.items.splice(+d.i, 1); audit('config-change', { detail: `order set "${s.name}": removed ${it.text}` }); save(); render(); };

  // Order sets inside CPOE
  const baseOrders = VIEWS.orders;
  VIEWS.orders = (u, args) => { const v = baseOrders(u, args);
    v.body += panel('Order sets', `<form data-form="os-apply" class="row"><select name="p" aria-label="Patient">${T.myPatients(u).map((p) => `<option value="${p.id}">${esc(p.name)} · MRN ${p.mrn}</option>`).join('')}</select><select name="s" aria-label="Order set">${S().orderSets.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.items.length})</option>`).join('')}</select><button class="btn" type="submit">Queue order set</button></form><span class="kpi-note">Each item is queued for your signature and safety-checked on its own.</span>`);
    return v; };
  FORMS['os-apply'] = (f) => { const p = P(f.p); const set = S().orderSets.find((s) => s.id === f.s); let flagged = 0;
    set.items.forEach((it) => { const flag = T.cds(p, it.type, it.text); const o = { id: nid('O'), patient: p.id, type: it.type, text: it.text, priority: 'Routine', status: 'Pending signature', by: me().id, at: new Date().toISOString() }; if (flag) { o.flag = flag; flagged++; } S().orders.unshift(o); });
    audit('order-set-apply', { patient: p, detail: `${set.name}: ${set.items.length} orders` }); save(); render(); toast(`${set.items.length} orders queued${flagged ? `, ${flagged} with safety flags` : ''}.`); };

  /* ======================= Data exchange (replaces ABDM) ======================= */
  VIEWS.interop = () => {
    const x = S().interop; const q = S().audit.filter((e) => e.action === 'hie-query').length;
    const us = x.uscdi.map(([n, ok]) => `<tr><td>${esc(n)}</td><td>${ok ? pill('ok', 'Exposed') : pill('warn', 'Gap')}</td></tr>`);
    const apps = x.apps.map((a) => `<tr><td><b>${esc(a.name)}</b><span class="sub">${esc(a.kind)}</span></td><td class="mono" style="font-size:12px">${esc(a.scopes)}</td><td>${statePill(/Approved/.test(a.status) ? 'Approved' : /Revoked/.test(a.status) ? 'Denied' : 'Pending')}<span class="sub">${esc(a.status)}</span></td><td>${/Pending/.test(a.status) ? `<button class="btn small primary" data-act="app-ok" data-id="${a.id}">Approve</button> ` : ''}${/Approved|Pending/.test(a.status) ? `<button class="btn small danger" data-act="app-revoke" data-id="${a.id}">Revoke</button>` : ''}</td></tr>`);
    const jobs = x.jobs.map((j) => `<tr><td><b>${esc(j.kind)}</b><span class="sub">${esc(j.resources)}</span></td><td>${esc(j.when)}</td><td>${statePill(j.status === 'Completed' ? 'Completed' : 'Scheduled')}</td><td>${j.status !== 'Completed' ? `<button class="btn small" data-act="job-run" data-id="${j.id}">Run now</button>` : ''}</td></tr>`);
    return { title: 'Data exchange', sub: 'US interoperability: FHIR R4, SMART on FHIR, USCDI, TEFCA · replaces Olir One\'s ABDM (India) module', body:
      tiles([['R4', 'FHIR version'], [x.uscdi.filter((u) => u[1]).length + '/' + x.uscdi.length, 'USCDI v3 classes exposed'], [x.apps.filter((a) => /Approved/.test(a.status)).length, 'SMART apps approved'], [q, 'Network queries (this demo)']]) +
      `<div class="grid-2">${panel('FHIR endpoint', `<dl class="kv" style="margin:0"><div><dt>Base URL</dt><dd class="mono" style="margin:0;font-size:12px">${esc(x.base)}</dd></div><div><dt>Authorization</dt><dd style="margin:0">SMART on FHIR (OAuth 2.0, PKCE)</dd></div><div><dt>Patient Access API</dt><dd style="margin:0">${pill('ok', 'Enabled')} CMS-9115-F</dd></div><div><dt>TEFCA</dt><dd style="margin:0">${pill('warn', 'QHIN onboarding (simulated)')}</dd></div></dl><p class="kpi-note">Every API read is written to the same audit log as screen access, with the app as the actor. Information-blocking exceptions (21st Century Cures Act) are recorded per request.</p>`)}
      ${panel('USCDI v3 coverage', table(['Data class', 'Status'], us), '', true)}</div>` +
      panel('SMART on FHIR apps', table(['App', 'Scopes', 'Status', ''], apps), '<span class="kpi-note">New apps need a security review before patients can connect them</span>', true) +
      panel('Bulk and payer exchange', table(['Job', 'When', 'Status', ''], jobs), '', true) };
  };
  Object.assign(ACT, {
    'app-ok': (d) => { const a = S().interop.apps.find((x) => x.id === d.id); a.status = 'Approved'; audit('smart-app-approve', { resource: a.name }); save(); render(); },
    'app-revoke': (d) => { const a = S().interop.apps.find((x) => x.id === d.id); a.status = 'Revoked: tokens invalidated'; audit('smart-app-revoke', { resource: a.name }); save(); render(); toast(`${a.name} revoked. Its access tokens no longer work.`); },
    'job-run': (d) => { const j = S().interop.jobs.find((x) => x.id === d.id); j.status = 'Completed'; j.when = 'Just now'; audit('bulk-export', { resource: j.kind }); save(); render(); }
  });

  Object.assign(T.counts, { interop: () => { const n = S().interop.apps.filter((a) => /Pending/.test(a.status)).length; return n ? `<span class="count">${n}</span>` : ''; } });
})(window.Tessera);
