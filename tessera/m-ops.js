/* Tessera Health — operations, safety and leadership: command center, analytics, finance,
   assets, staffing, infection control, incident reporting, itemized billing. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, esc, clone, P, U, me, nid, pill, statePill, tiles, panel, table, money, timeStr, toast, audit, openModal, render, save, UNIT } = T;
  const S = () => T.S;
  const UI = T.UI;

  T.inits.push((s) => {
    const fill = (k, v) => { if (s[k] === undefined) s[k] = clone(v); };
    fill('incidents', SEED.incidents); fill('hai', SEED.hai); fill('assets', SEED.assets); fill('workOrders', []);
  });

  // CMS cell-size suppression: counts 1–10 are shown as "<11" in aggregate reports.
  const cell = (n) => n > 0 && n < 11 ? '<11' : n.toLocaleString();

  /* ======================= Executive ======================= */
  function hospitalNow() {
    const pts = T.allPts();
    const admitted = pts.filter((p) => p.status === 'Admitted').length;
    const beds = SEED.beds.length, occ = SEED.beds.filter((b) => pts.some((p) => p.unit === b.unit && p.bed === b.bed && p.status !== 'Discharged')).length;
    return { admitted, beds, occ, er: S().er.filter((e) => !['Discharged', 'Admitted'].includes(e.status)).length, esi12: S().er.filter((e) => e.esi <= 2 && !['Discharged', 'Admitted'].includes(e.status)).length,
      or: S().ot.length, orActive: S().ot.filter((c) => ['Preparation', 'In surgery'].includes(c.stage)).length, dc: S().discharges.length,
      crit: S().results.filter((r) => r.state !== 'Closed').length, hai: S().hai.filter((h) => h.status !== 'Resolved').length, inc: S().incidents.filter((i) => i.status !== 'Closed').length,
      day: S().daycare.filter((d) => d.phase !== 'Discharged').length };
  }
  T.HOME.executive = () => {
    const h = hospitalNow(); audit('view-command-center', { detail: 'aggregate only' });
    return { title: 'Command center', sub: `${SEED.org.name} · aggregate view, no patient identifiers`, body:
      tiles([[h.admitted, 'Inpatients'], [Math.round(h.occ / h.beds * 100) + '%', `Occupancy (${h.occ}/${h.beds})`], [h.er, 'In the ER'], [h.esi12, 'ER ESI 1–2', h.esi12 ? 'crit' : ''], [h.or, 'OR cases today'], [h.day, 'Day care bays'], [h.dc, 'Discharges in progress'], [h.crit, 'Open critical results', h.crit ? 'crit' : ''], [h.hai, 'Active HAIs', 'warn'], [h.inc, 'Open incidents', 'warn']]) +
      `<div class="banner info"><p>Leadership sees counts, rates and money. Names, MRNs and clinical details never reach this role, and small counts are suppressed in reports.</p></div>` +
      `<div class="row"><a class="btn primary" href="#analytics">Analytics</a><a class="btn" href="#finance">Finance</a></div>` };
  };
  VIEWS.analytics = () => {
    const H = SEED.history; audit('view-analytics', { detail: 'aggregate, small cells suppressed' });
    const dept = H.deptVolumes.filter((d) => d[1] + d[2] + d[3] > 0).map(([n, opd, ipd, er]) => `<tr><td>${esc(n)}</td><td class="num">${cell(opd)}</td><td class="num">${cell(ipd)}</td><td class="num">${cell(er)}</td></tr>`);
    const rare = H.rareCounts.map(([n, c]) => `<tr><td>${esc(n)}</td><td class="num"><b>${cell(c)}</b></td></tr>`);
    const m = SEED.measures.map((x) => { const r = x.num / x.den * 100; return `<tr><td class="mono">${x.code}</td><td>${esc(x.name)}</td><td class="num">${r.toFixed(1)}%</td><td>${(x.inverse ? r <= x.target : r >= x.target) ? pill('ok', 'Meets') : pill('warn', 'Below')}</td></tr>`; });
    const er = S().er.filter((e) => e.triagedOff != null).map((e) => e.mOff - e.triagedOff);
    return { title: 'Analytics', sub: 'Month to date (synthetic history for the demo) plus today from the live record', body:
      tiles([[er.length ? Math.round(er.reduce((a, b) => a + b, 0) / er.length) + ' min' : '—', 'ER door-to-triage, today'], ['31 min', 'ER door-to-provider, MTD'], ['82%', 'OR first-case on time, MTD'], ['4.1 d', 'Avg length of stay, MTD'], ['11.8%', '30-day readmission, MTD', 'warn']]) +
      `<div class="grid-2">${panel('Volume by department (MTD)', table(['Department', 'Outpatient', 'Inpatient', 'ER'], dept), '', true)}${panel('Safety and outcomes (MTD)', table(['Measure', 'Count'], rare), '<span class="kpi-note">Counts from 1 to 10 show as &lt;11 (CMS cell-size rule)</span>', true)}</div>` +
      panel('Quality (HEDIS MY2026)', table(['Measure', 'Name', 'Rate', 'Target'], m), '', true) };
  };
  VIEWS.finance = () => {
    const H = SEED.history; const claims = S().claims;
    const max = Math.max(...H.revenue.map((r) => r[1]));
    const rev = H.revenue.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${money(v)}</td><td style="min-width:160px"><div class="minibar"><i style="width:${v / max * 100}%"></i></div></td></tr>`);
    const mix = H.payerMix.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v}%</td><td style="min-width:160px"><div class="minibar"><i style="width:${v}%"></i></div></td></tr>`);
    const denied = claims.filter((c) => c.status === 'Denied').length, sub = claims.filter((c) => ['Submitted', 'Paid', 'Denied'].includes(c.status)).length;
    const ar = claims.filter((c) => c.status !== 'Paid').reduce((n, c) => n + c.charge, 0);
    return { title: 'Finance', sub: 'Revenue cycle performance · no patient-level data', body:
      tiles([[money(H.revenue.reduce((n, r) => n + r[1], 0)), 'Net revenue, MTD'], [money(ar), 'Open A/R (today)'], [sub ? Math.round(denied / sub * 100) + '%' : '—', 'Denial rate (today)', 'warn'], ['38 d', 'Days in A/R, MTD'], ['96%', 'Clean claim rate, MTD']]) +
      `<div class="grid-2">${panel('Revenue by service line (MTD)', table(['Service line', 'Revenue', ''], rev), '', true)}${panel('Payer mix (MTD)', table(['Payer', 'Share', ''], mix), '', true)}</div>` };
  };

  /* ======================= Admin: assets & staffing ======================= */
  VIEWS.assets = () => {
    const rows = S().assets.map((a, i) => { const overdue = a.next < 0; const soon = a.next >= 0 && a.next <= 14; const wo = S().workOrders.find((w) => w.asset === a.id && !w.done);
      return `<tr><td class="mono">${a.id}</td><td><b>${esc(a.name)}</b><span class="sub">${esc(a.loc)}${a.note ? ' · ' + esc(a.note) : ''}</span></td><td>${esc(a.cat)}</td><td>${pill(a.crit === 'Critical' ? 'crit' : 'warn', a.crit)}</td><td>${T.dayStr(a.last)}</td><td>${T.dayStr(a.next)}${overdue ? `<span class="sub">${pill('crit', `PM overdue ${-a.next} d`)}</span>` : soon ? `<span class="sub">${pill('warn', `Due in ${a.next} d`)}</span>` : ''}</td><td>${statePill(a.status)}</td>
        <td>${wo ? pill('info', `Work order ${wo.id}`) : (overdue || soon || a.status !== 'Operational') ? `<button class="btn small" data-act="wo-new" data-i="${i}">Create work order</button>` : ''}</td></tr>`; });
    return { title: 'Assets & maintenance', sub: 'Biomedical equipment, preventive maintenance and service contracts', body:
      tiles([[S().assets.length, 'Tracked assets'], [S().assets.filter((a) => a.status === 'Operational').length, 'Operational', 'ok'], [S().assets.filter((a) => a.status !== 'Operational').length, 'Under maintenance', 'warn'], [S().assets.filter((a) => a.next < 0).length, 'PM overdue', 'crit'], [S().workOrders.filter((w) => !w.done).length, 'Open work orders']]) +
      panel('Equipment', table(['Asset', 'Equipment', 'Category', 'Criticality', 'Last service', 'Next service', 'Status', ''], rows), '', true) };
  };
  ACT['wo-new'] = (d) => { const a = S().assets[+d.i]; const id = nid('WO'); S().workOrders.push({ id, asset: a.id, done: false, at: new Date().toISOString() }); audit('work-order-create', { resource: a.id, detail: a.name }); save(); render(); toast(`${id} created and sent to Biomedical Engineering.`); };
  VIEWS.shifts = () => {
    const census = (un) => T.allPts().filter((p) => (un === 'PERIOP' ? ['PACU', 'DAYC'].includes(p.unit) : p.unit === un) && p.status !== 'Discharged').length;
    const rows = SEED.roster.map((r) => { const n = census(r.unit); const rns = r.staff.filter((s) => /RN/.test(s)).length; const need = r.ratio ? Math.ceil(n / r.ratio) : null; const short = need != null && rns < need;
      return `<tr><td><b>${esc(UNIT[r.unit] || r.unit)}</b></td><td>${esc(r.shift)}</td><td>${r.staff.map(esc).join('<br>')}</td><td class="num">${n}</td><td>${r.ratio ? `1:${r.ratio}` : '—'}</td><td>${need == null ? '—' : short ? pill('crit', `Short ${need - rns} RN`) : pill('ok', `${rns} of ${need} RN`)}</td></tr>`; });
    return { title: 'Staff & shifts', sub: 'Duty roster with California nurse-to-patient ratio check (Title 22)', body:
      panel('Roster · today', table(['Unit', 'Shift', 'Staff', 'Census', 'Required ratio', 'Coverage'], rows), '<span class="kpi-note">ICU 1:2, med-surg 1:5, ER 1:4</span>', true) };
  };

  /* ======================= Infection control ======================= */
  VIEWS.infection = (u) => {
    const isQ = u.role === 'quality';
    const hai = S().hai.filter((h) => isQ || h.unit === u.unit);
    const cards = hai.map((h) => { const p = P(h.patient); return `<article class="panel"><div class="body"><div class="row between"><h3>${esc(h.type)} · ${esc(p.name)}</h3>${statePill(h.status === 'Under treatment' ? 'In treatment' : 'Pending')}</div>
      <dl class="kv" style="margin:0"><div><dt>Unit</dt><dd style="margin:0">${esc(UNIT[h.unit])} · ${esc(p.bed)}</dd></div><div><dt>Device</dt><dd style="margin:0">${esc(h.device)}</dd></div><div><dt>Organism</dt><dd style="margin:0">${esc(h.organism)}</dd></div><div><dt>Treatment</dt><dd style="margin:0">${esc(h.tx)}</dd></div><div><dt>CDC NHSN</dt><dd style="margin:0">${esc(h.nhsn)}</dd></div></dl>
      ${isQ && h.nhsn !== 'Reported' ? `<div><button class="btn small" data-act="hai-nhsn" data-h="${h.id}">Mark reported to NHSN</button></div>` : ''}</div></article>`; }).join('');
    const iso = SEED.isolation.filter((i) => isQ || P(i.patient).unit === u.unit).map((i) => { const p = P(i.patient); return `<tr><td><b>${esc(p.name)}</b><span class="sub">${esc(T.location_(p))}</span></td><td>${pill('warn', i.type)}</td><td>${esc(i.reason)}</td></tr>`; });
    const stew = SEED.stewardship.map((s) => `<tr><td>${esc(s.drug)}</td><td class="num">${s.dot}</td><td class="num">${s.target}</td><td>${s.dot > s.target ? pill('crit', 'Above target') : pill('ok', 'At or below')}</td></tr>`);
    const hh = SEED.handHygiene.map((h) => `<tr><td>${esc(UNIT[h.unit])}</td><td class="num">${h.pct}%</td><td style="min-width:140px"><div class="minibar ${h.pct < 90 ? 'over' : ''}"><i style="width:${h.pct}%"></i></div></td></tr>`);
    audit('view-infection-control', { patients: hai.map((h) => T.tok(P(h.patient))).join(' ') });
    return { title: 'Infection control', sub: isQ ? 'Hospital-wide surveillance · identified data limited to unit, device and organism' : `${UNIT[u.unit]} only`, body:
      tiles([[hai.filter((h) => h.status !== 'Resolved').length, 'Active HAIs', 'crit'], [iso.length, 'Isolation'], [SEED.stewardship.filter((s) => s.dot > s.target).length, 'Antibiotics above target', 'warn'], [Math.round(SEED.handHygiene.reduce((n, h) => n + h.pct, 0) / SEED.handHygiene.length) + '%', 'Hand hygiene (target 95%)']]) +
      `<div class="grid">${cards}</div>` + `<div class="grid-2">${panel('Isolation precautions', table(['Patient', 'Type', 'Reason'], iso), '', true)}${panel('Antibiotic stewardship · days of therapy per 1,000 patient-days', table(['Drug', 'DOT', 'Target', ''], stew), '', true)}</div>` +
      (isQ ? panel('Hand hygiene compliance', table(['Unit', 'Compliance', ''], hh), '', true) : '') };
  };
  ACT['hai-nhsn'] = (d) => { const h = S().hai.find((x) => x.id === d.h); h.nhsn = 'Reported'; audit('nhsn-report', { patient: P(h.patient), detail: h.type }); save(); render(); };

  /* ======================= Incidents ======================= */
  const INC_FLOW = ['Reported', 'Under investigation', 'Root cause analysis', 'Action plan', 'Closed'];
  VIEWS.incidents = () => {
    const rows = S().incidents.map((i, k) => `<tr><td class="mono">${i.id}</td><td><b>${esc(i.type)}</b><span class="sub">${esc(i.kind)} · ${esc(i.where)} · ${T.dayStr(i.dOff)}</span></td><td>${esc(i.text)}${i.rca ? `<span class="sub">RCA: ${esc(i.rca)}</span>` : ''}</td><td>${pill(/No harm/.test(i.harm) ? 'ok' : /Minor/.test(i.harm) ? 'warn' : 'crit', i.harm)}</td><td>${esc(i.reporter)}</td><td>${statePill(i.status === 'Closed' ? 'Closed' : 'Pending')}<span class="sub">${esc(i.status)}</span></td><td>${i.status !== 'Closed' ? `<button class="btn small" data-act="inc-next" data-k="${k}">${INC_FLOW[INC_FLOW.indexOf(i.status) + 1] === 'Closed' ? 'Close' : 'Advance…'}</button>` : ''}</td></tr>`);
    const sev = S().incidents.filter((i) => /Temporary|Permanent|Severe|Death/.test(i.harm));
    return { title: 'Incidents', sub: 'Patient safety event reporting · just culture · RCA', body:
      tiles([[S().incidents.length, 'Reported (MTD)'], [S().incidents.filter((i) => i.kind === 'Adverse event').length, 'Adverse events', 'warn'], [S().incidents.filter((i) => i.kind === 'Near miss').length, 'Near misses', 'ok'], [S().incidents.filter((i) => i.status !== 'Closed').length, 'Open'], [sev.length, 'Harm events needing RCA', 'crit']]) +
      `<div class="banner info"><p>Event reports are confidential patient-safety work product (Patient Safety and Quality Improvement Act). Anonymous reporting is allowed.</p></div>` +
      panel('Events', table(['ID', 'Event', 'Description', 'Harm', 'Reporter', 'Status', ''], rows), '', true) };
  };
  ACT['inc-next'] = (d) => { const i = S().incidents[+d.k]; const nx = INC_FLOW[INC_FLOW.indexOf(i.status) + 1];
    if (nx === 'Root cause analysis' || nx === 'Action plan') { openModal({ title: `${i.id} · ${nx}`, form: 'inc-next', submit: 'Save', body: `<input type="hidden" name="k" value="${d.k}"><div class="field"><label for="ir">${nx === 'Root cause analysis' ? 'Contributing factors' : 'Action plan'}</label><textarea id="ir" name="t" required></textarea></div>` }); return; }
    i.status = nx; audit('incident-status', { resource: i.id, detail: nx }); save(); render(); };
  FORMS['inc-next'] = (f) => { const i = S().incidents[+f.k]; i.status = INC_FLOW[INC_FLOW.indexOf(i.status) + 1]; i.rca = (i.rca ? i.rca + ' | ' : '') + f.t; UI.modal = null; audit('incident-status', { resource: i.id, detail: i.status }); save(); render(); };

  VIEWS.report = (u) => {
    const mine = S().incidents.filter((i) => i.reporterId === u.id).map((i) => `<tr><td class="mono">${i.id}</td><td>${esc(i.type)}</td><td>${esc(i.status)}</td></tr>`);
    return { title: 'Report an incident', sub: 'Adverse events and near misses · anonymous allowed', body:
      `<div class="grid-2">${panel('New report', `<form data-form="inc-new" class="stack">
        <div class="field"><label for="in-k">What happened</label><select id="in-k" name="kind"><option>Near miss</option><option>Adverse event</option></select></div>
        <div class="field"><label for="in-t">Category</label><select id="in-t" name="type"><option>Medication error</option><option>Fall</option><option>Patient identification</option><option>Specimen labeling</option><option>Equipment failure</option><option>Pressure injury</option><option>Privacy / PHI exposure</option><option>Other</option></select></div>
        <div class="field"><label for="in-h">Harm</label><select id="in-h" name="harm"><option>No harm</option><option>Minor harm</option><option>Temporary harm</option><option>Permanent harm</option></select></div>
        <div class="field"><label for="in-w">Where</label><input id="in-w" name="where" required value="${esc(UNIT[u.unit] || '')}"></div>
        <div class="field"><label for="in-x">Description</label><textarea id="in-x" name="text" required placeholder="Describe the facts. Avoid patient names; use the MRN if needed."></textarea></div>
        <label class="row" style="gap:8px"><input type="checkbox" name="anon"> Submit anonymously</label>
        <div><button class="btn primary" type="submit">Submit report</button></div></form>`)}
      ${panel('My reports', table(['ID', 'Category', 'Status'], mine), '<span class="kpi-note">Anonymous reports are not listed</span>', true)}</div>` };
  };
  FORMS['inc-new'] = (f) => { const u = me(); const id = 'IR-0' + (42 + S().incidents.filter((i) => i.new).length);
    S().incidents.unshift({ id, new: true, kind: f.kind, type: f.type, harm: f.harm, where: f.where, dOff: 0, status: 'Reported', reporter: f.anon ? 'Anonymous' : u.name, reporterId: f.anon ? null : u.id, text: f.text });
    audit('incident-report', { resource: id, actor: f.anon ? 'anonymous' : undefined, role: f.anon ? '—' : undefined, detail: f.type }); save(); render(); toast(`${id} submitted to Quality & Patient Safety.`); };

  /* ======================= Billing: itemized charges ======================= */
  const baseAccounts = VIEWS.accounts;
  VIEWS.accounts = (u, args) => {
    const v = baseAccounts(u, args);
    const c = S().claims.find((x) => x.id === UI.selClaim);
    if (c) {
      const lines = SEED.chargeLines[c.id] || c.cpt.map((x, i, a) => ['0510', x, SEED.cptDesc[x] || 'Professional service', 1, c.charge / a.length]);
      const rows = lines.map(([rev, code, desc, q, amt]) => `<tr><td class="mono">${rev}</td><td class="mono">${esc(code)}</td><td>${esc(desc)}</td><td class="num">${q}</td><td class="num">${money(amt)}</td><td class="num">${money(q * amt)}</td></tr>`);
      const tot = lines.reduce((n, l) => n + l[3] * l[4], 0);
      v.body += panel(`Itemized charges · ${c.id}`, table(['Rev code', 'CPT / HCPCS', 'Description', 'Qty', 'Unit', 'Amount'], rows.concat([`<tr><td colspan="5"><b>Total</b></td><td class="num"><b>${money(tot)}</b></td></tr>`])), '<span class="kpi-note">From the charge description master (CDM)</span>', true);
    }
    return v;
  };

  T.counts.incidents = () => { const n = S().incidents.filter((i) => i.status === 'Reported').length; return n ? `<span class="count">${n}</span>` : ''; };
})(window.Tessera);
