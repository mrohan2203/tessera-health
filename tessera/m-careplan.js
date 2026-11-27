/* Tessera Health — Care plan (chart tab "Care plan").
   Goals and tasks per organ system, drafted from the record and accepted by a clinician.
   - Goals carry a measurable target (a lab or a vital sign) and show live status from the
     vitals and lab history: met, improving, worsening, not met, or no data.
   - Tasks have an owner (nurse, doctor, pharmacist, lab) and a due time. Many close themselves
     when the evidence arrives (a repeat lab is released, a critical result is acknowledged, med
     reconciliation is signed, vitals are charted on schedule); all can be ticked by hand.
   - Planned medications run a safety check before they can go to orders: allergies including
     cross-reactivity, potassium-raising drugs while potassium is high, double anticoagulation,
     duplicates and kidney limits. Blocked drugs need a doctor's documented override.
   Everything is audited. Doctors and nurses can edit the plan; only doctors add or order drugs. */
(function (T) {
  'use strict';
  const { CHART, ACT, FORMS, esc, pill, panel, audit, render } = T;
  const UI = T.UI;
  const S = () => T.S;
  const H = 3600e3;
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const lab = (p, re) => p.labs.find((l) => re.test(l.test));
  const has = (p, re) => p.problems.some((x) => re.test(x));
  const held = (m) => /held|stopped|discontinued/i.test(m.status + ' ' + m.dose);
  const active = (p) => p.meds.filter((m) => !held(m));
  const SYS = { kidney: 'Kidneys & electrolytes', heart: 'Heart & circulation', blood: 'Blood & clotting', endo: 'Metabolic', lungs: 'Lungs', infection: 'Infection', safety: 'Safety & monitoring', meds: 'Medicines' };
  const OWN = ['Nurse', 'Doctor', 'Pharmacist', 'Lab'];
  const ROLE_OWNER = { nurse: 'Nurse', doctor: 'Doctor', pharmacist: 'Pharmacist', lab: 'Lab' };

  /* ---------- Medication safety check ---------- */
  const ALLERGY = [
    { agent: /penicillin|amoxicillin|ampicillin/i, block: /cillin|amoxi|ampi|augmentin|piperacillin|tazobactam/i, caution: [[/\bcef|ceph/i, 'Cephalosporin: about 1–2% cross-reactivity with penicillin; avoid if the reaction was anaphylaxis'], [/penem\b/i, 'Carbapenem: under 1% cross-reactivity with penicillin']], what: 'penicillin-class drug' },
    { agent: /aspirin|nsaid|ibuprofen|naproxen/i, block: /aspirin|acetylsalicylic|ibuprofen|naproxen|ketorolac|diclofenac|indomethacin/i, caution: [[/celecoxib|meloxicam/i, 'COX-2 selective NSAID: lower but real cross-reactivity in aspirin/NSAID allergy']], what: 'aspirin or NSAID' },
    { agent: /sulf/i, block: /sulfamethoxazole|bactrim|co-trimoxazole|sulfadiazine|sulfasalazine/i, caution: [[/furosemide|hydrochlorothiazide|chlorthalidone|celecoxib/i, 'Non-antibiotic sulfonamide: cross-reactivity is unlikely but documented']], what: 'sulfonamide antibiotic' },
    { agent: /contrast|iodine/i, block: /contrast|iohexol|iodixanol|iopamidol/i, caution: [], what: 'iodinated contrast' },
    { agent: /codeine|morphine|opioid/i, block: /codeine|morphine/i, caution: [[/oxycodone|hydromorphone|fentanyl|tramadol/i, 'Opioid: check the nature of the previous reaction']], what: 'opioid' },
    { agent: /latex/i, block: /^$/, caution: [[/catheter|glove|tourniquet/i, 'Latex allergy: use latex-free equipment']], what: 'latex' }
  ];
  const K_UP = /pril\b|sartan|spironolactone|eplerenone|amiloride|triamterene|potassium chloride|kcl|trimethoprim|bactrim/i;
  const ANTICOAG = /warfarin|heparin|enoxaparin|apixaban|rivaroxaban|dabigatran|edoxaban/i, ANTIPLT = /aspirin|clopidogrel|ticagrelor|prasugrel/i;
  function checkDrug(p, text) {
    const t = String(text || ''); const out = [];
    p.allergies.forEach((a) => ALLERGY.forEach((rule) => {
      if (!rule.agent.test(a.agent)) return;
      if (rule.block.test(t)) out.push(['block', `Allergy: ${a.agent} (${a.reaction}, ${String(a.severity).toLowerCase()}). This is a ${rule.what}.`]);
      else rule.caution.forEach(([re, msg]) => { if (re.test(t)) out.push([/anaphyl|SJS|Stevens/i.test(a.reaction) && /cef|ceph/i.test(t) ? 'block' : 'caution', `Allergy: ${a.agent} (${a.reaction}). ${msg}.`]); });
    }));
    if (p.allergiesUnknown) out.push(['caution', 'Allergies are not yet documented. Confirm before giving any new drug.']);
    const k = lab(p, /^potassium/i);
    if (K_UP.test(t) && k && num(k.value) > 5.1) out.push(['block', `Raises potassium, and potassium is ${k.value} ${k.unit} (${k.flag}).`]);
    const meds = active(p);
    if (ANTICOAG.test(t) && meds.some((m) => ANTICOAG.test(m.drug))) out.push(['block', `Already on an anticoagulant (${meds.find((m) => ANTICOAG.test(m.drug)).drug}).`]);
    if ((ANTICOAG.test(t) && meds.some((m) => ANTIPLT.test(m.drug))) || (ANTIPLT.test(t) && meds.some((m) => ANTICOAG.test(m.drug)))) out.push(['caution', 'Anticoagulant with antiplatelet: higher bleeding risk.']);
    const inr = lab(p, /^INR/i); if (inr && num(inr.value) > 3 && (ANTICOAG.test(t) || ANTIPLT.test(t))) out.push(['caution', `INR is ${inr.value}: bleeding risk is already high.`]);
    const first = t.trim().split(/\s+/)[0].toLowerCase();
    const dup = first.length > 3 && meds.find((m) => m.drug.toLowerCase().startsWith(first)); if (dup) out.push(['caution', `Duplicate: ${dup.drug} is already on the medication list.`]);
    const eg = lab(p, /^eGFR/i), e = eg ? num(eg.value) : null;
    if (e != null && /metformin/i.test(t) && e < 30) out.push(['block', `Metformin with eGFR ${e}: contraindicated below 30.`]);
    else if (e != null && /metformin/i.test(t) && e < 45) out.push(['caution', `Metformin with eGFR ${e}: maximum 1,000 mg a day.`]);
    if (e != null && /ibuprofen|naproxen|ketorolac|diclofenac|celecoxib/i.test(t) && e < 60) out.push(['caution', `NSAID with eGFR ${e}: risk of kidney injury.`]);
    if (!/\d/.test(t)) out.push(['caution', 'No dose given.']);
    const level = out.some(([l]) => l === 'block') ? 'block' : out.length ? 'caution' : 'ok';
    return { level, reasons: out.map(([, m]) => m) };
  }

  /* ---------- Suggestions drafted from the record ---------- */
  function suggest(p) {
    const g = [], t = [], m = [];
    const k = lab(p, /^potassium/i), kv = k ? num(k.value) : null, inr = lab(p, /^INR/i), iv = inr ? num(inr.value) : null;
    const cr = lab(p, /^creatinine/i), n = T.news2 ? T.news2(p).sc : 0, meds = active(p);
    const crit = (S().results || []).filter((r) => r.patient === p.id && r.state === 'New');
    if (kv != null && kv > 5.1) {
      g.push({ sid: 'g-k', sys: 'kidney', text: 'Potassium 5.1 mmol/L or lower', metric: { kind: 'lab', test: 'Potassium', hi: 5.1 }, dueH: 24, why: `Potassium ${k.value} (${k.flag})` });
      t.push({ sid: 't-krepeat', sys: 'kidney', text: 'Repeat potassium', owner: 'Lab', dueH: 2, auto: { type: 'lab', test: 'Potassium' }, why: 'Confirms the trend after treatment' });
      if (kv > 6) t.push({ sid: 't-ecg', sys: 'heart', text: '12-lead ECG and continuous cardiac monitoring', owner: 'Nurse', dueH: 1, auto: { type: 'order', re: 'ECG', status: 'Completed' }, why: `Potassium above 6.0 can cause arrhythmia` });
      meds.filter((x) => K_UP.test(x.drug)).forEach((x) => t.push({ sid: 't-hold-' + x.drug.toLowerCase(), sys: 'meds', text: `Hold ${x.drug} while potassium is high`, owner: 'Doctor', dueH: 1, auto: { type: 'held', drug: x.drug }, why: `${x.drug} raises potassium` }));
      m.push({ sid: 'm-szc', drug: 'Sodium zirconium cyclosilicate 10 g PO three times a day for 48 h', why: 'Potassium binder' });
      if (kv > 6) { m.push({ sid: 'm-ins', drug: 'Insulin regular 10 units IV with dextrose 50% 25 g IV', why: 'Shifts potassium into cells within 30 minutes' }); m.push({ sid: 'm-ca', drug: 'Calcium gluconate 10% 30 mL IV over 10 minutes if the ECG shows changes', why: 'Protects the heart muscle' }); t.push({ sid: 't-glu', sys: 'endo', text: 'Capillary glucose 1, 2, 4 and 6 h after insulin', owner: 'Nurse', dueH: 6, why: 'Insulin with dextrose can cause hypoglycaemia' }); }
    }
    if (cr && cr.flag) { g.push({ sid: 'g-cr', sys: 'kidney', text: 'Creatinine back towards baseline (1.4 mg/dL or lower)', metric: { kind: 'lab', test: 'Creatinine', hi: 1.4 }, dueH: 72, why: `Creatinine ${cr.value} (${cr.flag})` }); t.push({ sid: 't-io', sys: 'kidney', text: 'Strict fluid intake and urine output chart', owner: 'Nurse', dueH: 4, why: 'Kidney function is reduced' }); t.push({ sid: 't-renaldose', sys: 'meds', text: 'Renally dose-check every new drug', owner: 'Pharmacist', dueH: 24, why: 'Reduced kidney function' }); }
    if (iv != null && iv > 3) {
      g.push({ sid: 'g-inr', sys: 'blood', text: 'INR 2.0–3.0 before restarting anticoagulation', metric: { kind: 'lab', test: 'INR', lo: 2, hi: 3 }, dueH: 72, why: `INR ${inr.value}` });
      t.push({ sid: 't-inr', sys: 'blood', text: 'Daily INR', owner: 'Lab', dueH: 24, auto: { type: 'lab', test: 'INR' }, why: 'Track reversal' });
      t.push({ sid: 't-bleed', sys: 'blood', text: 'Check for bleeding each shift (gums, urine, stool, neuro)', owner: 'Nurse', dueH: 8, why: `INR ${inr.value}` });
      if (iv < 10) m.push({ sid: 'm-vitk', drug: 'Vitamin K (phytonadione) 2.5 mg PO once', why: `INR ${inr.value} without bleeding` });
      meds.filter((x) => ANTIPLT.test(x.drug)).forEach((x) => t.push({ sid: 't-antiplt', sys: 'blood', text: `Review the need for ${x.drug} while INR is above 3`, owner: 'Doctor', dueH: 12, why: 'Antiplatelet with a high INR' }));
    }
    if (has(p, /atrial fib|I48/i)) { g.push({ sid: 'g-hr', sys: 'heart', text: 'Heart rate below 110 (rate control)', metric: { kind: 'vital', key: 'hr', hi: 110 }, dueH: 24, why: 'Atrial fibrillation' }); t.push({ sid: 't-stroke', sys: 'heart', text: 'Document the stroke-protection plan (when to restart anticoagulation)', owner: 'Doctor', dueH: 48, why: 'Atrial fibrillation with anticoagulation held' }); }
    if (has(p, /hypertens|I10/i)) g.push({ sid: 'g-bp', sys: 'heart', text: 'Systolic blood pressure below 140', metric: { kind: 'vital', key: 'sbp', hi: 139 }, dueH: 48, why: `BP ${p.vitals.bp}` });
    if (has(p, /diabet|E11|E10/i)) { g.push({ sid: 'g-glu', sys: 'endo', text: 'Glucose 140–180 mg/dL', metric: { kind: 'lab', test: 'Glucose', lo: 140, hi: 180 }, dueH: 24, why: 'Inpatient diabetes target' }); t.push({ sid: 't-cbg', sys: 'endo', text: 'Capillary glucose before meals and at bedtime', owner: 'Nurse', dueH: 6, why: 'Diabetes' }); const a1 = lab(p, /HbA1c/i); if (a1 && num(a1.value) > 8) t.push({ sid: 't-a1c', sys: 'endo', text: 'Adjust the diabetes regimen before discharge', owner: 'Doctor', dueH: 72, why: `HbA1c ${a1.value}%` }); }
    if (n >= 5) { g.push({ sid: 'g-news', sys: 'safety', text: 'NEWS2 below 5', metric: { kind: 'vital', key: 'news', hi: 4 }, dueH: 12, why: `NEWS2 ${n}` }); t.push({ sid: 't-vitals1', sys: 'safety', text: 'Vital signs every hour until NEWS2 is below 5', owner: 'Nurse', dueH: 1, auto: { type: 'vitals', every: 1 }, why: `NEWS2 ${n}` }); }
    else t.push({ sid: 't-vitals4', sys: 'safety', text: 'Vital signs every 4 hours', owner: 'Nurse', dueH: 4, auto: { type: 'vitals', every: 4 }, why: 'Ward standard' });
    if (p.vitals.spo2 <= 93) g.push({ sid: 'g-spo2', sys: 'lungs', text: 'SpO₂ 94–98%', metric: { kind: 'vital', key: 'spo2', lo: 94, hi: 98 }, dueH: 4, why: `SpO₂ ${p.vitals.spo2}%` });
    (S().hai || []).filter((h) => h.patient === p.id).forEach((h) => { g.push({ sid: 'g-hai', sys: 'infection', text: `Complete treatment for ${h.type} (${h.organism})`, metric: null, dueH: 168, why: h.tx }); if (/catheter/i.test(h.device || '')) t.push({ sid: 't-cath', sys: 'infection', text: 'Remove the urinary catheter, or document why it is still needed', owner: 'Nurse', dueH: 24, why: h.device }); });
    crit.forEach((r) => t.push({ sid: 't-ack-' + r.id, sys: 'safety', text: `Acknowledge the critical ${r.test} result`, owner: 'Doctor', dueH: 0.5, auto: { type: 'ack', id: r.id }, why: `${r.test} ${r.value}` }));
    const mr = ((S().medrec || {})[p.id] || {}).admission; if (!(mr && mr.by)) t.push({ sid: 't-medrec', sys: 'meds', text: 'Admission medication reconciliation', owner: 'Pharmacist', dueH: 24, auto: { type: 'medrec' }, why: 'Not yet done' });
    m.forEach((x) => { x.check = checkDrug(p, x.drug); });
    return { goals: g, tasks: t, meds: m };
  }

  /* ---------- Plan state ---------- */
  const plan = (pid) => { const st = S(); st.carePlans = st.carePlans || {}; return st.carePlans[pid] || (st.carePlans[pid] = { goals: [], tasks: [], meds: [], dismissed: [], log: [] }); };
  const pending = (p, pl) => { const s = suggest(p), taken = new Set(pl.goals.concat(pl.tasks, pl.meds).map((x) => x.sid).concat(pl.dismissed)); return { goals: s.goals.filter((x) => !taken.has(x.sid)), tasks: s.tasks.filter((x) => !taken.has(x.sid)), meds: s.meds.filter((x) => !taken.has(x.sid)) }; };
  function goalStatus(p, g) {
    if (!g.metric) return { st: 'open', label: 'In progress' };
    let series = [];
    if (g.metric.kind === 'lab' && T.hist) { const s = T.hist.lab(p, g.metric.test); if (s) series = s.pts.map((x) => ({ at: x.at, v: x.v, raw: x.raw })); }
    if (g.metric.kind === 'vital' && T.hist) series = T.hist.vitals(p).map((x) => ({ at: x.at, v: x[g.metric.key], raw: String(x[g.metric.key]) })).filter((x) => x.v != null);
    if (!series.length) return { st: 'nodata', label: 'No data yet', series };
    const cur = series[series.length - 1], prev = series.length > 1 ? series[series.length - 2] : null;
    const ok = (v) => (g.metric.lo == null || v >= g.metric.lo) && (g.metric.hi == null || v <= g.metric.hi);
    const dist = (v) => (g.metric.lo != null && v < g.metric.lo ? g.metric.lo - v : g.metric.hi != null && v > g.metric.hi ? v - g.metric.hi : 0);
    if (ok(cur.v)) return { st: 'met', label: 'Met', cur, series };
    const overdue = g.created && Date.now() > g.created + g.dueH * H;
    if (prev && dist(cur.v) < dist(prev.v)) return { st: 'improving', label: overdue ? 'Improving, past due' : 'Improving', cur, series };
    if (prev && dist(cur.v) > dist(prev.v)) return { st: 'worse', label: 'Worsening', cur, series };
    return { st: overdue ? 'worse' : 'notmet', label: overdue ? 'Not met, past due' : 'Not met', cur, series };
  }
  function autoEvidence(p, t) {
    const a = t.auto; if (!a) return null;
    if (a.type === 'lab') {
      const s = T.hist && T.hist.lab(p, a.test); const newer = s && s.pts.filter((x) => x.at > t.created);
      if (newer && newer.length) return { at: newer[newer.length - 1].at, how: `${a.test} ${newer[newer.length - 1].raw} resulted` };
      const lo = (S().labOrders || []).find((o) => o.patient === p.id && o.status === 'Released' && new RegExp('^' + a.test, 'i').test(o.test)); if (lo) return { at: Date.now(), how: `${lo.test} ${lo.value} released` };
    }
    if (a.type === 'ack') { const r = (S().results || []).find((x) => x.id === a.id); if (r && r.state !== 'New') return { at: Date.now(), how: `Result ${r.state.toLowerCase()}` }; }
    if (a.type === 'medrec') { const mr = ((S().medrec || {})[p.id] || {}).admission; if (mr && mr.by) return { at: mr.at || Date.now(), how: `Reconciled by ${mr.by}` }; }
    if (a.type === 'held') { const m = p.meds.find((x) => x.drug === a.drug); if (m && held(m)) return { at: Date.now(), how: `${a.drug} held on the medication list` }; const o = (S().orders || []).find((x) => x.patient === p.id && new RegExp(a.drug, 'i').test(x.text) && /cancel|reject|discontinu/i.test(x.status)); if (o) return { at: Date.now(), how: `${a.drug} order ${o.status.toLowerCase()}` }; }
    if (a.type === 'order') { const o = (S().orders || []).find((x) => x.patient === p.id && new RegExp(a.re, 'i').test(x.text) && new RegExp(a.status, 'i').test(x.status)); if (o) return { at: Date.now(), how: `Order ${o.id} ${o.status.toLowerCase()}` }; }
    return null;
  }
  function recurring(p, t) {
    const vs = T.hist ? T.hist.vitals(p) : []; const last = vs[vs.length - 1];
    const next = last ? last.at + t.auto.every * H : Date.now();
    return { last, next, overdue: Date.now() > next };
  }
  /* Close tasks whose evidence has arrived (once), with an audit entry naming the evidence. */
  function sweep(p, pl) {
    let changed = false;
    pl.tasks.forEach((t) => {
      if (t.done || t.cancelled || !t.auto || t.auto.type === 'vitals') return;
      const e = autoEvidence(p, t); if (!e) return;
      t.done = { at: Date.now(), by: 'Closed automatically', how: e.how }; changed = true;
      audit('careplan-autoclose', { patient: p, detail: `${t.text}: ${e.how}` });
    });
    if (changed) T.save();
  }
  const rel = (ms) => { const m = Math.round(ms / 60000); const a = Math.abs(m); const s = a < 60 ? `${a} min` : a < 48 * 60 ? `${Math.round(a / 60)} h` : `${Math.round(a / 1440)} d`; return m >= 0 ? `in ${s}` : `${s} overdue`; };
  const when = (at) => (T.hist ? T.hist.fmtT(at) : new Date(at).toLocaleString());

  /* ---------- Tab ---------- */
  const ST_PILL = { met: 'ok', improving: 'info', worse: 'crit', notmet: 'warn', nodata: '', open: '' };
  const CHECK_PILL = { ok: ['ok', 'Safe to order'], caution: ['warn', 'Caution'], block: ['crit', 'Blocked'] };
  CHART.careplan = function (u, p) {
    const pl = plan(p.id); sweep(p, pl);
    const canEdit = u.role === 'doctor' || u.role === 'nurse', isDoc = u.role === 'doctor', mine = ROLE_OWNER[u.role];
    const sug = pending(p, pl);
    const goals = pl.goals.map((g) => Object.assign({ g }, goalStatus(p, g)));
    const tasks = pl.tasks.filter((t) => !t.cancelled).map((t) => {
      if (t.auto && t.auto.type === 'vitals') { const r = recurring(p, t); return { t, rec: r, state: r.overdue ? 'overdue' : 'ontrack', due: r.next }; }
      const due = t.created + t.dueH * H; return { t, state: t.done ? 'done' : Date.now() > due ? 'overdue' : 'open', due };
    });
    const nMet = goals.filter((x) => x.st === 'met').length, nDone = tasks.filter((x) => x.state === 'done').length, nOver = tasks.filter((x) => x.state === 'overdue').length;
    const head = `<div class="cp-head"><div class="cp-stats"><div><span>Goals met</span><b>${nMet}<small>/${goals.length}</small></b></div><div><span>Tasks done</span><b>${nDone}<small>/${tasks.filter((x) => !x.rec).length}</small></b></div><div class="${nOver ? 'over' : ''}"><span>Overdue</span><b>${nOver}</b></div><div><span>Planned drugs</span><b>${pl.meds.filter((x) => !x.removed).length}</b></div></div>
      <div class="cp-rev">${pl.reviewed ? `<span class="muted">Reviewed by <b>${esc(pl.reviewed.by)}</b> ${esc(when(pl.reviewed.at))}</span>` : '<span class="muted">Not yet reviewed</span>'}${canEdit && (pl.goals.length || pl.tasks.length) ? `<button class="btn small" data-act="cp-review" data-p="${p.id}">Review plan</button>` : ''}</div></div>`;
    const sugN = sug.goals.length + sug.tasks.length + sug.meds.length;
    const sugRow = (kind, x) => `<li><span class="cp-sys">${esc(SYS[x.sys] || 'Medicines')}</span><span class="cp-st"><b>${esc(x.text || x.drug)}</b><small>${esc(x.why || '')}${x.owner ? ` · ${esc(x.owner)} · due ${x.dueH < 1 ? Math.round(x.dueH * 60) + ' min' : x.dueH + ' h'}` : ''}${x.auto ? ' · closes automatically' : ''}</small>${x.check && x.check.level !== 'ok' ? `<small class="cp-chk ${x.check.level}">${esc(x.check.reasons.join(' '))}</small>` : ''}</span>${canEdit && (kind !== 'meds' || isDoc) ? `<span class="cp-acts"><button class="btn small" data-act="cp-accept" data-p="${p.id}" data-k="${kind}" data-s="${x.sid}">Add</button><button class="btn small ghost" data-act="cp-dismiss" data-p="${p.id}" data-s="${x.sid}" aria-label="Dismiss">✕</button></span>` : ''}</li>`;
    const sugPanel = sugN ? panel(`Suggested from the record <small class="muted">${sugN}</small>`, `<p class="muted" style="margin:0 0 10px;font-size:13px">Drafted from the problems, labs, vitals, medications and infection record. Nothing is added until a clinician accepts it.</p>
      <ul class="cp-sug">${sug.goals.map((x) => sugRow('goals', x)).join('')}${sug.tasks.map((x) => sugRow('tasks', x)).join('')}${sug.meds.map((x) => sugRow('meds', x)).join('')}</ul>
      ${canEdit ? `<div class="row" style="margin-top:10px"><button class="btn primary small" data-act="cp-accept-all" data-p="${p.id}">Add all ${isDoc ? '' : 'goals and tasks'}</button></div>` : ''}`) : '';
    const goalRows = goals.map(({ g, st, label, cur, series }) => {
      const tgt = g.metric ? (g.metric.lo != null && g.metric.hi != null ? `${g.metric.lo}–${g.metric.hi}` : g.metric.hi != null ? `≤ ${g.metric.hi}` : `≥ ${g.metric.lo}`) : '';
      const sp = series && series.length > 1 && T.hist ? T.hist.spark(series.slice(-10).map((x) => x.v), { w: 80, h: 22, lo: g.metric.lo, hi: g.metric.hi, cls: st === 'met' ? '' : st === 'worse' ? 'crit' : 'warn' }) : '';
      return `<li class="cp-goal ${st}"><span class="cp-sys">${esc(SYS[g.sys] || '')}</span><span class="cp-st"><b>${esc(g.text)}</b><small>${cur ? `Now ${esc(cur.raw)}${tgt ? ` · target ${tgt}` : ''} · ` : ''}due ${esc(rel(g.created + g.dueH * H - Date.now()).replace('overdue', 'ago'))}</small></span>${sp}${pill(ST_PILL[st], label)}${canEdit ? `<button class="btn small ghost" data-act="cp-remove" data-p="${p.id}" data-k="goals" data-i="${g.id}" aria-label="Remove goal">✕</button>` : ''}</li>`;
    }).join('');
    const order = { overdue: 0, open: 1, ontrack: 2, done: 3 };
    const tf = UI.cpFilter || 'all';
    const tlist = tasks.filter((x) => tf === 'all' || (tf === 'mine' ? x.t.owner === mine : x.state === 'overdue')).sort((a, b) => order[a.state] - order[b.state] || a.due - b.due);
    const taskRows = tlist.map(({ t, state, due, rec }) => {
      const status = rec ? (rec.last ? `Last charted ${esc(when(rec.last.at))} · ${rec.overdue ? `next set ${esc(rel(rec.next - Date.now()))}` : `next due ${esc(rel(rec.next - Date.now()))}`}` : 'No vitals yet') : t.done ? `${esc(t.done.by)} ${esc(when(t.done.at))}${t.done.how ? ` · ${esc(t.done.how)}` : ''}` : `Due ${esc(rel(due - Date.now()))}`;
      const box = rec ? `<span class="cp-rec ${state}" title="Recurring">↻</span>` : `<input type="checkbox" data-change="cp-task" data-p="${p.id}" data-i="${t.id}" ${t.done ? 'checked' : ''} ${canEdit || t.owner === mine ? '' : 'disabled'} aria-label="Mark done: ${esc(t.text)}">`;
      return `<li class="cp-task ${state} ${t.owner === mine ? 'mine' : ''}">${box}<span class="cp-st"><b>${esc(t.text)}</b><small>${status}</small>${t.auto && !t.done && !rec ? `<small class="cp-auto">Closes automatically when ${esc({ lab: `a new ${t.auto.test} result arrives`, ack: 'the result is acknowledged', medrec: 'reconciliation is signed', held: `${t.auto.drug} is held`, order: 'the order is completed' }[t.auto.type] || 'the evidence arrives')}</small>` : ''}</span><span class="cp-own">${esc(t.owner)}</span>${state === 'overdue' ? pill('crit', 'Overdue') : state === 'ontrack' ? pill('ok', 'On track') : ''}${canEdit ? `<button class="btn small ghost" data-act="cp-remove" data-p="${p.id}" data-k="tasks" data-i="${t.id}" aria-label="Remove task">✕</button>` : ''}</li>`;
    }).join('');
    const medRows = pl.meds.filter((x) => !x.removed).map((x) => {
      const c = x.check; const [pc, pl2] = CHECK_PILL[c.level];
      const status = x.ordered ? pill('info', `Sent to orders · ${x.ordered.id}`) : x.override ? pill('warn', 'Overridden') : pill(pc, pl2);
      const acts = isDoc && !x.ordered ? (c.level === 'block' && !x.override ? `<button class="btn small" data-act="cp-override" data-p="${p.id}" data-i="${x.id}">Override…</button>` : `<button class="btn small primary" data-act="cp-order" data-p="${p.id}" data-i="${x.id}">Send to orders</button>`) + `<button class="btn small ghost" data-act="cp-remove" data-p="${p.id}" data-k="meds" data-i="${x.id}" aria-label="Remove">✕</button>` : '';
      const ovr = UI.cpOverride === x.id ? `<form data-form="cp-override" class="cp-ovr"><input type="hidden" name="p" value="${p.id}"><input type="hidden" name="i" value="${x.id}"><input name="reason" required minlength="10" placeholder="Clinical reason for overriding (logged)"><button class="btn small primary" type="submit">Override and keep</button></form>` : '';
      return `<li class="cp-med ${c.level}"><span class="cp-st"><b>${esc(x.drug)}</b><small>${esc(x.why || '')}${x.by ? ` · proposed by ${esc(x.by)}` : ''}</small>${c.reasons.length ? `<small class="cp-chk ${c.level}">${c.reasons.map(esc).join(' ')}</small>` : '<small class="cp-chk ok">No allergy, interaction, duplicate or kidney problem found.</small>'}${x.override ? `<small class="cp-chk caution">Override by ${esc(x.override.by)}: ${esc(x.override.reason)}</small>` : ''}${ovr}</span>${status}<span class="cp-acts">${acts}</span></li>`;
    }).join('');
    const addTask = canEdit ? `<form data-form="cp-add-task" class="cp-add"><input type="hidden" name="p" value="${p.id}"><input name="text" required placeholder="Add a task" aria-label="Task"><select name="owner" aria-label="Owner">${OWN.map((o) => `<option ${o === mine ? 'selected' : ''}>${o}</option>`).join('')}</select><select name="due" aria-label="Due">${[[1, 'in 1 h'], [4, 'in 4 h'], [12, 'in 12 h'], [24, 'in 24 h'], [72, 'in 3 days']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="btn small" type="submit">Add</button></form>` : '';
    const addMed = isDoc ? `<form data-form="cp-add-med" class="cp-add"><input type="hidden" name="p" value="${p.id}"><input name="drug" required placeholder="Drug, dose, route, frequency (for example: aspirin 81 mg PO daily)" aria-label="Planned drug"><input name="why" placeholder="Why" aria-label="Indication"><button class="btn small" type="submit">Check and add</button></form>` : '';
    const empty = !pl.goals.length && !pl.tasks.length && !pl.meds.length;
    return `${head}
      ${sugPanel}
      ${empty && !sugN ? '<p class="muted">No plan yet and nothing to suggest from the record.</p>' : ''}
      <div class="cp-grid">
        ${panel('Goals', goalRows ? `<ul class="cp-list">${goalRows}</ul>` : '<p class="muted">No goals yet. Add them from the suggestions.</p>', '<span class="kpi-note">Status updates from the vitals and lab history</span>')}
        ${panel('Tasks', `<div class="chips" style="margin-bottom:10px">${[['all', 'All'], ['mine', `Mine (${mine || 'none'})`], ['overdue', `Overdue ${nOver}`]].map(([k, l]) => `<button class="btn small ${tf === k ? 'primary' : ''}" data-act="cp-filter" data-f="${k}">${esc(l)}</button>`).join('')}</div>${taskRows ? `<ul class="cp-list">${taskRows}</ul>` : '<p class="muted">No tasks.</p>'}${addTask}`)}
      </div>
      ${panel('Planned medications', `${medRows ? `<ul class="cp-list">${medRows}</ul>` : '<p class="muted">No planned medications.</p>'}${addMed}<p class="muted" style="font-size:12px;margin:10px 0 0">Every drug is checked against allergies (with cross-reactivity), potassium, anticoagulants, duplicates and kidney function before it can be ordered. A blocked drug needs a doctor's documented reason.</p>`)}`;
  };

  /* ---------- Actions ---------- */
  const me = () => T.me() || {};
  const pid = (d) => d.p;
  function accept(p, pl, kind, x) {
    const base = { sid: x.sid, created: Date.now(), by: me().name };
    if (kind === 'goals') pl.goals.push(Object.assign({ id: T.nid('G') }, x, base));
    if (kind === 'tasks') pl.tasks.push(Object.assign({ id: T.nid('TK') }, x, base));
    if (kind === 'meds') pl.meds.push(Object.assign({ id: T.nid('PM') }, x, base, { check: checkDrug(p, x.drug) }));
  }
  ACT['cp-accept'] = (d) => { const p = T.P(pid(d)), pl = plan(p.id), s = suggest(p)[d.k].find((x) => x.sid === d.s); if (!s) return; if (d.k === 'meds' && me().role !== 'doctor') return; accept(p, pl, d.k, s); audit('careplan-add', { patient: p, detail: `${d.k.slice(0, -1)}: ${s.text || s.drug}` }); T.save(); render(); };
  ACT['cp-accept-all'] = (d) => { const p = T.P(pid(d)), pl = plan(p.id), s = pending(p, pl); let n = 0; ['goals', 'tasks'].concat(me().role === 'doctor' ? ['meds'] : []).forEach((k) => s[k].forEach((x) => { accept(p, pl, k, x); n++; })); audit('careplan-add', { patient: p, detail: `${n} suggested items accepted` }); T.save(); render(); T.toast(`${n} items added to the care plan.`); };
  ACT['cp-dismiss'] = (d) => { const p = T.P(pid(d)), pl = plan(p.id); pl.dismissed.push(d.s); audit('careplan-dismiss', { patient: p, detail: d.s }); T.save(); render(); };
  ACT['cp-remove'] = (d) => { const p = T.P(pid(d)), pl = plan(p.id); const list = pl[d.k]; const x = list.find((y) => y.id === d.i); if (!x) return; if (d.k === 'meds') x.removed = true; else if (d.k === 'tasks') x.cancelled = { at: Date.now(), by: me().name }; else list.splice(list.indexOf(x), 1); if (x.sid) pl.dismissed.push(x.sid); audit('careplan-remove', { patient: p, detail: `${d.k.slice(0, -1)}: ${x.text || x.drug}` }); T.save(); render(); };
  ACT['cp-filter'] = (d) => { UI.cpFilter = d.f; render(); };
  ACT['cp-review'] = (d) => { const p = T.P(pid(d)), pl = plan(p.id); pl.reviewed = { by: me().name, at: Date.now() }; audit('careplan-review', { patient: p, detail: `${pl.goals.length} goals, ${pl.tasks.filter((t) => !t.cancelled).length} tasks, ${pl.meds.filter((x) => !x.removed).length} drugs` }); T.save(); render(); T.toast('Care plan reviewed and signed.'); };
  ACT['cp-override'] = (d) => { UI.cpOverride = UI.cpOverride === d.i ? null : d.i; render(); };
  ACT['cp-order'] = (d) => {
    const p = T.P(pid(d)), pl = plan(p.id), x = pl.meds.find((y) => y.id === d.i); if (!x || me().role !== 'doctor') return;
    x.check = checkDrug(p, x.drug); if (x.check.level === 'block' && !x.override) { T.toast('Blocked: document an override first.'); render(); return; }
    const o = { id: T.nid('O'), patient: p.id, type: 'Medication', text: x.drug, priority: 'Routine', status: 'Pending signature', by: me().id, at: new Date().toISOString(), fromPlan: x.id };
    S().orders.push(o); x.ordered = { id: o.id, at: Date.now() };
    audit('order-create', { patient: p, detail: `${x.drug} (from care plan${x.override ? ', allergy/interaction overridden' : ''})` }); T.save(); render(); T.toast(`Sent to orders as ${o.id}, awaiting your signature.`);
  };
  T.CHANGE = T.CHANGE || {};
  T.CHANGE['cp-task'] = (v, el) => {
    const p = T.P(el.dataset.p), pl = plan(p.id), t = pl.tasks.find((x) => x.id === el.dataset.i); if (!t) return;
    t.done = el.checked ? { at: Date.now(), by: me().name, how: 'marked done' } : null;
    audit('careplan-task', { patient: p, detail: `${el.checked ? 'done' : 'reopened'}: ${t.text}` }); T.save(); render();
  };
  FORMS['cp-add-task'] = (f) => { const p = T.P(f.p), pl = plan(p.id); pl.tasks.push({ id: T.nid('TK'), sys: 'safety', text: f.text.trim(), owner: f.owner, dueH: +f.due, created: Date.now(), by: me().name }); audit('careplan-add', { patient: p, detail: `task: ${f.text.trim()} (${f.owner})` }); T.save(); render(); };
  FORMS['cp-add-med'] = (f) => {
    const p = T.P(f.p), pl = plan(p.id); if (me().role !== 'doctor') return;
    const c = checkDrug(p, f.drug); pl.meds.push({ id: T.nid('PM'), drug: f.drug.trim(), why: (f.why || '').trim(), check: c, created: Date.now(), by: me().name });
    audit(c.level === 'block' ? 'careplan-med-blocked' : 'careplan-add', { patient: p, detail: `drug: ${f.drug.trim()}${c.reasons.length ? ' · ' + c.reasons.join(' ') : ''}` }); T.save(); render();
    T.toast(c.level === 'block' ? `Blocked: ${c.reasons[0]}` : c.level === 'caution' ? `Added with a caution: ${c.reasons[0]}` : 'Added. No safety problems found.');
  };
  FORMS['cp-override'] = (f) => {
    const p = T.P(f.p), pl = plan(p.id), x = pl.meds.find((y) => y.id === f.i); if (!x || me().role !== 'doctor') return;
    if ((f.reason || '').trim().length < 10) { T.toast('Give a clinical reason of at least 10 characters.'); return; }
    x.override = { by: me().name, at: Date.now(), reason: f.reason.trim() }; UI.cpOverride = null;
    audit('careplan-override', { patient: p, detail: `${x.drug}: ${x.check.reasons.join(' ')} · reason: ${x.override.reason}` }); T.save(); render();
  };

  /* Summary for other screens (Ask the twin, patient twins list). */
  function summary(p) {
    const pl = (S().carePlans || {})[p.id]; if (!pl) return null;
    const goals = pl.goals.map((g) => Object.assign({ g }, goalStatus(p, g)));
    const tasks = pl.tasks.filter((t) => !t.cancelled).map((t) => { if (t.auto && t.auto.type === 'vitals') { const r = recurring(p, t); return { t, state: r.overdue ? 'overdue' : 'ontrack', due: r.next }; } const due = t.created + t.dueH * H; return { t, state: t.done ? 'done' : Date.now() > due ? 'overdue' : 'open', due }; });
    return { pl, goals, tasks, meds: pl.meds.filter((x) => !x.removed), overdue: tasks.filter((x) => x.state === 'overdue') };
  }
  T.careplan = { checkDrug, suggest, summary, plan, rel };
})(window.Tessera);
