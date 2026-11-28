/* Tessera Health — modules that go beyond Olir One and most hospital systems:
   Privacy Sentinel, Alert Burden, Social Needs (closed loop), Good Faith Estimates,
   Capacity Forecast, Family Updates. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, esc, clone, P, U, me, nid, tok, pill, statePill, tiles, panel, table, money, ago, timeStr, toast, audit, careRel, openModal, render, save, dayStr, UNIT } = T;
  const S = () => T.S;
  const UI = T.UI;
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(l)}</option>`;

  T.inits.push((s) => {
    const fill = (k, v) => { if (s[k] === undefined) s[k] = clone(v); };
    fill('privacyCases', {}); fill('sdoh', SEED.sdohSeed.map((x) => Object.assign({ at: new Date(Date.now() + x.dOff * 864e5).toISOString() }, x)));
    fill('sdohRefs', [{ id: 'SR-1', patient: 'P09', domain: 'food', org: SEED.communityOrgs.food[0], status: 'Service delivered', at: new Date(Date.now() - 18 * 864e5).toISOString() }, { id: 'SR-2', patient: 'P09', domain: 'transport', org: SEED.communityOrgs.transport[0], status: 'Sent', at: new Date(Date.now() - 20 * 864e5).toISOString() }]);
    fill('gfe', []); fill('family', clone(SEED.familySeed)); fill('familyMsgs', []); fill('forecastWhatIf', 0);
  });

  /* ======================= 1. Privacy Sentinel ======================= */
  // Proactive detection of inappropriate record access, explained in plain language,
  // with a guided HIPAA breach risk assessment. Admin sees patient tokens, not names.
  function privacyAlerts() {
    if (T.store && T.store.live) { if (!UI.livePrivacy) T.livePrivacyFetch(); return (UI.livePrivacy && UI.livePrivacy.alerts) || []; } /* live: rules run on the server over the real audit log */
    const out = []; const add = (id, risk, rule, who, pt, why, evidence) => out.push({ id, risk, rule, who, pt, why, evidence });
    // Seeded history (clearly labeled)
    const h = SEED.privacyHistory; const bl = h.filter((e) => e.outcome === 'blocked');
    if (bl.length >= 3) add('PS-H1', 'High', 'Repeated out-of-scope chart attempts', bl[0].actor, bl.map((e) => tok(P(e.patient))).join(' '), `${U(bl[0].actor).name} tried to open ${bl.length} charts outside their unit within 2 minutes.`, bl.map((e) => `${e.note} (seeded history, ${Math.round(-e.at / 60)} h ago)`));
    h.filter((e) => e.hour >= 22 || e.hour < 6).forEach((e, i) => add('PS-H2-' + i, 'Medium', 'After-hours access by a non-clinical role', e.actor, tok(P(e.patient)), `${U(e.actor).name} (${U(e.actor).title}) opened a record at ${e.hour}:00.`, [e.note + ' (seeded history)']));
    h.filter((e) => SEED.vip.includes(e.patient)).forEach((e, i) => add('PS-H3-' + i, 'Medium', 'VIP record opened outside the care team', e.actor, tok(P(e.patient)), 'A record flagged for extra protection was opened by someone without a care relationship at the time.', [e.note + ' (seeded history)']));
    // Live audit
    const live = S().audit;
    const blocked = live.filter((e) => e.action === 'chart-access' && e.outcome !== 'success');
    const byActor = {}; blocked.forEach((e) => { (byActor[e.actor] = byActor[e.actor] || []).push(e); });
    Object.entries(byActor).forEach(([a, es]) => { if (es.length >= 2 && U(a)) add('PS-L1-' + a, es.length >= 3 ? 'High' : 'Medium', 'Repeated blocked chart access', a, [...new Set(es.map((e) => e.patient))].join(' '), `${U(a).name} was blocked ${es.length} times opening charts outside their role or scope.`, es.map((e) => `${timeStr(e.ts)} · ${e.detail || e.action}`)); });
    Object.entries(SEED.staffRelations).forEach(([a, pids]) => pids.forEach((pid) => { const t = tok(P(pid)); const es = live.filter((e) => e.actor === a && e.patient === t && !/^list/.test(e.action)); if (es.length) add('PS-L2-' + a + pid, 'High', 'Staff member accessed a relative\'s record', a, t, `${U(a).name} accessed the record of someone listed as a relative in HR records.`, es.map((e) => `${timeStr(e.ts)} · ${e.action}`)); }));
    S().btg.forEach((g) => { const vip = SEED.vip.includes(g.patient); add('PS-L3-' + g.id, vip ? 'High' : 'Low', 'Break-the-glass access', g.user, tok(P(g.patient)), `${U(g.user).name} used emergency access: ${g.reason}. ${g.reviewed ? 'Already reviewed.' : 'Needs review.'}`, [`${timeStr(g.at)} · "${g.text}"`]); });
    live.filter((e) => e.action === 'reveal-contact' && SEED.vip.includes((T.allPts().find((p) => tok(p) === e.patient) || {}).id)).forEach((e) => add('PS-L4-' + e.seq, 'Medium', 'VIP contact details revealed', e.actor, e.patient, 'Contact details of a VIP-flagged patient were unmasked.', [`${timeStr(e.ts)} · by ${(U(e.actor) || {}).name}`]));
    const order = { High: 0, Medium: 1, Low: 2 };
    return out.sort((a, b) => order[a.risk] - order[b.risk]);
  }
  T.privacyAlerts = privacyAlerts;
  VIEWS.privacy = () => {
    const alerts = privacyAlerts(); const cases = S().privacyCases;
    const sel = alerts.find((a) => a.id === UI.ps) || alerts[0];
    const rows = alerts.map((a) => { const c = cases[a.id]; return `<tr class="clickable" data-act="ps-sel" data-id="${a.id}" ${sel && a.id === sel.id ? 'style="outline:2px solid var(--accent);outline-offset:-2px"' : ''}><td>${pill(a.risk === 'High' ? 'crit' : a.risk === 'Medium' ? 'warn' : '', a.risk)}</td><td><b>${esc(a.rule)}</b><span class="sub">${esc((U(a.who) || {}).name || a.who)}</span></td><td class="mono" style="font-size:12px">${esc(a.pt)}</td><td>${c ? statePill(c.outcome ? 'Closed' : 'Pending') + `<span class="sub">${esc(c.outcome || 'Investigating')}</span>` : pill('', 'New')}</td></tr>`; });
    let det = '<p class="muted">No alerts.</p>';
    if (sel) { const c = cases[sel.id] || {};
      det = `<div class="stack"><h3>${esc(sel.rule)}</h3><p>${esc(sel.why)}</p><ul style="margin:0;padding-left:18px;font-size:13px">${sel.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        <dl class="kv" style="margin:0"><div><dt>Staff member</dt><dd style="margin:0">${esc((U(sel.who) || {}).name || '—')}</dd></div><div><dt>Patient</dt><dd style="margin:0">${c.revealed ? esc(c.revealed) : `<span class="mono">${esc(sel.pt)}</span> <button class="linkbtn" data-act="ps-reveal" data-id="${sel.id}">Reveal identity…</button>`}</dd></div></dl>
        ${c.outcome ? `<div class="banner ${/required/.test(c.outcome) ? 'crit' : 'ok'}"><p><b>${esc(c.outcome)}</b>${c.deadline ? ` Notify the patient by ${esc(c.deadline)}.` : ''}</p></div>` :
        `<form data-form="ps-assess" class="stack"><input type="hidden" name="id" value="${sel.id}"><h3>HIPAA breach risk assessment (45 CFR 164.402)</h3>
          ${[['f1', 'Nature and extent of PHI involved', 'Demographics only', 'Clinical details, diagnoses or financial data'], ['f2', 'Who received or used it', 'Workforce member bound by HIPAA, used for a job purpose', 'Person with no job reason or outside the organization'], ['f3', 'Was PHI actually viewed or acquired?', 'No: access was blocked', 'Yes: the record was opened'], ['f4', 'Extent the risk was mitigated', 'Signed attestation, retrained, no further disclosure', 'Not mitigated']].map(([k, l, lo, hi]) => `<div class="field"><label for="${k}">${l}</label><select id="${k}" name="${k}" required><option value="">Choose</option><option value="low">${lo}</option><option value="high">${hi}</option></select></div>`).join('')}
          <div class="row"><button class="btn primary" type="submit">Record determination</button><button class="btn" type="button" data-act="ps-ok" data-id="${sel.id}">Access was appropriate</button></div></form>`}</div>`; }
    return { title: 'Privacy Sentinel', sub: 'Finds inappropriate access before a complaint does · tokens until a privacy reason is given', body:
      tiles([[alerts.filter((a) => a.risk === 'High').length, 'High-risk alerts', 'crit'], [alerts.filter((a) => !cases[a.id]).length, 'Not yet reviewed', 'warn'], [Object.values(cases).filter((c) => /required/.test(c.outcome || '')).length, 'Notifications required'], [S().audit.length, 'Events watched']]) +
      `<div class="banner info"><p>Most hospital systems only store the audit log; someone has to go looking. Sentinel runs rules over every access: repeated out-of-scope attempts, after-hours access by non-clinical roles, VIP records, staff opening relatives' records (from HR declarations), and every break-the-glass. Patients see the same events in "Who viewed my record".</p></div>` +
      `<div class="grid-2">${panel('Alerts', table(['Risk', 'Rule', 'Patient token', 'Case'], rows), '', true)}${panel('Investigation', det)}</div>` };
  };
  Object.assign(ACT, {
    'ps-sel': (d) => { UI.ps = d.id; render(); },
    'ps-reveal': (d) => openModal({ title: 'Reveal patient identity', form: 'ps-reveal', submit: 'Reveal', body: `<input type="hidden" name="id" value="${d.id}"><div class="field"><label for="pr">Privacy investigation reason</label><input id="pr" name="why" required placeholder="e.g. Case PS-2026-11: possible snooping"></div><p class="kpi-note">Logged. Identity is needed to judge harm and notify the patient.</p>` }),
    'ps-ok': (d) => { S().privacyCases[d.id] = { outcome: 'Appropriate access: documented and closed', by: me().name, at: new Date().toISOString() }; audit('privacy-case-close', { resource: d.id, detail: 'appropriate' }); save(); render(); }
  });
  FORMS['ps-reveal'] = (f) => { if (T.store && T.store.live) return T.liveApi('POST', '/api/privacy/reveal', { token: privacyAlerts().find((x) => x.id === f.id).pt.split(' ')[0], why: f.why }).then((r) => { if (!r.ok) { T.toast(r.data.error || 'Not revealed.'); return; } S().privacyCases[f.id] = Object.assign(S().privacyCases[f.id] || {}, { revealed: `${r.data.name} · MRN ${r.data.mrn}` }); UI.modal = null; save(); render(); });
    const a = privacyAlerts().find((x) => x.id === f.id); const t = a.pt.split(' ')[0]; const p = T.allPts().find((x) => tok(x) === t); S().privacyCases[f.id] = Object.assign(S().privacyCases[f.id] || {}, { revealed: p ? `${p.name} · MRN ${p.mrn}` : t }); UI.modal = null; audit('privacy-identity-reveal', { patient: p, detail: f.why, purpose: 'Privacy investigation' }); save(); render(); };
  FORMS['ps-assess'] = (f) => { const high = ['f1', 'f2', 'f3', 'f4'].filter((k) => f[k] === 'high').length; const d = new Date(Date.now() + 60 * 864e5);
    const c = S().privacyCases[f.id] = Object.assign(S().privacyCases[f.id] || {}, high && f.f3 === 'high' ? { outcome: 'Breach: notification required.', deadline: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' (60 days from discovery); log for the annual HHS report (under 500 people)' } : { outcome: 'Low probability of compromise: documented, no notification required.' });
    c.by = me().name; c.at = new Date().toISOString(); audit('privacy-breach-assessment', { resource: f.id, detail: c.outcome }); save(); render(); };

  /* ======================= 2. Alert Burden ======================= */
  VIEWS.alerts = (u) => {
    const live = {}; S().orders.filter((o) => o.flag).forEach((o) => { const k = o.flag.kind; live[k] = live[k] || { fired: 0, over: 0 }; live[k].fired++; if (o.flag.override) live[k].over++; });
    const kinds = SEED.alertHistory.map((h) => { const l = live[h.kind] || { fired: 0, over: 0 }; const fired = h.fired + l.fired; const over = h.overridden + l.over; const rate = over / fired * 100;
      const rec = h.kind === 'allergy' ? ['ok', 'Keep: low override rate and prevented harm'] : rate > 75 && h.harmPrevented === 0 ? ['crit', 'Retire or make passive: overridden almost always, no harm prevented in 30 days'] : rate > 45 ? ['warn', 'Tier it: fire only above a stronger threshold (e.g. K⁺ ≥ 5.5)'] : ['ok', 'Keep'];
      return { k: h.kind, fired, over, rate, prevented: h.harmPrevented, rec, on: !(S().config.cds && S().config.cds[h.kind === 'missing-dose' ? 'missingDose' : h.kind] === false) }; });
    const reasons = {}; S().orders.filter((o) => o.flag && o.flag.override).forEach((o) => { reasons[o.flag.override.reason] = (reasons[o.flag.override.reason] || 0) + 1; });
    const total = kinds.reduce((n, k) => n + k.fired, 0); const totalOver = kinds.reduce((n, k) => n + k.over, 0);
    const rows = kinds.map((k) => `<tr><td><b>${esc(k.k)}</b></td><td class="num">${k.fired}</td><td class="num">${k.over}</td><td style="min-width:150px"><div class="minibar ${k.rate > 75 ? 'over' : ''}"><i style="width:${k.rate}%"></i></div><span class="sub">${k.rate.toFixed(0)}% overridden</span></td><td class="num">${k.prevented}</td><td>${pill(k.rec[0], k.rec[1])}</td><td>${k.k !== 'allergy' && k.rec[0] === 'crit' && k.on ? `<button class="btn small" data-act="al-passive" data-k="${k.k}">Make passive</button>` : !k.on ? pill('', 'Passive') : ''}</td></tr>`);
    const clin = SEED.alertByClinician.map(([n, f, o]) => `<tr><td>${esc(n)}</td><td class="num">${f}</td><td class="num">${(o / f * 100).toFixed(0)}%</td><td style="min-width:120px"><div class="minibar ${o / f > 0.6 ? 'over' : ''}"><i style="width:${o / f * 100}%"></i></div></td></tr>`);
    return { title: 'Alert burden', sub: 'Which safety alerts help, and which just train clinicians to click through · last 30 days + today', body:
      tiles([[total, 'Alerts fired'], [Math.round(totalOver / total * 100) + '%', 'Overridden', 'warn'], [kinds.reduce((n, k) => n + k.prevented, 0), 'Harm prevented (pharmacist-confirmed)', 'ok'], [Math.round(total / 30 / 4), 'Alerts per clinician per day']]) +
      `<div class="banner info"><p>Alert fatigue is a known patient-safety risk, but hospital systems rarely measure it. Each alert type here shows how often it is overridden and whether it ever stopped harm, so the Pharmacy &amp; Therapeutics committee can keep the useful ones loud and quiet the rest. The allergy check can't be turned off.</p></div>` +
      panel('By alert type', table(['Alert', 'Fired', 'Overridden', 'Override rate', 'Harm prevented', 'Recommendation', ''], rows), '', true) +
      `<div class="grid-2">${panel('By clinician', table(['Clinician', 'Alerts', 'Override rate', ''], clin), '<span class="kpi-note">Coaching signal, not discipline</span>', true)}${panel('Override reasons today', Object.keys(reasons).length ? table(['Reason', 'Count'], Object.entries(reasons).map(([r, n]) => `<tr><td>${esc(r)}</td><td class="num">${n}</td></tr>`)) : '<p class="muted">No overrides yet today. Override an alert in CPOE to see it here.</p>')}</div>` };
  };
  ACT['al-passive'] = (d) => { const key = d.k === 'missing-dose' ? 'missingDose' : d.k; S().config.cds[key] = false; audit('config-change', { detail: `CDS ${d.k} made passive from Alert burden` }); save(); render(); toast('Alert made passive. Reversible in Hospital configuration.'); };

  /* ======================= 3. Social needs (closed loop) ======================= */
  const lastScreen = (pid) => S().sdoh.filter((x) => x.patient === pid).slice(-1)[0];
  VIEWS.sdoh = (u) => {
    const doms = SEED.sdohDomains;
    if (u.role === 'quality') {
      const screened = S().sdoh.length; const eligible = T.allPts().filter((p) => p.status === 'Admitted' || S().appts.some((a) => a.patient === p.id)).length;
      const pos = doms.map(([k, l]) => [l, S().sdoh.filter((x) => x.answers[k]).length]);
      const refs = S().sdohRefs; const closed = refs.filter((r) => /delivered/.test(r.status)).length;
      return { title: 'Social needs', sub: 'CMS measures SDOH-1 (screening rate) and SDOH-2 (positive rate) · de-identified', body:
        tiles([[Math.round(Math.min(screened, eligible) / Math.max(1, eligible) * 100) + '%', 'SDOH-1 screening rate'], [Math.round(S().sdoh.filter((x) => Object.values(x.answers).some(Boolean)).length / Math.max(1, screened) * 100) + '%', 'SDOH-2 screened positive'], [refs.length, 'Referrals'], [Math.round(closed / Math.max(1, refs.length) * 100) + '%', 'Loops closed', 'ok']]) +
        panel('Positive by domain', table(['Domain', 'Positive screens'], pos.map(([l, n]) => `<tr><td>${esc(l)}</td><td class="num">${n > 0 && n < 11 ? '&lt;11' : n}</td></tr>`)), '<span class="kpi-note">Counts under 11 suppressed</span>', true) };
    }
    if (u.role === 'receptionist') {
      const refs = S().sdohRefs.filter((r) => r.domain !== 'safety');
      return { title: 'Social needs referrals', sub: 'Closing the loop with community partners · safety referrals are handled by the care team only', body:
        panel('Referral work queue', table(['Patient', 'Need', 'Partner', 'Sent', 'Status', ''], refs.map((r) => `<tr><td><b>${esc(P(r.patient).name)}</b><span class="sub">${phoneOnly(P(r.patient))}</span></td><td>${esc(doms.find((d) => d[0] === r.domain)[1])}</td><td>${esc(r.org)}</td><td>${timeStr(r.at)}</td><td>${statePill(/delivered/.test(r.status) ? 'Completed' : /Unable/.test(r.status) ? 'Denied' : 'Pending')}<span class="sub">${esc(r.status)}</span></td><td>${/delivered|Unable/.test(r.status) ? '' : `<select data-change="sdoh-status" data-id="${r.id}" aria-label="Update status"><option value="">Update…</option><option>Partner accepted</option><option>Service delivered</option><option>Unable to reach patient</option></select>`}</td></tr>`)), '', true) };
    }
    const pts = T.myPatients(u).filter((p) => !p.unidentified);
    if (!UI.sd || !pts.some((p) => p.id === UI.sd)) UI.sd = (pts[0] || {}).id;
    const p = P(UI.sd); if (!p) return { title: 'Social needs', body: '<p class="muted">No patients in scope.</p>' };
    const ls = lastScreen(p.id); const refs = S().sdohRefs.filter((r) => r.patient === p.id);
    audit('view-sdoh', { patient: p });
    return { title: 'Social needs', sub: 'Screen five domains (CMS) → refer to community partners → track until the need is met', body:
      `<div class="field" style="max-width:420px"><label for="sd-p">Patient</label><select id="sd-p" data-change="sdoh-pick">${pts.map((x) => opt(x.id, `${x.name} · MRN ${x.mrn}`, x.id === p.id)).join('')}</select></div>` +
      `<div class="grid-2">${panel(ls ? `Screening · last done ${dayStr(Math.round((new Date(ls.at) - Date.now()) / 864e5))}` : 'Screening · not yet done', `<form data-form="sdoh" class="stack"><input type="hidden" name="p" value="${p.id}">${doms.map(([k, l, q]) => `<div class="field"><label for="sd-${k}">${l}</label><span class="kpi-note">${esc(q)}</span><select id="sd-${k}" name="${k}">${['No', 'Yes', 'Declined to answer'].map((o) => opt(o, o, ls && ((ls.answers[k] && o === 'Yes') || (!ls.answers[k] && o === 'No')))).join('')}</select></div>`).join('')}<div><button class="btn primary" type="submit">Save screening</button></div></form>`)}
      ${panel('Referrals', `${ls ? doms.filter(([k]) => ls.answers[k]).map(([k, l]) => { const r = refs.find((x) => x.domain === k); return `<div class="note"><div class="row between"><b>${esc(l)}</b>${r ? statePill(/delivered/.test(r.status) ? 'Completed' : 'Pending') : pill('warn', 'Not referred')}</div>${k === 'safety' ? '<p class="kpi-note">Confidential: not visible to the front desk. Offer resources privately, away from companions.</p>' : ''}${r ? `<span class="kpi-note">${esc(r.org)} · ${esc(r.status)} · ${timeStr(r.at)}</span>` : `<form data-form="sdoh-ref" class="row"><input type="hidden" name="p" value="${p.id}"><input type="hidden" name="d" value="${k}"><select name="org" aria-label="Partner">${SEED.communityOrgs[k].map((o) => opt(o, o)).join('')}</select><button class="btn small primary" type="submit">Refer</button></form>`}</div>`; }).join('') || '<p class="muted">No positive domains.</p>' : '<p class="muted">Screen first.</p>'}`)}</div>` };
  };
  const phoneOnly = (p) => p.phone ? '(•••) •••-' + p.phone.slice(-4) : '';
  T.CHANGE['sdoh-pick'] = (v) => { UI.sd = v; render(); };
  T.CHANGE['sdoh-status'] = (v, el) => { if (!v) return; const r = S().sdohRefs.find((x) => x.id === el.dataset.id); r.status = v; audit('sdoh-referral-update', { patient: P(r.patient), detail: v }); save(); render(); };
  FORMS.sdoh = (f) => { const answers = {}; SEED.sdohDomains.forEach(([k]) => { answers[k] = f[k] === 'Yes'; }); S().sdoh.push({ patient: f.p, by: me().name, at: new Date().toISOString(), answers }); audit('sdoh-screen', { patient: P(f.p), detail: Object.keys(answers).filter((k) => answers[k]).join(', ') || 'all negative' }); save(); render(); toast('Screening saved.'); };
  FORMS['sdoh-ref'] = (f) => { S().sdohRefs.push({ id: nid('SR'), patient: f.p, domain: f.d, org: f.org, status: 'Sent', at: new Date().toISOString(), confidential: f.d === 'safety' }); audit('sdoh-referral', { patient: P(f.p), detail: f.d }); save(); render(); toast('Referral sent. The front desk tracks it to completion.'); };

  /* ======================= 4. Good Faith Estimates ======================= */
  const payerType = (p) => /self-pay|unknown/i.test(p.payer) ? 'Self-pay' : /medicare/i.test(p.payer) ? 'Medicare' : 'Commercial';
  function gfeCandidates() {
    const c = S().ot.filter((x) => SEED.cdmPrices[x.cpt]).map((x) => ({ key: 'OT-' + x.id, patient: x.patient, cpt: x.cpt, service: x.procedure, when: `Today ${x.scheduled}` }));
    S().insCases.filter((x) => /93458/.test(x.service)).forEach((x) => c.push({ key: 'PA-' + x.id, patient: x.patient, cpt: '93458', service: 'Left heart catheterization', when: 'Pending authorization' }));
    return c;
  }
  VIEWS.estimates = () => {
    const cands = gfeCandidates();
    const rows = cands.map((c) => { const p = P(c.patient); const g = S().gfe.find((x) => x.key === c.key); const pt = payerType(p); const claim = S().claims.find((x) => x.patient === p.id && x.cpt.includes(c.cpt));
      const variance = g && claim ? claim.charge * SEED.payerFactor[pt] - g.allowed : null;
      return `<tr><td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn} · ${esc(p.payer)}</span></td><td>${esc(c.service)}<span class="sub mono">CPT ${c.cpt} · ${esc(c.when)}</span></td><td>${pill(pt === 'Self-pay' ? 'warn' : '', pt)}</td><td>${g ? `<b class="num">${money(g.patientCost)}</b><span class="sub">allowed ${money(g.allowed)}</span>` : '—'}</td><td>${g ? statePill(g.delivered ? 'Released' : 'Pending') + `<span class="sub">${g.delivered ? 'Delivered to portal ' + timeStr(g.delivered) : 'Draft'}</span>` : pill(pt === 'Self-pay' ? 'crit' : '', pt === 'Self-pay' ? 'Required by law' : 'On request')}${variance != null && variance >= 400 ? `<span class="sub">${pill('crit', `Bill exceeds estimate by ${money(variance)}: dispute-eligible`)}</span>` : ''}</td><td>${g ? (g.delivered ? '' : `<button class="btn small primary" data-act="gfe-send" data-k="${c.key}">Deliver to patient</button>`) : `<button class="btn small" data-act="gfe-make" data-k="${c.key}">Create estimate</button>`}</td></tr>`; });
    const g = S().gfe.find((x) => x.key === UI.gfeSel) || S().gfe[S().gfe.length - 1];
    const det = g ? `<div class="stack"><b>${esc(P(g.patient).name)} · ${esc(g.service)}</b>${table(['Item', 'Expected allowed amount'], g.lines.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${money(v)}</td></tr>`).concat([`<tr><td><b>Total expected</b></td><td class="num"><b>${money(g.allowed)}</b></td></tr>`, `<tr><td><b>Patient's estimated cost</b><span class="sub">${esc(g.basis)}</span></td><td class="num"><b>${money(g.patientCost)}</b></td></tr>`]))}<span class="kpi-note">Includes facility and professional items so the patient sees one number. Valid 12 months.</span></div>` : '<p class="muted">Create an estimate to see its breakdown.</p>';
    return { title: 'Good Faith Estimates', sub: 'No Surprises Act: self-pay and uninsured patients get an estimate before scheduled care; bills $400+ above it are dispute-eligible', body:
      tiles([[cands.length, 'Scheduled services'], [cands.filter((c) => payerType(P(c.patient)) === 'Self-pay' && !S().gfe.some((x) => x.key === c.key && x.delivered)).length, 'Legally required, not delivered', 'crit'], [S().gfe.filter((x) => x.delivered).length, 'Delivered', 'ok']]) +
      `<div class="grid-2">${panel('Services needing an estimate', table(['Patient', 'Service', 'Coverage', 'Estimate', 'Status', ''], rows), '', true)}${panel('Estimate detail', det)}</div>` };
  };
  Object.assign(ACT, {
    'gfe-make': (d) => { const c = gfeCandidates().find((x) => x.key === d.k); const p = P(c.patient); const pt = payerType(p); const f = SEED.payerFactor[pt];
      /* chargemaster price × expected allowed-amount ratio for the coverage type */ const lines = SEED.cdmPrices[c.cpt].map(([n, v]) => [n, Math.round(v * f)]); const allowed = lines.reduce((n, l) => n + l[1], 0);
      const patientCost = pt === 'Self-pay' ? allowed : Math.round(allowed * 0.2); const basis = pt === 'Self-pay' ? 'Self-pay: full expected amount (with prompt-pay discount applied)' : '20% coinsurance after deductible, estimated';
      S().gfe.push({ key: c.key, patient: p.id, cpt: c.cpt, service: c.service, lines, allowed, patientCost, basis, created: new Date().toISOString() }); UI.gfeSel = c.key; audit('gfe-create', { patient: p, detail: `${c.service}: ${money(patientCost)}` }); save(); render(); },
    'gfe-send': (d) => { const g = S().gfe.find((x) => x.key === d.k); g.delivered = new Date().toISOString(); audit('gfe-deliver', { patient: P(g.patient) }); save(); render(); toast('Estimate delivered to the patient portal.'); }
  });
  const baseBills = VIEWS.bills;
  if (baseBills) VIEWS.bills = (u, a) => { const v = baseBills(u, a); const gs = S().gfe.filter((g) => g.patient === u.patientId && g.delivered); if (gs.length) v.body = panel('Your cost estimates', gs.map((g) => `<div class="note"><div class="row between"><b>${esc(g.service)}</b><b class="num" style="font-size:20px">${money(g.patientCost)}</b></div><span class="kpi-note">${esc(g.basis)} · Good Faith Estimate under the No Surprises Act. If your bill is $400 or more above this, you can dispute it.</span></div>`).join('')) + v.body; return v; };

  /* ======================= 5. Capacity forecast ======================= */
  VIEWS.forecast = () => {
    const pts = T.allPts(); const extra = S().forecastWhatIf || 0;
    const units = ['CICU', 'W4B', 'PEDW', 'PACU'].map((un) => {
      const beds = SEED.beds.filter((b) => b.unit === un).length; const now = pts.filter((p) => p.unit === un && p.status === 'Admitted').length;
      const drivers = []; let out = 0, inn = 0;
      S().discharges.forEach((d) => { const p = P(d.patient); if (p.unit !== un) return; const done = d.steps.filter((s) => s.state === 'Done').length / d.steps.length; const pr = d.steps.some((s) => s.state === 'Blocked') ? 0.4 : done >= 0.6 ? 0.9 : 0.6; out += pr; drivers.push(`−${pr.toFixed(1)} discharge in progress (${Math.round(done * 100)}% done${pr === 0.4 ? ', blocked' : ''})`); });
      S().bedRequests.filter((r) => !r.done && r.unit === un).forEach(() => { inn += 1; drivers.push('+1.0 ER admission waiting for a bed'); });
      S().er.filter((e) => !['Discharged', 'Admitted', 'Admit requested'].includes(e.status)).forEach((e) => { const cardiac = /chest|STEMI/i.test(e.complaint); const target = cardiac ? 'CICU' : 'W4B'; const pr = e.esi <= 2 ? 0.7 : e.esi === 3 ? 0.3 : 0.05; if (target === un && pr > 0.1) { inn += pr; drivers.push(`+${pr.toFixed(1)} ER ESI ${e.esi} likely admission`); } });
      S().ot.filter((c) => !['Completed', 'Recovery'].includes(c.stage) && c.cpt === '27447').forEach(() => { if (un === 'W4B') { inn += 1; drivers.push('+1.0 post-op knee replacement'); } });
      if (un === 'W4B' && extra) { inn += extra; drivers.push(`+${extra} what-if: extra ER admissions`); }
      const proj = Math.max(0, now - out + inn); return { un, beds, now, out, inn, proj, pct: proj / beds, drivers };
    });
    const rows = units.map((x) => `<tr><td><b>${esc(UNIT[x.un])}</b></td><td class="num">${x.beds}</td><td class="num">${x.now}</td><td class="num">−${x.out.toFixed(1)}</td><td class="num">+${x.inn.toFixed(1)}</td><td class="num"><b>${x.proj.toFixed(1)}</b></td><td style="min-width:160px"><div class="minibar ${x.pct > 0.85 ? 'over' : ''}"><i style="width:${Math.min(100, x.pct * 100)}%"></i></div><span class="sub">${Math.round(x.pct * 100)}% ${x.pct > 1 ? '· ' + Math.ceil(x.proj - x.beds) + ' bed(s) short' : x.pct > 0.85 ? '· tight' : ''}</span></td></tr>`);
    return { title: 'Capacity forecast', sub: 'Next 24 hours, built from the live record: discharges in progress, ER patients, admits waiting, scheduled surgery', body:
      `<div class="banner info"><p>Most bed boards show now. This shows tomorrow, with the reason for every number, so bed management can act on the blocker (a stuck prior authorization, a missing ride) instead of the symptom.</p></div>` +
      `<section class="hero"><div class="hero-head"><div><h2>What if the ER sends more?</h2><span class="kpi-note">Extra admissions to Ward 4B tonight</span></div><div class="row"><input type="range" min="0" max="8" value="${extra}" data-change="fc-what" aria-label="Extra ER admissions" style="width:200px"><b class="num" style="font-size:20px">${extra}</b></div></div></section>` +
      panel('Projected census', table(['Unit', 'Beds', 'Now', 'Expected out', 'Expected in', 'Projected', ''], rows), '', true) +
      `<div class="grid">${units.filter((x) => x.drivers.length).map((x) => panel(`${esc(UNIT[x.un])} drivers`, `<ul style="margin:0;padding-left:18px;font-size:13px">${x.drivers.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`)).join('')}</div>` };
  };
  T.CHANGE['fc-what'] = (v) => { S().forecastWhatIf = +v; save(); render(); };

  /* ======================= 6. Family updates ======================= */
  function familyStatus(p) {
    const c = S().ot.find((x) => x.patient === p.id && x.stage !== 'Scheduled');
    const first = p.name.split(' ')[0];
    if (c) return { Preparation: `${first} is being prepared for the procedure.`, 'In surgery': `${first}'s procedure has started.`, Recovery: `${first}'s procedure is finished and ${first} is in the recovery area.`, Completed: `${first} has moved to a hospital room.` }[c.stage];
    return p.status === 'Admitted' ? `${first} is staying in the hospital.` : `${first} is not in the hospital right now.`;
  }
  VIEWS.people = (u) => {
    const p = P(u.patientId); const list = S().family[p.id] = S().family[p.id] || []; const msgs = S().familyMsgs.filter((m) => m.patient === p.id);
    audit('portal-view', { patient: p, resource: 'family sharing', purpose: 'Individual access' });
    return { title: 'Family updates', sub: 'You choose who hears how you are doing. Messages never include diagnoses, results or medicines.', body:
      `<section class="hero patient-hero"><div class="hero-head"><div><span class="eyebrow">What your people see right now</span><h2>${esc(familyStatus(p))}</h2></div></div></section>` +
      `<div class="grid-2">${panel('People you share with', `${list.map((f, i) => `<div class="note"><div class="row between"><b>${esc(f.name)}</b>${pill('accent', f.level)}</div><span class="kpi-note">${esc(f.relation)} · ${esc(f.contact)}</span><div><button class="btn small danger" data-act="fam-remove" data-i="${i}">Stop sharing</button></div></div>`).join('') || '<p class="muted">No one yet.</p>'}
        <form data-form="fam-add" class="stack"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))"><div class="field"><label for="fa-n">Name</label><input id="fa-n" name="name" required></div><div class="field"><label for="fa-r">Relationship</label><input id="fa-r" name="rel" required></div><div class="field"><label for="fa-c">Mobile (last 4 shown)</label><input id="fa-c" name="phone" inputmode="numeric" pattern="[0-9]{10}" required placeholder="10 digits"></div></div><div class="field"><label for="fa-l">They can see</label><select id="fa-l" name="level"><option>Status updates</option><option>Status updates and room number</option></select></div><div><button class="btn small" type="submit">Add person</button></div></form>`)}
      ${panel('Messages sent', msgs.length ? msgs.slice().reverse().map((m) => `<div class="note"><span class="kpi-note">${timeStr(m.at)} · to ${esc(m.to)}</span><p>${esc(m.text)}</p></div>`).join('') : '<p class="muted">Updates go out automatically when your status changes during a procedure.</p>')}</div>` };
  };
  Object.assign(ACT, { 'fam-remove': (d) => { const p = P(me().patientId); const [f] = S().family[p.id].splice(+d.i, 1); audit('family-share-revoke', { patient: p, detail: f.relation, purpose: 'Individual access' }); save(); render(); } });
  FORMS['fam-add'] = (f) => { const p = P(me().patientId); (S().family[p.id] = S().family[p.id] || []).push({ name: f.name, relation: f.rel, contact: '••• ••• ' + f.phone.slice(-4), level: f.level }); audit('family-share-add', { patient: p, detail: f.rel, purpose: 'Individual access' }); save(); render(); toast(`${f.name} will get status updates.`); };
  const baseOtNext = ACT['ot-next'];
  if (baseOtNext) ACT['ot-next'] = (d, el, e) => { baseOtNext(d, el, e); const c = S().ot.find((x) => x.id === d.c); const p = P(c.patient); const fam = (S().family[p.id] || []);
    if (fam.length) { fam.forEach((f) => { const room = /room number/.test(f.level) && c.stage === 'Completed' && p.bed ? ` Room ${p.bed}.` : ''; S().familyMsgs.push({ patient: p.id, to: `${f.name} (${f.relation})`, text: familyStatus(p) + room, at: new Date().toISOString() }); }); audit('family-update-sent', { patient: p, detail: `${fam.length} contact(s)` }); save(); } };

  (T.notifHooks = T.notifHooks || []).push((u, add) => {
    if (u.role === 'admin') { const n = privacyAlerts().filter((a) => a.risk === 'High' && !S().privacyCases[a.id]).length; if (n) add('ps-' + n, 'crit', `${n} high-risk privacy alert(s) to review`, '#privacy'); }
    if (u.role === 'billing') { const n = gfeCandidates().filter((c) => payerType(P(c.patient)) === 'Self-pay' && !S().gfe.some((x) => x.key === c.key && x.delivered)).length; if (n) add('gfe-' + n, 'crit', `${n} self-pay estimate(s) legally required`, '#estimates'); }
    if (u.role === 'receptionist') { const n = S().sdohRefs.filter((r) => r.domain !== 'safety' && !/delivered|Unable/.test(r.status)).length; if (n) add('sd-' + n, 'info', `${n} community referral(s) to follow up`, '#sdoh'); }
  });
})(window.Tessera);
