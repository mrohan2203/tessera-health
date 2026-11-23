/* Tessera Health — remaining Olir One modules: Doctor Live, My Work, Encounters, Credentials &
   privileges, Consent management (drawn e-signature, revocation), Blood donors & processing,
   Hospital digital twin, Patient vault, Research, Platform administration. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, esc, clone, P, U, me, nid, tok, pill, statePill, allergyChips, tiles, panel, table, ago, timeStr, toast, audit, careRel, openModal, render, save, dayStr, DEPT, UNIT } = T;
  const S = () => T.S;
  const UI = T.UI;
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(l)}</option>`;
  const expPill = (d) => d < 0 ? pill('crit', `Expired ${-d} d ago`) : d <= 30 ? pill('warn', `Expires in ${d} d`) : pill('ok', `Valid · ${dayStr(d)}`);

  T.inits.push((s) => {
    const fill = (k, v) => { if (s[k] === undefined) s[k] = clone(v); };
    fill('todos', {}); fill('donors', SEED.donors); fill('processing', SEED.processing); fill('shares', []); fill('shareLog', []);
    fill('tenants', SEED.tenants); fill('supportReq', []); fill('credReminders', {}); fill('extracts', []);
  });

  /* ======================= Doctor Live ======================= */
  function attention(u, p) {
    const why = []; let sc = 0;
    if (T.news2 && typeof p.vitals.hr === 'number') { const n = T.news2(p); sc += n.sc; if (n.sc >= 5) why.push(['crit', `NEWS2 ${n.sc}`]); else if (n.sc) why.push(['', `NEWS2 ${n.sc}`]); }
    const crit = S().results.filter((r) => r.patient === p.id && r.state !== 'Closed'); if (crit.length) { sc += 5 * crit.length; why.push(['crit', `${crit.length} open critical result${crit.length > 1 ? 's' : ''}`]); }
    const uns = S().orders.filter((o) => o.patient === p.id && o.status === 'Pending signature'); if (uns.length) { sc += uns.length; why.push([uns.some((o) => o.flag) ? 'warn' : '', `${uns.length} order${uns.length > 1 ? 's' : ''} to sign`]); }
    const tasks = S().handovers.filter((h) => h.patient === p.id).flatMap((h) => h.tasks.filter((t) => !t.done && t.urgent)); if (tasks.length) { sc += 2 * tasks.length; why.push(['warn', `Urgent task: ${tasks[0].t}`]); }
    const er = S().er.find((e) => e.patient === p.id && !['Discharged', 'Admitted'].includes(e.status)); if (er && !er.provider && er.mOff > SEED.esiTarget[er.esi]) { sc += 3; why.push(['crit', `ER wait over target (ESI ${er.esi})`]); }
    const dc = S().discharges.find((d) => d.patient === p.id && d.steps.some((s) => s.owner === 'doctor' && s.state !== 'Done')); if (dc) { sc += 1; why.push(['info', 'Discharge summary due']); }
    if (p.code !== 'Full code') why.push(['', p.code]);
    return { sc, why };
  }
  VIEWS.live = (u) => {
    const list = T.myPatients(u).filter((p) => !['Discharged'].includes(p.status)).map((p) => Object.assign({ p }, attention(u, p))).sort((a, b) => b.sc - a.sc);
    audit('view-doctor-live', { patients: list.map((x) => tok(x.p)).join(' ') });
    const cards = list.map(({ p, sc, why }) => `<article class="livecard ${sc >= 8 ? 'hot' : sc >= 4 ? 'warm' : ''}"><div class="livescore">${sc}</div><div class="stack" style="gap:4px;min-width:0"><a href="#patient-${p.id}-overview"><b>${esc(p.name)}</b></a><span class="kpi-note">${p.age}${p.sex} · ${esc(T.location_(p))}</span><div class="chips">${why.map(([c, t]) => pill(c, t)).join('') || pill('ok', 'Nothing pending')}</div><div class="row" style="gap:6px"><a class="btn small" href="#patient-${p.id}-results">Results</a><a class="btn small" href="#orders">Orders</a><a class="btn small" href="#patient-${p.id}-timeline">Timeline</a></div></div></article>`).join('');
    return { title: 'Doctor Live', sub: 'Who needs you right now: acuity, open criticals, unsigned orders, urgent tasks, waits', body:
      tiles([[list.filter((x) => x.sc >= 8).length, 'Need you now', 'crit'], [list.filter((x) => x.sc >= 4 && x.sc < 8).length, 'Soon', 'warn'], [list.length, 'Patients in scope']]) +
      `<div class="livegrid">${cards || '<p class="muted">No patients in your scope.</p>'}</div><p class="kpi-note">Attention score = NEWS2 + 5 per open critical result + 1 per unsigned order + 2 per urgent handover task + 3 when an ER wait is over target.</p>` };
  };

  /* ======================= My Work ======================= */
  VIEWS.mywork = (u) => {
    const items = T.notifs ? T.notifs(u) : []; const todos = S().todos[u.id] = S().todos[u.id] || [];
    const group = (lv) => items.filter((x) => lv.includes(x.level));
    const sec = (title, arr, cls) => panel(`${title} · ${arr.length}`, arr.length ? `<div class="worklist">${arr.map((x) => `<a class="workitem ${cls}" href="${x.href}"><span class="ndot ${x.level}"></span><span>${esc(x.text)}</span><span class="kpi-note">Open ›</span></a>`).join('')}</div>` : '<p class="muted">Nothing here.</p>');
    return { title: 'My work', sub: 'Everything waiting on you, from every module, in one list', body:
      `<div class="grid">${sec('Now', group(['crit']), 'crit')}${sec('Today', group(['warn']), 'warn')}${sec('When you can', group(['info', 'ok']), '')}</div>` +
      panel('Personal to-dos', `<div class="stack" style="gap:6px">${todos.map((t, i) => `<label class="row" style="gap:8px"><input type="checkbox" data-act="todo-toggle" data-i="${i}" ${t.done ? 'checked' : ''}> <span ${t.done ? 'class="muted" style="text-decoration:line-through"' : ''}>${esc(t.t)}</span></label>`).join('') || '<p class="muted">No to-dos.</p>'}</div>
        <form data-form="todo" class="row"><input class="search" name="t" required placeholder="Add a to-do (avoid patient names)" aria-label="New to-do"><button class="btn small" type="submit">Add</button></form>`) };
  };
  ACT['todo-toggle'] = (d) => { const t = S().todos[me().id][+d.i]; t.done = !t.done; save(); render(); };
  FORMS.todo = (f) => { const u = me(); (S().todos[u.id] = S().todos[u.id] || []).push({ t: f.t, done: false }); save(); render(); };

  /* ======================= Encounters ======================= */
  const encId = (seed) => 'ENC-2026-' + String(parseInt(T.fnv(seed).slice(0, 6), 16) % 900000 + 100000);
  VIEWS.encounters = (u) => {
    const clin = u.role === 'doctor'; const f = UI.encF || 'All';
    const rows = [];
    S().appts.forEach((a) => rows.push({ id: encId('A' + a.patient + a.time), type: 'Clinic', p: P(a.patient), who: U(a.provider), when: `Today ${a.time}`, status: a.status }));
    S().tele.forEach((t) => rows.push({ id: encId('T' + t.id), type: 'Telehealth', p: P(t.patient), who: U(t.provider), when: t.when, status: t.status }));
    S().er.forEach((e) => rows.push({ id: encId('E' + e.id), type: 'Emergency', p: P(e.patient), who: e.provider ? U(e.provider) : null, when: ago(e.mOff), status: e.status }));
    S().ot.forEach((c) => rows.push({ id: encId('O' + c.id), type: 'Surgery', p: P(c.patient), who: U(c.surgeon), when: `Today ${c.scheduled}`, status: c.stage }));
    S().daycare.forEach((d) => rows.push({ id: encId('D' + d.patient), type: 'Day care', p: P(d.patient), who: U(P(d.patient).attending), when: 'Today', status: d.phase }));
    const vis = rows.filter((r) => r.p && (clin ? careRel(u, r.p) : true)).filter((r) => f === 'All' || r.type === f);
    audit('list-encounters', { patients: [...new Set(vis.map((r) => tok(r.p)))].join(' ') });
    const tr = vis.map((r) => { const cl = S().claims.find((c) => c.patient === r.p.id);
      return `<tr><td class="mono">${r.id}</td><td>${pill('accent', r.type)}</td><td><b>${clin ? `<a href="#patient-${r.p.id}-overview">${esc(r.p.name)}</a>` : esc(r.p.name)}</b><span class="sub">MRN ${esc(r.p.mrn)}</span></td><td>${r.who ? esc(r.who.name) : '—'}</td><td>${esc(r.when)}</td><td>${statePill(r.status)}</td>${clin ? `<td class="mono" style="font-size:12px">${cl ? cl.icd.slice(0, 3).join(', ') : '—'}</td>` : ''}</tr>`; });
    return { title: 'Encounters', sub: clin ? 'Visits for patients in your care' : 'All visits today · diagnoses hidden from the front desk', body:
      `<div class="chips">${['All', 'Clinic', 'Telehealth', 'Emergency', 'Surgery', 'Day care'].map((t) => `<button class="btn small ${t === f ? 'primary' : ''}" data-act="enc-f" data-t="${t}">${t} ${t === 'All' ? rows.filter((r) => r.p && (clin ? careRel(u, r.p) : true)).length : rows.filter((r) => r.type === t && r.p && (clin ? careRel(u, r.p) : true)).length}</button>`).join('')}</div>` +
      panel('Encounters', table(['Encounter', 'Type', 'Patient', 'Clinician', 'When', 'Status'].concat(clin ? ['Diagnoses'] : []), tr), '', true) };
  };
  ACT['enc-f'] = (d) => { UI.encF = d.t; render(); };

  /* ======================= Credentials & privileges ======================= */
  VIEWS.credentials = () => {
    const rows = S().users.filter((x) => SEED.credentials[x.id]).flatMap((x) => SEED.credentials[x.id].map(([n, id, d], i) => `<tr><td>${i === 0 ? `<b>${esc(x.name)}</b><span class="sub">${esc(x.title)}</span>` : ''}</td><td>${esc(n)}</td><td class="mono" style="font-size:12px">${esc(id)}</td><td>${expPill(d)}</td><td>${d <= 30 ? (S().credReminders[x.id + n] ? pill('info', 'Reminder sent') : `<button class="btn small" data-act="cred-remind" data-u="${x.id}" data-n="${esc(n)}">Send reminder</button>`) : ''}</td></tr>`));
    const priv = Object.entries(SEED.privileges).map(([id, list]) => `<article class="note"><b>${esc(U(id).name)}</b>${list.map(([p, s]) => `<div class="row between" style="font-size:13px"><span>${esc(p)}</span>${pill(/Full/.test(s) ? 'ok' : 'warn', s)}</div>`).join('')}</article>`).join('');
    const all = S().users.filter((x) => SEED.credentials[x.id]).flatMap((x) => SEED.credentials[x.id].map((c) => c[2]));
    const dea = SEED.credentials['U-2002'].find((c) => /DEA/.test(c[0]));
    return { title: 'Credentials & privileges', sub: 'Licenses, DEA, board certification, life-support cards, procedure privileges', body:
      tiles([[all.filter((d) => d < 0).length, 'Expired', 'crit'], [all.filter((d) => d >= 0 && d <= 30).length, 'Expiring in 30 days', 'warn'], [Object.keys(SEED.privileges).length, 'Privileged proceduralists']]) +
      `<div class="banner info"><p>Enforced, not just tracked: an expired license suspends the account (Dr. Ruth Adeyemi), and an expired DEA registration blocks controlled-substance prescribing. Dr. Okafor's DEA expires in ${dea[2]} days.</p></div>` +
      panel('Credentials', table(['Clinician', 'Credential', 'Number', 'Status', ''], rows), '', true) + panel('Procedure privileges', `<div class="grid">${priv}</div>`) };
  };
  ACT['cred-remind'] = (d) => { S().credReminders[d.u + d.n] = true; audit('credential-reminder', { resource: d.u, detail: d.n }); save(); render(); toast(`Renewal reminder sent to ${U(d.u).name}.`); };
  const baseRx = FORMS.rx;
  if (baseRx) FORMS.rx = (f, form, sub) => { const dea = (SEED.credentials[me().id] || []).find((c) => /DEA/.test(c[0])); if (/(oxycodone|hydrocodone|morphine|lorazepam|alprazolam|tramadol|codeine)/i.test(f.drug) && (!dea || dea[2] < 0)) { toast('Your DEA registration is missing or expired, so controlled substances are blocked.'); audit('erx-blocked', { detail: 'DEA expired or missing' }); return; } return baseRx(f, form, sub); };

  /* ======================= Consent management ======================= */
  const tplOf = (c) => SEED.consentTemplates.find((t) => t.id === c.template) || SEED.consentTemplates.find((t) => (c.kind || '').toLowerCase().includes(t.name.toLowerCase().split(' ')[0])) || null;
  VIEWS.consents = (u) => {
    const pts = T.myPatients(u).filter((p) => !p.unidentified);
    const list = S().consents.map((c, i) => [c, i]).filter(([c]) => careRel(u, P(c.patient))).reverse();
    const rows = list.map(([c, i]) => { const t = tplOf(c); return `<tr><td><b>${esc(P(c.patient).name)}</b><span class="sub">MRN ${P(c.patient).mrn}</span></td><td><b>${esc(c.kind)}</b>${c.detail ? `<span class="sub">${esc(c.detail)}</span>` : ''}</td><td>${statePill(c.state === 'Done' ? 'Signed' : /Revoked|Declined/.test(c.state) ? 'Denied' : c.state)}<span class="sub">${esc(c.state === 'Done' ? 'Signed' : c.state)}</span></td><td>${c.sig ? `<img src="${c.sig}" alt="Signature" class="sigthumb">` : '<span class="kpi-note">Paper or verbal</span>'}</td><td>${esc(c.by)}<span class="sub">${timeStr(c.at)}</span></td><td>${t && t.revocable && c.state === 'Done' ? `<button class="btn small" data-act="cons-revoke" data-i="${i}">Revoke…</button>` : ''}</td></tr>`; });
    const tpl = SEED.consentTemplates.find((t) => t.id === (UI.ctpl || 'CT-SURG'));
    return { title: 'Consent management', sub: 'Templates · drawn e-signature · witness and interpreter · revocation enforced across modules', body:
      `<div class="grid-2">${panel('New consent', `<form data-form="consent" class="stack">
        <div class="field"><label for="cn-p">Patient</label><select id="cn-p" name="p" required>${pts.map((p) => opt(p.id, `${p.name} · MRN ${p.mrn}`)).join('')}</select></div>
        <div class="field"><label for="cn-t">Template</label><select id="cn-t" name="tpl" data-change="cons-tpl">${SEED.consentTemplates.map((t) => opt(t.id, t.name, t.id === tpl.id)).join('')}</select></div>
        <div class="field"><label for="cn-d">Procedure or details</label><input id="cn-d" name="detail" required placeholder="e.g. Laparoscopic cholecystectomy"></div>
        <fieldset class="stack" style="border:1px solid var(--line);border-radius:10px;padding:10px;gap:6px"><legend class="kpi-note">Risks discussed (all required)</legend>${tpl.risks.map((r, i) => `<label class="row" style="gap:8px"><input type="checkbox" name="r${i}" required> ${esc(r)}</label>`).join('')}</fieldset>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))"><div class="field"><label for="cn-s">Signed by</label><select id="cn-s" name="signer"><option>Patient</option><option>Legally authorized representative</option><option>Parent or guardian</option></select></div><div class="field"><label for="cn-i">Interpreter</label><select id="cn-i" name="interp"><option>Not needed</option><option>Spanish, in person</option><option>Video interpreter</option><option>Phone interpreter</option></select></div><div class="field"><label for="cn-w">Witness</label><input id="cn-w" name="witness" required></div></div>
        <div class="field"><label>Signature</label><canvas id="sigpad" class="sigpad" width="520" height="140" aria-label="Signature pad: draw with mouse, finger or stylus"></canvas><div class="row"><button class="btn small" type="button" data-act="sig-clear">Clear</button><span class="kpi-note" id="sig-state">Sign above</span></div></div>
        <div><button class="btn primary" type="submit">Save signed consent</button></div></form>`)}
      ${panel('What consent controls', `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:13.5px"><li><b>Surgery:</b> OT cases can't leave "Scheduled" without a signed surgical consent.</li><li><b>Ambient recording:</b> Ambient Doctor won't capture without it; revoking stops future recordings.</li><li><b>Research:</b> a revoked or declined research consent removes the patient from every cohort and extract.</li><li><b>Blood:</b> transfusion consent is checked before issue in day care.</li><li>Patients can revoke revocable consents themselves from the portal.</li></ul>`)}</div>` +
      panel('Consents', table(['Patient', 'Consent', 'Status', 'Signature', 'Recorded', ''], rows), '', true) };
  };
  T.CHANGE['cons-tpl'] = (v) => { UI.ctpl = v; render(); };
  let sigDrawn = false;
  T.after.push((u, route) => {
    const c = document.getElementById('sigpad'); if (!c) return; sigDrawn = false;
    const g = c.getContext('2d'); g.lineWidth = 2.4; g.lineCap = 'round'; g.strokeStyle = getComputedStyle(document.body).color;
    let down = false;
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener('pointerdown', (e) => { down = true; c.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); });
    c.addEventListener('pointermove', (e) => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); if (!sigDrawn) { sigDrawn = true; const s = document.getElementById('sig-state'); if (s) s.textContent = 'Signed'; } });
    c.addEventListener('pointerup', () => { down = false; });
  });
  ACT['sig-clear'] = () => { const c = document.getElementById('sigpad'); c.getContext('2d').clearRect(0, 0, c.width, c.height); sigDrawn = false; document.getElementById('sig-state').textContent = 'Sign above'; };
  FORMS.consent = (f) => {
    if (!sigDrawn) { toast('Draw the signature first.'); return; }
    const t = SEED.consentTemplates.find((x) => x.id === f.tpl); const c = document.getElementById('sigpad');
    const small = document.createElement('canvas'); small.width = 260; small.height = 70; small.getContext('2d').drawImage(c, 0, 0, 260, 70);
    S().consents.push({ patient: f.p, template: t.id, kind: `${t.name}${f.detail ? ' — ' + f.detail : ''}`, state: 'Done', by: me().name, at: new Date().toISOString(), detail: `Signed by ${f.signer.toLowerCase()} · witness ${f.witness} · interpreter: ${f.interp}`, sig: small.toDataURL('image/png') });
    const oc = S().ot.find((x) => x.patient === f.p && x.consent !== 'Signed' && t.id === 'CT-SURG'); if (oc) oc.consent = 'Signed';
    audit('consent-recorded', { patient: P(f.p), detail: t.name + ' · e-signed' }); save(); render(); toast(`${t.name} consent signed and saved.${oc ? ' The OT case is unblocked.' : ''}`);
  };
  ACT['cons-revoke'] = (d) => openModal({ title: 'Revoke consent', form: 'cons-revoke', submit: 'Revoke', danger: true, body: `<input type="hidden" name="i" value="${d.i}"><p>${esc(S().consents[+d.i].kind)}</p><div class="field"><label for="rv">Reason</label><input id="rv" name="why" required placeholder="e.g. Patient changed their mind"></div><p class="kpi-note">Revocation stops future use. It does not undo care already given.</p>` });
  FORMS['cons-revoke'] = (f) => { const c = S().consents[+f.i]; c.state = 'Revoked'; c.detail = (c.detail ? c.detail + ' · ' : '') + `Revoked by ${me().name}: ${f.why}`; UI.modal = null; audit('consent-revoked', { patient: P(c.patient), detail: c.kind }); save(); render(); };
  // Patient-side consents
  VIEWS.myconsents = (u) => {
    const p = P(u.patientId); audit('portal-view', { patient: p, resource: 'consents', purpose: 'Individual access' });
    const rows = S().consents.map((c, i) => [c, i]).filter(([c]) => c.patient === p.id).map(([c, i]) => { const t = tplOf(c); return `<tr><td><b>${esc(c.kind)}</b><span class="sub">${esc(c.detail || '')}</span></td><td>${esc(c.state === 'Done' ? 'Active' : c.state)}</td><td>${timeStr(c.at)}</td><td>${t && t.revocable && c.state === 'Done' ? `<button class="btn small" data-act="pt-revoke" data-i="${i}">Withdraw</button>` : t && !t.revocable ? '<span class="kpi-note">Completed procedure</span>' : ''}</td></tr>`; });
    return { title: 'My consents', sub: 'What you agreed to, and the ones you can withdraw at any time', body: panel('Consents', table(['Consent', 'Status', 'Date', ''], rows), '', true) };
  };
  ACT['pt-revoke'] = (d) => { const c = S().consents[+d.i]; c.state = 'Revoked by patient'; audit('consent-revoked', { patient: P(c.patient), detail: c.kind + ' (by patient)', purpose: 'Individual access' }); save(); render(); toast('Withdrawn. Your care team has been told.'); };

  /* ======================= Blood bank: donors & processing ======================= */
  const baseBB = VIEWS.bloodbank;
  VIEWS.bloodbank = (u, args) => {
    const tab = UI.bbTab || 'stock';
    const tabs = `<nav class="tabs" aria-label="Blood bank">${[['stock', 'Stock & issue'], ['donors', 'Donors'], ['processing', 'Processing']].map(([k, l]) => `<a href="#bloodbank" data-act="bb-tab" data-t="${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}${k === 'processing' && S().processing.length ? ` (${S().processing.length})` : ''}</a>`).join('')}</nav>`;
    if (tab === 'stock') { const v = baseBB(u, args); v.body = tabs + v.body; return v; }
    if (tab === 'donors') {
      const rows = S().donors.map((d) => `<tr><td class="mono">${d.id}</td><td><b>${esc(d.name)}</b></td><td><b>${d.group}</b></td><td>${d.lastDays} d ago</td><td class="num">${d.hb} g/dL</td><td>${d.status === 'Eligible' ? pill('ok', 'Eligible') : pill('warn', 'Deferred')}${d.why ? `<span class="sub">${esc(d.why)}</span>` : ''}</td><td>${d.status === 'Eligible' ? `<button class="btn small primary" data-act="bb-donate" data-d="${d.id}">Record donation</button>` : ''}</td></tr>`);
      return { title: 'Blood bank · donors', sub: 'Eligibility: 56 days between whole-blood donations, hemoglobin ≥ 12.5 g/dL', body: tabs + panel('Donor registry', table(['Donor', 'Name', 'Group', 'Last donation', 'Hemoglobin', 'Eligibility', ''], rows), '', true) };
    }
    const rows = S().processing.map((x, i) => { const res = SEED.bbTests.map((t, k) => `<td><select data-change="bb-test" data-i="${i}" data-k="${k}" aria-label="${esc(t)}">${['Pending', 'Neg', 'Pos'].map((o) => opt(o, o === 'Neg' ? 'Negative' : o === 'Pos' ? 'Reactive' : 'Pending', (x.results[k] || 'Pending') === o)).join('')}</select></td>`).join('');
      const allNeg = SEED.bbTests.every((_, k) => x.results[k] === 'Neg'); const pos = SEED.bbTests.some((_, k) => x.results[k] === 'Pos');
      return `<tr><td class="mono" style="font-size:12px">${esc(x.id)}<span class="sub">${x.group} ${x.product}</span></td>${res}<td>${pos ? `<button class="btn small danger" data-act="bb-discard" data-i="${i}">Discard and defer donor</button>` : allNeg ? `<button class="btn small primary" data-act="bb-release" data-i="${i}">Release to inventory</button>` : '<span class="kpi-note">Testing</span>'}</td></tr>`; });
    return { title: 'Blood bank · processing', sub: 'Every unit is quarantined until all required infectious-disease tests are negative', body: tabs + panel('Units in processing', `<div class="tbl"><table class="t"><thead><tr><th>Unit</th>${SEED.bbTests.map((t) => `<th style="font-size:10px">${esc(t)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="9" class="muted">No units in processing.</td></tr>'}</tbody></table></div>`, '', true) };
  };
  Object.assign(ACT, {
    'bb-tab': (d) => { UI.bbTab = d.t; render(); },
    'bb-donate': (d) => { const dn = S().donors.find((x) => x.id === d.d); dn.lastDays = 0; dn.status = 'Deferred'; dn.why = 'Donated today (eligible again in 56 days)'; S().processing.push({ id: 'W0412 26 00' + (1300 + S().seq++), donor: dn.id, product: 'PRBC', group: dn.group, results: {} }); audit('bb-donation', { resource: dn.id }); save(); render(); toast('Donation recorded. Unit is in processing.'); },
    'bb-release': (d) => { const x = S().processing.splice(+d.i, 1)[0]; S().bloodUnits.push({ id: x.id, group: x.group, product: x.product, expDays: 42 }); audit('bb-release', { resource: x.id }); save(); render(); toast(`${x.group} unit released to inventory (expires in 42 days).`); },
    'bb-discard': (d) => { const x = S().processing.splice(+d.i, 1)[0]; const dn = S().donors.find((y) => y.id === x.donor); if (dn) { dn.status = 'Deferred'; dn.why = 'Reactive screening test: donor notified, lookback started (21 CFR 610.46)'; } audit('bb-discard', { resource: x.id, detail: 'reactive test' }); save(); render(); toast('Unit discarded. Donor deferred and notified; lookback on earlier donations started.'); }
  });
  T.CHANGE['bb-test'] = (v, el) => { S().processing[+el.dataset.i].results[+el.dataset.k] = v; save(); render(); };

  /* ======================= Hospital digital twin ======================= */
  function zoneLoad(z) {
    const pts = T.allPts();
    if (z.kind === 'unit') { const beds = SEED.beds.filter((b) => b.unit === z.unit); const occ = beds.filter((b) => pts.some((p) => p.unit === z.unit && p.bed === b.bed && p.status !== 'Discharged')).length; return [occ, beds.length, 'beds']; }
    if (z.kind === 'er') return [S().er.filter((e) => !['Discharged', 'Admitted'].includes(e.status)).length, z.cap, 'patients'];
    if (z.kind === 'or') return [S().ot.filter((c) => ['Preparation', 'In surgery'].includes(c.stage)).length, z.cap, 'rooms in use'];
    if (z.kind === 'dc') return [S().daycare.filter((d) => d.phase !== 'Discharged').length, z.cap, 'bays'];
    if (z.kind === 'rad') return [S().radOrders.filter((o) => ['Arrived', 'In progress'].includes(o.status)).length, z.cap, 'scanning'];
    if (z.kind === 'lab') return [S().labOrders.filter((o) => ['Collected', 'Received'].includes(o.status)).length, null, 'specimens in lab'];
    if (z.kind === 'front') return [S().appts.filter((a) => ['Arrived', 'Waiting'].includes(a.status)).length, null, 'waiting'];
    if (z.kind === 'pharm') return [S().orders.filter((o) => o.type === 'Medication' && o.status === 'Signed' && !S().verified[o.id]).length, null, 'to verify'];
    return [null, null, ''];
  }
  VIEWS.twin = () => {
    const fl = SEED.floors.find((f) => f.id === (UI.floor || 'GF'));
    const zones = fl.zones.map((z) => { const [n, cap, lab] = zoneLoad(z); const pct = cap ? n / cap : null; const heat = pct == null ? '' : pct >= 0.85 ? 'hot' : pct >= 0.6 ? 'warm' : 'cool';
      const eq = S().assets.filter((a) => SEED.assetZone[a.id] === z.id).map((a) => `<i class="eq ${a.status !== 'Operational' ? 'down' : a.next < 0 ? 'due' : ''}" title="${esc(a.name)}: ${esc(a.status)}${a.next < 0 ? ', maintenance overdue' : ''}"></i>`).join('');
      return `<div class="zone ${heat} k-${z.kind}" style="grid-column:${z.x}/span ${z.w};grid-row:${z.y}/span ${z.h}"><b>${esc(z.name)}</b>${n != null ? `<span class="zn">${n}${cap ? `<small>/${cap}</small>` : ''}</span><span class="kpi-note">${lab}</span>` : ''}${pct != null ? `<div class="minibar ${pct >= 0.85 ? 'over' : ''}"><i style="width:${Math.min(100, pct * 100)}%"></i></div>` : ''}${eq ? `<div class="eqrow">${eq}</div>` : ''}</div>`; }).join('');
    audit('view-digital-twin', { detail: fl.id });
    return { title: 'Hospital map', sub: 'Digital twin of the building · live counts from the record · no patient names', body:
      `<div class="chips">${SEED.floors.map((f) => `<button class="btn small ${f.id === fl.id ? 'primary' : ''}" data-act="twin-floor" data-f="${f.id}">${f.id} · ${esc(f.name)}</button>`).join('')}</div>` +
      `<section class="hero"><div class="floorplan">${zones}</div><div class="legend"><span><i class="lg-cool"></i>Under 60% full</span><span><i class="lg-warm"></i>60–85%</span><span><i class="lg-hot"></i>Over 85%</span><span><i class="eq"></i>Equipment OK</span><span><i class="eq due"></i>Maintenance overdue</span><span><i class="eq down"></i>Down</span></div></section>` };
  };
  ACT['twin-floor'] = (d) => { UI.floor = d.f; render(); };

  /* ======================= Patient vault ======================= */
  VIEWS.vault = (u) => {
    const p = P(u.patientId); audit('portal-view', { patient: p, resource: 'vault', purpose: 'Individual access' });
    const items = [].concat(
      S().notes.filter((n) => n.patient === p.id && n.signed).map((n) => ({ id: 'N:' + n.id, kind: 'Visit note', title: n.kind, when: n.at || null, by: n.author })),
      p.labs.map((l, i) => ({ id: 'L:' + i, kind: 'Result', title: `${l.test} ${l.value} ${l.unit}`, when: null, by: l.outside ? 'Outside lab' : 'Bayview lab' })),
      S().radOrders.filter((o) => o.patient === p.id && o.status === 'Reported').map((o) => ({ id: 'R:' + o.id, kind: 'Imaging report', title: o.study, when: o.report.at, by: o.report.by })),
      S().consents.filter((c) => c.patient === p.id).map((c, i) => ({ id: 'C:' + i, kind: 'Consent', title: c.kind, when: c.at, by: c.by })));
    const shares = S().shares.filter((s) => s.patient === p.id);
    return { title: 'My vault', sub: 'Your records in one place. You decide who else sees them.', body:
      `<div class="grid-2">${panel('Records', `<form data-form="vault-share" class="stack"><div class="tbl"><table class="t"><tbody>${items.map((x) => `<tr><td><input type="checkbox" name="i:${esc(x.id)}" aria-label="Select ${esc(x.title)}"></td><td>${pill('accent', x.kind)}</td><td><b>${esc(x.title)}</b><span class="sub">${esc(x.by || '')}${x.when ? ' · ' + timeStr(x.when) : ''}</span></td></tr>`).join('')}</tbody></table></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))"><div class="field"><label for="vs-to">Share with</label><select id="vs-to" name="to"><option>Another doctor</option><option>A family member</option><option>A health app (SMART on FHIR)</option></select></div><div class="field"><label for="vs-d">For</label><select id="vs-d" name="days"><option value="1">24 hours</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></div></div>
        <div><button class="btn primary" type="submit">Create share code</button></div></form>`)}
      ${panel('Active shares', shares.map((s, i) => `<article class="note"><div class="row between"><b class="mono" style="font-size:18px;letter-spacing:.1em">${esc(s.code)}</b>${s.revoked ? pill('crit', 'Revoked') : new Date(s.expires) < new Date() ? pill('', 'Expired') : pill('ok', `Until ${timeStr(s.expires)}`)}</div><span class="kpi-note">${esc(s.to)} · ${s.items.length} record(s) · opened ${s.opens} time(s)</span>${s.revoked ? '' : `<div class="row"><button class="btn small" data-act="vault-open" data-i="${S().shares.indexOf(s)}">Simulate recipient opening</button><button class="btn small danger" data-act="vault-revoke" data-i="${S().shares.indexOf(s)}">Revoke</button></div>`}</article>`).join('') || '<p class="muted">You haven\'t shared anything.</p>')}</div>` };
  };
  FORMS['vault-share'] = (f) => { const p = P(me().patientId); const items = Object.keys(f).filter((k) => k.startsWith('i:')).map((k) => k.slice(2)); if (!items.length) { toast('Pick at least one record.'); return; }
    const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const code = Array.from({ length: 6 }, (_, i) => a[(parseInt(T.fnv(String(Date.now()) + i), 16)) % a.length]).join('').replace(/^(...)/, '$1-');
    S().shares.push({ patient: p.id, code, to: f.to, items, expires: new Date(Date.now() + +f.days * 864e5).toISOString(), opens: 0, revoked: false }); audit('vault-share', { patient: p, detail: `${items.length} record(s) to ${f.to}`, purpose: 'Individual access' }); save(); render(); toast(`Share code ${code} created.`); };
  Object.assign(ACT, {
    'vault-open': (d) => { const s = S().shares[+d.i]; s.opens++; audit('vault-share-opened', { patient: P(s.patient), actor: 'external', role: 'recipient', detail: `${s.to} via code`, purpose: 'Patient-directed disclosure' }); save(); render(); toast('Logged in your access history as a patient-directed disclosure.'); },
    'vault-revoke': (d) => { const s = S().shares[+d.i]; s.revoked = true; audit('vault-share-revoked', { patient: P(s.patient), purpose: 'Individual access' }); save(); render(); }
  });

  /* ======================= Research ======================= */
  const researchOptOut = (pid) => S().consents.some((c) => c.patient === pid && /research/i.test(c.kind) && /Declined|Revoked/.test(c.state));
  VIEWS.research = () => {
    const q = UI.cohort || { dx: '', amin: 18, amax: 90, setting: 'Any' };
    const base = T.allPts().filter((p) => !p.unidentified && p.age >= q.amin && p.age <= q.amax && (!q.dx || p.problems.some((x) => x.toLowerCase().includes(q.dx.toLowerCase()))) && (q.setting === 'Any' || (q.setting === 'Inpatient' ? p.status === 'Admitted' : p.status !== 'Admitted')));
    const out = base.filter((p) => researchOptOut(p.id)); const cohort = base.filter((p) => !researchOptOut(p.id));
    const show = (n) => n > 0 && n < 11 ? '<11' : String(n);
    const shift = (s) => s ? String(+s.slice(0, 4) + 0) : '';
    const preview = cohort.slice(0, 6).map((p) => `<tr><td class="mono">${tok(p).replace('PT-', 'R-')}</td><td>${p.age >= 90 ? '90+' : Math.floor(p.age / 5) * 5 + '–' + (Math.floor(p.age / 5) * 5 + 4)}</td><td>${p.sex}</td><td class="mono" style="font-size:12px">${p.problems.map((x) => (x.match(/\(([A-Z]\d[^,)]*)/) || [])[1]).filter(Boolean).join(', ')}</td><td>${p.status === 'Admitted' ? 'Inpatient' : 'Outpatient'}</td></tr>`);
    const st = SEED.studies.map((s) => `<tr><td class="mono">${s.id}</td><td><b>${esc(s.title)}</b><span class="sub">${esc(s.pi)}</span></td><td>${statePill(s.status === 'Enrolling' ? 'Active' : s.status === 'IRB review' ? 'Pending' : 'Released')}<span class="sub">${esc(s.status)}</span></td><td>${esc(s.waiver)}</td><td class="num">${s.n}</td></tr>`);
    return { title: 'Research & cohorts', sub: 'IRB-approved studies · de-identified cohorts · research opt-outs always excluded', body:
      panel('Studies', table(['IRB #', 'Study', 'Status', 'Data permission', 'Enrolled'], st), '', true) +
      `<div class="grid-2">${panel('Cohort builder', `<form data-form="cohort" class="stack"><div class="field"><label for="co-dx">Diagnosis contains</label><input id="co-dx" name="dx" value="${esc(q.dx)}" placeholder="e.g. diabetes, I10, heart failure"></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))"><div class="field"><label for="co-a1">Age from</label><input id="co-a1" type="number" name="amin" value="${q.amin}"></div><div class="field"><label for="co-a2">to</label><input id="co-a2" type="number" name="amax" value="${q.amax}"></div><div class="field"><label for="co-s">Setting</label><select id="co-s" name="setting">${['Any', 'Inpatient', 'Outpatient'].map((o) => opt(o, o, q.setting === o)).join('')}</select></div></div><div><button class="btn primary" type="submit">Count</button></div></form>`)}
      ${panel('Result', `<div class="tiles">${[[show(cohort.length), 'Patients in cohort'], [show(out.length), 'Excluded: research opt-out', out.length ? 'warn' : '']].map(([n, l, c]) => `<div class="tile ${c || ''}"><b>${n}</b><span>${l}</span></div>`).join('')}</div><p class="kpi-note">Counts from 1 to 10 show as &lt;11. Extracts use HIPAA Safe Harbor de-identification: no names, MRNs, dates or locations; ages in 5-year bands, 90 and over grouped.</p>
        ${preview.length ? table(['Research ID', 'Age band', 'Sex', 'Diagnosis codes', 'Setting'], preview) : ''}
        <form data-form="extract" class="row"><select name="study" aria-label="Study">${SEED.studies.filter((s) => s.status !== 'IRB review').map((s) => opt(s.id, s.id)).join('')}</select><button class="btn small" type="submit">Release de-identified extract</button></form>`)}</div>` };
  };
  FORMS.cohort = (f) => { UI.cohort = { dx: f.dx, amin: +f.amin || 0, amax: +f.amax || 120, setting: f.setting }; audit('research-cohort-count', { detail: JSON.stringify(UI.cohort) }); render(); };
  FORMS.extract = (f) => { const n = T.allPts().filter((p) => !researchOptOut(p.id)).length; S().extracts.push({ study: f.study, at: new Date().toISOString(), by: me().name }); audit('research-extract', { detail: `${f.study}: Safe Harbor extract, opt-outs excluded` }); save(); toast(`De-identified extract released to ${f.study}. Logged.`); };

  /* ======================= Platform administration ======================= */
  T.HOME.platform = () => {
    const rows = S().tenants.map((t) => { const sr = S().supportReq.filter((r) => r.tenant === t.id).slice(-1)[0];
      return `<tr><td><b>${esc(t.name)}</b><span class="sub mono">${t.id} · ${t.region}</span></td><td class="mono">${t.version}</td><td>${pill(/Healthy/.test(t.health) ? 'ok' : 'warn', t.health)}</td><td class="num">${t.users}</td><td>${-t.keyRotated > 365 ? pill('crit', `${-t.keyRotated} d`) : `${-t.keyRotated} d ago`}<span class="sub"><button class="linkbtn" data-act="pf-rotate" data-t="${t.id}">Rotate now</button></span></td><td>${-t.backupTested > 30 ? pill('warn', `${-t.backupTested} d ago`) : `${-t.backupTested} d ago`}<span class="sub"><button class="linkbtn" data-act="pf-restore" data-t="${t.id}">Run restore test</button></span></td>
        <td>${sr ? `${statePill(sr.status === 'approved' ? 'Approved' : sr.status === 'denied' ? 'Denied' : 'Pending')}<span class="sub">${sr.status === 'approved' ? 'Config view until ' + timeStr(sr.expires) : sr.status}</span>` : `<button class="btn small" data-act="pf-support" data-t="${t.id}">Request support access…</button>`}</td></tr>`; });
    return { title: 'Platform', sub: 'Tenants, encryption keys and recovery · platform staff never see patient data', body:
      tiles([[S().tenants.length, 'Tenants'], [S().tenants.filter((t) => !/Healthy/.test(t.health)).length, 'Degraded', 'warn'], [S().tenants.filter((t) => -t.keyRotated > 365).length, 'Keys older than 1 year', 'crit'], [S().tenants.filter((t) => -t.backupTested > 30).length, 'Restore test overdue', 'warn']]) +
      `<div class="banner info"><p>Each tenant's data is encrypted with its own KMS key. Support access to a tenant needs that tenant's administrator to approve, lasts 2 hours, shows configuration only, and lands in both audit logs.</p></div>` +
      panel('Tenants', table(['Tenant', 'Version', 'Health', 'Users', 'Key rotated', 'Restore tested', 'Support access'], rows), '', true) +
      panel('Recovery objectives', table(['Objective', 'Target', 'Last measured'], [`<tr><td>Recovery point (RPO)</td><td>15 minutes</td><td>4 min (continuous backup)</td></tr>`, `<tr><td>Recovery time (RTO)</td><td>4 hours</td><td>2 h 10 min (last restore test)</td></tr>`, `<tr><td>Availability</td><td>99.9%</td><td>99.97% (30 days)</td></tr>`]), '', true) };
  };
  Object.assign(ACT, {
    'pf-rotate': (d) => { const t = S().tenants.find((x) => x.id === d.t); t.keyRotated = 0; audit('kms-key-rotate', { resource: t.id }); save(); render(); toast(`${t.name}: data key rotated. Old key kept for decryption only.`); },
    'pf-restore': (d) => { const t = S().tenants.find((x) => x.id === d.t); t.backupTested = 0; audit('restore-test', { resource: t.id }); save(); render(); toast('Restore test passed in an isolated environment.'); },
    'pf-support': (d) => openModal({ title: 'Request support access', form: 'pf-support', submit: 'Send request', body: `<input type="hidden" name="t" value="${d.t}"><div class="field"><label for="ps">Ticket and reason</label><input id="ps" name="why" required placeholder="e.g. INC-4471: report service latency"></div><p class="kpi-note">The tenant administrator must approve. Access is read-only configuration, 2 hours, no patient data.</p>` })
  });
  FORMS['pf-support'] = (f) => { S().supportReq.push({ id: nid('SR'), tenant: f.t, by: me().id, why: f.why, status: 'pending', at: new Date().toISOString() }); UI.modal = null; audit('support-access-request', { resource: f.t, detail: f.why }); save(); render(); toast('Request sent to the tenant administrator.'); };
  // Tenant admin approves support access from Hospital configuration
  const baseCfg = VIEWS.config;
  VIEWS.config = (u, args) => { const v = baseCfg(u, args); const reqs = S().supportReq.filter((r) => r.tenant === SEED.org.tenant);
    if (reqs.length) v.body = panel('Platform support access', table(['Requested by', 'Reason', 'Status', ''], reqs.map((r) => `<tr><td>${esc(U(r.by).name)}<span class="sub">${timeStr(r.at)}</span></td><td>${esc(r.why)}</td><td>${statePill(r.status === 'approved' ? 'Approved' : r.status === 'denied' ? 'Denied' : 'Pending')}</td><td>${r.status === 'pending' ? `<button class="btn small primary" data-act="sr-ok" data-id="${r.id}">Approve 2 h</button> <button class="btn small" data-act="sr-no" data-id="${r.id}">Deny</button>` : ''}</td></tr>`)), '', true) + v.body;
    return v; };
  Object.assign(ACT, {
    'sr-ok': (d) => { const r = S().supportReq.find((x) => x.id === d.id); r.status = 'approved'; r.expires = new Date(Date.now() + 2 * 3600e3).toISOString(); audit('support-access-approve', { resource: r.tenant }); save(); render(); },
    'sr-no': (d) => { const r = S().supportReq.find((x) => x.id === d.id); r.status = 'denied'; audit('support-access-deny', { resource: r.tenant }); save(); render(); }
  });

  (T.notifHooks = T.notifHooks || []).push((u, add) => {
    if (u.role === 'admin') { S().supportReq.filter((r) => r.status === 'pending').forEach((r) => add('sr-' + r.id, 'warn', `Platform support access requested: ${r.why}`, '#config')); Object.entries(SEED.credentials).forEach(([id, l]) => l.filter((c) => c[2] < 0 || c[2] <= 30).forEach((c) => add(`cred-${id}-${c[0]}`, c[2] < 0 ? 'crit' : 'warn', `${U(id).name}: ${c[0]} ${c[2] < 0 ? 'expired' : `expires in ${c[2]} d`}`, '#credentials'))); }
    if (u.role === 'platform') S().tenants.filter((t) => -t.keyRotated > 365 || -t.backupTested > 30).forEach((t) => add('pf-' + t.id, 'warn', `${t.name}: ${-t.keyRotated > 365 ? 'key rotation overdue' : 'restore test overdue'}`, '#home'));
    if (SEED.credentials[u.id]) SEED.credentials[u.id].filter((c) => c[2] >= 0 && c[2] <= 30).forEach((c) => add(`mycred-${c[0]}`, 'warn', `Your ${c[0]} expires in ${c[2]} days`, '#mywork'));
  });
})(window.Tessera);
