/* Tessera Health — clinical records: OP case sheet, prescriptions, bedside risk assessments,
   medication reconciliation, discharge summary, clinical timeline, document intelligence. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, CHART, esc, clone, P, U, me, nid, pill, statePill, allergyChips, tiles, panel, table, ago, timeStr, toast, audit, careRel, openModal, render, save } = T;
  const S = () => T.S;
  const UI = T.UI;
  T.extraRoutes = Object.assign(T.extraRoutes || {}, { doctor: ['dcsum'] });

  T.inits.push((s) => {
    const fill = (k, v) => { if (s[k] === undefined) s[k] = clone(v); };
    fill('caseDrafts', {}); fill('assessments', []); fill('medrec', {}); fill('dcsum', {}); fill('docs', []);
  });

  // Live recalculation (vitals flags, calculators, Rx quantity) and select-driven pickers
  T.LIVE = T.LIVE || {}; T.CHANGE = T.CHANGE || {};
  document.addEventListener('input', (e) => { const f = e.target.closest('form[data-live]'); if (f && T.LIVE[f.dataset.live]) T.LIVE[f.dataset.live](f); });
  document.addEventListener('change', (e) => {
    const f = e.target.closest('form[data-live]'); if (f && T.LIVE[f.dataset.live]) T.LIVE[f.dataset.live](f);
    const el = e.target.closest('[data-change]'); if (el && T.CHANGE[el.dataset.change]) T.CHANGE[el.dataset.change](el.value, el, e);
  });
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const picker = (name, pts, cur) => `<div class="field" style="max-width:420px"><label for="pk-${name}">Patient</label><select id="pk-${name}" data-change="pick-${name}">${pts.map((p) => opt(p.id, `${p.name} · MRN ${p.mrn}${p.bed ? ' · ' + p.bed : ''}`, p.id === cur)).join('')}</select></div>`;
  const inpatientsFor = (u) => T.allPts().filter((p) => p.status === 'Admitted' && (u.role === 'pharmacist' || careRel(u, p)));

  /* ======================= OP case sheet ======================= */
  const VR = { sys: [90, 129, 80, 180], dia: [60, 79, 50, 120], hr: [60, 100, 40, 130], rr: [12, 20, 8, 30], temp: [97, 99.5, 95, 103], spo2: [95, 100, 90, 101], glucose: [70, 140, 54, 400] };
  const VL = { sys: 'Systolic BP', dia: 'Diastolic BP', hr: 'Heart rate', rr: 'Resp. rate', temp: 'Temp °F', spo2: 'SpO₂ %', glucose: 'Glucose mg/dL', weight: 'Weight kg' };
  function vflag(k, v) { const r = VR[k]; const x = parseFloat(v); if (!r || isNaN(x)) return ''; if (x <= r[2] || x >= r[3]) return pill('crit', 'Critical'); if (x < r[0]) return pill('warn', 'Low'); if (x > r[1]) return pill('warn', 'High'); return pill('ok', 'Normal'); }
  const ROS = ['Constitutional', 'Cardiovascular', 'Respiratory', 'Gastrointestinal', 'Genitourinary', 'Musculoskeletal', 'Neurological', 'Skin', 'Psychiatric'];
  const EXAM = ['General', 'Heart', 'Lungs', 'Abdomen', 'Extremities', 'Neuro'];
  const clinicPatients = (u) => { const ids = [...new Set(S().appts.filter((a) => a.provider === u.id).map((a) => a.patient))]; return ids.map(P).concat(T.myPatients(u).filter((p) => p.status === 'Outpatient' && !ids.includes(p.id))).filter((p) => p && careRel(u, p)); };
  VIEWS.casesheet = (u) => {
    const pts = clinicPatients(u); if (!pts.length) return { title: 'OP case sheet', body: '<p class="muted">No outpatients in your scope.</p>' };
    if (!UI.cs || !pts.some((p) => p.id === UI.cs)) UI.cs = pts[0].id;
    const p = P(UI.cs); const d = S().caseDrafts[p.id] || {}; const v = p.vitals; const [bs, bd] = String(v.bp).split('/');
    audit('view-casesheet', { patient: p });
    const val = (k, dflt) => esc(d[k] != null ? d[k] : dflt != null ? dflt : '');
    const appt = S().appts.find((a) => a.patient === p.id && a.provider === u.id);
    const vit = [['sys', bs], ['dia', bd], ['hr', v.hr], ['rr', v.rr], ['temp', v.temp], ['spo2', v.spo2], ['glucose', ''], ['weight', p.weightKg || '']].map(([k, dv]) => `<div class="field"><label for="v-${k}">${VL[k]}</label><input id="v-${k}" name="v_${k}" inputmode="decimal" value="${val('v_' + k, dv)}"><small id="vf-${k}">${vflag(k, d['v_' + k] != null ? d['v_' + k] : dv)}</small></div>`).join('');
    const ros = ROS.map((r, i) => `<div class="field"><label for="ros${i}">${r}</label><select id="ros${i}" name="ros_${i}">${['Not reviewed', 'Negative', 'Positive'].map((o) => opt(o, o, (d['ros_' + i] || 'Not reviewed') === o)).join('')}</select></div>`).join('');
    const exam = EXAM.map((x, i) => `<div class="field"><label for="ex${i}">${x}</label><input id="ex${i}" name="ex_${i}" value="${val('ex_' + i, 'Normal')}"></div>`).join('');
    const probs = p.problems.map((x, i) => `<label class="row" style="gap:8px"><input type="checkbox" name="pr_${i}" ${d['pr_' + i] !== undefined ? (d['pr_' + i] ? 'checked' : '') : i < 2 ? 'checked' : ''}> ${esc(x)}</label>`).join('');
    const bmi = p.weightKg && p.heightCm ? (p.weightKg / Math.pow(p.heightCm / 100, 2)).toFixed(1) : null;
    return { title: 'OP case sheet', sub: 'Structured outpatient consultation · vitals checked against reference ranges', body:
      picker('cs', pts, p.id) +
      `<section class="panel"><div class="body"><div class="ptheader"><div class="stack" style="gap:2px"><h2>${esc(p.name)}</h2><span class="muted">${p.age}${p.sex} · MRN ${p.mrn}${appt ? ` · ${appt.time} · ${esc(appt.reason)}` : ''}${bmi ? ` · BMI ${bmi}` : ''}</span></div><div class="chips">${allergyChips(p)}</div></div></div></section>
      <form data-form="casesheet" data-live="vitals" class="stack"><input type="hidden" name="p" value="${p.id}">
        ${panel('Presenting complaint', `<div class="field"><label for="cc">Chief complaint</label><input id="cc" name="cc" value="${val('cc', appt ? appt.reason : '')}" required></div><div class="field"><label for="hpi">History of present illness</label><textarea id="hpi" name="hpi">${val('hpi')}</textarea></div>`)}
        ${panel('Vitals', `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">${vit}</div><span class="kpi-note">Flags update as you type. Saved vitals replace the latest vitals in the chart.</span>`)}
        <div class="grid-2">${panel('Review of systems', `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${ros}</div>`)}${panel('Examination', `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${exam}</div>`)}</div>
        ${panel('Assessment', `${probs}<div class="field"><label for="nd">New diagnosis (optional, with ICD-10-CM code)</label><input id="nd" name="newdx" value="${val('newdx')}" placeholder="e.g. Supraventricular tachycardia (I47.1)"></div>`)}
        ${panel('Plan', `<div class="field"><label for="pl">Plan</label><textarea id="pl" name="plan" required>${val('plan')}</textarea></div><div class="field" style="max-width:240px"><label for="fu">Follow-up</label><select id="fu" name="fu">${['1 week', '2 weeks', '1 month', '3 months', '6 months', 'As needed'].map((o) => opt(o, o, d.fu === o)).join('')}</select></div>
          <div class="row"><button class="btn primary" type="submit" name="act" value="sign">Sign case sheet</button><button class="btn" type="submit" name="act" value="draft" formnovalidate>Save draft</button><a class="btn" href="#rx">Prescribe</a></div>`)}
      </form>` };
  };
  T.CHANGE['pick-cs'] = (v) => { UI.cs = v; render(); };
  T.LIVE.vitals = (f) => Object.keys(VR).concat(['weight']).forEach((k) => { const el = document.getElementById('vf-' + k); if (el) el.innerHTML = vflag(k, f['v_' + k] && f['v_' + k].value); });
  FORMS.casesheet = (f, form) => {
    const act = f.act || 'sign';
    const p = P(f.p);
    const data = Object.assign({}, f); delete data.act; p.problems.forEach((_, i) => { data['pr_' + i] = !!f['pr_' + i]; });
    if (act === 'draft') { S().caseDrafts[p.id] = data; save(); audit('casesheet-draft', { patient: p }); toast('Draft saved.'); return; }
    const vit = { bp: `${f.v_sys}/${f.v_dia}`, hr: +f.v_hr || p.vitals.hr, rr: +f.v_rr || p.vitals.rr, temp: +f.v_temp || p.vitals.temp, spo2: +f.v_spo2 || p.vitals.spo2 };
    const ros = ROS.map((r, i) => `${r}: ${f['ros_' + i]}`).filter((x) => !/Not reviewed/.test(x)).join('; ') || 'Not documented';
    const exam = EXAM.map((x, i) => `${x}: ${f['ex_' + i]}`).join('; ');
    const dx = p.problems.filter((_, i) => f['pr_' + i]).concat(f.newdx ? [f.newdx] : []);
    const text = `CC: ${f.cc}\nHPI: ${f.hpi || '—'}\nVitals: BP ${vit.bp}, HR ${vit.hr}, RR ${vit.rr}, T ${vit.temp} °F, SpO₂ ${vit.spo2}%${f.v_glucose ? `, glucose ${f.v_glucose} mg/dL` : ''}${f.v_weight ? `, weight ${f.v_weight} kg` : ''}\nROS: ${ros}\nExam: ${exam}\nAssessment: ${dx.join('; ') || '—'}\nPlan: ${f.plan}\nFollow-up: ${f.fu}`;
    S().notes.push({ id: nid('N'), patient: p.id, author: me().name, kind: 'OP case sheet', mOff: 0, at: new Date().toISOString(), signed: true, text, addenda: [] });
    if (T.hist) { const [sb, db] = vit.bp.split('/').map(Number); T.hist.logVitals(p, { hr: vit.hr, sbp: sb, dbp: db, rr: vit.rr, temp: vit.temp, spo2: vit.spo2 }, 'OP case sheet'); }
    T.patchPatient(p.id, Object.assign({ vitals: vit }, f.newdx ? { problems: p.problems.concat([f.newdx]) } : {}, f.v_weight ? { weightKg: +f.v_weight } : {}));
    const ap = S().appts.find((a) => a.patient === p.id && a.provider === me().id && a.status !== 'Completed'); if (ap) ap.status = 'Completed';
    delete S().caseDrafts[p.id]; audit('casesheet-sign', { patient: p }); save(); render(); toast('Case sheet signed. Vitals and assessment are in the chart.');
  };

  /* ======================= Prescriptions ======================= */
  const FREQ = { 'Once daily': 1, 'Twice daily (BID)': 2, 'Three times daily (TID)': 3, 'Four times daily (QID)': 4, 'At bedtime': 1, 'Every 4–6 h as needed': 4 };
  const isControlled = (d) => /(oxycodone|hydrocodone|morphine|lorazepam|alprazolam|tramadol|codeine)/i.test(d);
  VIEWS.rx = (u) => {
    const pts = T.myPatients(u).filter((p) => !p.unidentified);
    const list = S().erx.filter((e) => careRel(u, P(e.patient))).map((e, i) => { const p = P(e.patient); const idx = S().erx.indexOf(e);
      return `<tr><td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn}</span></td><td>${esc(e.drug)}${e.sig ? `<span class="sub">${esc(e.sig)}</span>` : ''}${e.controlled ? ' ' + pill('crit', 'EPCS') : ''}${e.override ? `<span class="sub">Override: ${esc(e.override)}</span>` : ''}</td><td class="num">${e.qty || '—'}${e.refills != null ? `<span class="sub">${e.refills} refill(s)</span>` : ''}</td><td>${esc(e.pharmacy)}</td><td>${statePill(/Cancel/.test(e.status) ? 'Discontinued' : 'Released')}<span class="sub">${esc(e.status)}</span></td><td>${/Cancel/.test(e.status) ? '' : `<button class="btn small" data-act="rx-cancel" data-i="${idx}">Cancel (CancelRx)</button>`}</td></tr>`; });
    const reqs = S().portalRequests.filter((r) => r.patient && r.state === 'Pending' && careRel(u, P(r.patient))).map((r) => `<tr><td><b>${esc(P(r.patient).name)}</b></td><td>${esc(r.drug || r.t)}</td><td>${timeStr(r.at)}</td><td><button class="btn small primary" data-act="rf-ok" data-id="${r.id}">Approve</button> <button class="btn small" data-act="rf-no" data-id="${r.id}">Deny…</button></td></tr>`);
    const last = UI.rxLast != null && S().erx[UI.rxLast] && careRel(u, P(S().erx[UI.rxLast].patient)) ? S().erx[UI.rxLast] : null;
    const card = last ? (() => { const p = P(last.patient); return `<div class="note" style="font-family:var(--mono);font-size:13px"><b>℞ Bayview Regional Medical Center</b><span>${esc(me().name)} · NPI 1234567893${last.controlled ? ' · DEA ••••4521' : ''}</span><hr style="border:0;border-top:1px solid var(--line);width:100%">
      <span>${esc(p.name)} · DOB ${p.dob}</span><b style="font-size:15px">${esc(last.drug)}</b>${last.sig ? `<span>Sig: ${esc(last.sig)}</span>` : ''}${last.qty != null ? `<span>Disp: ${last.qty} · Refills: ${last.refills || 0}${last.daw ? ' · Dispense as written' : ''}</span>` : ''}<span>Sent ${timeStr(last.at)} to ${esc(last.pharmacy)} · e-signed${last.controlled ? ' with two-factor (EPCS)' : ''}</span></div>`; })() : '<p class="muted">The most recent prescription appears here.</p>';
    return { title: 'Prescriptions', sub: 'e-Prescribing (NCPDP SCRIPT) · safety checks · refill requests', body:
      tiles([[list.length, 'Active prescriptions'], [reqs.length, 'Refill requests', reqs.length ? 'warn' : ''], [S().erx.filter((e) => e.controlled && careRel(u, P(e.patient))).length, 'Controlled (EPCS)']]) +
      (reqs.length ? panel('Refill requests from the patient portal', table(['Patient', 'Medication', 'Requested', ''], reqs), '', true) : '') +
      `<div class="grid-2">${panel('New prescription', `<form data-form="rx" data-live="rx" class="stack">
        <div class="field"><label for="rx-p">Patient</label><select id="rx-p" name="p" required>${pts.map((p) => opt(p.id, `${p.name} · MRN ${p.mrn}`, p.id === UI.rxP)).join('')}</select></div>
        <div class="field"><label for="rx-d">Drug and strength</label><input id="rx-d" name="drug" list="druglist" required placeholder="Start typing"><datalist id="druglist">${SEED.drugList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          <div class="field"><label for="rx-dose">Dose</label><input id="rx-dose" name="dose" value="1 tablet" required></div>
          <div class="field"><label for="rx-r">Route</label><select id="rx-r" name="route">${['By mouth', 'Inhaled', 'Subcutaneous', 'Topical', 'Under the tongue'].map((o) => opt(o, o)).join('')}</select></div>
          <div class="field"><label for="rx-f">Frequency</label><select id="rx-f" name="freq">${Object.keys(FREQ).map((o) => opt(o, o)).join('')}</select></div>
          <div class="field"><label for="rx-days">Days</label><input id="rx-days" name="days" type="number" min="1" max="90" value="30"></div>
          <div class="field"><label for="rx-q">Quantity</label><input id="rx-q" name="qty" type="number" min="1" value="30"><small>Calculated; edit if needed</small></div>
          <div class="field"><label for="rx-rf">Refills</label><input id="rx-rf" name="refills" type="number" min="0" max="11" value="0"></div></div>
        <div class="field"><label for="rx-ph">Pharmacy</label><select id="rx-ph" name="pharmacy"><option>Bayview Outpatient Pharmacy</option><option>Patient's preferred retail pharmacy</option><option>Mail-order pharmacy</option></select></div>
        <label class="row" style="gap:8px"><input type="checkbox" name="daw"> Dispense as written (no generic substitution)</label>
        <label class="row" style="gap:8px" id="rx-epcs" hidden><input type="checkbox" name="twofa"> Controlled substance: confirmed with my security key (DEA EPCS). PDMP checked.</label>
        <div><button class="btn primary" type="submit">Check and send</button></div></form>`)}${panel('Prescription', card)}</div>` +
      panel('Prescriptions sent', table(['Patient', 'Medication', 'Qty', 'Pharmacy', 'Status', ''], list), '', true) };
  };
  T.LIVE.rx = (f) => { const per = FREQ[f.freq.value] || 1; const days = +f.days.value || 0; if (document.activeElement !== f.qty) f.qty.value = per * days; const e = document.getElementById('rx-epcs'); if (e) e.hidden = !isControlled(f.drug.value); UI.rxP = f.p.value; };
  function sendRx(f, override) {
    const p = P(f.p); const sig = `${f.dose} ${f.route.toLowerCase()} ${f.freq.toLowerCase()} for ${f.days} days`;
    S().erx.unshift({ patient: p.id, drug: f.drug, sig, qty: +f.qty, refills: +f.refills, daw: !!f.daw, pharmacy: f.pharmacy, by: me().id, status: 'Sent (NCPDP SCRIPT)', controlled: isControlled(f.drug), override, at: new Date().toISOString() });
    UI.rxLast = 0; UI.modal = null; audit('erx-sent', { patient: p, detail: `${f.drug}${override ? ' · CDS override' : ''}${isControlled(f.drug) ? ' · EPCS' : ''}` }); save(); render(); toast('Prescription sent.');
  }
  FORMS.rx = (f) => {
    if (isControlled(f.drug) && !f.twofa) { toast('Controlled substance: confirm with your security key and the PDMP first.'); return; }
    const flag = T.cds(P(f.p), 'Medication', `${f.drug} ${f.dose}`);
    if (flag && flag.kind !== 'missing-dose') { UI.pendingRx = f; openModal({ title: 'Safety check', form: 'rx-override', submit: 'Override and send', danger: true, body: `<div class="flag"><h4>${esc(flag.kind)}: ${esc(f.drug)}</h4><p>${esc(flag.text)}</p></div><div class="field"><label for="rxo">Override reason</label><select id="rxo" name="reason" required><option value="">Choose</option><option>Benefit outweighs risk, monitoring in place</option><option>Patient tolerated this drug before</option><option>Allergy history inaccurate (update allergy list)</option></select></div>` }); return; }
    sendRx(f);
  };
  FORMS['rx-override'] = (f) => sendRx(UI.pendingRx, f.reason);
  Object.assign(ACT, {
    'rx-cancel': (d) => { const e = S().erx[+d.i]; e.status = 'Cancelled (CancelRx sent)'; audit('erx-cancel', { patient: P(e.patient), detail: e.drug }); save(); render(); },
    'rf-ok': (d) => { const r = S().portalRequests.find((x) => x.id === d.id); r.state = 'Approved'; r.note = `Sent by ${me().name}`; S().erx.unshift({ patient: r.patient, drug: r.drug, sig: 'As previously prescribed', qty: 30, refills: 0, pharmacy: "Patient's preferred retail pharmacy", by: me().id, status: 'Sent (refill)', controlled: false, at: new Date().toISOString() }); audit('refill-approve', { patient: P(r.patient), detail: r.drug }); save(); render(); toast('Refill approved and sent. The patient sees it in the portal.'); },
    'rf-no': (d) => openModal({ title: 'Deny refill', form: 'rf-no', submit: 'Deny', body: `<input type="hidden" name="id" value="${d.id}"><div class="field"><label for="rfn">Reason shown to the patient</label><select id="rfn" name="why" required><option value="">Choose</option><option>Please book a visit first; labs are due</option><option>This medicine was stopped</option><option>Your specialist manages this medicine</option></select></div>` })
  });
  FORMS['rf-no'] = (f) => { const r = S().portalRequests.find((x) => x.id === f.id); r.state = 'Denied'; r.note = f.why; UI.modal = null; audit('refill-deny', { patient: P(r.patient) }); save(); render(); };

  /* ======================= Bedside risk assessments ======================= */
  const TOOLS = {
    morse: { name: 'Morse Fall Scale', items: [['hist', 'History of falling (3 months)', [['No', 0], ['Yes', 25]]], ['sec', 'Secondary diagnosis', [['No', 0], ['Yes', 15]]], ['aid', 'Ambulatory aid', [['None / bed rest / nurse assist', 0], ['Crutches, cane, walker', 15], ['Furniture', 30]]], ['iv', 'IV or heparin lock', [['No', 0], ['Yes', 20]]], ['gait', 'Gait', [['Normal / bed rest', 0], ['Weak', 10], ['Impaired', 20]]], ['ment', 'Mental status', [['Oriented to own ability', 0], ['Forgets limitations', 15]]]],
      risk: (s) => s >= 45 ? ['crit', 'High fall risk'] : s >= 25 ? ['warn', 'Moderate fall risk'] : ['ok', 'Low fall risk'],
      act: (s) => s >= 45 ? ['Bed alarm on, bed low and locked', 'Non-slip socks, call light in reach', 'Hourly rounding', 'Yellow fall-risk wristband'] : s >= 25 ? ['Call light in reach', 'Assist with ambulation'] : ['Standard precautions'] },
    braden: { name: 'Braden Scale (pressure injury)', items: [['sens', 'Sensory perception', [['Completely limited', 1], ['Very limited', 2], ['Slightly limited', 3], ['No impairment', 4]]], ['moist', 'Moisture', [['Constantly moist', 1], ['Very moist', 2], ['Occasionally moist', 3], ['Rarely moist', 4]]], ['act', 'Activity', [['Bedfast', 1], ['Chairfast', 2], ['Walks occasionally', 3], ['Walks frequently', 4]]], ['mob', 'Mobility', [['Completely immobile', 1], ['Very limited', 2], ['Slightly limited', 3], ['No limitation', 4]]], ['nut', 'Nutrition', [['Very poor', 1], ['Probably inadequate', 2], ['Adequate', 3], ['Excellent', 4]]], ['fric', 'Friction and shear', [['Problem', 1], ['Potential problem', 2], ['No apparent problem', 3]]]],
      risk: (s) => s <= 9 ? ['crit', 'Very high risk'] : s <= 12 ? ['crit', 'High risk'] : s <= 14 ? ['warn', 'Moderate risk'] : s <= 18 ? ['warn', 'Mild risk'] : ['ok', 'No risk'],
      act: (s) => s <= 12 ? ['Reposition every 2 hours', 'Pressure-redistribution mattress', 'Heels offloaded', 'Dietitian referral'] : s <= 18 ? ['Reposition every 2–4 hours', 'Skin check each shift'] : ['Routine skin checks'] },
    padua: { name: 'Padua Prediction Score (VTE)', items: [['ca', 'Active cancer', [['No', 0], ['Yes', 3]]], ['vte', 'Previous VTE', [['No', 0], ['Yes', 3]]], ['mob', 'Reduced mobility (≥3 days)', [['No', 0], ['Yes', 3]]], ['thr', 'Known thrombophilia', [['No', 0], ['Yes', 3]]], ['surg', 'Trauma or surgery in last month', [['No', 0], ['Yes', 2]]], ['age', 'Age ≥ 70', [['No', 0], ['Yes', 1]]], ['hf', 'Heart or respiratory failure', [['No', 0], ['Yes', 1]]], ['mi', 'Acute MI or stroke', [['No', 0], ['Yes', 1]]], ['inf', 'Acute infection or rheumatologic disorder', [['No', 0], ['Yes', 1]]], ['bmi', 'Obesity (BMI ≥ 30)', [['No', 0], ['Yes', 1]]], ['horm', 'Ongoing hormonal treatment', [['No', 0], ['Yes', 1]]]],
      risk: (s) => s >= 4 ? ['crit', 'High VTE risk: prophylaxis indicated'] : ['ok', 'Low VTE risk'],
      act: (s) => s >= 4 ? ['Pharmacologic prophylaxis unless contraindicated', 'Early mobilization'] : ['Early mobilization'] }
  };
  function prefill(p) {
    const has = (re) => p.problems.some((x) => re.test(x));
    const bmi = p.weightKg && p.heightCm ? p.weightKg / Math.pow(p.heightCm / 100, 2) : 0;
    const surg = S().ot.some((c) => c.patient === p.id && c.stage !== 'Scheduled');
    return { morse: { sec: p.problems.length > 1 ? 15 : 0, iv: 20, aid: surg ? 15 : 0 }, braden: { sens: 4, moist: 4, act: surg || p.unit === 'CICU' ? 2 : 3, mob: surg ? 2 : 3, nut: 3, fric: 3 },
      padua: { ca: has(/\(C\d/) ? 3 : 0, surg: surg ? 2 : 0, age: p.age >= 70 ? 1 : 0, hf: has(/I50|failure/i) ? 1 : 0, mi: has(/I21|STEMI|stroke/i) ? 1 : 0, inf: has(/A41|sepsis|infection|J02/i) ? 1 : 0, bmi: bmi >= 30 ? 1 : 0, mob: p.unit === 'CICU' || surg ? 3 : 0 } };
  }
  const lastOf = (pid, tool) => S().assessments.filter((a) => a.patient === pid && a.tool === tool).slice(-1)[0];
  const isDue = (pid, tool) => { const l = lastOf(pid, tool); return !l || Date.now() - new Date(l.at) > 12 * 3600e3; };
  VIEWS.assess = (u) => {
    const pts = inpatientsFor(u); if (!pts.length) return { title: 'Risk assessments', body: '<p class="muted">No inpatients in your scope.</p>' };
    if (!UI.as || !pts.some((p) => p.id === UI.as)) UI.as = pts[0].id;
    const p = P(UI.as); const pre = prefill(p);
    audit('view-assessments', { patient: p });
    const overview = pts.map((x) => `<tr class="clickable" data-act="as-pick" data-p="${x.id}" ${x.id === p.id ? 'style="outline:2px solid var(--accent);outline-offset:-2px"' : ''}><td><b>${esc(x.name)}</b><span class="sub">${esc(x.bed || '')}</span></td>${Object.keys(TOOLS).map((k) => { const l = lastOf(x.id, k); return `<td>${l ? pill(TOOLS[k].risk(l.score)[0], `${l.score} · ${TOOLS[k].risk(l.score)[1].split(':')[0]}`) : ''}${isDue(x.id, k) ? `<span class="sub">${pill('warn', 'Due')}</span>` : ''}</td>`; }).join('')}</tr>`);
    const forms = Object.entries(TOOLS).map(([k, t]) => {
      const vals = pre[k] || {}; const l = lastOf(p.id, k);
      const score = t.items.reduce((n, [id, , o]) => n + (vals[id] != null ? vals[id] : o[k === 'braden' ? o.length - 1 : 0][1]), 0);
      const [cls, lab] = t.risk(score);
      return panel(t.name, `<form data-form="assess" data-live="assess" class="stack" data-tool="${k}"><input type="hidden" name="tool" value="${k}"><input type="hidden" name="p" value="${p.id}">
        ${t.items.map(([id, label, o]) => { const dv = vals[id] != null ? vals[id] : o[k === 'braden' ? o.length - 1 : 0][1]; return `<div class="field"><label for="${k}-${id}">${label}</label><select id="${k}-${id}" name="${id}">${o.map(([ol, ov]) => opt(ov, `${ol} (${ov})`, ov === dv)).join('')}</select></div>`; }).join('')}
        <div class="row between"><b>Score <span class="num" id="sc-${k}">${score}</span></b><span id="rk-${k}">${pill(cls, lab)}</span></div>
        <div class="kpi-note" id="ac-${k}">${t.act(score).map(esc).join(' · ')}</div>
        <div class="row"><button class="btn primary small" type="submit">Save assessment</button>${l ? `<span class="kpi-note">Last: ${l.score} by ${esc(l.by)}, ${timeStr(l.at)}</span>` : ''}</div></form>`, '', false);
    }).join('');
    const padua = lastOf(p.id, 'padua'); const anticoag = p.meds.some((m) => /heparin|enoxaparin|apixaban|rivaroxaban|warfarin/i.test(m.drug) && /Active/.test(m.status)) || S().orders.some((o) => o.patient === p.id && /enoxaparin|heparin/i.test(o.text) && o.status !== 'Discontinued');
    const vte = u.role === 'doctor' && padua && padua.score >= 4 && !anticoag ? `<div class="banner warn"><p>Padua ${padua.score}: VTE prophylaxis indicated and no anticoagulant is active.</p><button class="btn small primary" data-act="as-vte" data-p="${p.id}">Order enoxaparin 40 mg SC daily</button></div>` : '';
    return { title: 'Risk assessments', sub: 'Falls (Morse), pressure injury (Braden), VTE (Padua) · due every shift', body:
      panel('Inpatients', table(['Patient', 'Morse', 'Braden', 'Padua'], overview), '<span class="kpi-note">Pre-filled from the chart; confirm at the bedside</span>', true) +
      `<h2>${esc(p.name)} <span class="muted" style="font-weight:400;font-size:14px">${p.age}${p.sex} · ${esc(T.location_(p))}</span></h2>` + vte + `<div class="grid">${forms}</div>` };
  };
  T.LIVE.assess = (f) => { const k = f.tool.value; const t = TOOLS[k]; const s = t.items.reduce((n, [id]) => n + (+f[id].value || 0), 0); const [c, l] = t.risk(s);
    document.getElementById('sc-' + k).textContent = s; document.getElementById('rk-' + k).innerHTML = pill(c, l); document.getElementById('ac-' + k).textContent = t.act(s).join(' · '); };
  FORMS.assess = (f) => { const t = TOOLS[f.tool]; const score = t.items.reduce((n, [id]) => n + (+f[id] || 0), 0); const p = P(f.p);
    S().assessments.push({ patient: p.id, tool: f.tool, score, risk: t.risk(score)[1], by: me().name, at: new Date().toISOString(), interventions: t.act(score) });
    audit('risk-assessment', { patient: p, detail: `${t.name}: ${score}` }); save(); render(); toast(`${t.name} saved: ${score} (${t.risk(score)[1]}).`); };
  Object.assign(ACT, {
    'as-pick': (d) => { UI.as = d.p; render(); },
    'as-vte': (d) => { const p = P(d.p); const text = 'Enoxaparin 40 mg SC daily (VTE prophylaxis)'; const flag = T.cds(p, 'Medication', text); const o = { id: nid('O'), patient: p.id, type: 'Medication', text, priority: 'Routine', status: 'Pending signature', by: me().id }; if (flag) o.flag = flag; S().orders.unshift(o); audit('order-create', { patient: p, detail: 'VTE prophylaxis from Padua score' }); save(); render(); toast('Order queued in CPOE for your signature.'); }
  });

  /* ======================= Medication reconciliation ======================= */
  const firstWord = (s) => String(s).toLowerCase().split(/[\s-]/)[0];
  function recLines(p, kind) {
    const saved = S().medrec[p.id] && S().medrec[p.id][kind];
    if (saved && saved.lines) return saved.lines;
    if (kind === 'admission') return (SEED.homeMeds[p.id] || []).map((h) => { const m = p.meds.find((x) => firstWord(x.drug) === firstWord(h)); return { home: h, inpatient: m ? `${m.drug} ${m.dose} ${m.route} ${m.freq} (${m.status})` : '', decision: '', note: '' }; });
    const adm = (S().medrec[p.id] && S().medrec[p.id].admission && S().medrec[p.id].admission.lines) || [];
    const lines = adm.filter((l) => l.decision !== 'Stop').map((l) => ({ home: l.home, inpatient: l.inpatient, decision: '', note: l.note }));
    p.meds.filter((m) => /Active|Given/.test(m.status) && !adm.some((l) => firstWord(l.home) === firstWord(m.drug))).forEach((m) => lines.push({ home: '', inpatient: `${m.drug} ${m.dose} ${m.route} ${m.freq}`, decision: '', note: 'Started in hospital' }));
    return lines;
  }
  function recWarnings(p, lines) {
    const w = []; const txt = lines.map((l) => (l.home + ' ' + l.inpatient)).join(' ');
    if (/(ibuprofen|naproxen)/i.test(txt) && (/(warfarin|heparin|enoxaparin|clopidogrel|aspirin)/i.test(txt) || p.problems.some((x) => /N18|CKD/i.test(x)))) w.push('NSAID with an anticoagulant/antiplatelet or kidney disease: consider stopping.');
    if (/spironolactone/i.test(txt) && p.labs.some((l) => l.test === 'Potassium' && /H/.test(l.flag))) w.push('Spironolactone with high potassium.');
    return w;
  }
  VIEWS.medrec = (u) => {
    const pts = inpatientsFor(u); if (!pts.length) return { title: 'Medication reconciliation', body: '<p class="muted">No inpatients in your scope.</p>' };
    if (!UI.mr || !pts.some((p) => p.id === UI.mr)) UI.mr = pts[0].id;
    const kind = UI.mrKind || 'admission'; const p = P(UI.mr); const rec = (S().medrec[p.id] || {})[kind] || {};
    const lines = recLines(p, kind); const warns = recWarnings(p, lines);
    audit('view-medrec', { patient: p, resource: kind });
    const decisions = kind === 'admission' ? SEED.medDecisions : ['Continue at home', 'New prescription', 'Changed dose', 'Stop'];
    const done = !!rec.by;
    const rows = lines.map((l, i) => `<tr><td>${l.home ? esc(l.home) : '<span class="muted">—</span>'}</td><td>${l.inpatient ? esc(l.inpatient) : pill(kind === 'admission' ? 'warn' : '', kind === 'admission' ? 'Not ordered' : '—')}</td>
      <td><select name="d${i}" aria-label="Decision" ${done ? 'disabled' : ''}><option value="">Choose…</option>${decisions.map((o) => opt(o, o, l.decision === o)).join('')}</select></td><td><input name="n${i}" value="${esc(l.note || '')}" aria-label="Note" ${done ? 'disabled' : ''}></td></tr>`);
    const summary = S().medrec[p.id] || {};
    return { title: 'Medication reconciliation', sub: 'Home medicines vs hospital orders at admission and discharge (Joint Commission NPSG.03.06.01)', body:
      picker('mr', pts, p.id) +
      `<div class="row"><button class="btn ${kind === 'admission' ? 'primary' : ''}" data-act="mr-kind" data-k="admission">Admission ${summary.admission && summary.admission.by ? '✓' : ''}</button><button class="btn ${kind === 'discharge' ? 'primary' : ''}" data-act="mr-kind" data-k="discharge">Discharge ${summary.discharge && summary.discharge.by ? '✓' : ''}</button><div class="chips">${allergyChips(p)}</div></div>` +
      warns.map((x) => `<div class="flag warn"><h4>Check</h4><p>${esc(x)}</p></div>`).join('') +
      panel(`${kind === 'admission' ? 'Admission' : 'Discharge'} reconciliation · ${esc(p.name)}`, `<form data-form="medrec" class="stack"><input type="hidden" name="p" value="${p.id}"><input type="hidden" name="kind" value="${kind}">
        <div class="tbl"><table class="t"><thead><tr><th>${kind === 'admission' ? 'Home medicine (patient report)' : 'Before admission'}</th><th>${kind === 'admission' ? 'Hospital order' : 'In hospital'}</th><th>Decision</th><th>Note</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4" class="muted">No medicines listed.</td></tr>'}</tbody></table></div>
        ${done ? `<div class="banner ok"><p>Completed by ${esc(rec.by)} ${timeStr(rec.at)}${rec.verifiedBy ? ` · verified by ${esc(rec.verifiedBy)}` : ''}.</p></div>` : `${kind === 'admission' ? '<div class="row"><input class="search" name="addhome" placeholder="Add a home medicine the patient reports" aria-label="Add home medicine"><button class="btn small" type="submit" name="act" value="add">Add</button></div>' : ''}
        <div class="row">${u.role === 'doctor' ? '<button class="btn primary" type="submit" name="act" value="complete">Complete reconciliation</button>' : ''}<button class="btn" type="submit" name="act" value="save">Save progress</button></div>`}
        ${done && !rec.verifiedBy && u.role === 'pharmacist' ? `<div><button class="btn primary" type="button" data-act="mr-verify" data-p="${p.id}" data-k="${kind}">Pharmacist verify</button></div>` : ''}
      </form>`) };
  };
  T.CHANGE['pick-mr'] = (v) => { UI.mr = v; render(); };
  ACT['mr-kind'] = (d) => { UI.mrKind = d.k; render(); };
  ACT['mr-verify'] = (d) => { const r = S().medrec[d.p][d.k]; r.verifiedBy = me().name; audit('medrec-verify', { patient: P(d.p), resource: d.k }); save(); render(); toast('Reconciliation verified by pharmacy.'); };
  FORMS.medrec = (f) => {
    const act = f.act || 'save';
    const p = P(f.p); const lines = recLines(p, f.kind).map((l, i) => Object.assign({}, l, { decision: f['d' + i] || l.decision, note: f['n' + i] != null ? f['n' + i] : l.note }));
    if (act === 'add' && f.addhome) lines.push({ home: f.addhome, inpatient: '', decision: '', note: 'Added from patient interview' });
    S().medrec[p.id] = S().medrec[p.id] || {};
    const rec = S().medrec[p.id][f.kind] = Object.assign(S().medrec[p.id][f.kind] || {}, { lines });
    if (act === 'complete') { if (lines.some((l) => !l.decision)) { toast('Every line needs a decision before you complete.'); save(); render(); return; } rec.by = me().name; rec.at = new Date().toISOString(); audit('medrec-complete', { patient: p, resource: f.kind }); toast('Reconciliation complete. Pharmacy can verify it.'); }
    save(); render();
  };

  /* ======================= Discharge summary ======================= */
  const RETURN = [[/STEMI|NSTEMI|I21|coronary|angina/i, 'Call 911 for chest pain or pressure lasting more than 5 minutes, fainting, or severe shortness of breath.'], [/append|K35|abscess|surgery|arthroplasty/i, 'Call us for fever over 101 °F, redness or drainage from the wound, or pain that keeps getting worse.'], [/heart failure|I50/i, 'Weigh yourself every morning. Call us if you gain more than 3 pounds in a day or 5 pounds in a week.'], [/sepsis|A41/i, 'Call us for fever, chills, confusion, or feeling very unwell.']];
  function draftSummary(d, p) {
    const ot = S().ot.filter((c) => c.patient === p.id && c.stage !== 'Scheduled').map((c) => `${c.procedure} (CPT ${c.cpt}), ${c.stage.toLowerCase()}`);
    const img = S().radOrders.filter((o) => o.patient === p.id && o.report && o.status === 'Reported').map((o) => `${o.study}: ${o.report.impression}`);
    const labs = p.labs.filter((l) => l.flag).map((l) => `${l.test} ${l.value} ${l.unit} (${l.flag})`).concat(S().labOrders.filter((o) => o.patient === p.id && o.status === 'Released' && o.flag).map((o) => `${o.test} ${o.value} ${o.unit} (${o.flag})`));
    const notes = S().notes.filter((n) => n.patient === p.id && n.signed).map((n) => n.text.split('\n')[0].replace(/^[A-Z]+:\s*/, ''));
    const dm = (S().medrec[p.id] && S().medrec[p.id].discharge && S().medrec[p.id].discharge.by) ? S().medrec[p.id].discharge.lines.filter((l) => l.decision !== 'Stop').map((l) => `${l.home || l.inpatient} — ${l.decision}${l.note ? ' (' + l.note + ')' : ''}`) : null;
    const stopped = dm ? S().medrec[p.id].discharge.lines.filter((l) => l.decision === 'Stop').map((l) => l.home || l.inpatient) : [];
    const ret = RETURN.filter(([re]) => p.problems.some((x) => re.test(x))).map((r) => r[1]);
    return {
      diagnosis: p.problems.slice(0, 3).join('; '),
      course: `${p.age}-year-old ${p.sex === 'M' ? 'man' : 'woman'} admitted with ${p.problems[0].split(' (')[0].toLowerCase()}. ${ot.length ? 'Underwent ' + ot.join('; ') + '. ' : ''}${notes.slice(0, 2).join(' ')}`.trim(),
      procedures: ot.concat(img).join('\n') || 'None',
      results: labs.join('\n') || 'No abnormal results',
      meds: dm ? dm.join('\n') + (stopped.length ? `\nSTOP: ${stopped.join(', ')}` : '') : '',
      followup: d.followUp.join('\n'),
      instructions: `You were in the hospital for ${p.problems[0].split(' (')[0].toLowerCase()}.\n• Take your medicines exactly as listed on this page.${stopped.length ? `\n• Stop taking: ${stopped.join(', ')}.` : ''}\n• ${d.followUp.join('\n• ')}\n${ret.map((r) => '• ' + r).join('\n') || '• Call us if you feel worse or have new symptoms.'}`
    };
  }
  VIEWS.dcsum = (u, args) => {
    const d = S().discharges.find((x) => x.id === args.join('-')); // ids contain hyphens; the router splits on them if (!d) return { title: 'Discharge summary', body: '<p class="muted">Not found.</p>' };
    const p = P(d.patient); if (!careRel(u, p)) { audit('chart-access', { patient: p, outcome: 'denied', detail: 'discharge summary outside scope' }); return { title: 'Access denied', body: '<div class="banner crit"><p>This patient is outside your care scope.</p></div>' }; }
    audit('view-dcsummary', { patient: p });
    const saved = S().dcsum[d.id]; const g = Object.assign(draftSummary(d, p), saved || {});
    const recDone = S().medrec[p.id] && S().medrec[p.id].discharge && S().medrec[p.id].discharge.by;
    const signed = saved && saved.signedBy;
    const ta = (k, label, rows = 3) => `<div class="field"><label for="ds-${k}">${label}</label><textarea id="ds-${k}" name="${k}" style="min-height:${rows * 22}px" ${signed ? 'readonly' : ''}>${esc(g[k])}</textarea></div>`;
    return { title: 'Discharge summary', sub: `${esc(p.name)} · MRN ${p.mrn} · ${esc(T.location_(p))}`, body:
      (!recDone ? `<div class="banner crit"><p><b>Discharge medication reconciliation isn't done.</b> The summary can't be signed until it is (Joint Commission NPSG.03.06.01).</p><button class="btn small" data-act="ds-medrec" data-p="${p.id}">Reconcile discharge medicines</button></div>` : '') +
      (signed ? `<div class="banner ok"><p>Signed by ${esc(saved.signedBy)} ${timeStr(saved.at)}. Patient instructions are in the patient portal.</p></div>` : '') +
      `<form data-form="dcsum" class="stack"><input type="hidden" name="d" value="${d.id}">
        ${panel('Clinical summary', ta('diagnosis', 'Discharge diagnoses', 2) + ta('course', 'Hospital course', 4) + ta('procedures', 'Procedures and imaging', 3) + ta('results', 'Key results', 3) + ta('meds', 'Discharge medications (from reconciliation)', 4) + ta('followup', 'Follow-up', 2))}
        ${panel('Patient instructions (plain language)', ta('instructions', 'Shown to the patient in the portal', 6) + (T.caps && T.caps.sample && !signed ? '<div><button class="btn small" type="button" data-act="ds-plain">Rewrite at a 6th-grade reading level with Claude</button></div>' : ''))}
        ${signed ? '' : `<div class="row"><button class="btn primary" type="submit" name="act" value="sign" ${recDone ? '' : 'disabled'}>Sign summary</button><button class="btn" type="submit" name="act" value="save" formnovalidate>Save draft</button><a class="btn" href="#discharge">Back to discharge</a></div>`}
      </form>` };
  };
  ACT['ds-medrec'] = (d) => { UI.mr = d.p; UI.mrKind = 'discharge'; location.hash = 'medrec'; };
  ACT['ds-plain'] = async (d, el) => {
    const ta = document.getElementById('ds-instructions'); if (!ta || !T.caps.sample) return;
    el.disabled = true; el.textContent = 'Rewriting…';
    try { const { text } = await T.caps.sample(`Rewrite these hospital discharge instructions for a patient at a 6th-grade reading level. Keep every instruction and warning, keep bullet points, add nothing new. Fictional demo patient.\n\n${ta.value}`, { cache: false }); ta.value = text.trim(); toast('Rewritten. Check it before signing.'); }
    catch (e) { toast(e && e.code === 'not_granted' ? 'Claude isn\'t allowed for this page.' : 'Rewrite failed. Try again.'); }
    el.disabled = false; el.textContent = 'Rewrite at a 6th-grade reading level with Claude';
  };
  FORMS.dcsum = (f) => {
    const act = f.act || 'save';
    const d = S().discharges.find((x) => x.id === f.d); const p = P(d.patient);
    const body = { diagnosis: f.diagnosis, course: f.course, procedures: f.procedures, results: f.results, meds: f.meds, followup: f.followup, instructions: f.instructions };
    S().dcsum[d.id] = Object.assign(S().dcsum[d.id] || {}, body);
    if (act === 'sign') {
      Object.assign(S().dcsum[d.id], { signedBy: me().name, at: new Date().toISOString(), patient: p.id });
      const st = d.steps.find((s) => s.owner === 'doctor'); if (st) { st.state = 'Done'; st.by = me().name; }
      S().notes.push({ id: nid('N'), patient: p.id, author: me().name, kind: 'Discharge summary', mOff: 0, at: new Date().toISOString(), signed: true, text: `Diagnoses: ${f.diagnosis}\nCourse: ${f.course}\nMedications:\n${f.meds}\nFollow-up: ${f.followup}`, addenda: [] });
      audit('dcsummary-sign', { patient: p }); toast('Summary signed. The physician discharge step is complete.');
    } else { audit('dcsummary-draft', { patient: p }); toast('Draft saved.'); }
    save(); render();
  };
  // Discharge instructions in the patient portal
  const basePortalHome = T.HOME.patient;
  if (basePortalHome) T.HOME.patient = (u) => { const v = basePortalHome(u); const ds = Object.values(S().dcsum).find((x) => x.patient === u.patientId && x.signedBy); if (ds) v.body += panel('Your discharge instructions', `<pre style="white-space:pre-wrap;font-family:var(--sans);margin:0">${esc(ds.instructions)}</pre><span class="kpi-note">From ${esc(ds.signedBy)}</span>`); return v; };

  /* ======================= Clinical timeline (chart tab) ======================= */
  const TL_TYPES = ['All', 'Encounters', 'Notes', 'Orders', 'Results', 'Imaging', 'Procedures', 'Medications', 'Assessments', 'Consents', 'Records'];
  function timelineEvents(p) {
    const now = Date.now(); const ev = []; const add = (ts, type, text, who) => ev.push({ ts: typeof ts === 'number' ? ts : new Date(ts).getTime(), type, text, who: who || '' });
    const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); d.setHours(8, 0, 0, 0); return d.getTime(); };
    const today = (hm) => { const d = new Date(); const [h, m] = hm.split(':'); d.setHours(+h, +m, 0, 0); return d.getTime(); };
    (S().er || []).filter((e) => e.patient === p.id).forEach((e) => { add(now - e.mOff * 60000, 'Encounters', `Arrived at ER (${e.arrival}): ${e.complaint}`); if (e.triagedOff != null) add(now - e.triagedOff * 60000, 'Encounters', `Triaged ESI ${e.esi}`); });
    S().appts.filter((a) => a.patient === p.id).forEach((a) => add(today(a.time), 'Encounters', `Clinic visit: ${a.reason} (${a.status})`, U(a.provider).name));
    (S().tele || []).filter((t) => t.patient === p.id && /Today/.test(t.when)).forEach((t) => add(today(t.when.replace('Today ', '')), 'Encounters', `Video visit: ${t.reason} (${t.status})`, U(t.provider).name));
    S().notes.filter((n) => n.patient === p.id).forEach((n) => add(n.at || now - n.mOff * 60000, 'Notes', `${n.kind}${n.signed ? '' : ' (draft)'}: ${n.text.split('\n')[0].slice(0, 110)}`, n.author));
    S().orders.filter((o) => o.patient === p.id).forEach((o) => add(o.at || now - 90 * 60000, 'Orders', `${o.type}: ${o.text} — ${o.status}`, U(o.by) ? U(o.by).name : ''));
    p.labs.forEach((l) => add(day(l.dOff), 'Results', `${l.test} ${l.value} ${l.unit}${l.flag ? ' (' + l.flag + ')' : ''}${l.outside ? ' · outside record' : ''}`));
    (S().labOrders || []).filter((o) => o.patient === p.id && o.status === 'Released').forEach((o) => add(now - o.mOff * 60000 + 20 * 60000, 'Results', `${o.test} ${o.value} ${o.unit}${o.flag ? ' (' + o.flag + ')' : ''}`, o.releasedBy));
    (S().results || []).filter((r) => r.patient === p.id).forEach((r) => add(now - r.mOff * 60000, 'Results', `Critical: ${r.test} ${r.value} — ${r.state}`));
    (S().radOrders || []).filter((o) => o.patient === p.id).forEach((o) => add(now - o.mOff * 60000, 'Imaging', `${o.study} — ${o.status}${o.report && o.status === 'Reported' ? ': ' + o.report.impression : ''}`, o.report ? o.report.by : ''));
    (S().ot || []).filter((c) => c.patient === p.id).forEach((c) => add(today(c.scheduled), 'Procedures', `${c.procedure} in ${c.room} — ${c.stage}`, U(c.surgeon).name));
    (S().daycare || []).filter((x) => x.patient === p.id).forEach((x) => add(now - x.mOff * 60000, 'Procedures', `${x.procedure} — ${x.phase}`));
    Object.entries(S().mar || {}).filter(([k]) => k.startsWith(p.id + '|')).forEach(([k, v]) => { const [, drug, t] = k.split('|'); add(v.at || today(t), 'Medications', `${drug}: ${v.state}${v.note ? ' — ' + v.note : ''}`, v.by); });
    (S().erx || []).filter((e) => e.patient === p.id).forEach((e) => add(e.at || now - 180 * 60000, 'Medications', `Prescription: ${e.drug} — ${e.status}`));
    (S().assessments || []).filter((a) => a.patient === p.id).forEach((a) => add(a.at, 'Assessments', `${TOOLS[a.tool].name}: ${a.score} (${a.risk})`, a.by));
    Object.entries(S().medrec[p.id] || {}).forEach(([k, r]) => { if (r.by) add(r.at, 'Medications', `${k === 'admission' ? 'Admission' : 'Discharge'} medication reconciliation completed${r.verifiedBy ? ', verified by ' + r.verifiedBy : ''}`, r.by); });
    (S().consents || []).filter((c) => c.patient === p.id).forEach((c) => add(c.at, 'Consents', `${c.kind}: ${c.state}`, c.by));
    (S().docs || []).filter((d) => d.patient === p.id && d.status === 'Filed').forEach((d) => add(d.filedAt, 'Records', `Outside record filed: ${d.title}`, d.by));
    (S().discharges || []).filter((d) => d.patient === p.id).forEach((d) => add(now - d.decidedOff * 60000, 'Encounters', 'Discharge decision', U(d.by).name));
    return ev.filter((e) => !isNaN(e.ts)).sort((a, b) => b.ts - a.ts);
  }
  const TL_CLS = { Encounters: 'info', Notes: 'accent', Orders: '', Results: 'warn', Imaging: 'info', Procedures: 'accent', Medications: 'ok', Assessments: 'warn', Consents: '', Records: 'info' };
  CHART.timeline = (u, p) => {
    const f = UI.tl || 'All'; const all = timelineEvents(p); const list = f === 'All' ? all : all.filter((e) => e.type === f);
    let lastDay = '';
    const rows = list.map((e) => { const d = new Date(e.ts); const dayLabel = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); const head = dayLabel !== lastDay ? `<tr><td colspan="3" style="background:var(--surface-2);font-weight:600">${dayLabel}</td></tr>` : ''; lastDay = dayLabel;
      return head + `<tr><td class="mono" style="white-space:nowrap">${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td><td>${pill(TL_CLS[e.type], e.type)}</td><td>${esc(e.text)}${e.who ? `<span class="sub">${esc(e.who)}</span>` : ''}</td></tr>`; }).join('');
    return `<div class="chips">${TL_TYPES.map((t) => `<button class="btn small ${t === f ? 'primary' : ''}" data-act="tl-filter" data-t="${t}">${t} ${t === 'All' ? all.length : all.filter((e) => e.type === t).length}</button>`).join('')}</div>` +
      panel('Clinical timeline', `<div class="tbl"><table class="t"><tbody>${rows || '<tr><td class="muted">No events.</td></tr>'}</tbody></table></div>`, '<span class="kpi-note">Every source in one place, newest first</span>', true);
  };
  ACT['tl-filter'] = (d) => { UI.tl = d.t; render(); };

  /* ======================= Document intelligence ======================= */
  function parseIdentity(text) {
    const name = (text.match(/(?:Patient|Re|Name)\s*:\s*([A-Za-z][A-Za-z .'-]+?)(?:\s{2,}|\s+DOB|\n|$)/i) || [])[1];
    const dob = (text.match(/DOB\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i) || []);
    return { name: name ? name.trim() : '', dob: dob[3] ? `${dob[3]}-${dob[1].padStart(2, '0')}-${dob[2].padStart(2, '0')}` : '' };
  }
  function matchIdentity(id) {
    const byName = T.allPts().filter((p) => id.name && p.name.toLowerCase() === id.name.toLowerCase());
    const exact = byName.find((p) => p.dob === id.dob);
    if (exact) return { status: 'Matched', patient: exact.id, why: 'Name and date of birth match one record' };
    if (byName.length) return { status: 'Quarantined', candidate: byName[0].id, why: `Name matches ${byName[0].name} (MRN ${byName[0].mrn}) but date of birth ${id.dob || 'missing'} doesn't match ${byName[0].dob}` };
    return { status: 'Quarantined', why: id.name ? `No patient named ${id.name} with that date of birth` : 'No patient name or date of birth found in the document' };
  }
  function offlineExtract(text) {
    const sec = (re) => { const m = text.match(new RegExp(`${re}[^\\n]*\\n([\\s\\S]*?)(?:\\n\\s*\\n|$)`, 'i')); return m ? m[1].split('\n').map((x) => x.replace(/^\s*(?:\d+\.|-)\s*/, '').trim()).filter(Boolean) : []; };
    const dx = sec('DIAGNOSES').map((x) => { const m = x.match(/^(.*?)\s*\(([A-Z]\d[\w.]*)\)/); return m ? { code: m[2], desc: m[1].trim() } : { code: '', desc: x }; });
    const meds = sec('(?:DISCHARGE )?MEDICATIONS');
    const allergies = sec('ALLERGIES').map((x) => /no known/i.test(x) ? { agent: 'NKDA', reaction: '' } : { agent: x.split(':')[0].trim(), reaction: (x.split(':')[1] || '').trim() });
    const labs = sec('(?:KEY )?RESULTS').map((x) => { const m = x.match(/^(.+?)\s+([\d.]+)\s*([^\s(]*)\s*(?:\((high|low)[^)]*\))?/i); return m ? { test: m[1].trim(), value: m[2], unit: m[3] || '', flag: m[4] ? (/high/i.test(m[4]) ? 'H' : 'L') : '' } : null; }).filter(Boolean);
    return { diagnoses: dx, medications: meds, allergies, labs };
  }
  const EXTRACT_PROMPT = (text) => `Extract structured clinical data from this outside medical record so a clinician can review it. The record is fictional demo data. Use only what is written; never infer.
Return only JSON: {"patientName": "", "dob": "YYYY-MM-DD or empty", "diagnoses": [{"code": "ICD-10-CM code or empty", "desc": ""}], "medications": ["drug dose route frequency"], "allergies": [{"agent": "", "reaction": ""}], "labs": [{"test": "", "value": "", "unit": "", "flag": "H, L or empty"}]}
If the record states no known drug allergies, return allergies as [{"agent": "NKDA", "reaction": ""}].
${text ? '\nRECORD:\n' + text.slice(0, 20000) : '\nThe record is in the attached image.'}`;
  function classify(p, x) {
    if (x.kind === 'dx') return p.problems.some((pr) => (x.code && pr.includes(x.code)) || pr.toLowerCase().includes(x.desc.toLowerCase().split(',')[0])) ? 'In chart' : 'New';
    if (x.kind === 'med') return p.meds.some((m) => firstWord(m.drug) === firstWord(x.text)) || (SEED.homeMeds[p.id] || []).some((h) => firstWord(h) === firstWord(x.text)) ? 'In chart' : 'New';
    if (x.kind === 'allergy') { if (x.agent === 'NKDA') return p.allergies.length ? 'Conflict' : 'In chart'; return p.allergies.some((a) => firstWord(a.agent) === firstWord(x.agent)) ? 'In chart' : 'New'; }
    if (x.kind === 'lab') return p.labs.some((l) => l.test.toLowerCase() === x.test.toLowerCase() && l.value === x.value) ? 'In chart' : 'New';
    return 'New';
  }
  async function processDoc(doc) {
    doc.status = 'Processing'; save(); render();
    let ex = null; let id = parseIdentity(doc.text || '');
    if (T.caps && T.caps.sample) {
      try { const j = await T.caps.sample.json(EXTRACT_PROMPT(doc.text), Object.assign({ cache: false }, doc.blob ? { images: [doc.blob] } : {})); ex = { diagnoses: j.diagnoses || [], medications: j.medications || [], allergies: j.allergies || [], labs: j.labs || [] }; doc.engine = 'Claude'; if (!id.name && j.patientName) id = { name: j.patientName, dob: j.dob || '' }; }
      catch (e) { doc.engineNote = e && e.code === 'not_granted' ? 'Claude isn\'t allowed for this page; used rules instead.' : 'Claude extraction failed; used rules instead.'; }
    }
    if (!ex) { if (!doc.text) { doc.status = 'Failed'; doc.why = 'Images need Claude (use the published link).'; save(); render(); return; } ex = offlineExtract(doc.text); doc.engine = 'Rules'; }
    doc.identity = id;
    const m = matchIdentity(id); doc.status = m.status; doc.patient = m.patient || null; doc.candidate = m.candidate || null; doc.why = m.why;
    doc.items = [].concat(ex.diagnoses.map((x) => ({ kind: 'dx', code: x.code || '', desc: x.desc || '' })), ex.medications.map((x) => ({ kind: 'med', text: String(x) })), ex.allergies.map((x) => ({ kind: 'allergy', agent: x.agent || '', reaction: x.reaction || '' })), ex.labs.map((x) => ({ kind: 'lab', test: x.test, value: String(x.value), unit: x.unit || '', flag: x.flag || '' })));
    if (doc.patient) doc.items.forEach((x) => { x.state = classify(P(doc.patient), x); });
    audit('outside-record-processed', { patient: doc.patient ? P(doc.patient) : undefined, detail: `${doc.title}: ${doc.status} (${doc.engine})` });
    if (UI.di === doc.id || !UI.di) UI.di = doc.id;
    save(); render();
  }
  function intake(o) { const doc = Object.assign({ id: nid('DOC'), at: new Date().toISOString(), by: me().name, status: 'Received' }, o); S().docs.unshift(doc); UI.di = doc.id; audit('outside-record-intake', { detail: doc.title }); processDoc(doc); }
  const itemLabel = (x) => x.kind === 'dx' ? `${x.desc}${x.code ? ` (${x.code})` : ''}` : x.kind === 'med' ? x.text : x.kind === 'allergy' ? (x.agent === 'NKDA' ? 'No known drug allergies' : `${x.agent}${x.reaction ? ': ' + x.reaction : ''}`) : `${x.test} ${x.value} ${x.unit}${x.flag ? ' (' + x.flag + ')' : ''}`;
  const KIND = { dx: 'Diagnosis', med: 'Medication', allergy: 'Allergy', lab: 'Lab' };
  VIEWS.docintel = (u) => {
    const docs = S().docs.filter((d) => d.by === u.name || (d.patient && careRel(u, P(d.patient))));
    const pts = T.myPatients(u).filter((p) => !p.unidentified);
    const doc = docs.find((d) => d.id === UI.di);
    const qrows = docs.map((d) => `<tr class="clickable" data-act="di-sel" data-id="${d.id}" ${d.id === UI.di ? 'style="outline:2px solid var(--accent);outline-offset:-2px"' : ''}><td><b>${esc(d.title)}</b><span class="sub">${esc(d.source || '')}</span></td><td>${d.patient ? esc(P(d.patient).name) : '<span class="muted">Unassigned</span>'}</td><td>${pill(d.status === 'Filed' ? 'ok' : d.status === 'Matched' ? 'accent' : d.status === 'Quarantined' || d.status === 'Failed' ? 'crit' : 'warn', d.status)}<span class="sub">${esc(d.engine || '')}</span></td></tr>`);
    let detail = '<p class="muted">Load a sample record, paste text, upload a file, or query the network for a patient.</p>';
    if (doc) {
      const p = doc.patient && P(doc.patient);
      const items = (doc.items || []).map((x, i) => `<tr><td>${KIND[x.kind]}</td><td>${esc(itemLabel(x))}</td><td>${x.state ? pill(x.state === 'New' ? 'info' : x.state === 'Conflict' ? 'crit' : 'ok', x.state) : ''}</td><td>${doc.status === 'Matched' ? `<input type="checkbox" name="i${i}" aria-label="Accept" ${x.state === 'New' ? 'checked' : ''} ${x.state === 'In chart' ? 'disabled' : ''}>` : x.accepted ? pill('ok', 'Filed') : ''}</td></tr>`).join('');
      detail = `<div class="stack"><div class="row between"><h3>${esc(doc.title)}</h3>${pill(doc.status === 'Filed' ? 'ok' : doc.status === 'Quarantined' || doc.status === 'Failed' ? 'crit' : 'accent', doc.status)}</div>
        ${doc.engineNote ? `<div class="banner info"><p>${esc(doc.engineNote)}</p></div>` : ''}
        <dl class="kv" style="margin:0"><div><dt>Name in document</dt><dd style="margin:0">${esc((doc.identity || {}).name || '—')}</dd></div><div><dt>DOB in document</dt><dd style="margin:0">${esc((doc.identity || {}).dob || '—')}</dd></div><div><dt>Matched to</dt><dd style="margin:0">${p ? `${esc(p.name)} · MRN ${p.mrn}` : '—'}</dd></div><div><dt>Extraction</dt><dd style="margin:0">${esc(doc.engine || '—')}</dd></div></dl>
        ${doc.status === 'Quarantined' ? `<div class="banner crit"><p><b>Identity not confirmed.</b> ${esc(doc.why)}. Nothing is filed until a person confirms the match.</p></div>
          <form data-form="di-resolve" class="row"><input type="hidden" name="id" value="${doc.id}"><select name="p" aria-label="Patient" required><option value="">Match to patient…</option>${pts.map((x) => opt(x.id, `${x.name} · DOB ${x.dob}`, x.id === doc.candidate)).join('')}</select><input class="search" name="why" required placeholder="Why this is the same person" aria-label="Reason"><button class="btn small" type="submit">Confirm match</button><button class="btn small danger" type="button" data-act="di-reject" data-id="${doc.id}">Reject document</button></form>` : ''}
        ${doc.items && doc.items.length ? `<form data-form="di-file" class="stack"><input type="hidden" name="id" value="${doc.id}">${table(['Type', 'Extracted', 'Chart check', doc.status === 'Matched' ? 'File' : ''], [items])}
          ${doc.items.some((x) => x.state === 'Conflict') ? '<div class="flag"><h4>Conflict</h4><p>The outside record says no known drug allergies, but this chart lists allergies. The chart list is kept; review with the patient.</p></div>' : ''}
          ${doc.status === 'Matched' ? '<div><button class="btn primary" type="submit">File selected items to the chart</button></div>' : ''}</form>` : ''}
        <details><summary class="linkbtn">Source text</summary><pre style="white-space:pre-wrap;font-size:12.5px">${esc(doc.text || '(image)')}</pre></details></div>`;
    }
    return { title: 'Document intelligence', sub: 'Outside records → identity check → extraction → clinician review → filed', body:
      tiles([[docs.length, 'Documents'], [docs.filter((d) => d.status === 'Matched').length, 'Ready to review', 'warn'], [docs.filter((d) => d.status === 'Quarantined').length, 'Quarantined (identity)', 'crit'], [docs.filter((d) => d.status === 'Filed').length, 'Filed', 'ok']]) +
      `<div class="grid-2">${panel('Add a document', `<div class="stack"><div class="row">${SEED.outsideDocs.map((d) => `<button class="btn small" data-act="di-sample" data-id="${d.id}">Sample: ${esc(d.kind)}${d.id === 'OD-3' ? ' (DOB typo)' : ''}</button>`).join('')}</div>
        <div class="field"><label for="di-file">Upload (.txt, or an image on the published link)</label><input id="di-file" type="file" accept=".txt,text/plain,image/png,image/jpeg,image/webp" data-change="di-upload"></div>
        <form data-form="di-paste" class="stack"><div class="field"><label for="di-t">Or paste text</label><textarea id="di-t" name="text" required placeholder="Patient: …  DOB: MM/DD/YYYY …"></textarea></div><div><button class="btn small" type="submit">Process text</button></div></form>
        <form data-form="di-hie" class="row"><select name="p" aria-label="Patient for network query" required>${pts.map((x) => opt(x.id, `${x.name} · MRN ${x.mrn}`)).join('')}</select><button class="btn small" type="submit">Query outside records (TEFCA, simulated)</button></form>
        <span class="kpi-note">${T.caps && T.caps.sample ? 'Extraction runs on Claude.' : 'Running without Claude here, so extraction uses rules (text only).'} Records go through identity matching before anything is filed.</span></div>`)}
      ${panel('Queue', table(['Document', 'Patient', 'Status'], qrows), '', true)}</div>` + panel('Review', detail) };
  };
  Object.assign(ACT, {
    'di-sel': (d) => { UI.di = d.id; render(); },
    'di-sample': (d) => { const s = SEED.outsideDocs.find((x) => x.id === d.id); intake({ title: s.title, source: s.source, text: s.text }); },
    'di-reject': (d) => { const doc = S().docs.find((x) => x.id === d.id); doc.status = 'Rejected'; doc.items = []; audit('outside-record-reject', { detail: doc.title }); save(); render(); }
  });
  T.CHANGE['di-upload'] = (v, el) => { const file = el.files && el.files[0]; if (!file) return; if (/^image\//.test(file.type)) { intake({ title: file.name, source: 'Upload (image)', text: '', blob: file }); } else { const r = new FileReader(); r.onload = () => intake({ title: file.name, source: 'Upload', text: String(r.result) }); r.readAsText(file); } el.value = ''; };
  Object.assign(FORMS, {
    'di-paste'(f) { intake({ title: 'Pasted record', source: 'Pasted text', text: f.text }); },
    'di-hie'(f) { const p = P(f.p); const ids = SEED.hieResults[p.id] || []; audit('hie-query', { patient: p, detail: `${ids.length} document(s)` }); if (!ids.length) { toast(`No outside records found for ${p.name}.`); return; } ids.forEach((id) => { const s = SEED.outsideDocs.find((x) => x.id === id); intake({ title: s.title, source: 'TEFCA query (simulated): ' + s.source, text: s.text }); }); toast(`${ids.length} outside record(s) received for ${p.name}.`); },
    'di-resolve'(f) { const doc = S().docs.find((x) => x.id === f.id); doc.status = 'Matched'; doc.patient = f.p; doc.why = `Matched manually by ${me().name}: ${f.why}`; doc.items.forEach((x) => { x.state = classify(P(f.p), x); }); audit('mpi-manual-match', { patient: P(f.p), detail: f.why }); save(); render(); },
    'di-file'(f) {
      const doc = S().docs.find((x) => x.id === f.id); const p = P(doc.patient); const src = doc.source || 'outside record';
      const pick = doc.items.map((x, i) => [x, !!f['i' + i]]).filter(([x, on]) => on && x.state !== 'In chart').map(([x]) => x);
      const upd = { problems: p.problems.slice(), meds: p.meds.slice(), allergies: p.allergies.slice(), labs: p.labs.slice() };
      pick.forEach((x) => { x.accepted = true;
        if (x.kind === 'dx') upd.problems.push(`${x.desc}${x.code ? ` (${x.code})` : ''} — outside record`);
        if (x.kind === 'med') upd.meds.push({ drug: x.text, dose: '', route: '', freq: '', status: 'Outside record — reconcile' });
        if (x.kind === 'allergy' && x.agent !== 'NKDA') upd.allergies.push({ agent: x.agent, reaction: x.reaction || 'Unknown', severity: 'Moderate' });
        if (x.kind === 'lab') upd.labs.push({ test: x.test, loinc: '—', value: x.value, unit: x.unit, ref: 'outside', flag: x.flag, dOff: -30, outside: true });
      });
      T.patchPatient(p.id, upd); doc.status = 'Filed'; doc.filedAt = new Date().toISOString();
      audit('outside-record-filed', { patient: p, detail: `${pick.length} item(s) from ${src}` }); render(); toast(`${pick.length} item(s) filed to ${p.name}'s chart, labeled as outside record.`);
    }
  });

  Object.assign(T.counts, {
    assess: (u) => { const n = inpatientsFor(u).reduce((k, p) => k + Object.keys(TOOLS).filter((t) => isDue(p.id, t)).length, 0); return n ? `<span class="count">${n}</span>` : ''; },
    rx: (u) => { const n = S().portalRequests.filter((r) => r.patient && r.state === 'Pending' && careRel(u, P(r.patient))).length; return n ? `<span class="count">${n}</span>` : ''; },
    docintel: (u) => { const n = S().docs.filter((d) => ['Matched', 'Quarantined'].includes(d.status) && (d.by === u.name || (d.patient && careRel(u, P(d.patient))))).length; return n ? `<span class="count">${n}</span>` : ''; }
  });
  T.records = { TOOLS, isDue, inpatientsFor, timelineEvents };
})(window.Tessera);
