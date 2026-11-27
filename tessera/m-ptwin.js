/* Tessera Health — Patient digital twin (chart tab "Twin").
   A model of one patient built only from their own record. Seven views share one set of what-if
   levers (with doses and timing) and one hour-by-hour time slider that can play:
     Overview     organ-level body map that recolours over time, a simulated bedside monitor whose
                  ECG follows projected potassium, nine computed scores, five risks, the levers
     Physiology   one card per organ system: reserve, evidence, drugs acting there, its course
     Forecast     hourly 72-hour projections (potassium, INR, creatinine, glucose, NEWS2, heart
                  rate) with 80% uncertainty bands, record vs levers, and every threshold crossed
     Drug levels  one-compartment pharmacokinetics for each dosed drug, adjusted for the computed
                  kidney function and the levers; meropenem time above MIC; aspirin platelet effect
     Medications  drug-to-organ map across chart, home and infection-control sources, renal
                  dosing from the computed CrCl, and interactions
     Scenarios    save lever sets (with their doses) and compare them side by side
     Sources      every input the twin read, how fresh it is, a confidence score, and the
                  identifiers it never reads
   Illustrative rules, not a validated model. Simulations and scenarios are audited and change
   nothing in the record. Care team only: it sits inside the chart, so chart access rules and the
   view-chart audit apply. */
(function (T) {
  'use strict';
  const { CHART, ACT, esc, pill, panel, audit, render } = T;
  const UI = T.UI;
  const S = () => T.S;
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const lab = (p, re) => p.labs.find((l) => re.test(l.test));
  const has = (p, re) => p.problems.some((x) => re.test(x));
  const isHeld = (m) => /held|stopped|discontinued/i.test(m.status + ' ' + m.dose);
  const activeMeds = (p) => p.meds.filter((m) => !isHeld(m));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const refHi = (l, d) => { const m = String((l && l.ref) || '').match(/[–-]\s*([\d.]+)/); return m ? +m[1] : d; };
  const H = 72; // forecast window in hours, hourly resolution
  const HOURS = Array.from({ length: H + 1 }, (_, i) => i);
  const hLabel = (h) => (h === 0 ? 'Now' : `+${h} h`);
  const clock = (h) => { const d = new Date(Date.now() + h * 3600e3); return d.toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); };
  const nowHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  const gauss = (t, mu, s, a) => a * Math.exp(-((t - mu) * (t - mu)) / (2 * s * s));
  const isAF = (p) => has(p, /atrial fib|I48/i);
  const isDM = (p) => has(p, /diabet|E11|E10/i);

  /* ---------- Organ systems ---------- */
  const SYSTEMS = [
    { id: 'neuro', name: 'Brain & nerves', prob: /seizure|stroke|epilep|dementia|migraine|neuro|syncope|head injur|delirium/i, labs: /^$/, watch: 'Consciousness (AVPU), new confusion, focal signs' },
    { id: 'heart', name: 'Heart & circulation', prob: /coronary|myocard|\bMI\b|atrial|heart|cardi|hypertens|angina|arrhythm|palpitation|chest pain/i, labs: /troponin|BNP|LDL/i, watch: 'Rhythm on telemetry, BP, ECG if potassium is high' },
    { id: 'lungs', name: 'Lungs', prob: /asthma|copd|pneumon|respir|apnea|pulmon|bronch|hypox/i, labs: /^$/, watch: 'SpO₂, respiratory rate, oxygen requirement' },
    { id: 'gi', name: 'Liver & gut', prob: /liver|hepat|cirrho|pancreat|gall|chole|appendic|bowel|gastr|GERD|ulcer/i, labs: /lipase|ALT|AST|bilirubin/i, watch: 'Liver enzymes, GI bleeding signs' },
    { id: 'kidney', name: 'Kidneys & electrolytes', prob: /CKD|kidney|renal|N18|nephr|urinary|CAUTI/i, labs: /creatinine|eGFR|potassium|sodium/i, watch: 'Potassium, creatinine, urine output' },
    { id: 'endo', name: 'Metabolic & endocrine', prob: /diabet|thyroid|obes|E11|E10|metabolic|lipid/i, labs: /HbA1c|glucose|TSH/i, watch: 'Capillary glucose, HbA1c trend' },
    { id: 'blood', name: 'Blood & immunity', prob: /anemi|anticoag|warfarin|sepsis|infect|strep|bleed|coagul|leuk/i, labs: /INR|WBC|hemoglobin|lactate|culture|strep/i, watch: 'INR, haemoglobin, temperature, bleeding' },
    { id: 'msk', name: 'Bones & joints', prob: /arthr|fracture|knee|hip|osteo|spine|back pain|gout/i, labs: /^$/, watch: 'Mobility, falls, pain scores' }
  ];
  const FLAG = {
    Potassium: (v) => (v > 6.0 ? 'HH' : v > 5.1 ? 'H' : v < 3.5 ? 'L' : ''),
    INR: (v) => (v > 4.5 ? 'HH' : v > 3.0 ? 'H' : ''),
    Creatinine: (v, l) => (v > refHi(l, 1.3) ? 'H' : '')
  };
  const fmt = { Potassium: (v) => v.toFixed(1), INR: (v) => v.toFixed(1), Creatinine: (v) => v.toFixed(2) };
  function systemState(p, s, ov) {
    const ev = [];
    let level = 0;
    p.problems.filter((x) => s.prob.test(x)).forEach((x) => { ev.push(['Problem', x.replace(/\s*\([^)]*\)\s*$/, '')]); level = Math.max(level, 1); });
    p.labs.filter((l) => s.labs.test(l.test)).forEach((l) => {
      let value = l.value, flag = l.flag;
      if (ov && ov[l.test] != null && FLAG[l.test]) { value = fmt[l.test](ov[l.test]); flag = FLAG[l.test](ov[l.test], l); }
      const crit = flag && (flag.length > 1 || flag === 'A');
      const dl = !ov && T.hist ? T.hist.labDelta(p, l.test) : null;
      ev.push([crit ? 'Critical lab' : flag ? 'Abnormal lab' : 'Lab', `${l.test} ${value} ${l.unit || ''}${ov && ov[l.test] != null ? ' (projected)' : ''}${dl && dl.dir ? ` (${dl.dir > 0 ? '↑' : '↓'} from ${dl.prev.raw} ${T.hist.dayLbl(dl.prev.at)})` : ''}`.trim()]);
      level = Math.max(level, crit ? 2 : flag ? 1 : 0);
    });
    const v = p.vitals || {}; const sbp = num(String(v.bp).split('/')[0]);
    if (s.id === 'heart') { if (v.hr > 110 || v.hr < 45 || sbp > 180 || sbp < 90) { ev.push(['Vital', `HR ${v.hr} · BP ${v.bp}`]); level = 2; } else if (v.hr > 90 || sbp > 140) { ev.push(['Vital', `HR ${v.hr} · BP ${v.bp}`]); level = Math.max(level, 1); } }
    if (s.id === 'heart' && ov && ov.Potassium > 6.5) { ev.push(['Projected', `Potassium ${ov.Potassium.toFixed(1)}: arrhythmia risk`]); level = 2; }
    if (s.id === 'endo' && ov && ov.Glucose != null && ov.Glucose < 70) { ev.push(['Projected', `Glucose ${Math.round(ov.Glucose)} mg/dL: hypoglycaemia`]); level = 2; }
    if (s.id === 'lungs') { if (v.spo2 <= 91 || v.rr >= 25) { ev.push(['Vital', `SpO₂ ${v.spo2}% · RR ${v.rr}`]); level = 2; } else if (v.spo2 <= 95 || v.rr > 20) { ev.push(['Vital', `SpO₂ ${v.spo2}% · RR ${v.rr}`]); level = Math.max(level, 1); } }
    if (s.id === 'blood' && v.temp >= 100.4) { ev.push(['Vital', `Temp ${v.temp} °F`]); level = Math.max(level, 1); }
    if (s.id === 'blood' && activeMeds(p).some((m) => ANTICOAG.test(m.drug))) { ev.push(['Medication', 'On an anticoagulant']); level = Math.max(level, 1); }
    if (s.id === 'blood' || s.id === 'kidney') (S().hai || []).filter((h) => h.patient === p.id && (s.id === 'blood' || /CAUTI/.test(h.type))).forEach((h) => { ev.push(['Infection', `${h.type}: ${h.organism}`]); level = Math.max(level, 1); });
    if (s.id === 'neuro' && p.avpu && p.avpu !== 'A') { ev.push(['Vital', `AVPU ${p.avpu}`]); level = 2; }
    return { level, ev };
  }
  const reserve = (st) => clamp(100 - (st.level === 2 ? 45 : st.level === 1 ? 18 : 0) - 6 * st.ev.filter(([k]) => k !== 'Lab').length, 12, 100);
  const LVL = ['Stable', 'Watch', 'Alert'];

  /* ---------- Medication effects ---------- */
  const ARB = /pril\b|sartan/i, KSPARE = /spironolactone|eplerenone|amiloride|potassium chloride|trimethoprim/i;
  const ANTICOAG = /warfarin|heparin|apixaban|rivaroxaban|enoxaparin|dabigatran/i, ANTIPLT = /aspirin|clopidogrel|ticagrelor|prasugrel/i;
  const NSAID = /ibuprofen|naproxen|ketorolac|diclofenac|celecoxib/i;
  const MED_FX = [
    [ARB, { kidney: '↑ potassium · ↓ filtration', heart: '↓ BP' }],
    [KSPARE, { kidney: '↑ potassium' }],
    [/warfarin/i, { blood: 'Anticoagulant', gi: 'Liver metabolism' }],
    [/apixaban|rivaroxaban|dabigatran|enoxaparin|heparin/i, { blood: 'Anticoagulant', kidney: 'Renal clearance' }],
    [ANTIPLT, { blood: 'Antiplatelet', gi: 'GI bleeding' }],
    [/olol\b|carvedilol/i, { heart: '↓ HR · ↓ BP', lungs: 'Bronchospasm (non-selective)' }],
    [/statin/i, { endo: '↓ LDL', gi: 'Liver enzymes', msk: 'Myalgia' }],
    [/metformin/i, { endo: '↓ glucose', kidney: 'Renal clearance' }],
    [/insulin/i, { endo: '↓ glucose', kidney: 'Shifts potassium into cells' }],
    [/furosemide|bumetanide|torsemide|hydrochlorothiazide|chlorthalidone/i, { kidney: '↓ potassium · fluid', heart: '↓ preload' }],
    [/meropenem|ertapenem|imipenem/i, { blood: 'Treats infection', kidney: 'Renal dosing', neuro: 'Lowers seizure threshold' }],
    [/cef|piperacillin|vancomycin|amoxicillin|azithro|cipro|levoflox|doxy/i, { blood: 'Treats infection', kidney: 'Renal dosing' }],
    [NSAID, { kidney: '↓ filtration', gi: 'GI bleeding', heart: '↑ BP' }],
    [/morphine|oxycodone|hydromorphone|fentanyl|tramadol/i, { neuro: 'Sedation', lungs: 'Respiratory depression' }],
    [/dipine\b/i, { heart: '↓ BP' }],
    [/levothyroxine/i, { endo: 'Thyroid replacement' }],
    [/prazole\b/i, { gi: 'Acid suppression' }],
    [/prednis|dexameth|hydrocort|methylpred/i, { endo: '↑ glucose', blood: '↓ immunity' }],
    [/levetiracetam|phenytoin|valpro|lamotrig/i, { neuro: 'Anticonvulsant' }],
    [/albuterol|salbutamol|ipratropium|tiotropium/i, { lungs: 'Bronchodilator', heart: '↑ HR' }]
  ];
  const fxOf = (drug) => { const out = {}; MED_FX.forEach(([re, fx]) => { if (re.test(drug)) Object.assign(out, fx); }); return out; };

  /* ---------- Clinical scores ---------- */
  const CHA_RATE = [0.2, 0.6, 2.2, 3.2, 4.8, 7.2, 9.7, 11.2, 10.8, 12.2]; // adjusted stroke rate, %/yr, untreated
  function cha2ds2(p) {
    let c = 0; const why = [];
    if (has(p, /heart failure/i)) { c += 1; why.push('HF'); } if (has(p, /hypertens|I10/i)) { c += 1; why.push('HTN'); }
    if (p.age >= 75) { c += 2; why.push('age ≥75'); } else if (p.age >= 65) { c += 1; why.push('age 65–74'); }
    if (isDM(p)) { c += 1; why.push('diabetes'); } if (has(p, /stroke|TIA/i)) { c += 2; why.push('stroke'); }
    if (has(p, /coronary|myocard|\bMI\b|peripheral arter/i)) { c += 1; why.push('vascular'); } if (p.sex === 'F') { c += 1; why.push('female'); }
    return { c, why, rate: CHA_RATE[Math.min(c, 9)] };
  }
  function scores(p) {
    const out = [];
    const cr = lab(p, /^creatinine/i), crv = cr && num(cr.value), f = p.sex === 'F';
    const n = T.news2 ? T.news2(p) : { sc: 0, risk: 'Low' };
    out.push({ k: 'NEWS2', v: n.sc, sub: n.risk, cls: n.sc >= 7 ? 'crit' : n.sc >= 5 ? 'warn' : '', why: 'National Early Warning Score 2 from the latest vitals' });
    if (crv) {
      const kap = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
      const egfr = 142 * Math.pow(Math.min(crv / kap, 1), a) * Math.pow(Math.max(crv / kap, 1), -1.2) * Math.pow(0.9938, p.age) * (f ? 1.012 : 1);
      out.push({ k: 'eGFR', v: Math.round(egfr), sub: 'mL/min/1.73m² · CKD-EPI 2021', cls: egfr < 30 ? 'crit' : egfr < 60 ? 'warn' : '', why: `Computed from creatinine ${cr.value}, age and sex` });
      if (p.weightKg) { const cg = ((140 - p.age) * p.weightKg / (72 * crv)) * (f ? 0.85 : 1); out.push({ k: 'CrCl', v: Math.round(cg), sub: 'mL/min · Cockcroft–Gault', cls: cg < 30 ? 'crit' : cg < 50 ? 'warn' : '', why: 'Used for drug dosing', raw: cg }); }
    }
    if (p.weightKg && p.heightCm) { const b = p.weightKg / Math.pow(p.heightCm / 100, 2); out.push({ k: 'BMI', v: b.toFixed(1), sub: b >= 30 ? 'Obese' : b >= 25 ? 'Overweight' : b < 18.5 ? 'Underweight' : 'Healthy range', cls: b >= 30 || b < 18.5 ? 'warn' : '', why: `${p.weightKg} kg · ${p.heightCm} cm` }); }
    const v = p.vitals || {}; const [sbp, dbp] = String(v.bp).split('/').map(num);
    if (sbp && dbp) { const map = (sbp + 2 * dbp) / 3; out.push({ k: 'MAP', v: Math.round(map), sub: 'mmHg', cls: map < 65 ? 'crit' : '', why: 'Mean arterial pressure' }); }
    if (sbp && v.hr) { const si = v.hr / sbp; out.push({ k: 'Shock index', v: si.toFixed(2), sub: si >= 1 ? 'Shock likely' : si >= 0.7 ? 'Borderline' : 'Normal', cls: si >= 1 ? 'crit' : si >= 0.7 ? 'warn' : '', why: 'Heart rate ÷ systolic BP' }); }
    if (isAF(p)) { const c = cha2ds2(p); out.push({ k: 'CHA₂DS₂-VASc', v: c.c, sub: c.c >= 2 ? `Anticoagulate · ${c.rate}%/yr untreated` : 'Low stroke risk', cls: c.c >= 2 ? 'warn' : '', why: c.why.join(' · ') || 'No points' }); }
    if (isAF(p) || p.meds.some((m) => ANTICOAG.test(m.drug))) {
      let h = 0; const why = []; const inr = lab(p, /^INR/i);
      if (sbp > 160) { h += 1; why.push('SBP >160'); } if (crv >= 2.26 || has(p, /dialysis/i)) { h += 1; why.push('renal'); }
      if (has(p, /cirrho|hepat/i)) { h += 1; why.push('liver'); } if (has(p, /stroke/i)) { h += 1; why.push('stroke'); }
      if (has(p, /bleed/i)) { h += 1; why.push('bleeding history'); } if (inr && num(inr.value) > 3) { h += 1; why.push('labile INR'); }
      if (p.age > 65) { h += 1; why.push('age >65'); } if (activeMeds(p).some((m) => ANTIPLT.test(m.drug) || NSAID.test(m.drug))) { h += 1; why.push('antiplatelet/NSAID'); }
      out.push({ k: 'HAS-BLED', v: h, sub: h >= 3 ? 'High bleeding risk' : 'Lower bleeding risk', cls: h >= 3 ? 'crit' : h === 2 ? 'warn' : '', why: why.join(' · ') || 'No points' });
    }
    if (sbp) { const q = (v.rr >= 22 ? 1 : 0) + (sbp <= 100 ? 1 : 0) + (p.avpu && p.avpu !== 'A' ? 1 : 0); out.push({ k: 'qSOFA', v: q, sub: q >= 2 ? 'Sepsis risk' : 'Low', cls: q >= 2 ? 'crit' : '', why: 'RR ≥22, SBP ≤100, altered mentation' }); }
    return out;
  }

  /* ---------- Levers (with dose and timing options) ---------- */
  const VK = { 1: { tgt: 2.3, tau: 18, bleed: -10 }, 2.5: { tgt: 1.9, tau: 14, bleed: -14 }, 5: { tgt: 1.5, tau: 10, bleed: -18 }, 10: { tgt: 1.2, tau: 6, bleed: -20 } };
  function levers(p) {
    const out = [];
    const af = isAF(p), rate = cha2ds2(p).rate;
    p.meds.forEach((m, i) => {
      const held = isHeld(m);
      const lbl = `${held ? 'Keep holding' : 'Hold'} ${m.drug}`;
      if (ARB.test(m.drug) || KSPARE.test(m.drug)) out.push({ id: 'hold-' + i, med: i, label: lbl, fx: { k: -12 }, pre: held });
      if (ANTICOAG.test(m.drug)) out.push({ id: 'hold-' + i, med: i, label: lbl, fx: af ? { bleed: -14, stroke: +(rate * 0.64).toFixed(2) } : { bleed: -14 }, pre: held });
      else if (ANTIPLT.test(m.drug)) out.push({ id: 'hold-' + i, med: i, label: lbl, fx: { bleed: -5 }, pre: held });
      else if (NSAID.test(m.drug)) out.push({ id: 'hold-' + i, med: i, label: lbl, fx: { k: -6 }, pre: held });
    });
    const wi = p.meds.findIndex((m) => /warfarin/i.test(m.drug));
    if (wi >= 0 && isHeld(p.meds[wi]) && af) out.push({ id: 'warf-restart', label: 'Restart warfarin at a reduced dose (2.5 mg)', fx: { bleed: +6, stroke: -(rate * 0.64).toFixed(2) }, opts: { key: 'at', label: 'from', def: 48, choices: [[24, '+24 h'], [36, '+36 h'], [48, '+48 h']] } });
    const k = lab(p, /^potassium/i), inr = lab(p, /^INR/i);
    if (k && num(k.value) > 5.0) {
      out.push({ id: 'k-treat', label: 'Treat potassium (insulin + dextrose, binder)', fx: { k: -25 }, opts: { key: 'at', label: 'start', def: 0, choices: [[0, 'now'], [2, '+2 h'], [6, '+6 h']] }, fxFn: (o) => ({ k: o.at === 0 ? -25 : o.at === 2 ? -21 : -14 }) });
      out.push({ id: 'k-diet', label: 'Low-potassium diet', fx: { k: -3 } });
    }
    if (inr && num(inr.value) > 3) out.push({ id: 'vit-k', label: 'Give vitamin K', fx: { bleed: -14 }, opts: { key: 'dose', label: 'dose', def: 2.5, choices: [[1, '1 mg PO'], [2.5, '2.5 mg PO'], [5, '5 mg PO'], [10, '10 mg IV']] }, fxFn: (o) => ({ bleed: VK[o.dose].bleed }) });
    const n = T.news2 ? T.news2(p) : { sc: 0 };
    if (n.sc >= 5) out.push({ id: 'rrt', label: 'Rapid response review + escalate monitoring', fx: { det: -12 } });
    if (p.vitals && p.vitals.spo2 <= 93) out.push({ id: 'o2', label: 'Titrate oxygen to SpO₂ 94–98%', fx: { det: -6 } });
    out.push({ id: 'fu7', label: 'Follow-up visit within 7 days of discharge', fx: { readmit: -4 } });
    out.push({ id: 'mr', label: 'Pharmacist med reconciliation at discharge', fx: { readmit: -3 } });
    out.forEach((l) => { Object.keys(l.fx).forEach((r) => { l.fx[r] = +l.fx[r]; }); });
    return out;
  }
  const optOf = (l, opt) => (l.opts ? Object.assign({ [l.opts.key]: l.opts.def }, (opt || {})[l.id]) : {});
  const lfx = (l, opt) => (l.fxFn ? l.fxFn(optOf(l, opt)) : l.fx);

  /* ---------- Risks ---------- */
  function risks(p) {
    const n = T.news2 ? T.news2(p) : { sc: 0, risk: 'Low' };
    const meds = activeMeds(p);
    const k = lab(p, /^potassium/i), cr = lab(p, /^creatinine/i), inr = lab(p, /^INR/i);
    const ckd = has(p, /CKD|kidney|renal|N18/i);
    const det = { id: 'det', name: 'Clinical deterioration · 24 h', base: n.sc >= 7 ? 45 : n.sc >= 5 ? 25 : 4 + n.sc * 3, drivers: [`NEWS2 ${n.sc} (${n.risk.toLowerCase()})`] };
    if (p.vitals.spo2 <= 95) det.drivers.push(`SpO₂ ${p.vitals.spo2}%`);
    if (p.vitals.hr > 90) det.drivers.push(`Heart rate ${p.vitals.hr}`);
    const kr = { id: 'k', name: 'Hyperkalaemia / AKI · 72 h', base: 3, drivers: [] };
    if (k) { const kv = num(k.value); if (kv > 5.5) { kr.base += 35; kr.drivers.push(`Potassium ${k.value}`); } else if (kv > 5.0) { kr.base += 15; kr.drivers.push(`Potassium ${k.value}`); } }
    if (ckd) { kr.base += 10; kr.drivers.push('Chronic kidney disease'); }
    if (cr && cr.flag) { kr.base += 10; kr.drivers.push(`Creatinine ${cr.value}`); }
    meds.filter((m) => ARB.test(m.drug) || KSPARE.test(m.drug)).forEach((m) => { kr.base += 12; kr.drivers.push(`${m.drug} (raises K)`); });
    meds.filter((m) => NSAID.test(m.drug)).forEach((m) => { kr.base += 6; kr.drivers.push(`${m.drug} (NSAID)`); });
    if (p.age >= 65) { kr.base += 5; kr.drivers.push(`Age ${p.age}`); }
    const bl = { id: 'bleed', name: 'Major bleeding · 30 d', base: 2, drivers: [] };
    meds.filter((m) => ANTICOAG.test(m.drug)).forEach((m) => { bl.base += 14; bl.drivers.push(`${m.drug} (anticoagulant)`); });
    meds.filter((m) => ANTIPLT.test(m.drug)).forEach((m) => { bl.base += 5; bl.drivers.push(`${m.drug} (antiplatelet)`); });
    if (inr) { const iv = num(inr.value); if (iv > 3) { bl.base += 30; bl.drivers.push(`INR ${inr.value}`); } else if (iv > 2) { bl.base += 8; bl.drivers.push(`INR ${inr.value}`); } }
    if (p.age >= 75) { bl.base += 5; bl.drivers.push(`Age ${p.age}`); }
    if (ckd) { bl.base += 4; bl.drivers.push('Chronic kidney disease'); }
    const rd = { id: 'readmit', name: '30-day readmission', base: 5 + p.problems.length * 2.5, drivers: [`${p.problems.length} active problems`] };
    if (p.age >= 65) { rd.base += 5; rd.drivers.push(`Age ${p.age}`); }
    if (isDM(p)) { rd.base += 3; rd.drivers.push('Diabetes'); }
    if (has(p, /heart failure|CKD|COPD/i)) { rd.base += 4; rd.drivers.push('Heart, kidney or lung failure'); }
    if (/admitted|emergency/i.test(p.status)) { rd.base += 4; rd.drivers.push('Current admission'); }
    const out = [det, kr, bl, rd];
    if (isAF(p)) {
      const c = cha2ds2(p); const on = meds.some((m) => /warfarin|apixaban|rivaroxaban|dabigatran/i.test(m.drug));
      out.push({ id: 'stroke', name: 'Stroke / embolism · 1 yr', base: on ? c.rate * 0.36 : c.rate, dec: true, min: c.rate * 0.36, max: c.rate, drivers: [`CHA₂DS₂-VASc ${c.c} (${c.rate}%/yr untreated)`, on ? 'Anticoagulated' : 'Anticoagulation held: unprotected'] });
    }
    return out.map((r) => Object.assign(r, { base: rfmt(r, r.base), drivers: r.drivers.length ? r.drivers : ['No major drivers in the record'] }));
  }
  const rfmt = (r, x) => (r.dec ? Math.round(clamp(x, 0.1, 95) * 10) / 10 : Math.max(1, Math.min(95, Math.round(x))));
  function riskWith(r, lv, set, opt) {
    let delta = 0;
    lv.forEach((l) => { const d = lfx(l, opt)[r.id]; if (!d) return; if (set.has(l.id) && !l.pre) delta += d; if (l.pre && !set.has(l.id)) delta -= d; });
    const sim = rfmt(r, clamp(r.base + delta, r.min != null ? r.min : -1e9, r.max != null ? r.max : 1e9));
    return { delta: Math.round((sim - r.base) * 10) / 10, sim };
  }
  const baseSet = (lv) => new Set(lv.filter((l) => l.pre).map((l) => l.id));

  /* ---------- Hourly 72-hour projection ----------
     Each lab starts at its latest result and follows a simple, explainable curve set by what is in
     play: insulin shifts potassium within 2 h and wears off by about 12 h, a binder keeps pulling it
     down, holding an ARB stops the upward drift; with warfarin held INR decays slowly, vitamin K
     reverses it at a speed and depth set by its dose, and a restart pushes it back up after about a
     day. Glucose follows meals and dips after insulin. Potassium above 6.5 slows the heart and adds
     to NEWS2, so the systems are coupled. */
  const SD = { k: (t) => 0.08 + 0.006 * t, inr: (t) => 0.1 + 0.012 * t, cr: (t) => 0.02 + 0.0015 * t, glu: (t) => 8 + 0.5 * t, news: (t) => 0.3 + 0.025 * t, hr: (t) => 3 + 0.12 * t };
  function project(p, lv, set, opt) {
    opt = opt || {};
    const medHeld = (i) => { const l = lv.find((x) => x.med === i); return l ? set.has(l.id) : isHeld(p.meds[i]); };
    const raisers = p.meds.map((m, i) => [m, i]).filter(([m, i]) => (ARB.test(m.drug) || KSPARE.test(m.drug) || NSAID.test(m.drug)) && !medHeld(i));
    const heldRaisers = p.meds.map((m, i) => [m, i]).filter(([m, i]) => (ARB.test(m.drug) || KSPARE.test(m.drug)) && medHeld(i));
    const warfOn = p.meds.some((m, i) => /warfarin/i.test(m.drug) && !medHeld(i));
    const ckd = has(p, /CKD|kidney|renal|N18/i);
    const on = (id) => set.has(id);
    const o = (id) => { const l = lv.find((x) => x.id === id); return l ? optOf(l, opt) : {}; };
    const out = { sd: {} };
    const kL = lab(p, /^potassium/i);
    const kAt = o('k-treat').at || 0;
    if (kL) {
      const k0 = num(kL.value);
      let drift = (raisers.length ? 0.005 * raisers.length : heldRaisers.length ? -0.003 : (4.4 - k0) / 120) + (ckd ? 0.002 : 0);
      const obsK = T.hist && T.hist.slope(p, kL.test, 96); // measured trend over the last 4 days
      if (obsK != null && !heldRaisers.length) drift = clamp(0.5 * drift + 0.5 * obsK, -0.02, 0.02);
      out.kObs = obsK;
      out.k = HOURS.map((t) => {
        let k = k0 + drift * t;
        const s = t - kAt;
        if (on('k-treat') && s > 0) k += -0.9 * Math.min(s / 2, 1) + (s > 4 ? 0.55 * Math.min((s - 4) / 8, 1) : 0) - Math.min(0.01 * s, 1.0);
        if (on('k-diet')) k -= Math.min(0.003 * t, 0.25);
        return clamp(k, 2.8, 7.8);
      });
    }
    const iL = lab(p, /^INR/i);
    if (iL) {
      const i0 = num(iL.value);
      const vk = on('vit-k') ? VK[o('vit-k').dose] : null;
      const rs = on('warf-restart') ? o('warf-restart').at : null;
      out.inr = HOURS.map((t) => {
        let v = warfOn ? i0 + (i0 > 3 ? 0.006 : 0.004) * t : 1.1 + (i0 - 1.1) * Math.exp(-t / 42);
        if (vk) v = Math.min(v, vk.tgt + (i0 - vk.tgt) * Math.exp(-t / vk.tau));
        if (rs != null) v += Math.min(1.2, 0.035 * Math.max(0, t - rs - 24)) * (vk && vk.tgt <= 1.2 ? 0.4 : 1); // high-dose vitamin K blunts warfarin
        return clamp(v, 0.9, 9);
      });
    }
    const n0 = T.news2 ? T.news2(p).sc : 0;
    const cL = lab(p, /^creatinine/i);
    if (cL) {
      const c0 = num(cL.value), hi = refHi(cL, 1.3);
      let d = (raisers.length && ckd ? 0.0015 * raisers.length : 0) + (heldRaisers.length ? -0.001 : 0) + (n0 >= 5 && !on('rrt') ? 0.002 : 0) + (raisers.some(([m]) => NSAID.test(m.drug)) ? 0.002 : 0);
      const obsC = T.hist && T.hist.slope(p, cL.test, 96);
      if (obsC != null && !heldRaisers.length) d = clamp(0.5 * d + 0.5 * obsC, -0.01, 0.01);
      out.cr = HOURS.map((t) => clamp(c0 + d * t, Math.min(c0, hi - 0.1), 9));
    }
    if (isDM(p) || lv.some((l) => l.id === 'k-treat') || lab(p, /glucose/i)) {
      const gl = lab(p, /^glucose/i), a1c = lab(p, /HbA1c/i);
      const g0 = gl ? num(gl.value) : a1c ? 28.7 * num(a1c.value) - 46.7 : isDM(p) ? 160 : 105;
      const meal = isDM(p) ? 48 : 22, h0 = nowHour();
      const bump = (hh) => [8.5, 13.5, 19.5].reduce((a, m) => a + gauss(((hh - m + 36) % 24) - 12, 0, 1.1, meal), 0);
      out.glu = HOURS.map((t) => {
        let g = g0 + bump(h0 + t) - bump(h0);
        const s = t - kAt;
        if (on('k-treat') && s > 0) g -= (isDM(p) ? 70 : 62) * (s / 1.2) * Math.exp(1 - s / 1.2);
        return clamp(g, 35, 450);
      });
      out.gluSrc = gl ? 'latest glucose' : a1c ? `estimated from HbA1c ${a1c.value}%` : 'typical for this patient';
    }
    const hr0 = p.vitals.hr, sp0 = p.vitals.spo2, rr0 = p.vitals.rr;
    out.hr = HOURS.map((t, i) => { let h = hr0; if (t === 0) return hr0; const k = out.k && out.k[i]; if (k > 6.5) h -= 14; else if (k > 6.0) h -= 5; if (on('rrt') && hr0 > 100) h -= (hr0 - 95) * (1 - Math.exp(-t / 12)); return clamp(h, 30, 180); });
    out.spo2 = HOURS.map((t) => clamp(sp0 + (on('o2') && t >= 1 ? Math.min(3, 97 - sp0) : 0), 70, 100));
    out.rr = HOURS.map((t) => clamp(rr0 + (n0 >= 5 && !on('rrt') ? 0.04 * t : on('rrt') && rr0 > 20 ? -(rr0 - 18) * (1 - Math.exp(-t / 12)) : 0), 6, 40));
    out.news = HOURS.map((t, i) => {
      let v = n0 >= 5 ? (on('rrt') ? 2 + (n0 - 2) * Math.exp(-t / 18) : n0 + 0.03 * t) : n0 - Math.min(0.01 * t, 1);
      if (on('o2') && t >= 1) v -= 1;
      if (out.k && out.k[i] > 6.5) v += 1;
      return clamp(v, 0, 14);
    });
    Object.keys(SD).forEach((id) => { const key = id === 'glu' ? 'glu' : id; if (out[key]) out.sd[key] = HOURS.map((t) => SD[id](t)); });
    out.levels = HOURS.map((t, i) => {
      const ov = { Potassium: out.k && out.k[i], INR: out.inr && out.inr[i], Creatinine: out.cr && out.cr[i], Glucose: out.glu && out.glu[i] };
      return Object.fromEntries(SYSTEMS.map((s) => [s.id, i === 0 ? systemState(p, s).level : systemState(p, s, ov).level]));
    });
    return out;
  }
  const METRICS = (p) => {
    const cL = lab(p, /^creatinine/i), c0 = cL ? num(cL.value) : 0;
    return [
      { id: 'k', name: 'Potassium', unit: 'mmol/L', lo: 3.5, hi: 5.1, f: (v) => v.toFixed(1), th: [{ v: 6.5, label: 'severe hyperkalaemia (ECG changes likely)', up: 'crit', down: 'ok' }, { v: 6.0, label: 'the critical limit', up: 'crit', down: 'ok' }, { v: 5.1, label: 'the upper limit of normal', up: 'warn', down: 'ok' }] },
      { id: 'inr', name: 'INR', unit: '', lo: 2.0, hi: 3.0, f: (v) => v.toFixed(1), th: [{ v: 4.5, label: 'the bleeding-risk level', up: 'crit', down: 'ok' }, { v: 3.0, label: 'the top of the target range', up: 'warn', down: 'ok' }, { v: 2.0, label: 'the target range (stroke protection lost)', up: 'ok', down: 'warn' }] },
      { id: 'cr', name: 'Creatinine', unit: 'mg/dL', lo: 0.7, hi: refHi(cL, 1.3), f: (v) => v.toFixed(2), th: [{ v: +(c0 + 0.3).toFixed(2), label: 'AKI (KDIGO: +0.3 mg/dL)', up: 'crit', down: 'ok' }] },
      { id: 'glu', name: 'Glucose', unit: 'mg/dL', lo: 70, hi: 180, f: (v) => String(Math.round(v)), th: [{ v: 250, label: 'hyperglycaemia', up: 'warn', down: 'ok' }, { v: 70, label: 'hypoglycaemia', up: 'ok', down: 'crit' }] },
      { id: 'news', name: 'NEWS2', unit: '', lo: 0, hi: 4, f: (v) => String(Math.round(v)), th: [{ v: 7, label: 'emergency response', up: 'crit', down: 'ok' }, { v: 5, label: 'urgent response', up: 'warn', down: 'ok' }] },
      { id: 'hr', name: 'Heart rate', unit: 'bpm', lo: 60, hi: 100, f: (v) => String(Math.round(v)), th: [{ v: 110, label: 'the AF rate-control target', up: 'warn', down: 'ok' }, { v: 50, label: 'bradycardia', up: 'ok', down: 'warn' }] }
    ];
  };
  function crossings(series, m) {
    const out = [];
    m.th.forEach((th) => {
      const s0 = series[0];
      const i = series.findIndex((v) => (s0 < th.v ? v >= th.v : v < th.v));
      if (i > 0) out.push({ h: HOURS[i], cls: s0 < th.v ? th.up : th.down, text: `${m.name} ${s0 < th.v ? 'rises above' : 'falls below'} ${m.f(th.v)}: ${th.label}` });
    });
    return out;
  }
  const events = (p, proj) => METRICS(p).filter((m) => proj[m.id]).flatMap((m) => crossings(proj[m.id], m)).sort((a, b) => a.h - b.h);

  /* ---------- Pharmacokinetics ----------
     One-compartment models with textbook parameters, dosed on the ward schedule. Kidney-cleared
     drugs use the twin's computed CrCl. Record = what is charted now; levers stop, resume or restart
     doses. */
  const PKT = Array.from({ length: H * 4 + 1 }, (_, i) => i / 4);
  const PK = [
    { re: /meropenem/i, name: 'Meropenem', route: 'IV', vd: (p) => 0.3 * (p.weightKg || 70), t12: (c) => 1.0 * Math.pow(clamp(100 / (c || 100), 1, 10), 0.9), unit: 'mg/L', scale: 1, f: (v) => v.toFixed(1), mic: 2, def: 1000, sched: [6, 14, 22], renal: true, note: 'Time above the MIC drives killing; target ≥40% of the interval.' },
    { re: /metoprolol/i, name: 'Metoprolol', route: 'PO', F: 0.5, ka: 1.5, vd: (p) => 4.2 * (p.weightKg || 70), t12: () => 3.5, unit: 'ng/mL', scale: 1000, f: (v) => v.toFixed(0), def: 25, note: 'Cleared by the liver (CYP2D6); kidney function does not change it.' },
    { re: /telmisartan/i, name: 'Telmisartan', route: 'PO', F: 0.43, ka: 1.2, vd: () => 500, t12: () => 24, unit: 'ng/mL', scale: 1000, f: (v) => v.toFixed(0), def: 40, note: 'Long half-life: holding it lowers levels over days, not hours.' },
    { re: /warfarin/i, name: 'Warfarin', route: 'PO', F: 1, ka: 1.5, vd: (p) => 0.14 * (p.weightKg || 70), t12: () => 40, unit: 'mg/L', scale: 1, f: (v) => v.toFixed(2), def: 5, band: [0.5, 3], note: 'INR lags the level by about 36 h because clotting factors take days to turn over.' }
  ];
  const schedOf = (freq, d) => (d.sched ? d.sched : /bid|twice/i.test(freq) ? [8, 20] : /nightly|bedtime/i.test(freq) ? [21] : /q8/i.test(freq) ? [6, 14, 22] : /q12/i.test(freq) ? [8, 20] : [8]);
  function pkSeries(p, lv, set, opt) {
    const cr = scores(p).find((s) => s.k === 'CrCl'), crcl = cr ? cr.raw : 90;
    const h0 = nowHour();
    const sources = p.meds.map((m, i) => ({ drug: m.drug, dose: m.dose, freq: m.freq, held: isHeld(m), i }))
      .concat((S().hai || []).filter((x) => x.patient === p.id && x.tx).map((x) => ({ drug: x.tx.split(' ')[0], dose: x.tx.split(' ').slice(1, 3).join(' '), freq: x.tx, held: false })));
    const home = (T.SEED.homeMeds || {})[p.id] || [];
    const res = [];
    sources.forEach((s) => {
      const d = PK.find((x) => x.re.test(s.drug)); if (!d || res.some((r) => r.name === d.name)) return;
      let mg = num(s.dose); if (/\bg\b/.test(s.dose) && mg < 10) mg *= 1000;
      if (!mg) { const hm = home.find((x) => d.re.test(x)); mg = hm ? num(hm.split(' ').slice(1).join(' ')) : d.def; }
      const hours = schedOf(s.freq || '', d);
      const ke = Math.LN2 / d.t12(crcl), V = d.vd(p);
      const doses = (mode) => {
        const out = [];
        const l = s.i != null ? lv.find((x) => x.med === s.i) : null;
        const heldNow = mode === 'base' ? s.held : l ? set.has(l.id) : s.held;
        const restart = mode === 'sim' && /warfarin/i.test(s.drug) && set.has('warf-restart') ? optOf(lv.find((x) => x.id === 'warf-restart'), opt).at : null;
        for (let day = -8; day <= 4; day++) hours.forEach((hh) => {
          const t = day * 24 + hh - h0; if (t < -190 || t > H) return;
          if (t < 0) { if (!s.held || t <= -30) out.push([t, mg]); return; } // the past is fixed; held drugs stopped ~30 h ago
          if (!heldNow) out.push([t, mg]); else if (restart != null && t >= restart) out.push([t, mg * 0.5]);
        });
        return out;
      };
      const conc = (ds) => PKT.map((t) => ds.reduce((a, [td, D]) => { const tau = t - td; if (tau < 0) return a; if (d.route === 'IV') return a + (D / V) * Math.exp(-ke * tau); return a + (d.F * D / V) * (d.ka / (d.ka - ke)) * (Math.exp(-ke * tau) - Math.exp(-d.ka * tau)); }, 0) * d.scale);
      const bd = doses('base'), sd = doses('sim');
      const base = conc(bd), sim = conc(sd);
      const stats = (ser) => { const last = ser.slice(-97); return { cmax: Math.max(...last), cmin: Math.min(...last), tmic: d.mic ? Math.round(100 * ser.filter((v) => v >= d.mic).length / ser.length) : null }; };
      res.push({ id: 'pk-' + d.name.toLowerCase(), name: d.name, d, mg, hours, t12: d.t12(crcl), crcl, base, sim, bst: stats(base), sst: stats(sim), doses: sd.filter(([t]) => t >= 0 && t <= H).map(([t]) => t) });
    });
    const asp = p.meds.findIndex((m) => /aspirin/i.test(m.drug));
    if (asp >= 0) {
      const l = lv.find((x) => x.med === asp), held0 = isHeld(p.meds[asp]), heldS = l ? set.has(l.id) : held0;
      const eff = (held) => PKT.map((t) => (held ? clamp(95 - (10 / 24) * (t + (held0 ? 24 : 0)), 5, 95) : 95));
      res.push({ id: 'pk-aspirin', name: 'Aspirin', effect: true, base: eff(held0), sim: eff(heldS), d: { unit: '% platelets inhibited', f: (v) => v.toFixed(0), note: 'Aspirin blocks platelets for their whole life; about 10% are replaced each day after stopping.' } });
    }
    return res;
  }

  /* ---------- Data confidence ---------- */
  function confidence(p) {
    const recent = (re) => { const l = lab(p, re); return l && (l.dOff == null || l.dOff >= -1); };
    const anticoag = p.meds.some((m) => ANTICOAG.test(m.drug));
    const mr = ((S().medrec || {})[p.id] || {}).admission;
    const checks = [
      ['Vital signs on the flowsheet', !!p.vitals],
      ['Potassium in the last 24 h', recent(/^potassium/i)],
      ['Creatinine in the last 24 h', recent(/^creatinine/i)],
      ['Weight and height (for dosing)', !!(p.weightKg && p.heightCm)],
      ['Allergies documented', !p.allergiesUnknown],
      ['Problem list coded (ICD-10)', p.problems.length > 0 && p.problems.every((x) => /\([A-Z]\d/.test(x))],
      ['Admission med reconciliation', !!(mr && mr.by)],
      ['Signed note in the last 24 h', (S().notes || []).some((n) => n.patient === p.id && n.signed && (n.mOff == null || n.mOff < 1440))]
    ];
    if (anticoag) checks.splice(3, 0, ['INR in the last 24 h (anticoagulated)', recent(/^INR/i)]);
    if (isDM(p)) checks.push(['Glucose in the last 24 h (diabetic)', recent(/^glucose/i)]);
    return { checks, score: Math.round(100 * checks.filter((c) => c[1]).length / checks.length) };
  }

  /* ---------- Anatomy (organ level) ---------- */
  const ANAT = [
    { id: 'spine', sys: 'msk', name: 'Spine', line: 1, d: '<path d="M120 112V334"/>' },
    { id: 'aorta', sys: 'heart', name: 'Aorta', line: 1, d: '<path d="M130 170c0-14 13-16 15-5v40c0 30-10 50-12 96"/>' },
    { id: 'brain', sys: 'neuro', name: 'Brain', d: '<path d="M96 40c0-15 10-25 24-25s24 10 24 25c0 11-10 18-24 18S96 51 96 40z"/>', deco: '<path class="dc" d="M104 34c5-4 9 2 14-2m4 0c5 4 9-2 14 2M102 44c6 3 10-2 16 1m4 0c6 3 10-2 16-1M120 18v38"/>' },
    { id: 'thyroid', sys: 'endo', name: 'Thyroid', fixed: (p) => (has(p, /thyroid/i) || lab(p, /TSH/i) ? Math.max(1, systemState(p, SYSTEMS[5]).level) : 0), d: '<path d="M112 92c-4 0-6 4-5 8s6 5 9 3l4-3 4 3c3 2 8 1 9-3s-1-8-5-8c-3 0-5 2-8 4-3-2-5-4-8-4z"/>' },
    { id: 'trachea', sys: 'lungs', name: 'Airway', d: '<rect x="117" y="102" width="6" height="30" rx="3"/>' },
    { id: 'lungR', sys: 'lungs', name: 'Right lung', d: '<path d="M113 134c-15-3-28 10-30 33-2 24 1 42 9 51 9 7 19 2 21-9z"/>', deco: '<path class="dc" d="M88 170c8 2 14 0 22-6M86 196c9 0 16-3 24-10"/>' },
    { id: 'lungL', sys: 'lungs', name: 'Left lung', d: '<path d="M127 134c15-3 28 10 30 33 2 24-1 42-9 51-9 7-19 2-21-9z"/>', deco: '<path class="dc" d="M152 180c-8 2-15-1-22-6"/>' },
    { id: 'heart', sys: 'heart', name: 'Heart', d: '<path d="M124 170c-7-8-22-5-22 8 0 12 15 23 26 31 11-8 23-19 23-31 0-13-15-15-22-7l-2 3z"/>', deco: '<path class="dc" d="M126 176c-2 10 0 20 2 30M110 184c10 4 22 4 36-2"/>' },
    { id: 'liver', sys: 'gi', name: 'Liver', d: '<path d="M80 230c11-11 48-13 61-2-2 15-21 25-42 27-13 0-21-10-19-25z"/>' },
    { id: 'stomach', sys: 'gi', name: 'Stomach', d: '<path d="M141 229c15-7 25 4 21 19-4 15-19 19-28 11 9-7 9-19 7-30z"/>' },
    { id: 'spleen', sys: 'blood', name: 'Spleen', d: '<ellipse cx="165" cy="238" rx="6" ry="11" transform="rotate(18 165 238)"/>' },
    { id: 'pancreas', sys: 'endo', name: 'Pancreas', d: '<path d="M104 264c15-6 36-5 50-1-2 8-24 10-50 7z"/>' },
    { id: 'kidR', sys: 'kidney', name: 'Right kidney', d: '<path d="M97 274c-8 0-12 8-11 15s5 13 12 13c5 0 6-4 4-8-2-3-2-7 0-10s2-10-5-10z"/>' },
    { id: 'kidL', sys: 'kidney', name: 'Left kidney', d: '<path d="M143 274c8 0 12 8 11 15s-5 13-12 13c-5 0-6-4-4-8 2-3 2-7 0-10s-2-10 5-10z"/>' },
    { id: 'bowel', sys: 'gi', name: 'Bowel', d: '<rect x="100" y="304" width="40" height="30" rx="13"/>', deco: '<path class="dc" d="M106 314c8-4 12 4 20 0s10 4 10 4M106 324c8-4 12 4 20 0s10 4 10 4"/>' },
    { id: 'bladder', sys: 'kidney', name: 'Bladder', fixed: (p) => ((S().hai || []).some((h) => h.patient === p.id && /CAUTI/.test(h.type)) ? 1 : 0), d: '<ellipse cx="120" cy="347" rx="11" ry="8"/>' },
    { id: 'hipR', sys: 'msk', name: 'Right hip', d: '<circle cx="101" cy="356" r="6"/>' },
    { id: 'hipL', sys: 'msk', name: 'Left hip', d: '<circle cx="139" cy="356" r="6"/>' },
    { id: 'femR', sys: 'blood', name: 'Bone marrow (right femur)', line: 1, d: '<path d="M101 364l-2 62"/>' },
    { id: 'femL', sys: 'blood', name: 'Bone marrow (left femur)', line: 1, d: '<path d="M139 364l2 62"/>' },
    { id: 'kneeR', sys: 'msk', name: 'Right knee', d: '<circle cx="99" cy="434" r="7"/>' },
    { id: 'kneeL', sys: 'msk', name: 'Left knee', d: '<circle cx="141" cy="434" r="7"/>' }
  ];
  const SIL = '<g class="sil"><ellipse class="o" cx="120" cy="42" rx="31" ry="35"/><rect class="o" x="105" y="70" width="30" height="38" rx="9"/>' +
    '<path class="lo" d="M70 122Q52 142 48 202Q44 252 40 312M170 122Q188 142 192 202Q196 252 200 312M100 340Q98 420 100 500M140 340Q142 420 140 500"/>' +
    '<path class="o" d="M70 110Q120 96 170 110Q182 115 179 132L171 220Q166 262 172 300Q176 332 160 352L80 352Q64 332 68 300Q74 262 69 220L61 132Q58 115 70 110Z"/>' +
    '<path class="li" d="M70 122Q52 142 48 202Q44 252 40 312M170 122Q188 142 192 202Q196 252 200 312M100 340Q98 420 100 500M140 340Q142 420 140 500"/>' +
    '<ellipse class="f" cx="120" cy="42" rx="30" ry="34"/><rect class="f" x="106" y="71" width="28" height="38" rx="8"/>' +
    '<path class="f" d="M70 111Q120 97 170 111Q181 116 178 132L170 220Q165 262 171 300Q175 331 159 351L81 351Q65 331 69 300Q75 262 70 220L62 132Q59 116 70 111Z"/></g>';
  function organLevel(p, a, lvls) { return a.fixed ? a.fixed(p) : lvls[a.sys]; }
  function body(p, sel, lvls) {
    const organs = ANAT.map((a) => `<g class="org ${a.line ? 'ln' : ''} lv${organLevel(p, a, lvls)} ${sel === a.sys ? 'sel' : ''}" data-act="pt-twin-sys" data-p="${p.id}" data-s="${a.sys}" data-o="${a.id}" ${a.fixed ? 'data-fixed="1"' : ''} role="button" tabindex="0" aria-label="${esc(a.name)}"><title>${esc(a.name)} · ${esc(SYSTEMS.find((s) => s.id === a.sys).name)}</title>${a.d}${a.deco || ''}</g>`).join('');
    return `<svg class="ptwin-body" viewBox="20 0 200 510" aria-label="Body map by organ">${SIL}${organs}</svg>`;
  }

  /* ---------- Charts ---------- */
  let GEO = {};
  const CW = 560, CH = 200, CL = 46, CR = 14, CT = 14, CB = 28;
  function chart(m, base, sim, h, sd) {
    const N = sim.length, i = Math.round(h / H * (N - 1)), past = (m.past || []).filter((q) => q.h >= -72 && q.h <= 0), tmin = past.length ? -72 : 0;
    const up = sd ? sim.map((v, j) => v + 1.28 * sd[Math.round(j / (N - 1) * H)]) : null, dn = sd ? sim.map((v, j) => v - 1.28 * sd[Math.round(j / (N - 1) * H)]) : null;
    const vals = [...base, ...sim, ...past.map((q) => q.v), ...(up || []), ...(dn || []), ...(m.lo != null ? [m.lo, m.hi] : []), ...(m.th || []).map((t) => t.v)];
    let y0 = m.zero ? 0 : Math.min(...vals), y1 = Math.max(...vals); const pad = (y1 - y0) * 0.08 || 1; if (!m.zero) y0 -= pad; y1 += pad;
    const xt = (t) => CL + (t - tmin) / (H - tmin) * (CW - CL - CR), x = (j) => xt(j / (N - 1) * H), y = (v) => CT + (1 - (v - y0) / (y1 - y0)) * (CH - CT - CB);
    const path = (a) => a.map((v, j) => `${j ? 'L' : 'M'}${x(j).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    GEO[m.id] = { N, x: sim.map((_, j) => x(j)), yb: base.map(y), ys: sim.map(y), base, sim, f: m.f };
    const band = m.lo != null ? `<rect class="cband" x="${CL}" width="${CW - CL - CR}" y="${y(Math.min(m.hi, y1))}" height="${Math.max(0, y(Math.max(m.lo, y0)) - y(Math.min(m.hi, y1)))}"/>` : '';
    const unc = up ? `<path class="cunc" d="${path(up)}${dn.map((v, j) => `L${x(N - 1 - j).toFixed(1)} ${y(dn[N - 1 - j]).toFixed(1)}`).join('')}Z"/>` : '';
    const ths = (m.th || []).filter((t) => t.v > y0 && t.v < y1).map((t) => `<line class="cth ${t.up === 'crit' || t.down === 'crit' ? 'crit' : ''}" x1="${CL}" x2="${CW - CR}" y1="${y(t.v)}" y2="${y(t.v)}"/><text class="ctl" x="${CW - CR}" y="${y(t.v) - 3}" text-anchor="end">${esc(t.tag || m.f(t.v))}</text>`).join('');
    const tk = past.length ? [-72, -48, -24, 0, 24, 48, 72] : [0, 12, 24, 36, 48, 60, 72];
    const xtk = tk.map((hh) => `<text class="ctx" x="${xt(hh)}" y="${CH - 8}" text-anchor="middle">${past.length || hh % 24 === 0 || hh === 12 ? (hh < 0 ? `−${-hh} h` : hLabel(hh)) : ''}</text><line class="cgrid ${hh === 0 && past.length ? 'cnow' : ''}" x1="${xt(hh)}" x2="${xt(hh)}" y1="${CT}" y2="${CH - CB}"/>`).join('');
    const pastSvg = past.length ? `<rect class="cpastbg" x="${CL}" y="${CT}" width="${xt(0) - CL}" height="${CH - CT - CB}"/><polyline class="cpast" points="${past.map((q) => `${xt(q.h).toFixed(1)},${y(q.v).toFixed(1)}`).join(' ')} ${xt(0).toFixed(1)},${y(sim[0]).toFixed(1)}"/>${past.filter((q) => !q.interp).map((q) => `<circle class="cpd ${q.flag ? 'fl' : ''}" r="3" cx="${xt(q.h).toFixed(1)}" cy="${y(q.v).toFixed(1)}"><title>Measured ${esc(m.f(q.v))} at ${q.h} h</title></circle>`).join('')}<text class="ctl" x="${CL + 4}" y="${CT + 11}">Measured</text><text class="ctl" x="${xt(0) + 4}" y="${CT + 11}">Forecast</text>` : '';
    const ticks = Array.from({ length: 4 }, (_, k) => y0 + (y1 - y0) * (k + 0.5) / 4);
    const yt = ticks.map((v) => `<text class="ctx" x="${CL - 6}" y="${y(v) + 4}" text-anchor="end">${esc(m.f(v))}</text>`).join('');
    const marks = (m.marks || []).map((t) => `<line class="cdose" x1="${x(t / H * (N - 1))}" x2="${x(t / H * (N - 1))}" y1="${CH - CB}" y2="${CH - CB - 6}"/>`).join('');
    return `<svg class="tchart" viewBox="0 0 ${CW} ${CH}" data-m="${m.id}" role="img" aria-label="${esc(m.name)} over 72 hours">
      ${band}${xtk}${pastSvg}${unc}${ths}${yt}${marks}
      <path class="cbase" d="${path(base)}"/><path class="csim" d="${path(sim)}"/>
      <line class="cscrub" x1="${x(i)}" x2="${x(i)}" y1="${CT}" y2="${CH - CB}"/>
      <circle class="cdot b" r="3.5" cx="${x(i)}" cy="${y(base[i])}"/><circle class="cdot s" r="4.5" cx="${x(i)}" cy="${y(sim[i])}"/></svg>`;
  }

  /* ---------- Simulated bedside monitor ----------
     Waveforms are synthesised from the twin at the selected hour, never from a device: rate and
     rhythm (AF is irregularly irregular with no P waves), SpO₂ and respiration, and ECG shape from
     projected potassium (peaked T above 5.5; flat P and wide QRS above 6.5). */
  const MON = { hr: 80, spo2: 97, rr: 16, k: 4.2, af: false, bp: '120/80', raf: 0 };
  function monSet(sim, p, h) {
    Object.assign(MON, { hr: sim.hr[h], spo2: sim.spo2[h], rr: sim.rr[h], k: sim.k ? sim.k[h] : null, af: isAF(p), bp: p.vitals.bp });
    const set = (k, v) => document.querySelectorAll(`[data-mon="${k}"]`).forEach((el) => { el.textContent = v; });
    set('hr', Math.round(MON.hr)); set('spo2', Math.round(MON.spo2)); set('rr', Math.round(MON.rr)); set('bp', MON.bp);
    set('rhythm', rhythmText());
  }
  function rhythmText() {
    const r = [MON.af ? 'Atrial fibrillation, irregularly irregular' : 'Sinus rhythm'];
    if (MON.k != null && MON.k > 6.5) r.push(`wide QRS${MON.af ? '' : ', flat P'}, peaked T (K ${MON.k.toFixed(1)})`);
    else if (MON.k != null && MON.k > 5.5) r.push(`peaked T waves (K ${MON.k.toFixed(1)})`);
    else if (MON.k != null && MON.k < 3.5) r.push(`flat T, U waves (K ${MON.k.toFixed(1)})`);
    if (MON.hr < 50) r.push('bradycardia');
    return r.join(' · ');
  }
  function ecgAt(dt, tt) {
    const k = MON.k == null ? 4.2 : MON.k;
    const pk = k > 5.5 ? Math.min((k - 5.5) / 1.5, 1) : 0, wide = k > 6.5 ? 1 + Math.min((k - 6.5) * 0.9, 1.2) : 1, lowK = k < 3.5 ? 1 : 0;
    let v = 0;
    if (!MON.af) v += gauss(dt, 0.08, 0.022, k > 6.5 ? 0.03 : 0.12);
    else v += 0.035 * Math.sin(2 * Math.PI * 6.3 * tt) + 0.025 * Math.sin(2 * Math.PI * 9.7 * tt + 1.3);
    v += gauss(dt, 0.165, 0.009 * wide, -0.12) + gauss(dt, 0.185, 0.011 * wide, 1) + gauss(dt, 0.205 + 0.012 * (wide - 1), 0.012 * wide, -0.28);
    v += gauss(dt, 0.4 + 0.04 * (wide - 1), 0.05 - 0.024 * pk, lowK ? 0.05 : 0.22 + 0.5 * pk);
    if (lowK) v += gauss(dt, 0.56, 0.04, 0.1);
    return v;
  }
  function startMonitor() {
    cancelAnimationFrame(MON.raf);
    const cv = document.querySelector('canvas.twin-mon'); if (!cv) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, ht = cv.clientHeight; if (!w) return;
    cv.width = w * dpr; cv.height = ht * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const cs = getComputedStyle(cv), col = (n, d) => (cs.getPropertyValue(n) || d).trim();
    const C = { ecg: col('--mon-ecg', '#39e58c'), pl: col('--mon-pleth', '#4fd2f0'), rs: col('--mon-resp', '#f2c230'), bg: col('--mon-bg', '#041012'), grid: col('--mon-grid', '#0d2a2c') };
    const lanes = [{ k: 'ecg', y: ht * 0.04, h: ht * 0.44, lo: -0.45, hi: 1.15 }, { k: 'pl', y: ht * 0.52, h: ht * 0.24, lo: -0.05, hi: 1.15 }, { k: 'rs', y: ht * 0.78, h: ht * 0.2, lo: -1.1, hi: 1.1 }];
    const Y = (ln, v) => ln.y + ln.h * (1 - (v - ln.lo) / (ln.hi - ln.lo));
    const speed = 110; let t = 0, x = 0, beat = 0, rr = 60 / MON.hr, rr2 = rr, prev = null;
    const bgfill = (x0, wd) => { g.fillStyle = C.bg; g.fillRect(x0, 0, wd, ht); g.strokeStyle = C.grid; g.lineWidth = 1; for (let gx = Math.ceil(x0 / 22) * 22; gx < x0 + wd; gx += 22) { g.beginPath(); g.moveTo(gx + 0.5, 0); g.lineTo(gx + 0.5, ht); g.stroke(); } };
    bgfill(0, w);
    const sample = () => {
      while (t >= beat + rr) { beat += rr; rr2 = rr; rr = (60 / clamp(MON.hr, 25, 200)) * (MON.af ? 0.72 + Math.random() * 0.56 : 1); }
      const dt = t - beat;
      const ph = dt / rr2;
      return { ecg: ecgAt(dt, t) + (Math.random() - 0.5) * 0.012, pl: gauss(ph, 0.32, 0.075, 1) + gauss(ph, 0.52, 0.06, 0.32), rs: Math.sin(2 * Math.PI * (MON.rr / 60) * t) };
    };
    const step = () => {
      t += 1 / speed; x += 1;
      if (x >= w) { x = 0; prev = null; }
      const s = sample();
      bgfill(x, 14);
      if (prev) lanes.forEach((ln) => { g.strokeStyle = C[ln.k]; g.lineWidth = ln.k === 'ecg' ? 1.8 : 1.6; g.beginPath(); g.moveTo(x - 1, Y(ln, prev[ln.k])); g.lineTo(x, Y(ln, s[ln.k])); g.stroke(); });
      prev = s;
    };
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { for (let k = 0; k < w - 1; k++) step(); return; }
    let last = performance.now();
    const frame = (now) => {
      if (!cv.isConnected) return;
      const n = Math.min(40, Math.round((now - last) / 1000 * speed)); last = now;
      for (let k = 0; k < n; k++) step();
      MON.raf = requestAnimationFrame(frame);
    };
    MON.raf = requestAnimationFrame(frame);
  }
  T.after.push(() => startMonitor());
  const monitorHtml = (p) => `<section class="panel twin-monp"><header><h2>Bedside monitor <small class="muted" data-hour-label>${hLabel(0)}</small></h2><span class="kpi-note">Simulated from the twin, not a device feed</span></header>
    <div class="body flush"><div class="monwrap"><canvas class="twin-mon" aria-label="Simulated ECG, pleth and respiration traces"></canvas>
    <div class="monread"><div class="mr ecg"><span>HR</span><b data-mon="hr">–</b></div><div class="mr pl"><span>SpO₂</span><b data-mon="spo2">–</b></div><div class="mr rs"><span>RR</span><b data-mon="rr">–</b></div><div class="mr bp"><span>NIBP</span><b data-mon="bp">–</b></div></div></div>
    <p class="monnote" data-mon="rhythm"></p></div></section>`;

  /* ---------- Scrubbing and playback ---------- */
  let CUR = null;
  function scrubTo(h) {
    if (!CUR) return;
    Object.entries(GEO).forEach(([id, g]) => {
      const i = Math.round(h / H * (g.N - 1));
      const svg = document.querySelector(`svg.tchart[data-m="${id}"]`); if (!svg) return;
      svg.querySelectorAll('.cscrub').forEach((l) => { l.setAttribute('x1', g.x[i]); l.setAttribute('x2', g.x[i]); });
      const b = svg.querySelector('.cdot.b'), s = svg.querySelector('.cdot.s');
      b.setAttribute('cx', g.x[i]); b.setAttribute('cy', g.yb[i]); s.setAttribute('cx', g.x[i]); s.setAttribute('cy', g.ys[i]);
      document.querySelectorAll(`[data-read="${id}"]`).forEach((el) => { el.textContent = g.f(g.sim[i]); });
      document.querySelectorAll(`[data-read-b="${id}"]`).forEach((el) => { el.textContent = g.f(g.base[i]); });
    });
    const lv = CUR.sim.levels[h];
    ANAT.forEach((a) => { if (a.fixed) return; document.querySelectorAll(`.org[data-o="${a.id}"]`).forEach((g) => { g.classList.remove('lv0', 'lv1', 'lv2'); g.classList.add('lv' + lv[a.sys]); }); });
    SYSTEMS.forEach((s) => document.querySelectorAll(`.sysrow[data-s="${s.id}"]`).forEach((r) => { r.classList.remove('lv0', 'lv1', 'lv2'); r.classList.add('lv' + lv[s.id]); r.querySelector('small').textContent = LVL[lv[s.id]]; }));
    document.querySelectorAll('[data-hour-label]').forEach((el) => { el.textContent = h === 0 ? 'Now' : `${hLabel(h)} · ${clock(h)}`; });
    document.querySelectorAll('[data-twin-hour]').forEach((r) => { if (+r.value !== h) r.value = h; });
    monSet(CUR.sim, CUR.p, h);
    if (A3D.viewer && T.anatomy.atlas && document.querySelector('.anat-stage')) { A3D.st = anatState(CUR.p, CUR.sim, h, T.anatomy.atlas, CUR.on); anatApply(); const ins = document.querySelector('.anat-insp'); if (ins && AV.sel < 0) ins.innerHTML = anatInspector(CUR.p, { h }, A3D.st); }
  }
  document.addEventListener('input', (e) => {
    const r = e.target.closest('[data-twin-hour]'); if (!r) return;
    stopPlay(); UI.ptTwinHour = UI.ptTwinHour || {}; UI.ptTwinHour[r.dataset.twinHour] = +r.value; scrubTo(+r.value);
  });
  let PLAY = 0;
  function stopPlay() { if (PLAY) { clearInterval(PLAY); PLAY = 0; document.querySelectorAll('[data-act=pt-twin-play]').forEach((b) => { b.textContent = '▶ Play'; b.setAttribute('aria-pressed', 'false'); }); } }
  const scrubber = (p, h) => `<div class="twin-scrub"><button class="btn small" data-act="pt-twin-play" data-p="${p.id}" aria-pressed="false">▶ Play</button><input id="tw-h-${p.id}" type="range" min="0" max="${H}" step="1" value="${h}" data-twin-hour="${p.id}" aria-label="Hours from now"><b data-hour-label>${h === 0 ? 'Now' : `${hLabel(h)} · ${clock(h)}`}</b></div>`;

  /* ---------- Narrative ---------- */
  function story(p, base, sim, ev, evB, same) {
    const ms = METRICS(p).filter((m) => sim[m.id] && ['k', 'inr', 'cr'].includes(m.id));
    const line = (pr) => ms.map((m) => `${m.name} ${m.f(pr[m.id][0])} → <b>${m.f(pr[m.id][H])}</b>`).join(', ');
    const first = (list) => { const e = list.find((x) => x.cls === 'crit') || list.find((x) => x.cls === 'warn'); return e ? ` First concern: <span class="${e.cls}">${esc(e.text)}</span> at ${hLabel(e.h)}.` : ' No thresholds crossed in the window.'; };
    return `<div class="twin-story"><div><span class="k">If nothing changes (72 h)</span><p>${line(base) || 'No projectable labs in the record'}.${first(evB)}</p></div>
      <div class="${same ? 'muted' : ''}"><span class="k">With your levers</span><p>${same ? 'No levers changed yet. Tick one under “What if…” to see a different course.' : `${line(sim) || 'Vitals only'}.${first(ev)}`}</p></div></div>`;
  }

  /* ---------- Views ---------- */
  const VIEWS = [['overview', 'Overview'], ['ask', 'Ask'], ['anatomy', 'Anatomy 3D'], ['physiology', 'Physiology'], ['forecast', 'Forecast'], ['pk', 'Drug levels'], ['meds', 'Medications'], ['scenarios', 'Scenarios'], ['sources', 'Sources']];

  function leversHtml({ p, lv, on, rs, opt }) {
    const rname = (id) => (rs.find((r) => r.id === id) || { name: id }).name.split(' · ')[0];
    const rows = lv.map((l) => { const o = optOf(l, opt);
      const sel = l.opts ? `<span class="lopt">${esc(l.opts.label)} <select data-change="pt-twin-opt" data-p="${p.id}" data-l="${l.id}" data-k="${l.opts.key}" aria-label="${esc(l.label)} ${esc(l.opts.label)}">${l.opts.choices.map(([v, t]) => `<option value="${v}" ${+o[l.opts.key] === +v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></span>` : '';
      const fx = lfx(l, opt);
      return `<label class="lever"><input type="checkbox" data-change="pt-twin-lever" data-p="${p.id}" data-l="${l.id}" ${on.has(l.id) ? 'checked' : ''}><span>${esc(l.label)}${sel}<small>${Object.keys(fx).map((r) => `${esc(rname(r))} ${fx[r] < 0 ? '↓' : '↑'}`).join(' · ')}${l.pre ? ' · already in the record' : ''}</small></span></label>`; }).join('');
    return `<p class="muted" style="margin:0 0 10px;font-size:13px">Try a change, pick its dose or timing, and watch the risks, body, monitor and forecast move. Nothing is ordered.</p><div class="levers">${rows}</div>
      <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="pt-twin-reset" data-p="${p.id}">Reset to the record</button><button class="btn small" data-act="pt-twin-save" data-p="${p.id}">Save as scenario</button></div>`;
  }
  function riskHtml({ rs, lv, on, opt }) {
    return rs.map((r) => {
      const { delta, sim: sv } = riskWith(r, lv, on, opt);
      const cls = r.dec ? (sv >= 4 ? 'crit' : sv >= 2 ? 'warn' : 'ok') : sv >= 30 ? 'crit' : sv >= 15 ? 'warn' : 'ok';
      const scale = r.dec ? 100 / Math.max(r.max || 10, 1) * 0.9 : 1;
      return `<div class="risk ${cls}"><div class="row between"><b>${esc(r.name)}</b><span class="rv"><b>${sv}%</b>${delta ? `<small class="${delta < 0 ? 'down' : 'up'}">${delta < 0 ? '▼' : '▲'} ${Math.abs(delta)} from ${r.base}%</small>` : ''}</span></div>
        <div class="rbar"><i class="sim" style="width:${Math.min(100, sv * scale)}%"></i><i class="base" style="left:${Math.min(100, r.base * scale)}%"></i></div>
        <small class="muted">${r.drivers.map(esc).join(' · ')}${r.dec ? ' · bar scaled to the untreated rate' : ''}</small></div>`; }).join('');
  }

  function vOverview(ctx) {
    const { p, sim, h, sel } = ctx;
    const lvls = sim.levels[h];
    const sysRows = SYSTEMS.map((s) => `<button class="sysrow lv${lvls[s.id]} ${sel === s.id ? 'on' : ''}" data-act="pt-twin-sys" data-p="${p.id}" data-s="${s.id}"><i></i><span>${esc(s.name)}</span><small>${LVL[lvls[s.id]]}</small></button>`).join('');
    const selSys = SYSTEMS.find((s) => s.id === sel);
    const detail = selSys ? (() => { const r = systemState(p, selSys); const orgs = ANAT.filter((a) => a.sys === selSys.id).map((a) => a.name).join(', ');
      return `<div class="sysdetail"><b>${esc(selSys.name)}</b><small class="muted" style="display:block">${esc(orgs)}</small>${r.ev.length ? `<ul>${r.ev.map(([k, t]) => `<li><span class="muted">${esc(k)}</span> ${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">Nothing in the record for this system.</p>'}<button class="btn small" data-act="pt-twin-view" data-p="${p.id}" data-v="physiology">Open in Physiology</button></div>`; })()
      : '<p class="muted sysdetail">Select an organ to see the evidence behind its colour. Press Play or drag the slider to watch the body, the monitor and the risks change hour by hour.</p>';
    const sc = scores(p).map((s) => `<div class="score ${s.cls}" title="${esc(s.why)}"><span>${esc(s.k)}</span><b>${esc(String(s.v))}</b><small>${esc(s.sub)}</small></div>`).join('');
    return `<div class="twin-scores" aria-label="Computed clinical scores">${sc}</div>
      ${ctx.storyHtml}
      <div class="panel twin-scrub-panel"><div class="body">${scrubber(p, h)}</div></div>
      ${monitorHtml(p)}
      <div class="ptwin">
        ${panel('Body map', `<div class="ptwin-map">${body(p, sel, lvls)}<div class="sysrows">${sysRows}</div></div><div class="legend" style="margin-top:10px"><span><i class="nw-low"></i>Stable</span><span><i class="nw-mid"></i>Watch</span><span><i class="nw-high"></i>Alert</span></div>${detail}`)}
        ${panel('Risk twin', `<div class="risks">${riskHtml(ctx)}</div><div class="legend" style="margin-top:12px"><span><i class="lg-base"></i>Baseline from the record</span><span><i class="lg-sim"></i>With the levers you chose</span></div>`)}
        ${panel('What if…', leversHtml(ctx))}
      </div>`;
  }

  function vPhysiology(ctx) {
    const { p, sim, base, sel } = ctx;
    const allMeds = medRows(p, ctx);
    const trend = { kidney: ['k', 'cr'], blood: ['inr'], heart: ['hr', 'news'], lungs: ['news'], endo: ['glu'] };
    const ms = Object.fromEntries(METRICS(p).map((m) => [m.id, m]));
    const cards = SYSTEMS.map((s) => {
      const st = systemState(p, s), rv = reserve(st), at72 = sim.levels[H][s.id];
      const orgs = ANAT.filter((a) => a.sys === s.id).map((a) => a.name).join(' · ');
      const drugs = allMeds.filter((r) => r.fx[s.id]).map((r) => `<li><b>${esc(r.drug)}</b> <span class="muted">${esc(r.fx[s.id])}</span>${r.simHeld ? ' ' + pill('', 'held in scenario') : ''}</li>`).join('');
      const tr = (trend[s.id] || []).filter((id) => sim[id]).map((id) => { const m = ms[id]; const a = sim[id][0], z = sim[id][H], zb = base[id][H];
        const lo = Math.min(...sim[id]), hi = Math.max(...sim[id]);
        return `<li>${esc(m.name)} ${m.f(a)} → <b>${m.f(z)}</b> at +72 h <span class="muted">(range ${m.f(lo)}–${m.f(hi)}; record as is: ${m.f(zb)})</span></li>`; }).join('');
      return `<article class="syscard lv${st.level} ${sel === s.id ? 'on' : ''}" id="tw-sys-${s.id}">
        <header><h3>${esc(s.name)}</h3>${pill(st.level === 2 ? 'crit' : st.level === 1 ? 'warn' : 'ok', LVL[st.level])}${at72 !== st.level ? `<small class="muted">→ ${LVL[at72]} at +72 h</small>` : ''}</header>
        <small class="muted">${esc(orgs)}</small>
        <div class="reserve" title="Illustrative functional reserve"><span>Reserve</span><div class="rbar"><i class="sim" style="width:${rv}%"></i></div><b>${rv}</b></div>
        <div class="syscols"><div><h4>Evidence</h4>${st.ev.length ? `<ul>${st.ev.map(([k, t]) => `<li><span class="muted">${esc(k)}</span> ${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">Nothing in the record.</p>'}</div>
        <div><h4>Drugs acting here</h4>${drugs ? `<ul>${drugs}</ul>` : '<p class="muted">None.</p>'}</div></div>
        ${tr ? `<div><h4>Course with your levers</h4><ul>${tr}</ul></div>` : ''}
        <p class="watch"><b>Watch:</b> ${esc(s.watch)}</p></article>`;
    }).join('');
    return `<div class="syscards">${cards}</div>`;
  }

  /* Measured values from the flowsheet and lab history, as hours before now (for the forecast charts). */
  function measuredPast(p) {
    if (!T.hist) return {};
    const now = Date.now(), toH = (at) => Math.round((at - now) / 3600e3 * 10) / 10;
    const out = {};
    [['k', /^potassium$/i], ['inr', /^INR$/i], ['cr', /^creatinine$/i], ['glu', /^glucose$/i]].forEach(([id, re]) => {
      const s = T.hist.labs(p).find((x) => re.test(x.test)); if (!s) return;
      const pts = s.pts.map((q) => ({ h: Math.min(0, toH(q.at)), v: q.v, flag: q.flag }));
      const k = pts.findIndex((q) => q.h >= -72);
      if (k > 0) { const a = pts[k - 1], b = pts[k]; pts.splice(k, 0, { h: -72, v: a.v + (b.v - a.v) * (-72 - a.h) / (b.h - a.h), interp: true }); }
      out[id] = pts;
    });
    const vs = T.hist.vitals(p);
    out.hr = vs.map((q) => ({ h: Math.min(0, toH(q.at)), v: q.hr, flag: q.hr > 110 || q.hr < 50 }));
    out.news = vs.map((q) => ({ h: Math.min(0, toH(q.at)), v: q.news, flag: q.news >= 5 })).filter((q) => q.v != null);
    return out;
  }
  const evRow = (e) => `<li class="${e.cls}"><span class="mono">${hLabel(e.h)}</span>${esc(e.text)}</li>`;
  function vForecast(ctx) {
    const { p, sim, base, h, ev, evB } = ctx;
    const ms = METRICS(p).filter((m) => sim[m.id]);
    const past = measuredPast(p);
    ms.forEach((m) => { m.past = past[m.id] || []; });
    const charts = ms.map((m) => panel(`${esc(m.name)}${m.unit ? ` <small class="muted">${esc(m.unit)}</small>` : ''}`,
      `<div class="tread"><span class="s"><i></i>Your levers <b data-read="${m.id}">${m.f(sim[m.id][h])}</b></span><span class="b"><i></i>Record as is <b data-read-b="${m.id}">${m.f(base[m.id][h])}</b></span><span class="muted">Normal ${m.f(m.lo)}–${m.f(m.hi)}${m.id === 'glu' ? ` · ${esc(sim.gluSrc)}` : ''}</span></div>${chart(m, base[m.id], sim[m.id], h, sim.sd[m.id])}`)).join('');
    return `${ctx.storyHtml}<div class="panel twin-scrub-panel"><div class="body">${scrubber(p, h)}</div></div>
      <div class="legend" style="margin:0 0 10px"><span><i class="lg-line"></i>Your levers</span><span><i class="lg-unc"></i>80% band (widens with time)</span><span><i class="lg-dash"></i>Record as is</span><span><i class="lg-norm"></i>Normal range</span></div>
      <div class="twin-charts">${charts}</div>
      <div class="twin-ev">${panel('Predicted events · your levers', ev.length ? `<ul class="evlist">${ev.map(evRow).join('')}</ul>` : '<p class="muted">No thresholds crossed in 72 h.</p>')}
      ${panel('Predicted events · record as is', evB.length ? `<ul class="evlist">${evB.map(evRow).join('')}</ul>` : '<p class="muted">No thresholds crossed in 72 h.</p>')}
      ${panel('How the forecast works', `<ul class="howlist"><li>Hourly steps for 72 h. The left half of each chart is what was measured (flowsheet and lab history); the forecast starts from the latest result and blends the measured trend of the last 4 days with the effect of the drugs and treatments in play.</li><li>Insulin moves potassium into cells within 2 h and wears off by about 12 h; a binder keeps lowering it. Starting later shifts the whole curve. Holding an ARB stops the upward drift.</li><li>With warfarin held INR falls slowly (about 40 h time constant). Vitamin K reverses it faster and deeper the higher the dose; 10 mg also blunts a later warfarin restart. A restart lifts INR after about a day.</li><li>Glucose follows meals and dips about an hour after insulin.</li><li>Potassium above 6.5 slows the heart and adds to NEWS2.</li><li>The shaded band widens with time because the further out, the less certain. Illustrative only: not validated, not for treatment decisions.</li></ul>`)}</div>`;
  }

  function vPK(ctx) {
    const { p, lv, on, opt, h } = ctx;
    const list = pkSeries(p, lv, on, opt);
    if (!list.length) return '<p class="muted">No dosed drugs with a level model in this record.</p>';
    const cards = list.map((r) => {
      const d = r.d;
      const m = { id: r.id, name: r.name, f: d.f, lo: r.effect ? null : d.band ? d.band[0] : null, hi: d.band ? d.band[1] : null, zero: true, marks: r.doses || [],
        th: d.mic ? [{ v: d.mic, up: 'ok', down: 'warn', tag: `MIC ${d.mic}` }] : [] };
      const i = Math.round(h / H * (PKT.length - 1));
      const facts = r.effect ? `<span>${r.sim[PKT.length - 1] < 90 ? `Recovers to ${r.sim[PKT.length - 1].toFixed(0)}% inhibited by +72 h` : 'Fully inhibited while taken'}</span>`
        : `<span>${esc(String(r.mg >= 1000 ? r.mg / 1000 + ' g' : r.mg + ' mg'))} ${esc(d.route)} at ${r.hours.map((x) => String(x).padStart(2, '0') + ':00').join(', ')}</span><span>t½ <b>${r.t12.toFixed(1)} h</b>${d.renal ? ` at CrCl ${Math.round(r.crcl)} (normal ${d.t12(100).toFixed(1)} h)` : ''}</span><span>Peak <b>${d.f(r.sst.cmax)}</b> · trough <b>${d.f(r.sst.cmin)}</b> ${esc(d.unit)} (last 24 h)</span>${d.mic ? `<span>Time above MIC <b class="${r.sst.tmic >= 40 ? 'okc' : 'critc'}">${r.sst.tmic}%</b> (target ≥40%)</span>` : ''}`;
      return panel(`${esc(r.name)} <small class="muted">${esc(d.unit)}</small>`, `<div class="tread"><span class="s"><i></i>Your levers <b data-read="${r.id}">${d.f(r.sim[i])}</b></span><span class="b"><i></i>Record as is <b data-read-b="${r.id}">${d.f(r.base[i])}</b></span></div>
        ${chart(m, r.base, r.sim, h)}<div class="pkfacts">${facts}</div><p class="muted pknote">${esc(d.note)}</p>`);
    }).join('');
    const notModelled = p.meds.filter((m) => !PK.some((d) => d.re.test(m.drug)) && !/aspirin/i.test(m.drug)).map((m) => m.drug);
    return `${ctx.storyHtml}<div class="panel twin-scrub-panel"><div class="body">${scrubber(p, h)}</div></div>
      <div class="banner info"><p>Levels from one-compartment models dosed on the ward schedule (ticks on the time axis), using the twin's weight and computed kidney function. Holding, resuming or restarting a drug under “What if…” changes its curve.${notModelled.length ? ` Not modelled: ${esc(notModelled.join(', '))}.` : ''}</p></div>
      <div class="twin-charts">${cards}</div>`;
  }

  function medRows(p, ctx) {
    const lv = ctx.lv, on = ctx.on;
    const rows = p.meds.map((m, i) => { const l = lv.find((x) => x.med === i);
      return { drug: m.drug, dose: [m.dose, m.route, m.freq].filter(Boolean).join(' '), src: 'Chart', status: m.status, held: isHeld(m), simHeld: l ? on.has(l.id) && !isHeld(m) : false, simResumed: l ? (!on.has(l.id) && isHeld(m)) || (/warfarin/i.test(m.drug) && on.has('warf-restart')) : false, fx: fxOf(m.drug) }; });
    const first = (s) => s.split(' ')[0].toLowerCase();
    ((T.SEED.homeMeds || {})[p.id] || []).forEach((hm) => {
      if (!p.meds.some((m) => first(m.drug) === first(hm))) rows.push({ drug: hm.split(' ')[0], dose: hm.split(' ').slice(1).join(' '), src: 'Home list', status: 'Not continued in hospital', held: true, fx: fxOf(hm), home: true });
    });
    (S().hai || []).filter((x) => x.patient === p.id && x.tx).forEach((x) => { const d = x.tx.split(' ')[0]; if (!rows.some((r) => first(r.drug) === d.toLowerCase())) rows.push({ drug: d, dose: x.tx.split(' ').slice(1).join(' '), src: 'Infection control', status: x.status, held: false, fx: fxOf(d) }); });
    return rows;
  }
  function renalCheck(drug, sc) {
    const cr = sc.find((s) => s.k === 'CrCl'), eg = sc.find((s) => s.k === 'eGFR');
    const c = cr ? cr.raw : null, e = eg ? eg.v : null;
    if (/metformin/i.test(drug) && e != null) return e < 30 ? ['crit', `eGFR ${e}: stop`] : e < 45 ? ['warn', `eGFR ${e}: max 1,000 mg/day`] : ['ok', `eGFR ${e}: standard dose`];
    if (/meropenem/i.test(drug) && c != null) return c < 26 ? ['warn', `CrCl ${Math.round(c)}: 500 mg q12h`] : c <= 50 ? ['warn', `CrCl ${Math.round(c)}: 1 g q12h`] : ['ok', `CrCl ${Math.round(c)}: standard dose`];
    if (/enoxaparin/i.test(drug) && c != null) return c < 30 ? ['warn', `CrCl ${Math.round(c)}: 1 mg/kg once daily`] : ['ok', `CrCl ${Math.round(c)}: standard dose`];
    if (/apixaban|rivaroxaban|dabigatran/i.test(drug) && c != null) return c < 15 ? ['crit', `CrCl ${Math.round(c)}: avoid`] : c < 50 ? ['warn', `CrCl ${Math.round(c)}: check reduced dose`] : ['ok', `CrCl ${Math.round(c)}: standard dose`];
    if (NSAID.test(drug) && e != null && e < 60) return ['crit', `eGFR ${e}: avoid NSAIDs`];
    if ((ARB.test(drug) || KSPARE.test(drug)) && e != null && e < 60) return ['warn', `eGFR ${e}: monitor K and creatinine`];
    return null;
  }
  function interactions(p, rows) {
    const act = rows.filter((r) => (!r.held || r.simResumed) && !r.simHeld);
    const any = (re) => act.filter((r) => re.test(r.drug));
    const k = lab(p, /^potassium/i), inr = lab(p, /^INR/i), out = [];
    if (any(ANTICOAG).length && any(ANTIPLT).length) out.push(['crit', `${any(ANTICOAG)[0].drug} + ${any(ANTIPLT)[0].drug}`, 'Additive bleeding risk. Is dual therapy still indicated?']);
    if (any(ANTIPLT).length && inr && num(inr.value) > 3) out.push(['crit', `${any(ANTIPLT)[0].drug} with INR ${inr.value}`, 'Antiplatelet on top of a supratherapeutic INR.']);
    if (any(ARB).length && k && num(k.value) > 5.1) out.push(['crit', `${any(ARB)[0].drug} with potassium ${k.value}`, 'Raises potassium further; consider holding.']);
    if (any(ARB).length && any(KSPARE).length) out.push(['crit', `${any(ARB)[0].drug} + ${any(KSPARE)[0].drug}`, 'Dual potassium-raising therapy.']);
    if (any(NSAID).length && any(ARB).length) out.push(['crit', `${any(NSAID)[0].drug} + ${any(ARB)[0].drug}`, 'Kidney “double whammy”; add a diuretic and it is a triple whammy.']);
    if (any(/olol\b|carvedilol/i).length && p.vitals.hr < 55) out.push(['warn', `${any(/olol\b|carvedilol/i)[0].drug} with HR ${p.vitals.hr}`, 'Bradycardia.']);
    const carb = rows.find((r) => /meropenem|ertapenem|imipenem/i.test(r.drug)), pen = p.allergies.find((a) => /penicillin/i.test(a.agent));
    if (carb && pen) out.push(['warn', `${carb.drug} with ${pen.agent} allergy (${pen.reaction})`, 'Carbapenem cross-reactivity is under 1%; usually acceptable for non-severe reactions.']);
    const hw = rows.find((r) => r.home && /warfarin|metformin/i.test(r.drug));
    if (hw) out.push(['warn', `${hw.drug} on the home list only`, 'Not continued in hospital. Decide at discharge reconciliation.']);
    if (isAF(p) && !act.some((r) => /warfarin|apixaban|rivaroxaban|dabigatran/i.test(r.drug))) out.push(['warn', 'Atrial fibrillation without anticoagulation', `CHA₂DS₂-VASc ${cha2ds2(p).c}: plan when to restart (try “Restart warfarin”).`]);
    return out;
  }
  function vMeds(ctx) {
    const { p } = ctx;
    const sc = scores(p), rows = medRows(p, ctx), ix = interactions(p, rows);
    const tr = rows.map((r) => { const rc = renalCheck(r.drug, sc);
      const st = r.simHeld ? pill('warn', 'Held in scenario') : r.simResumed ? pill('info', 'Resumed in scenario') : r.held ? pill('', r.home ? 'Home only' : 'Held') : pill('ok', 'Active');
      return `<tr><td><b>${esc(r.drug)}</b><span class="sub">${esc(r.dose)}</span></td><td>${esc(r.src)}<span class="sub">${esc(r.status)}</span></td><td>${st}</td>
        <td><div class="fxs">${SYSTEMS.filter((s) => r.fx[s.id]).map((s) => `<span class="fx fx-${s.id}"><b>${esc(s.name.split(' ')[0])}</b> ${esc(r.fx[s.id])}</span>`).join('') || '<span class="muted">No mapping</span>'}</div></td>
        <td>${rc ? pill(rc[0], rc[1]) : '<span class="muted">—</span>'}</td></tr>`; }).join('');
    const cr = sc.find((s) => s.k === 'CrCl'), eg = sc.find((s) => s.k === 'eGFR');
    return `<div class="banner info"><p>Dosing uses the twin's computed kidney function${eg ? `: eGFR <b>${eg.v}</b>` : ''}${cr ? `, CrCl <b>${cr.v}</b> mL/min (${p.weightKg} kg)` : ''}. Sources: chart orders, the home medication list and infection-control treatment.</p></div>
      ${panel('Drug → organ map', `<div class="tbl"><table class="t medmap"><thead><tr><th>Medication</th><th>Source</th><th>Now</th><th>Effects by organ</th><th>Renal dosing</th></tr></thead><tbody>${tr}</tbody></table></div>`, `<span class="kpi-note">${rows.length} medications from 3 sources</span>`, true)}
      ${panel('Interactions and cautions', ix.length ? `<ul class="ixlist">${ix.map(([c, a, b]) => `<li class="${c}"><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ul>` : '<p class="muted">None found for the current scenario.</p>', '<span class="kpi-note">Reflects the levers you chose</span>')}`;
  }

  const scenKey = (set, opt, lv) => JSON.stringify([[...set].sort(), lv.filter((l) => l.opts && set.has(l.id)).map((l) => [l.id, optOf(l, opt)])]);
  function vScenarios(ctx) {
    const { p, lv, rs, on, opt } = ctx;
    const saved = (UI.ptTwinScen && UI.ptTwinScen[p.id]) || [];
    const cols = [{ name: 'Record as is', set: baseSet(lv), opt: {}, fixed: true }].concat(saved.map((s, i) => ({ name: s.name, set: new Set(s.levers), opt: s.opt || {}, i })));
    const curKey = scenKey(on, opt, lv);
    if (!cols.some((c) => scenKey(c.set, c.opt, lv) === curKey)) cols.push({ name: 'Current levers (unsaved)', set: on, opt, cur: true });
    const proj = cols.map((c) => project(p, lv, c.set, c.opt));
    const ms = METRICS(p).filter((m) => proj[0][m.id]);
    const rows = [];
    rs.forEach((r) => rows.push({ label: r.name, vals: cols.map((c) => riskWith(r, lv, c.set, c.opt).sim), f: (v) => v + '%' }));
    ms.filter((m) => ['k', 'inr', 'cr'].includes(m.id)).forEach((m) => { [24, 72].forEach((i) => rows.push({ label: `${m.name} at ${hLabel(i)}`, vals: proj.map((pr) => pr[m.id][i]), f: m.f, target: m.id === 'inr' ? [m.lo, m.hi] : null })); });
    if (proj[0].inr) rows.push({ label: 'Hours with INR in 2.0–3.0', vals: proj.map((pr) => pr.inr.filter((v) => v >= 2 && v <= 3).length), f: (v) => v + ' h', high: true });
    if (proj[0].glu) rows.push({ label: 'Lowest glucose', vals: proj.map((pr) => Math.min(...pr.glu)), f: (v) => String(Math.round(v)), high: true });
    rows.push({ label: 'Peak NEWS2', vals: proj.map((pr) => Math.max(...pr.news)), f: (v) => String(Math.round(v)) });
    rows.push({ label: 'Danger events in 72 h', vals: proj.map((pr) => events(p, pr).filter((e) => e.cls === 'crit').length), f: String });
    const best = (r) => { let d = r.vals; if (r.target) d = r.vals.map((v) => (v < r.target[0] ? r.target[0] - v : v > r.target[1] ? v - r.target[1] : 0)); else if (r.high) d = r.vals.map((v) => -v); const m = Math.min(...d); return d.map((x) => x === m && d.some((y) => y !== m)); };
    const lvName = (c) => [...c.set].map((id) => { const l = lv.find((x) => x.id === id); if (!l) return ''; const o = optOf(l, c.opt); return l.opts ? `${l.label} (${(l.opts.choices.find(([v]) => +v === +o[l.opts.key]) || [0, ''])[1]})` : l.label; }).filter(Boolean);
    const head = cols.map((c) => `<th>${esc(c.name)}<span class="sub">${lvName(c).map(esc).join(' · ') || 'No levers'}</span></th>`).join('');
    const body = rows.map((r) => { const b = best(r); return `<tr><td>${esc(r.label)}</td>${r.vals.map((v, i) => `<td class="num ${b[i] ? 'best' : ''}">${esc(r.f(v))}</td>`).join('')}</tr>`; }).join('');
    const acts = cols.map((c) => `<td>${c.fixed ? `<button class="btn small" data-act="pt-twin-reset" data-p="${p.id}">Load</button>` : c.cur ? `<button class="btn small primary" data-act="pt-twin-save" data-p="${p.id}">Save</button>` : `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn small" data-act="pt-twin-load" data-p="${p.id}" data-i="${c.i}">Load</button><button class="btn small" data-act="pt-twin-del" data-p="${p.id}" data-i="${c.i}" aria-label="Delete ${esc(c.name)}">Delete</button></div>`}</td>`).join('');
    return `<div class="banner info"><p>Save a set of levers (with their doses and timing), change them, and compare. Highlighted cells are the best value in each row (for INR, closest to the 2.0–3.0 target). Scenarios last for this session only and are never written to the record; saving and loading are audited.</p></div>
      ${panel('Compare scenarios', `<div class="tbl"><table class="t scen"><thead><tr><th></th>${head}</tr></thead><tbody>${body}<tr class="acts"><td></td>${acts}</tr></tbody></table></div>`, `<span class="kpi-note">${saved.length} saved</span>`, true)}
      <div class="ptwin" style="grid-template-columns:minmax(0,1fr)">${panel('What if…', leversHtml(ctx))}</div>`;
  }

  function vSources(ctx) {
    const { p } = ctx;
    const cf = confidence(p);
    const ago = (d) => (d == null || d === 0 ? 'Today' : d === -1 ? 'Yesterday' : `${-d} days ago`);
    const inputs = [['Vital signs', `HR ${p.vitals.hr} · BP ${p.vitals.bp} · RR ${p.vitals.rr} · SpO₂ ${p.vitals.spo2}% · ${p.vitals.temp}°F`, 'Nursing flowsheet', 'Latest']]
      .concat(T.hist ? [['Vitals history', `${T.hist.vitals(p).length} sets over 72 h`, 'Nursing flowsheet', 'Every 4 h']] : [])
      .concat(p.labs.map((l) => { const s = T.hist && T.hist.lab(p, l.test); return [l.test, `${l.value} ${l.unit || ''}${l.flag ? ` (${l.flag})` : ''}${s && s.pts.length > 1 ? ` · ${s.pts.length - 1} prior` : ''}`, l.outside ? 'Outside record' : 'Laboratory', ago(l.dOff)]; }))
      .concat([['Problem list', `${p.problems.length} coded problems`, 'Chart', 'Current'], ['Medications', `${p.meds.length} on the chart`, 'Orders / eMAR', 'Current'],
        ['Home medications', `${((T.SEED.homeMeds || {})[p.id] || []).length} on the home list`, 'Med reconciliation', 'Admission'], ['Allergies', p.allergiesUnknown ? 'Unknown' : p.allergies.map((a) => a.agent).join(', ') || 'None known', 'Chart', 'Current'],
        ['Weight / height', p.weightKg ? `${p.weightKg} kg · ${p.heightCm} cm` : 'Missing', 'Chart', 'Admission'], ['Age / sex', `${p.age} · ${p.sex}`, 'Registration', '—']])
      .concat((S().hai || []).filter((x) => x.patient === p.id).map((x) => [x.type, `${x.organism} · ${x.tx}`, 'Infection control', x.status]))
      .concat((S().results || []).filter((r) => r.patient === p.id).map((r) => ['Critical result', `${r.test} ${r.value} · ${r.state}`, 'Closed-loop results', r.mOff < 120 ? `${r.mOff} min ago` : `${Math.round(r.mOff / 60)} h ago`]));
    const stream = T.records && T.records.timelineEvents ? T.records.timelineEvents(p).slice(0, 10) : [];
    const ring = `<svg class="cring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" class="trk"/><circle cx="60" cy="60" r="50" class="val ${cf.score < 60 ? 'crit' : cf.score < 80 ? 'warn' : ''}" stroke-dasharray="${(cf.score / 100 * 314).toFixed(1)} 314" transform="rotate(-90 60 60)"/><text x="60" y="66" text-anchor="middle">${cf.score}%</text></svg>`;
    const models = [['Labs', 'Hourly curves per lab, starting from the measured 4-day trend and coupled (potassium → heart rate and NEWS2)'], ['Uncertainty', '80% band from an error that grows linearly with time'], ['Drug levels', 'One-compartment PK, textbook parameters, CrCl-adjusted for renal drugs'], ['Monitor', 'Waveforms synthesised from projected rate, rhythm, SpO₂, RR and potassium'], ['Risks', 'Points-based, with published CHA₂DS₂-VASc stroke rates'], ['Anatomy', 'BodyParts3D adult male reference (2,234 structures, FMA-coded); rules map the record to exact structures']];
    return `<div class="twin-src">
      ${panel('Twin confidence', `<div class="conf">${ring}<ul class="checks">${cf.checks.map(([t, ok]) => `<li class="${ok ? 'ok' : 'miss'}"><i>${ok ? '✓' : '!'}</i>${esc(t)}</li>`).join('')}</ul></div><p class="muted" style="font-size:12.5px;margin-top:10px">Confidence is the share of these inputs that are present and fresh. Missing items make the twin less reliable, not wrong.</p>`)}
      ${panel('Never read by the twin', `<p style="margin:0 0 8px">Least privilege applies to the model too. It works from clinical facts only and never reads:</p><ul class="never"><li>Name and date of birth (age only)</li><li>MRN, phone and address</li><li>Payer, member ID and charges</li><li>Free-text notes</li></ul><p class="muted" style="font-size:12.5px">Opening the twin is logged as a chart view; every simulation, dose change and scenario is logged as <span class="mono">twin-simulate</span> or <span class="mono">twin-scenario</span>.</p>`)}
    </div>
    ${panel('Models inside the twin', `<dl class="models">${models.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>`, '<span class="kpi-note">Illustrative, not validated</span>')}
    ${panel('Inputs', `<div class="tbl"><table class="t"><thead><tr><th>Input</th><th>Value</th><th>Source</th><th>As of</th></tr></thead><tbody>${inputs.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody></table></div>`, `<span class="kpi-note">${inputs.length} inputs</span>`, true)}
    ${stream.length ? panel('Latest events in the record', `<ul class="evstream">${stream.map((e) => `<li><span class="mono">${new Date(e.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>${pill('', e.type)}<span>${esc(e.text)}</span></li>`).join('')}</ul>`, '<span class="kpi-note">The twin re-syncs whenever these change</span>') : ''}`;
  }

  /* ---------- 3D anatomy (BodyParts3D, 2,234 structures) ----------
     Each rule ties something in the record to the exact structures it affects, down to coronary
     branches, liver segments, heart valves and retinas. Levels follow the hour on the slider, so the
     kidneys or myocardium recolour as projected potassium or creatinine changes. */
  const ANAT_RULES = [
    { id: 'ckd', label: 'Kidneys', rx: /^(left|right) kidney$/i, when: (p) => has(p, /CKD|kidney|renal|N18/i), why: (p) => [p.problems.find((x) => /CKD|kidney|renal|N18/i.test(x)), lab(p, /^eGFR/i) && `eGFR ${lab(p, /^eGFR/i).value}`, lab(p, /^creatinine/i) && `creatinine ${lab(p, /^creatinine/i).value}`].filter(Boolean).join(' · '), lv: (c) => Math.max(1, c.lv.kidney) },
    { id: 'renalv', label: 'Renal arteries and veins', rx: /renal (artery|vein)|branch of (left|right) renal artery|division of (left|right) renal artery/i, when: (p) => has(p, /CKD|kidney|renal|N18/i), why: (p) => (activeMeds(p).some((m) => ARB.test(m.drug)) ? 'Perfusion falls with an ARB in CKD' : 'Renal perfusion'), lv: () => 1 },
    { id: 'myo', label: 'Myocardium and conduction', rx: /wall of ventricle|wall of (left|right) atrium|papillary muscle/i, when: (p) => !!lab(p, /^potassium/i) && num(lab(p, /^potassium/i).value) > 5.1, why: (p, c) => `Potassium ${c.k != null ? c.k.toFixed(1) : lab(p, /^potassium/i).value} at ${hLabel(c.h)}: arrhythmia risk`, lv: (c) => (c.k > 6.0 ? 2 : c.k > 5.1 ? 1 : null) },
    { id: 'cad', label: 'Coronary arteries', rx: /coronary/i, layer: 'artery', when: (p) => has(p, /coronary|myocard|\bMI\b|I25|angina/i), why: (p) => p.problems.find((x) => /coronary|myocard|\bMI\b|I25|angina/i.test(x)), lv: () => 1 },
    { id: 'af', label: 'Atria', rx: /atrium/i, when: isAF, why: (p, c) => `Atrial fibrillation · heart rate ${Math.round(c.sim.hr[c.h])}`, lv: () => 1 },
    { id: 'valves', label: 'Heart valves', rx: /cusp of (aortic|pulmonary) valve|leaflet of (mitral|tricuspid) valve/i, when: (p) => has(p, /valv|stenosis|regurg|endocard/i), why: (p) => p.problems.find((x) => /valv|stenosis|regurg|endocard/i.test(x)), lv: () => 1 },
    { id: 'htn', label: 'Aorta', rx: /^(ascending|descending|descending thoracic|abdominal) aorta$|^arch of aorta$/i, when: (p) => has(p, /hypertens|I10/i), why: (p) => `Hypertension · BP ${p.vitals.bp}`, lv: () => 1 },
    { id: 'dm', label: 'Pancreas', rx: /^pancreas$|parenchyma of pancreas|pancreatic duct/i, when: isDM, why: (p, c) => [lab(p, /HbA1c/i) && `HbA1c ${lab(p, /HbA1c/i).value}%`, c.sim.glu && `glucose ${Math.round(c.sim.glu[c.h])} mg/dL at ${hLabel(c.h)}`].filter(Boolean).join(' · ') || 'Diabetes', lv: (c) => (c.sim.glu && c.sim.glu[c.h] < 70 ? 2 : Math.max(1, c.lv.endo)) },
    { id: 'dmeye', label: 'Retinas', rx: /optic part of (left|right) retina/i, when: isDM, why: () => 'Diabetic retinopathy screening (annual)', lv: () => 1 },
    { id: 'liver', label: 'Liver (makes clotting factors)', rx: /hepatovenous segment|lobe of liver/i, when: (p) => !!lab(p, /^INR/i) || p.meds.some((m) => /warfarin/i.test(m.drug)), why: (p, c) => (c.sim.inr ? `INR ${c.sim.inr[c.h].toFixed(1)} at ${hLabel(c.h)}` : 'Warfarin acts on clotting-factor synthesis'), lv: (c) => (c.sim.inr ? (c.sim.inr[c.h] > 4.5 ? 2 : c.sim.inr[c.h] > 3 || c.sim.inr[c.h] < 2 ? 1 : null) : 1) },
    { id: 'gib', label: 'Stomach and duodenum', rx: /^stomach$|^duodenum$/i, when: (p) => activeMeds(p).some((m) => ANTIPLT.test(m.drug) || NSAID.test(m.drug)) && (p.meds.some((m) => ANTICOAG.test(m.drug)) || (lab(p, /^INR/i) && num(lab(p, /^INR/i).value) > 3)), why: () => 'GI bleeding risk: antiplatelet with anticoagulation or high INR', lv: () => 1 },
    { id: 'uti', label: 'Bladder and urethra', rx: /^urinary bladder$|^urethra$/i, when: (p) => (S().hai || []).some((h) => h.patient === p.id && /CAUTI|UTI|urin/i.test(h.type)) || has(p, /urinary tract|cystitis|pyelo/i), why: (p) => { const h = (S().hai || []).find((x) => x.patient === p.id); return h ? `${h.type}: ${h.organism} · ${h.device || ''}`.trim() : 'Urinary infection'; }, lv: () => 1 },
    { id: 'airway', label: 'Bronchial tree', rx: /bronch/i, layer: 'resp', when: (p) => has(p, /asthma|copd|bronch|pneumon/i), why: (p) => p.problems.find((x) => /asthma|copd|bronch|pneumon/i.test(x)), lv: (c) => Math.max(1, c.lv.lungs) },
    { id: 'stroke', label: 'Middle cerebral arteries', rx: /middle cerebral artery/i, when: (p) => has(p, /stroke|TIA|I63/i), why: (p) => p.problems.find((x) => /stroke|TIA|I63/i.test(x)), lv: () => 2 },
    { id: 'seiz', label: 'Temporal lobes and hippocampi', rx: /hippocamp|temporal gyrus/i, when: (p) => has(p, /seizure|epilep/i), why: (p) => p.problems.find((x) => /seizure|epilep/i.test(x)), lv: () => 1 },
    { id: 'spine', label: 'Vertebrae and discs', rx: /lumbar vertebra|intervertebral disk of .*lumbar/i, when: (p) => has(p, /back pain|osteopor|spine|lumbar/i), why: (p) => p.problems.find((x) => /back pain|osteopor|spine|lumbar/i.test(x)), lv: () => 1 },
    { id: 'knee', label: 'Patellae', rx: /patella/i, when: (p) => has(p, /knee|osteoarth/i), why: (p) => p.problems.find((x) => /knee|osteoarth/i.test(x)), lv: () => 1 },
    { id: 'gb', label: 'Gallbladder and biliary tree', rx: /gallbladder|biliary/i, when: (p) => has(p, /chole|gall|biliary/i), why: (p) => p.problems.find((x) => /chole|gall|biliary/i.test(x)), lv: () => 2 },
    { id: 'app', label: 'Appendix', rx: /^appendix$/i, when: (p) => has(p, /appendic/i), why: (p) => p.problems.find((x) => /appendic/i.test(x)), lv: () => 2 }
  ];
  const DRUG_SITES = [
    [/olol\b|carvedilol/i, /wall of ventricle|wall of (left|right) atrium/i, 'slows the heart'], [ARB, /^(left|right) kidney$/i, 'acts on the kidney (RAAS)'],
    [/warfarin/i, /hepatovenous segment|lobe of liver/i, 'blocks clotting-factor synthesis'], [ANTIPLT, /^stomach$/i, 'irritates the stomach lining'],
    [/meropenem|cef|piperacillin|nitrofurantoin/i, /^urinary bladder$/i, 'treating the infection here'], [/statin/i, /hepatovenous segment|lobe of liver/i, 'acts in the liver'],
    [/metformin/i, /hepatovenous segment|lobe of liver/i, 'reduces liver glucose output'], [/insulin/i, /^pancreas$/i, 'replaces pancreatic insulin'], [/levothyroxine/i, /thyroid/i, 'replaces thyroid hormone']
  ];
  function anatState(p, sim, h, atlas, on) {
    const c = { h, sim, k: sim.k ? sim.k[h] : null, lv: sim.levels[h] };
    const state = {}, why = {}, findings = [];
    ANAT_RULES.forEach((r) => {
      if (!r.when(p)) return;
      const lv = r.lv(c); const parts = atlas.parts.filter((x) => r.rx.test(x.name) && (!r.layer || x.layer === r.layer)).map((x) => x.idx);
      if (!parts.length) return;
      const w = r.why(p, c) || r.label;
      findings.push({ id: r.id, label: r.label, why: w, level: lv, parts, kind: 'finding' });
      if (lv == null) return;
      parts.forEach((i) => { state[i] = Math.max(state[i] == null ? -1 : state[i], lv); (why[i] = why[i] || []).push([lv, r.label, w]); });
    });
    const meds = p.meds.map((m, i) => ({ m, i })).filter(({ m, i }) => { const l = sim.__lv && sim.__lv.find((x) => x.med === i); return l ? !on.has(l.id) || m.status.match(/held/i) == null : !isHeld(m); });
    const extra = (S().hai || []).filter((x) => x.patient === p.id && x.tx).map((x) => ({ m: { drug: x.tx.split(' ')[0] } }));
    meds.concat(extra).forEach(({ m }) => DRUG_SITES.forEach(([drx, prx, what]) => {
      if (!drx.test(m.drug)) return;
      const parts = atlas.parts.filter((x) => prx.test(x.name)).map((x) => x.idx); if (!parts.length) return;
      findings.push({ id: 'drug-' + m.drug, label: `${m.drug}: ${what}`, why: `${m.drug} ${what}`, level: 0, parts, kind: 'drug' });
      parts.forEach((i) => { if (state[i] == null) state[i] = 0; (why[i] = why[i] || []).push([0, m.drug, what]); });
    }));
    return { state, why, findings };
  }
  const AV = { layers: null, explode: 0, xray: 0, overlay: true, sel: -1, iso: null, isoLabel: '', q: '' };
  const A3D = { canvas: null, viewer: null, err: null, pct: 0 };
  const LAYER_NAMES = () => Object.fromEntries((T.anatomy.atlas ? T.anatomy.atlas.layers : []).map((l) => [l.id, l.name]));
  const nf = (n) => n.toLocaleString('en-US');
  function anatInspector(p, ctx, st) {
    const A = T.anatomy.atlas; if (!A) return '';
    const s = AV.sel >= 0 ? A.parts[AV.sel] : null;
    if (!s) {
      const fs = st.findings.filter((f) => f.kind === 'finding'), ds = st.findings.filter((f) => f.kind === 'drug');
      const row = (f) => `<button class="afind lv${f.level == null ? 'n' : f.level}" data-act="anat-finding" data-f="${esc(f.id)}"><i></i><span><b>${esc(f.label)}</b><small>${esc(f.why)}</small></span><em>${f.parts.length}</em></button>`;
      return `<h3 class="ai-h">Findings on the body <small class="muted">${fs.length} · ${hLabel(ctx.h)}</small></h3>${fs.length ? fs.map(row).join('') : '<p class="muted">No structure-level findings for this record.</p>'}
        ${ds.length ? `<h3 class="ai-h" style="margin-top:14px">Where the drugs act</h3>${ds.map(row).join('')}` : ''}
        <p class="muted" style="font-size:12px;margin-top:12px">Select any structure on the body, or a finding above to isolate it. The number is how many structures it covers.</p>`;
    }
    const sz = [0, 1, 2].map((k) => Math.round(s.b[1][k] - s.b[0][k]));
    const w = (st.why[s.idx] || []).sort((a, b) => b[0] - a[0]);
    const near = A.parts.filter((x) => x.idx !== s.idx).map((x) => [x, (x.ctr[0] - s.ctr[0]) ** 2 + (x.ctr[1] - s.ctr[1]) ** 2 + (x.ctr[2] - s.ctr[2]) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 6);
    const lvTxt = (l) => (l === 2 ? pill('crit', 'Alert') : l === 1 ? pill('warn', 'Watch') : pill('info', 'Drug site'));
    const LN = LAYER_NAMES();
    return `<div class="ainsp"><span class="ai-sw" style="background:rgb(${(T.anatomy.LAYER_COLOR[s.layer] || [0.6, 0.6, 0.6]).map((v) => Math.round(v * 255)).join(',')})"></span><div><h3>${esc(s.name)}</h3><small class="muted">${esc(LN[s.layer] || s.layer)} · ${esc(s.side)} · ${esc(s.region)}</small></div><button class="btn small" data-act="anat-clear" aria-label="Close">✕</button></div>
      <dl class="kv ai-kv"><div><dt>FMA concept</dt><dd class="mono">${esc(s.fma || '—')}</dd></div><div><dt>Model part</dt><dd class="mono">${esc(s.id)} · #${s.idx + 1} of ${nf(A.parts.length)}</dd></div><div><dt>Volume</dt><dd>${s.vol ? s.vol.toFixed(s.vol < 1 ? 3 : 1) + ' cm³' : '—'}</dd></div><div><dt>Extent</dt><dd>${sz.join(' × ')} mm</dd></div><div><dt>Mesh</dt><dd>${nf(s.ic / 3)} triangles</dd></div></dl>
      <h4 class="ai-sub">In this patient</h4>${w.length ? `<ul class="ai-why">${w.map(([l, a, b]) => `<li>${lvTxt(l)}<span><b>${esc(a)}</b> ${esc(b)}</span></li>`).join('')}</ul>` : '<p class="muted" style="font-size:13px">Nothing in the record points to this structure. It is shown in its normal state.</p>'}
      <div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0"><button class="btn small" data-act="anat-focus">Centre</button><button class="btn small" data-act="anat-iso-sel">Isolate</button><button class="btn small" data-act="anat-hide-sel">Hide</button><button class="btn small" data-act="anat-layer-only" data-l="${s.layer}">Only ${esc((LN[s.layer] || s.layer).toLowerCase())}</button></div>
      <h4 class="ai-sub">Nearest structures</h4><div class="ai-near">${near.map(([x]) => `<button data-act="anat-pick" data-i="${x.idx}"><i style="background:rgb(${(T.anatomy.LAYER_COLOR[x.layer] || [0.6, 0.6, 0.6]).map((v) => Math.round(v * 255)).join(',')})"></i>${esc(x.name)}</button>`).join('')}</div>`;
  }
  function vAnatomy(ctx) {
    const { p, h } = ctx;
    const A = T.anatomy && T.anatomy.atlas;
    if (!AV.layers) AV.layers = new Set(T.anatomy.PRESETS.organs);
    const st = A ? anatState(p, ctx.sim, h, A, ctx.on) : null; A3D.st = st;
    const layerRows = A ? A.layers.filter((l) => l.count).map((l) => `<label class="alayer"><input type="checkbox" data-change="anat-layer" data-l="${l.id}" ${AV.layers.has(l.id) ? 'checked' : ''}><i style="background:rgb(${(T.anatomy.LAYER_COLOR[l.id] || [0.6, 0.6, 0.6]).map((v) => Math.round(v * 255)).join(',')})"></i><span>${esc(l.name)}</span><small>${nf(l.count)}</small></label>`).join('') : '';
    const presets = [['organs', 'Organs'], ['skeleton', 'Skeleton'], ['vessels', 'Vessels'], ['nervous', 'Nervous'], ['muscles', 'Muscles'], ['all', 'Everything']];
    const affected = st ? Object.keys(st.state).filter((i) => st.state[i] > 0).length : 0;
    return `${scrubber(p, h)}
      <div class="anat">
        <div class="anat-main panel">
          <div class="anat-bar">
            <div class="seg">${['F', 'B', 'L', 'R', 'T'].map((v) => `<button data-act="anat-view" data-v="${v}" title="${{ F: 'Front', B: 'Back', L: 'Left side', R: 'Right side', T: 'Top' }[v]}">${v}</button>`).join('')}</div>
            <div class="seg">${presets.map(([k, l]) => `<button data-act="anat-preset" data-k="${k}">${l}</button>`).join('')}</div>
            <label class="anat-tog"><input type="checkbox" data-change="anat-overlay" ${AV.overlay ? 'checked' : ''}> Clinical overlay</label>
          </div>
          <div class="anat-stage" data-p="${p.id}">
            ${A ? '' : `<div class="anat-load"><div class="bar"><i style="width:${Math.round(A3D.pct * 100)}%"></i></div><span>${A3D.err ? esc(A3D.err) : 'Loading 2,234 anatomical structures…'}</span></div>`}
            <div class="anat-tip" hidden></div><div class="anat-pin" hidden></div>
            ${AV.iso ? `<div class="anat-iso">Isolated: <b>${esc(AV.isoLabel)}</b> <button class="btn small" data-act="anat-uniso">Show all</button></div>` : ''}
            <div class="anat-legend"><span><i class="c2"></i>Alert</span><span><i class="c1"></i>Watch</span><span><i class="c0"></i>Drug site</span><span><i class="cm"></i>Normal (muted)</span></div>
          </div>
          <div class="anat-sliders">
            <label>Explode <input type="range" min="0" max="100" value="${Math.round(AV.explode * 100)}" data-anat-slider="explode"></label>
            <label>X-ray <input type="range" min="0" max="100" value="${Math.round(AV.xray * 100)}" data-anat-slider="xray"></label>
            <span class="muted anat-stat">${A ? `${nf(A.parts.length)} structures · ${nf(A.triangles)} triangles · ${affected} affected` : ''}</span>
          </div>
          <p class="anat-attr">Anatomy: BodyParts3D, © The Database Center for Life Science, CC BY 4.0. Adult male reference body; the patient's own anatomy is not imaged.</p>
        </div>
        <div class="anat-side">
          <div class="panel"><div class="body">
            <div class="anat-search"><input type="search" placeholder="Find any structure: “left renal artery”, “mitral”, “C5 disk”…" data-anat-search aria-label="Search anatomy" value="${esc(AV.q)}"><div class="anat-res" hidden></div></div>
            <div class="anat-insp">${A ? anatInspector(p, ctx, st) : '<p class="muted">Loading…</p>'}</div>
          </div></div>
          <details class="panel anat-layers" open><summary>Layers</summary><div class="body">${layerRows}</div></details>
        </div>
      </div>`;
  }
  function anatApply() {
    const v = A3D.viewer; if (!v) return;
    v.layers = new Set(AV.layers); v.explode = AV.explode; v.xray = AV.xray; v.overlay = AV.overlay; v.sel = AV.sel; v.iso = AV.iso;
    v.state = A3D.st ? A3D.st.state : null; v.dirty = true;
  }
  function anatMount() {
    const stage = document.querySelector('.anat-stage'); if (!stage) return;
    if (A3D.canvas) {
      if (A3D.canvas.parentNode !== stage) stage.insertBefore(A3D.canvas, stage.firstChild);
      if (A3D.viewer) { anatApply(); if (A3D.viewer.dead) { A3D.viewer.dead = false; A3D.viewer.loop(); } }
      return;
    }
    const cv = document.createElement('canvas'); cv.className = 'anat-canvas'; cv.tabIndex = 0; cv.setAttribute('aria-label', '3D anatomy. Drag to rotate, scroll or pinch to zoom, shift-drag to pan, click to select.');
    stage.insertBefore(cv, stage.firstChild); A3D.canvas = cv;
    T.anatomy.load((f) => { A3D.pct = f; const b = document.querySelector('.anat-load .bar i'); if (b) b.style.width = Math.round(f * 100) + '%'; })
      .then(() => {
        try {
          A3D.viewer = new T.anatomy.Viewer(cv, T.anatomy.atlas, {
            onSelect: (k) => { AV.sel = k; const pid = (CUR && CUR.p.id) || ''; if (k >= 0) audit('twin-anatomy', { patient: T.P(pid), detail: `selected ${T.anatomy.atlas.parts[k].name} (${T.anatomy.atlas.parts[k].fma || T.anatomy.atlas.parts[k].id})` }); render(); },
            onHover: (k, e) => { const tip = document.querySelector('.anat-tip'); if (!tip) return; if (k < 0) { tip.hidden = true; return; } const r = cv.getBoundingClientRect(); tip.hidden = false; tip.textContent = T.anatomy.atlas.parts[k].name; tip.style.left = (e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px'; },
            onRender: (v) => { const pin = document.querySelector('.anat-pin'); if (!pin) return; if (v.sel < 0) { pin.hidden = true; return; } const pp = T.anatomy.atlas.parts[v.sel]; const off = v.offset(pp); const q = v.project([pp.ctr[0] + off[0], pp.ctr[1] + off[1], pp.ctr[2] + off[2]]); pin.hidden = q.z > 1; const W = cv.getBoundingClientRect().width; pin.classList.toggle('flip', q.x > W * 0.55); pin.style.left = q.x + 'px'; pin.style.top = q.y + 'px'; if (pin.dataset.i !== String(v.sel)) { pin.dataset.i = v.sel; pin.innerHTML = `<span>${esc(pp.name)}</span>`; } }
          });
          render();
        } catch (e) { A3D.err = e.message; render(); }
      })
      .catch((e) => { A3D.err = 'Could not load the anatomy model: ' + e.message; render(); });
  }
  T.after.push(() => { if (document.querySelector('.anat-stage')) anatMount(); });
  document.addEventListener('input', (e) => {
    const s = e.target.closest('[data-anat-slider]');
    if (s) { const k = s.dataset.anatSlider, prev = AV[k]; AV[k] = +s.value / 100; if (k === 'explode' && A3D.viewer) A3D.viewer.cam.dist *= (1 + AV.explode * 0.9) / (1 + prev * 0.9); anatApply(); return; }
    const q = e.target.closest('[data-anat-search]');
    if (q && T.anatomy.atlas) {
      AV.q = q.value; const box = q.parentNode.querySelector('.anat-res'); const t = q.value.trim().toLowerCase();
      if (t.length < 2) { box.hidden = true; return; }
      const words = t.split(/\s+/); const hits = T.anatomy.atlas.parts.filter((x) => words.every((w) => x.name.toLowerCase().includes(w))).slice(0, 12);
      box.hidden = false; box.innerHTML = hits.length ? hits.map((x) => `<button data-act="anat-pick" data-i="${x.idx}"><i style="background:rgb(${(T.anatomy.LAYER_COLOR[x.layer] || [0.6, 0.6, 0.6]).map((v) => Math.round(v * 255)).join(',')})"></i>${esc(x.name)}<small>${esc(LAYER_NAMES()[x.layer] || '')}</small></button>`).join('') : '<p class="muted">No structure matches.</p>';
    }
  });
  const anatPick = (i, focus) => { AV.sel = i; AV.q = ''; if (A3D.viewer && i >= 0) { const pt = T.anatomy.atlas.parts[i]; if (!AV.iso) AV.layers.add(pt.layer); if (focus) A3D.viewer.focus(i); } const pid = CUR && CUR.p.id; if (i >= 0) audit('twin-anatomy', { patient: T.P(pid), detail: `selected ${T.anatomy.atlas.parts[i].name}` }); render(); };
  ACT['anat-view'] = (d) => { A3D.viewer && A3D.viewer.view(d.v); };
  ACT['anat-preset'] = (d) => { const L = T.anatomy.PRESETS[d.k]; AV.layers = new Set(L || T.anatomy.atlas.layers.map((l) => l.id)); AV.iso = null; render(); };
  ACT['anat-pick'] = (d) => anatPick(+d.i, true);
  ACT['anat-clear'] = () => { AV.sel = -1; render(); };
  ACT['anat-focus'] = () => { A3D.viewer && A3D.viewer.focus(AV.sel); };
  ACT['anat-iso-sel'] = () => { if (AV.sel < 0) return; AV.iso = new Set([AV.sel]); AV.isoLabel = T.anatomy.atlas.parts[AV.sel].name; A3D.viewer && A3D.viewer.focus(AV.sel); render(); };
  ACT['anat-hide-sel'] = () => { if (AV.sel < 0 || !A3D.viewer) return; A3D.viewer.hidden.add(AV.sel); AV.sel = -1; render(); };
  ACT['anat-layer-only'] = (d) => { AV.layers = new Set([d.l]); AV.iso = null; render(); };
  ACT['anat-uniso'] = () => { AV.iso = null; A3D.viewer && A3D.viewer.hidden.clear(); A3D.viewer && A3D.viewer.view('F'); render(); };
  ACT['anat-finding'] = (d) => {
    const f = A3D.st && A3D.st.findings.find((x) => x.id === d.f); if (!f || !A3D.viewer) return;
    AV.iso = new Set(f.parts); AV.isoLabel = `${f.label} · ${f.parts.length} structure${f.parts.length > 1 ? 's' : ''}`; AV.sel = f.parts[0];
    const A = T.anatomy.atlas, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    f.parts.forEach((i) => { const b = A.parts[i].b; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b[0][k]); hi[k] = Math.max(hi[k], b[1][k]); } });
    A3D.viewer.cam.tgt = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2); A3D.viewer.cam.dist = Math.max(160, Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 2.6);
    audit('twin-anatomy', { patient: T.P(CUR && CUR.p.id), detail: `isolated ${f.label} (${f.parts.length} structures)` }); render();
  };
  T.CHANGE = T.CHANGE || {};
  T.CHANGE['anat-layer'] = (v, el) => { if (el.checked) AV.layers.add(el.dataset.l); else AV.layers.delete(el.dataset.l); AV.iso = null; anatApply(); };
  T.CHANGE['anat-overlay'] = (v, el) => { AV.overlay = el.checked; anatApply(); };

  /* ---------- Ask the twin ----------
     Questions about this patient, answered only from a numbered list of facts drawn from the record
     (labs with history, vitals, medications, problems, allergies, infections, orders, scores, risks,
     the 72-hour forecast and anatomy findings). Free-text notes and identifiers are never included.
     On the published link Claude answers; elsewhere a rule engine answers from the same facts. Every
     claim cites its fact, uncited answers are flagged, and every question is audited. */
  const ASK_LINK = { plan: 'careplan', lab: 'results', vitals: 'vitals', med: 'meds', problem: 'overview', allergy: 'overview', infection: 'overview', order: 'orders', result: 'results' };
  const ASK_ICON = { plan: '☑', lab: '⚗', vitals: '♥', med: '℞', problem: '◆', allergy: '⚠', infection: '✚', order: '☰', result: '!', score: '∑', risk: '▲', forecast: '⟶', anatomy: '◎', twin: '◇' };
  const SYS_WORDS = { neuro: /brain|neuro|nerve|confus|stroke|seiz/, heart: /heart|cardi|coronar|rhythm|atri|arrhythm|\baf\b|blood pressure|\bbp\b|aort/, lungs: /lung|breath|resp|oxygen|spo2|airway/, gi: /liver|gut|stomach|bowel|\bgi\b|hepat/, kidney: /kidney|renal|ckd|potassium|creatinine|egfr|urin|bladder/, endo: /diabet|glucose|sugar|a1c|pancrea|endocr|thyroid/, blood: /blood|bleed|inr|clot|warfarin|anticoag|infect|sepsis/, msk: /bone|joint|spine|knee|hip/ };
  function askFacts(ctx) {
    const { p, lv, on, opt, rs, sim, base, ev, evB } = ctx;
    const F = []; const add = (kind, text, extra) => { const f = Object.assign({ id: 'F' + (F.length + 1), kind, text }, extra || {}); F.push(f); return f; };
    const when = (at) => (T.hist ? T.hist.fmtT(at) : '');
    add('problem', `Age ${p.age}, ${p.sex === 'F' ? 'female' : 'male'}; ${/admitted/i.test(p.status) ? `admitted to ${p.unit}` : p.status}; ${p.code}`, { sys: [] });
    p.problems.forEach((x) => add('problem', `Active problem: ${x}`, { sys: SYSTEMS.filter((s) => s.prob.test(x)).map((s) => s.id) }));
    add('allergy', p.allergiesUnknown ? 'Allergies: unknown (not yet documented)' : p.allergies.length ? `Allergies: ${p.allergies.map((a) => `${a.agent} (${a.reaction}, ${a.severity.toLowerCase()})`).join('; ')}` : 'Allergies: none known');
    if (T.hist) {
      const vs = T.hist.vitals(p), last = vs[vs.length - 1], dayAgo = vs.slice().reverse().find((x) => last.at - x.at >= 20 * 3600e3);
      const vt = (x) => `HR ${x.hr}, BP ${x.sbp}/${x.dbp}, RR ${x.rr}, SpO₂ ${x.spo2}%, temp ${x.temp} °F, NEWS2 ${x.news}`;
      add('vitals', `Latest vitals (${when(last.at)}, ${last.by || 'nursing'}): ${vt(last)}`, { at: last.at, sys: ['heart', 'lungs'], latest: last });
      if (dayAgo) add('vitals', `Vitals about 24 h earlier (${when(dayAgo.at)}): ${vt(dayAgo)}`, { at: dayAgo.at, sys: ['heart', 'lungs'], dayAgo });
      T.hist.labs(p).forEach((s) => {
        const c = s.pts[s.pts.length - 1], pv = s.pts[s.pts.length - 2];
        const trend = s.pts.length > 2 ? `; ${s.pts.length} results ${s.pts.map((x) => x.raw).join(' → ')} since ${when(s.pts[0].at).split(',')[0]}` : '';
        add('lab', `${s.test} ${c.raw} ${s.unit || ''} (${c.flag || 'normal'}, reference ${s.ref || '—'}) on ${when(c.at)}${pv ? `; previous ${pv.raw} on ${when(pv.at)}` : ''}${trend}`, { at: c.at, test: s.test, series: s, sys: SYSTEMS.filter((sy) => sy.labs.test(s.test)).map((sy) => sy.id) });
      });
    } else p.labs.forEach((l) => add('lab', `${l.test} ${l.value} ${l.unit || ''} (${l.flag || 'normal'}, reference ${l.ref})`, { test: l.test }));
    medRows(p, ctx).forEach((r) => {
      const fx = Object.entries(r.fx).map(([k, v]) => `${(SYSTEMS.find((s) => s.id === k) || {}).name}: ${v}`).join('; ');
      const cls = [ARB.test(r.drug) && 'raises potassium (ARB/ACE inhibitor)', KSPARE.test(r.drug) && 'raises potassium', ANTICOAG.test(r.drug) && 'anticoagulant', ANTIPLT.test(r.drug) && 'antiplatelet', NSAID.test(r.drug) && 'NSAID'].filter(Boolean).join(', ');
      add('med', `${r.drug} ${r.dose} · source ${r.src} · status ${r.status}${r.simHeld ? ' (held in the current simulation)' : ''}${cls ? ` · ${cls}` : ''}${fx ? ` · effects: ${fx}` : ''}`, { drug: r.drug, held: r.held, sys: Object.keys(r.fx) });
    });
    (S().hai || []).filter((h) => h.patient === p.id).forEach((h) => add('infection', `${h.type}: ${h.organism}; ${h.device || ''}; treatment ${h.tx}; ${h.status}`, { sys: ['kidney', 'blood'] }));
    (S().isolation || []).filter((i) => i.patient === p.id).forEach((i) => add('infection', `${i.type} precautions: ${i.reason}`));
    (S().orders || []).filter((o) => o.patient === p.id && !/discontinued|completed/i.test(o.status)).forEach((o) => add('order', `${o.type} order: ${o.text} (${o.priority}, ${o.status})`, { sys: [] }));
    (S().results || []).filter((r) => r.patient === p.id).forEach((r) => add('result', `Critical result ${r.test} ${r.value}: ${r.state}${r.state === 'New' ? ' (not yet acknowledged)' : ''}`));
    scores(p).forEach((s) => add('score', `${s.k} ${s.v} (${s.sub}); ${s.why}`, { sys: s.k === 'eGFR' || s.k === 'CrCl' ? ['kidney'] : s.k.includes('VASc') || s.k === 'MAP' ? ['heart'] : s.k === 'HAS-BLED' ? ['blood'] : [] }));
    SYSTEMS.forEach((s) => { const st = systemState(p, s); if (st.level) add('twin', `Twin status of ${s.name}: ${LVL[st.level]} because ${st.ev.map(([k, t]) => `${k.toLowerCase()} ${t}`).join('; ')}`, { sys: [s.id], level: st.level }); });
    rs.forEach((r) => { const w = riskWith(r, lv, on, opt); add('risk', `Risk ${r.name}: ${r.base}% from the record${w.delta ? `; ${w.sim}% with the current simulated levers` : ''}. Drivers: ${r.drivers.join('; ')}`, { risk: r.id, base: r.base }); });
    const fs = METRICS(p).filter((m) => base[m.id] && ['k', 'inr', 'cr'].includes(m.id));
    if (fs.length) add('forecast', `Forecast if nothing changes (illustrative model): ${fs.map((m) => `${m.name} ${m.f(base[m.id][0])} now, ${m.f(base[m.id][24])} at +24 h, ${m.f(base[m.id][H])} at +72 h`).join('; ')}`, { sys: ['kidney', 'blood'] });
    evB.slice(0, 5).forEach((e) => add('forecast', `Forecast event if nothing changes: ${e.text} at ${hLabel(e.h)}`, { cls: e.cls }));
    if (lv.some((l) => on.has(l.id) !== !!l.pre)) ev.slice(0, 4).forEach((e) => add('forecast', `Forecast event with the current simulated levers: ${e.text} at ${hLabel(e.h)}`, { cls: e.cls, sim: true }));
    interactions(p, medRows(p, ctx)).forEach(([c, a, b]) => add('med', `Caution: ${a}. ${b}`, { caution: c }));
    ANAT_RULES.forEach((r) => { if (r.when(p)) add('anatomy', `Anatomy finding: ${r.label} (${r.why(p, { h: 0, sim: base, k: base.k ? base.k[0] : null, lv: base.levels[0] }) || ''})`); });
    const cp = T.careplan && T.careplan.summary(p);
    if (cp) {
      cp.goals.forEach(({ g, label, cur }) => add('plan', `Care plan goal (${g.sys}): ${g.text} — ${label}${cur ? `, now ${cur.raw}` : ''}`, { sys: [g.sys] }));
      cp.tasks.filter((x) => x.state !== 'done').forEach(({ t, state, due }) => add('plan', `Care plan task for ${t.owner}: ${t.text} — ${state === 'overdue' ? 'OVERDUE' : state === 'ontrack' ? 'on track' : 'open'}, due ${T.careplan.rel(due - Date.now())}`, { overdue: state === 'overdue' }));
      cp.meds.forEach((m) => add('plan', `Planned drug: ${m.drug} — safety check ${m.check.level}${m.check.reasons.length ? ': ' + m.check.reasons.join(' ') : ''}${m.ordered ? ' (sent to orders)' : ''}`));
    }
    F.forEach((f) => { f.terms = f.text.toLowerCase(); });
    return F;
  }
  const LAB_WORDS = [[/potassium|\bk\b/, /^potassium/i], [/creatinine|\bcr\b/, /^creatinine/i], [/egfr|gfr|kidney function/, /^eGFR/i], [/\binr\b|clot|coag/, /^INR/i], [/a1c|hba1c/, /HbA1c/i], [/glucose|sugar/, /glucose/i], [/troponin/, /troponin/i], [/sodium|\bna\b/, /sodium/i], [/haemoglobin|hemoglobin|\bhb\b/, /hemoglobin|haemoglobin/i], [/\bwbc\b|white cell/, /WBC/i], [/lactate/, /lactate/i], [/bnp/, /BNP/i], [/ldl|cholesterol/, /LDL/i], [/lipase/, /lipase/i]];
  function offlineAnswer(ctx, q, F) {
    const t = ' ' + q.toLowerCase() + ' ';
    const c = (f) => `[${f.id}]`; const out = []; const cites = new Set(); const say = (s, ...fs) => { fs.filter(Boolean).forEach((f) => cites.add(f.id)); out.push(s.replace(/\.\.+$/, '.').replace(/\s{2,}/g, ' ') + ' ' + fs.filter(Boolean).map(c).join('')); };
    const of = (k) => F.filter((f) => f.kind === k);
    const labF = (re) => F.find((f) => f.kind === 'lab' && re.test(f.test || ''));
    const labHit = LAB_WORDS.find(([w]) => w.test(t)); const sysHit = SYSTEMS.find((s) => SYS_WORDS[s.id].test(t));
    const follow = new Set();
    const futureQ = /if nothing|forecast|next \d|in \d+ ?h|72|tomorrow|expect|project|predict|going to/.test(t);
    if (!futureQ && /chang|new |since|last 24|overnight|yesterday|update|different|what.?s happened/.test(t)) {
      of('lab').filter((f) => f.series && f.series.pts.length > 1 && Date.now() - f.series.pts[f.series.pts.length - 1].at < 40 * 3600e3).forEach((f) => { const s = f.series, a = s.pts[s.pts.length - 2], b = s.pts[s.pts.length - 1]; if (a.raw !== b.raw) say(`${s.test} ${b.v > a.v ? 'rose' : 'fell'} from ${a.raw} to ${b.raw}${b.flag ? ` (${b.flag})` : ''}.`, f); });
      const vl = F.find((f) => f.latest), vd = F.find((f) => f.dayAgo);
      if (vl && vd) {
        const L = vl.latest, Dd = vd.dayAgo, ch = [];
        [['hr', 'heart rate', 10], ['sbp', 'systolic BP', 15], ['rr', 'respiratory rate', 3], ['spo2', 'SpO₂', 2], ['temp', 'temperature', 0.9], ['news', 'NEWS2', 1]].forEach(([k, n, th]) => { if (Math.abs(L[k] - Dd[k]) >= th) ch.push(`${n} ${Dd[k]} → ${L[k]}`); });
        say(ch.length ? `Over about 24 h the vitals moved: ${ch.join(', ')}.` : `Vitals are broadly stable over 24 h (NEWS2 ${Dd.news} → ${L.news}).`, vd, vl);
      }
      of('result').filter((f) => /not yet acknowledged/.test(f.text)).forEach((f) => say('A critical result is still waiting to be acknowledged.', f));
      of('order').filter((f) => /STAT|Pending signature/i.test(f.text)).slice(0, 3).forEach((f) => say(`Open order: ${f.text.replace(/^\w+ order: /, '')}.`, f));
      of('med').filter((f) => f.held && !f.drug.match(/^(Metformin)$/)).slice(0, 2).forEach((f) => say(`${f.drug} is on hold.`, f));
      follow.add('What should I watch on this shift?'); follow.add('What happens in 72 hours if nothing changes?');
    } else if (/(med|drug|tablet|pill)/.test(t) && /(potassium|\bk\b|hyperkal)/.test(t)) {
      const ms = of('med').filter((f) => /raises potassium/.test(f.text)); const k = labF(/^potassium/i);
      if (ms.length) ms.forEach((f) => say(`${f.drug} raises potassium${f.held ? ' but is on hold' : ''}.`, f)); else say('No medication on the record is listed as raising potassium.');
      if (k) say(`For context, potassium is ${k.series ? k.series.pts[k.series.pts.length - 1].raw : ''}.`, k);
      const ck = of('med').find((f) => f.caution && /potassium/.test(f.terms)); if (ck) say(ck.text.replace(/^Caution: /, ''), ck);
      follow.add("What's the trend in potassium?"); follow.add('Why is the kidney flagged?');
    } else if (/(med|drug)/.test(t) && /bleed|anticoag|blood thin/.test(t)) {
      of('med').filter((f) => /anticoagulant|antiplatelet|NSAID/.test(f.text)).forEach((f) => say(`${f.drug}: ${/anticoagulant/.test(f.text) ? 'anticoagulant' : /antiplatelet/.test(f.text) ? 'antiplatelet' : 'NSAID'}${f.held ? ', on hold' : ''}.`, f));
      const r = F.find((f) => f.risk === 'bleed'); if (r) say(`Modelled major-bleeding risk is ${r.base}% over 30 days.`, r);
      follow.add("What's the trend in INR?");
    } else if (/allerg/.test(t)) {
      const a = of('allergy')[0]; say(a.text + '.', a); const x = of('med').find((f) => f.caution && /allergy/.test(f.terms)); if (x) say(x.text.replace(/^Caution: /, ''), x);
    } else if (/why|flag|alert|watch|red|amber|yellow|wrong with/.test(t) && sysHit) {
      const tw = F.find((f) => f.kind === 'twin' && f.sys.includes(sysHit.id));
      if (tw) say(`${sysHit.name} is on ${LVL[tw.level].toLowerCase()} in the twin.`, tw); else say(`${sysHit.name} shows no abnormal findings in the record.`);
      F.filter((f) => ['lab', 'problem', 'score', 'infection'].includes(f.kind) && f.sys && f.sys.includes(sysHit.id) && (f.kind !== 'lab' || /\((H|L|HH|LL|A)/.test(f.text))).slice(0, 4).forEach((f) => say(f.kind === 'lab' ? `${f.test}: ${f.text.split(' (')[0].replace(f.test + ' ', '')} (${(f.text.match(/\(([^,)]+)/) || [])[1]}).` : f.text.replace(/^Active problem: /, '') + '.', f));
      of('med').filter((f) => f.sys && f.sys.includes(sysHit.id) && !f.held).slice(0, 2).forEach((f) => say(`${f.drug} acts here.`, f));
      follow.add(`Which medications affect the ${sysHit.name.split(' ')[0].toLowerCase()}?`);
    } else if (labHit && labF(labHit[1])) {
      const f = labF(labHit[1]); const s = f.series;
      if (s && s.pts.length > 1) { const a = s.pts[0], b = s.pts[s.pts.length - 1]; say(`${s.test} has gone from ${a.raw} to ${b.raw} ${s.unit || ''} over ${Math.max(1, Math.round((b.at - a.at) / 86400e3))} days (${s.pts.map((x) => x.raw).join(' → ')}).`, f); }
      else say(f.text + '.', f);
      const fc = F.find((x) => x.kind === 'forecast' && x.text.includes(s ? s.test : '')); if (fc) say('The twin projects where it goes next if nothing changes.', fc);
      const ev1 = F.find((x) => x.kind === 'forecast' && /event/.test(x.text) && s && x.text.includes(s.test) && !x.sim); if (ev1) say(ev1.text.replace('Forecast event if nothing changes: ', 'If nothing changes: ') + '.', ev1);
      follow.add('What changed in the last 24 hours?');
    } else if (/risk|worr|concern|danger|serious|worst/.test(t)) {
      of('risk').sort((a, b) => b.base - a.base).slice(0, 3).forEach((f) => say(f.text.split('. Drivers')[0] + '.', f));
      const e = F.find((f) => f.kind === 'forecast' && f.cls === 'crit' && !f.sim); if (e) say(e.text + '.', e);
      follow.add('How can the hyperkalaemia risk come down?');
    } else if (/forecast|next|72|tomorrow|if nothing|expect|project|predict|going to/.test(t)) {
      const fc = of('forecast').filter((f) => !f.sim); fc.slice(0, 4).forEach((f) => say(f.text + '.', f));
      if (!fc.length) say('The record has no labs the twin can project.');
      follow.add("What's the biggest risk right now?");
    } else if (/care plan|plan\b|goal|task|overdue|to.?do/.test(t)) {
      const ps = of('plan'); if (!ps.length) say('There is no care plan yet. Open the Care plan tab to accept the suggested goals and tasks.');
      ps.filter((f) => f.overdue).forEach((f) => say(f.text.replace('Care plan task for ', 'Overdue for ') + '.', f));
      ps.filter((f) => /goal/.test(f.text)).slice(0, 4).forEach((f) => say(f.text.replace('Care plan goal ', 'Goal ') + '.', f));
      ps.filter((f) => /Planned drug/.test(f.text) && /block/.test(f.text)).forEach((f) => say(f.text + '.', f));
    } else if (/vital|news|heart rate|pulse|\bbp\b|pressure|oxygen|spo2|sat|temp|fever|breath/.test(t)) {
      const vl = F.find((f) => f.latest), vd = F.find((f) => f.dayAgo); say(vl.text + '.', vl); if (vd) say('For comparison: ' + vd.text.replace(/^Vitals about 24 h earlier /, '') + '.', vd);
    } else if (/abnormal|out of range|critical|high|low|labs?\b|results?/.test(t)) {
      of('lab').filter((f) => /\((H|L|HH|LL|A)\b/.test(f.text)).forEach((f) => say(`${f.test} ${f.series ? f.series.pts[f.series.pts.length - 1].raw : ''} (${(f.text.match(/\(([^,)]+)/) || [])[1]}).`, f));
      of('result').filter((f) => /not yet/.test(f.text)).forEach((f) => say(f.text + '.', f));
    } else if (/watch|monitor|check|plan|do next|priorit|shift|handover/.test(t)) {
      F.filter((f) => f.kind === 'twin' && f.level === 2).forEach((f) => say(`${f.text.split(' because')[0].replace('Twin status of ', '')}: ${(SYSTEMS.find((s) => f.sys.includes(s.id)) || {}).watch}.`, f));
      F.filter((f) => f.kind === 'forecast' && f.cls === 'crit' && !f.sim).slice(0, 2).forEach((f) => say(f.text + '.', f));
      of('result').filter((f) => /not yet/.test(f.text)).forEach((f) => say('Acknowledge the open critical result.', f));
      of('med').filter((f) => f.caution === 'crit').slice(0, 2).forEach((f) => say(f.text + '.', f));
    } else if (/score|egfr|crcl|chads|cha2|vasc|has.?bled|bmi|qsofa|map\b|shock index/.test(t)) {
      const KEYS = [[/chads|cha2|vasc|stroke score/, 'CHA'], [/has.?bled/, 'HAS'], [/egfr|gfr/, 'eGFR'], [/crcl|creatinine clearance/, 'CrCl'], [/bmi/, 'BMI'], [/qsofa/, 'qSOFA'], [/\bmap\b|mean arterial/, 'MAP'], [/shock/, 'Shock'], [/news/, 'NEWS2']];
      const want = KEYS.filter(([re]) => re.test(t)).map(([, k]) => k);
      const fs = of('score').filter((f) => !want.length || want.some((k) => f.text.startsWith(k)));
      fs.forEach((f) => say(f.text.replace(/;\s*/, ': ').replace(/\.$/, '') + '.', f));
    } else if (/infect|isolat|cauti|antibiotic|precaution|organism/.test(t)) {
      const fs = of('infection'); fs.forEach((f) => say(f.text + '.', f)); if (!fs.length) say('No infection or isolation is recorded.');
    } else {
      const words = t.match(/[a-z0-9]{3,}/g) || []; const stop = /^(the|and|what|why|how|does|this|that|with|for|are|was|his|her|patient|any|about|have|has|show|tell|me)$/;
      const scored = F.map((f) => [f, words.filter((w) => !stop.test(w) && f.terms.includes(w)).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (scored.length) { out.push('Here is what the record has on that:'); scored.forEach(([f]) => say('• ' + f.text + '.', f)); }
      else out.push("I couldn't find anything in this patient's record that answers that. Try asking about a lab, a vital sign, a medication, a body system, the risks or the forecast.");
    }
    if (!follow.size) { follow.add('What changed in the last 24 hours?'); follow.add('What should I watch on this shift?'); }
    return { answer: out.join(' '), citations: [...cites], followups: [...follow].slice(0, 3) };
  }
  const askPrompt = (ctx, q, F) => `You are "Ask the twin", a question-answering assistant inside a hospital record system. The data is fictional demo data.
Answer the clinician's question using ONLY the numbered facts below. Every sentence that states something from the record must end with the fact ids it relies on in square brackets, for example [F3] or [F3][F7]. Never cite an id that is not listed. If the facts don't answer the question, say so plainly and suggest what to check instead. Do not invent values, diagnoses or treatments; you may point out what the facts imply, such as a rising trend or an interaction the facts list. Forecasts and risks come from an illustrative model, so call them projections. Plain language, short sentences, at most 120 words.
Return only JSON: {"answer": "text with [F#] citations", "citations": ["F#", ...], "followups": ["up to 3 short follow-up questions"]}

Patient: ${ctx.p.age}-year-old ${ctx.p.sex === 'F' ? 'female' : 'male'} (identifiers withheld). Time now: ${new Date().toLocaleString('en-US')}.
Facts:
${F.map((f) => `${f.id} [${f.kind}] ${f.text}`).join('\n')}

Question: ${q}`;
  const ASK_ERR = { rate_limited: 'Claude is busy or the usage limit was reached', session_expired: 'the claude.ai session expired', refused: 'Claude declined to answer', empty_completion: 'Claude returned nothing', invalid_json: 'Claude returned an unreadable answer' };
  async function askTwin(pid, q) {
    q = String(q || '').trim().slice(0, 300); if (!q) return;
    const p = T.P(pid); const u = T.me(); if (!p || !u) return;
    const ctx = askCtx(p);
    const F = askFacts(ctx);
    UI.ptTwinAsk = UI.ptTwinAsk || {}; const thread = UI.ptTwinAsk[pid] = UI.ptTwinAsk[pid] || [];
    const item = { q, at: Date.now(), state: 'pending', facts: F };
    thread.push(item); render();
    const s = T.caps && T.caps.sample;
    let res = null, engine = 'rules', note = '';
    if (s) {
      try {
        const j = await s.json(askPrompt(ctx, q, F), { cache: false });
        if (!j || typeof j.answer !== 'string' || !j.answer.trim()) throw { code: 'empty_completion' };
        res = { answer: j.answer, citations: (j.citations || []).filter((id) => F.some((f) => f.id === id)), followups: (j.followups || []).slice(0, 3).map(String) };
        engine = 'claude';
      } catch (e) {
        const code = e && e.code;
        if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) T.caps.sample = null;
        note = `Claude wasn't available (${ASK_ERR[code] || code || 'error'}), so the built-in rules answered.`;
      }
    } else note = (window.claude && window.claude.use) ? '' : 'Answered by the built-in rules. On the published link, Claude answers from the same facts.';
    if (!res) res = offlineAnswer(ctx, q, F);
    const inText = [...new Set((res.answer.match(/\[F\d+\]/g) || []).map((x) => x.slice(1, -1)))].filter((id) => F.some((f) => f.id === id));
    res.answer = res.answer.replace(/\[(F\d+)\]/g, (m, id) => (F.some((f) => f.id === id) ? m : ''));
    Object.assign(item, { state: 'done', engine, note, answer: res.answer, cites: inText.length ? inText : res.citations, followups: res.followups, uncited: !inText.length && !/couldn't find/.test(res.answer) });
    audit('twin-ask', { patient: p, detail: `${engine === 'claude' ? 'Claude' : 'rules'}: "${q.slice(0, 90)}" · ${item.cites.length} source${item.cites.length === 1 ? '' : 's'} cited` });
    render();
    setTimeout(() => { const el = document.querySelector('.ask-thread .ask-item:last-child'); el && el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
  }
  function askCtx(p) {
    const lv = levers(p), on = (UI.ptTwin || {})[p.id] || baseSet(lv), opt = (UI.ptTwinOpt || {})[p.id] || {};
    const sim = project(p, lv, on, opt), base = project(p, lv, baseSet(lv), {});
    return { p, lv, on, opt, rs: risks(p), sim, base, ev: events(p, sim), evB: events(p, base) };
  }
  function askSuggest(ctx) {
    const { p } = ctx; const out = ['What changed in the last 24 hours?'];
    const alert = SYSTEMS.map((s) => [s, systemState(p, s).level]).sort((a, b) => b[1] - a[1])[0];
    if (alert && alert[1]) out.push(`Why is the ${alert[0].name.split(' ')[0].toLowerCase()} flagged?`);
    const k = lab(p, /^potassium/i); if (k && num(k.value) > 5.1) out.push('Which medications raise potassium?');
    const worst = p.labs.find((l) => l.flag && l.flag.length > 1) || p.labs.find((l) => l.flag); if (worst) out.push(`What's the trend in ${worst.test}?`);
    out.push("What's the biggest risk right now?", 'What happens in 72 hours if nothing changes?', 'What should I watch on this shift?');
    return [...new Set(out)].slice(0, 7);
  }
  function askAnswerHtml(item, qi, pid) {
    if (item.state === 'pending') return '<div class="ask-a pending"><span class="dots"><i></i><i></i><i></i></span> Reading the record…</div>';
    const F = item.facts; const used = item.cites.map((id) => F.find((f) => f.id === id)).filter(Boolean);
    const num1 = (id) => used.findIndex((f) => f.id === id) + 1;
    const body = esc(item.answer).replace(/\[(F\d+)\]/g, (m, id) => { const n = num1(id); return n ? `<button class="cite" data-act="ask-cite" data-k="${qi}-${id}" aria-label="Source ${n}">${n}</button>` : ''; });
    const src = used.map((f, i) => { const tab = ASK_LINK[f.kind]; return `<li id="ask-${qi}-${f.id}"><span class="sn">${i + 1}</span><span class="si" aria-hidden="true">${ASK_ICON[f.kind] || '•'}</span><span class="st"><small>${esc(f.kind === 'twin' || f.kind === 'forecast' || f.kind === 'risk' || f.kind === 'anatomy' ? 'Twin model' : f.kind[0].toUpperCase() + f.kind.slice(1))}</small>${esc(f.text)}</span>${tab ? `<a href="#patient-${pid}-${tab}">Open</a>` : ''}</li>`; }).join('');
    return `<div class="ask-a"><div class="ask-meta">${item.engine === 'claude' ? pill('accent', 'Claude') : pill('', 'Built-in rules')}<span class="muted">${used.length} source${used.length === 1 ? '' : 's'} from the record</span></div>
      <p class="ask-body">${body}</p>
      ${item.uncited ? '<p class="ask-warn">No source was cited for this answer. Treat it with caution and check the chart.</p>' : ''}
      ${used.length ? `<ol class="ask-src">${src}</ol>` : ''}
      ${item.note ? `<p class="muted ask-note">${esc(item.note)}</p>` : ''}
      ${item.followups && item.followups.length ? `<div class="ask-chips">${item.followups.map((f) => `<button class="chip" data-act="ask-q" data-p="${pid}" data-q="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : ''}</div>`;
  }
  function vAsk(ctx) {
    const { p } = ctx; const thread = (UI.ptTwinAsk || {})[p.id] || [];
    const nFacts = askFacts(ctx).length; const claude = !!(T.caps && T.caps.sample);
    const items = thread.map((it, i) => `<div class="ask-item"><div class="ask-q"><span>${esc(it.q)}</span><small>${new Date(it.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</small></div>${askAnswerHtml(it, i, p.id)}</div>`).join('');
    const pending = thread.some((it) => it.state === 'pending');
    return `<div class="ask">
      <div class="ask-main panel"><div class="body">
        ${thread.length ? `<div class="ask-thread">${items}</div>` : `<div class="ask-empty"><b>Ask anything about ${esc(p.name.split(' ')[0])}'s record.</b><p class="muted">Answers come only from the record and cite every source. Try one of these:</p><div class="ask-chips">${askSuggest(ctx).map((q) => `<button class="chip" data-act="ask-q" data-p="${p.id}" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`}
        <form data-form="twin-ask" class="ask-form" autocomplete="off"><input type="hidden" name="p" value="${p.id}"><input name="q" type="text" maxlength="300" placeholder="Ask about labs, vitals, medications, risks, the forecast…" aria-label="Question about this patient" ${pending ? 'disabled' : ''} required><button class="btn primary" type="submit" ${pending ? 'disabled' : ''}>Ask</button></form>
        ${thread.length ? `<div class="ask-chips ask-more">${askSuggest(ctx).slice(0, 4).map((q) => `<button class="chip" data-act="ask-q" data-p="${p.id}" data-q="${esc(q)}">${esc(q)}</button>`).join('')}<button class="chip ghost" data-act="ask-clear" data-p="${p.id}">Clear</button></div>` : ''}
      </div></div>
      <aside class="ask-side">
        ${panel('How answers work', `<ul class="howlist"><li>${claude ? '<b>Claude</b> answers on this page' : '<b>Built-in rules</b> answer here; on the published link Claude answers'}, using only ${nFacts} numbered facts from the record.</li><li>Every claim carries a numbered source you can open. Answers with no source are flagged.</li><li>Facts cover labs with their history, vitals, medications, problems, allergies, infections, orders, scores, risks, the forecast and anatomy findings.</li><li>Never sent: name, date of birth, MRN, contact details, payer, and free-text notes.</li><li>Every question is written to the audit log. Answers are not saved to the record.</li></ul>`)}
        ${panel('Not a diagnosis', '<p class="muted" style="margin:0;font-size:13px">Ask the twin summarises what the record already says. Forecasts and risks come from an illustrative model. Check the sources before acting.</p>')}
      </aside></div>`;
  }
  T.FORMS['twin-ask'] = (f) => askTwin(f.p, f.q);
  ACT['ask-q'] = (d) => askTwin(d.p, d.q);
  ACT['ask-clear'] = (d) => { if (UI.ptTwinAsk) delete UI.ptTwinAsk[d.p]; render(); };
  ACT['ask-cite'] = (d) => { const el = document.getElementById('ask-' + d.k); if (!el) return; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };

  /* ---------- Patient twins: everyone you care for, ranked by risk ----------
     One row per patient in the user's care, built from the same twin model (organ states, 72-hour
     forecast) plus vitals and lab history. Same access rule as the patient list (care relationship),
     and opening it is audited with patient tokens, not names. */
  const CAT = { critical: ['crit', 'Critical'], watch: ['warn', 'Watch'], stable: ['ok', 'Stable'] };
  function twinSummary(p) {
    const lv = levers(p), bset = baseSet(lv);
    const base = project(p, lv, bset, {});
    const evs = events(p, base);
    const n = T.news2 ? T.news2(p) : { sc: 0, risk: 'Low' };
    const sys = SYSTEMS.map((s) => [s, systemState(p, s).level]);
    const alerts = sys.filter(([, l]) => l === 2), watches = sys.filter(([, l]) => l === 1);
    const crit = (S().results || []).filter((r) => r.patient === p.id && r.state !== 'Closed');
    const critEv = evs.filter((e) => e.cls === 'crit'), soon = critEv.find((e) => e.h <= 24);
    const vs = T.hist ? T.hist.vitals(p) : []; const last = vs[vs.length - 1]; const dayAgo = vs.slice().reverse().find((x) => last && last.at - x.at >= 20 * 3600e3);
    const changes = [];
    if (last && dayAgo && last.news != null && dayAgo.news != null && last.news !== dayAgo.news) changes.push([last.news > dayAgo.news ? 'up' : 'down', `NEWS2 ${dayAgo.news} → ${last.news}`]);
    const labsH = T.hist ? T.hist.labs(p) : [];
    labsH.forEach((s) => { const b = s.pts[s.pts.length - 1], a = s.pts[s.pts.length - 2]; if (a && b && Date.now() - b.at < 40 * 3600e3 && a.raw !== b.raw && (b.flag || Math.abs(b.v - a.v) / Math.max(Math.abs(a.v), 1e-6) >= 0.05)) changes.push([b.v > a.v ? 'up' : 'down', `${s.test} ${a.raw} → ${b.raw}`, !!b.flag && Math.abs(b.v - a.v) > 0 && (b.v > a.v) === /H/.test(b.flag)]); });
    crit.filter((r) => r.state === 'New').forEach((r) => changes.unshift(['crit', `New critical: ${r.test} ${r.value}`]));
    const worst = labsH.filter((s) => s.pts[s.pts.length - 1].flag).sort((x, y) => y.pts[y.pts.length - 1].flag.length - x.pts[x.pts.length - 1].flag.length)[0] || labsH[0] || null;
    const worsening = changes.filter((c) => c[2]);
    const cpS = T.careplan && T.careplan.summary(p); const overdueTasks = cpS ? cpS.overdue.length : 0;
    let score = n.sc * 6 + (n.sc >= 7 ? 25 : 0) + worsening.length * 4 + overdueTasks * 3 + alerts.length * 10 + watches.length * 3 + critEv.length * 6 + crit.length * 12 + (soon ? 10 : 0) + ((S().isolation || []).some((i) => i.patient === p.id) ? 2 : 0);
    const cat = n.sc >= 7 || crit.some((r) => r.state === 'New') || soon || alerts.length >= 2 ? 'critical' : n.sc >= 5 || alerts.length || critEv.length || crit.length || worsening.length ? 'watch' : 'stable';
    const why = [n.sc >= 5 && `NEWS2 ${n.sc}`, crit.length && `${crit.length} open critical result${crit.length > 1 ? 's' : ''}`, soon && `${soon.text.split(':')[0]} by ${hLabel(soon.h)}`, alerts.length && `${alerts.map(([s]) => s.name.split(' ')[0]).join(', ')} on alert`, overdueTasks && `${overdueTasks} care-plan task${overdueTasks > 1 ? 's' : ''} overdue`, n.sc < 5 && worsening.length && `${worsening.map((c) => c[1].split(' ')[0] + (c[1].split(' ')[1] && !/\d/.test(c[1].split(' ')[1]) ? ' ' + c[1].split(' ')[1] : '')).join(', ')} worsening`].filter(Boolean);
    return { p, n, sys, alerts, crit, evs, first: critEv[0] || evs.find((e) => e.cls === 'warn') || null, vs, last, dayAgo, changes: changes.slice(0, 3), worst, score, cat, why };
  }
  T.VIEWS.twins = (u) => {
    if (u.role !== 'doctor' && u.role !== 'nurse') return { title: 'Patient twins', sub: '', body: '<p class="muted">Patient twins are for the care team.</p>' };
    UI.twinsF = UI.twinsF || 'all'; UI.twinsSort = UI.twinsSort || 'risk';
    const all = T.myPatients(u).map((p) => { try { return twinSummary(p); } catch (e) { return null; } }).filter(Boolean);
    audit('view-twin-list', { resource: 'patient twins', patients: all.map((r) => T.tok(r.p)).join(' '), detail: `${all.length} twins ranked` });
    const q = (UI.twinsQ || '').toLowerCase();
    let list = all.filter((r) => (UI.twinsF === 'all' || r.cat === UI.twinsF) && (!q || r.p.name.toLowerCase().includes(q) || String(r.p.bed || '').toLowerCase().includes(q)));
    const rank = { critical: 0, watch: 1, stable: 2 };
    list.sort(UI.twinsSort === 'news' ? (a, b) => b.n.sc - a.n.sc : UI.twinsSort === 'bed' ? (a, b) => String(a.p.bed || 'zz').localeCompare(String(b.p.bed || 'zz')) : (a, b) => rank[a.cat] - rank[b.cat] || (a.cat === 'critical' ? b.n.sc - a.n.sc : 0) || b.score - a.score || b.n.sc - a.n.sc);
    const cnt = (c) => all.filter((r) => r.cat === c).length;
    const tiles = `<div class="tw-tiles"><div class="tw-tile"><span>Your patients</span><b>${all.length}</b></div>${['critical', 'watch', 'stable'].map((c) => `<button class="tw-tile ${c} ${UI.twinsF === c ? 'on' : ''}" data-act="twins-f" data-f="${UI.twinsF === c ? 'all' : c}"><span>${CAT[c][1]}</span><b>${cnt(c)}</b></button>`).join('')}<div class="tw-tile"><span>Open critical results</span><b>${all.reduce((n, r) => n + r.crit.length, 0)}</b></div></div>`;
    const dot = (l) => `<i class="lvd lv${l}"></i>`;
    const rows = list.map((r) => {
      const p = r.p, w = r.worst, wl = w && w.pts[w.pts.length - 1], [lo, hi] = w ? T.hist.refRange(w.ref) : [];
      const nv = r.vs.slice(-12).map((x) => x.news).filter((x) => x != null);
      return `<article class="tw-row ${r.cat}">
        <div class="tw-who"><span class="tw-bar" aria-hidden="true"></span><div><a href="#patient-${p.id}-twin"><b>${esc(p.name)}</b></a><small>${p.age} ${esc(p.sex)} · ${esc(p.bed || p.unit || p.status)} · ${esc((T.U(p.attending) || {}).name || '')}</small>
          <div class="tw-why">${pill(CAT[r.cat][0], CAT[r.cat][1])}<span>${esc(r.why.join(' · ') || 'No active concerns')}</span></div></div></div>
        <div class="tw-news"><small>NEWS2</small><b class="${r.n.sc >= 7 ? 'crit' : r.n.sc >= 5 ? 'warn' : ''}">${r.n.sc}</b>${nv.length > 2 ? T.hist.spark(nv, { w: 70, h: 20, cls: r.n.sc >= 7 ? 'crit' : r.n.sc >= 5 ? 'warn' : '' }) : ''}</div>
        <div class="tw-lab">${w ? `<small>${esc(w.test)}</small><b class="${wl.flag && wl.flag.length > 1 ? 'crit' : wl.flag ? 'warn' : ''}">${esc(wl.raw)}<em>${esc(w.unit || '')}</em></b>${w.pts.length > 1 ? T.hist.spark(w.pts.map((x) => x.v), { w: 70, h: 20, lo, hi, cls: wl.flag && wl.flag.length > 1 ? 'crit' : wl.flag ? 'warn' : '' }) : ''}` : '<small class="muted">No labs</small>'}</div>
        <div class="tw-chg"><small>Last 24 h</small>${r.changes.length ? `<ul>${r.changes.map(([d, t, worse]) => `<li class="${d === 'crit' ? 'crit' : worse || /^NEWS2/.test(t) && d === 'up' ? 'bad' : /^NEWS2/.test(t) && d === 'down' ? 'good' : 'neutral'}">${d === 'up' ? '▲' : d === 'down' ? '▼' : '!'} ${esc(t)}</li>`).join('')}</ul>` : '<span class="muted">No change</span>'}</div>
        <div class="tw-next"><small>Next 72 h</small>${r.first ? `<span class="${r.first.cls}">${esc(r.first.text.split(':')[0])} <b>${hLabel(r.first.h)}</b></span>` : '<span class="muted">No thresholds crossed</span>'}</div>
        <div class="tw-sys" aria-label="Organ systems">${r.sys.map(([s, l]) => `<span title="${esc(s.name)}: ${LVL[l]}">${dot(l)}</span>`).join('')}</div>
        <div class="tw-act"><a class="btn small primary" href="#patient-${p.id}-twin">Open twin</a><button class="btn small" data-act="twins-ask" data-p="${p.id}">Ask</button></div>
      </article>`;
    }).join('');
    const legend = `<div class="legend tw-legend"><span><i class="lvd lv2"></i>Alert</span><span><i class="lvd lv1"></i>Watch</span><span><i class="lvd lv0"></i>Stable</span><span class="muted">Dots: ${SYSTEMS.map((s) => s.name.split(' ')[0]).join(' · ')}</span></div>`;
    return { title: 'Patient twins', sub: `Everyone in your care, ranked by risk from their digital twin · ${u.role === 'nurse' ? 'your unit' : 'your patients'} only · this view is logged`,
      body: `${tiles}
        <div class="tw-tools"><input type="search" placeholder="Find a patient or bed" value="${esc(UI.twinsQ || '')}" data-change="twins-q" aria-label="Find a patient or bed">
          <div class="seg">${[['risk', 'Risk'], ['news', 'NEWS2'], ['bed', 'Bed']].map(([k, l]) => `<button data-act="twins-sort" data-s="${k}" class="${UI.twinsSort === k ? 'on' : ''}">${l}</button>`).join('')}</div>${legend}</div>
        <div class="tw-list">${rows || '<p class="muted">No patients match.</p>'}</div>
        <p class="kpi-note" style="margin-top:12px">Critical: NEWS2 7 or more, a new critical result, a danger threshold crossed within 24 h, or two organ systems on alert. Watch: NEWS2 5–6, any organ system on alert, an open critical result, a forecast danger, or an abnormal lab moving further out of range. Illustrative rules, not a validated triage tool.</p>` };
  };
  ACT['twins-f'] = (d) => { UI.twinsF = d.f; render(); };
  ACT['twins-sort'] = (d) => { UI.twinsSort = d.s; render(); };
  ACT['twins-ask'] = (d) => { UI.ptTwinView = UI.ptTwinView || {}; UI.ptTwinView[d.p] = 'ask'; location.hash = `patient-${d.p}-twin`; };
  T.CHANGE['twins-q'] = (v) => { UI.twinsQ = v; render(); };

  /* ---------- Patient portal: "My health twin" ----------
     The same twin, explained in plain language for the patient: how each part of the body is
     doing, their numbers over time, the goals their care team set, and what each medicine is for.
     Forecasts, risk percentages and what-if simulations stay with the care team: they are
     unvalidated model output and easy to misread without a clinician. Patients see only their own
     record, and opening the page is logged as individual access (Cures Act). */
  const PLAIN_SYS = { neuro: 'Brain and nerves', heart: 'Heart and blood pressure', lungs: 'Lungs and breathing', gi: 'Liver and digestion', kidney: 'Kidneys and body salts', endo: 'Blood sugar and hormones', blood: 'Blood and infection', msk: 'Bones and joints' };
  const PLAIN_LVL = [['ok', 'Looking good'], ['watch', 'Being watched'], ['alert', 'Needs attention']];
  const PLAIN_PROB = [[/uncontrolled.*hypertens|hypertens.*uncontrolled/i, 'high blood pressure that is not yet under control'], [/hypertens|I10/i, 'high blood pressure'], [/type 2 diabet.*poorly|E11\.65/i, 'type 2 diabetes that needs better control'], [/type 2 diabet|E11/i, 'type 2 diabetes'], [/CKD|chronic kidney/i, 'kidneys that are not filtering as well as normal (chronic kidney disease)'], [/coronary|I25/i, 'narrowed heart arteries'], [/s\/p MI|myocardial infarction/i, 'a past heart attack'], [/atrial fib|I48/i, 'an irregular heartbeat (atrial fibrillation)'], [/heart failure/i, 'a heart that pumps less strongly than normal (heart failure)'], [/osteoarth.*knee|M17/i, 'wear-and-tear arthritis in the knee'], [/knee arthroplasty|knee replacement/i, 'your new knee joint (knee replacement surgery)'], [/COPD/i, 'long-term lung disease (COPD)'], [/asthma/i, 'asthma'], [/pneumon/i, 'a chest infection (pneumonia)'], [/neuropath/i, 'nerve damage in the feet (neuropathy)'], [/foot ulcer/i, 'a wound on the foot'], [/stroke/i, 'a stroke'], [/sepsis/i, 'a serious infection in the blood (sepsis)'], [/angina/i, 'chest pain from the heart (angina)'], [/anemi|anaemi/i, 'a low red blood cell count (anaemia)']];
  const PLAIN_GROUP = (t) => /blood pressure/.test(t) ? 'bp' : /diabetes/.test(t) ? 'dm' : /arthritis|knee joint/.test(t) ? t : t;
  const plainProblem = (x) => { const seen = new Set(); const hits = PLAIN_PROB.filter(([re]) => re.test(x)).map(([, t]) => t).filter((t) => { const g = PLAIN_GROUP(t); if (seen.has(g)) return false; seen.add(g); return true; }); return hits.length ? hits.slice(0, 2).join(' and ') : x.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase(); };
  const PLAIN_LAB = { potassium: ['Potassium', 'A salt your heart and muscles need. Too much can upset the heart rhythm.'], creatinine: ['Creatinine', 'A waste product your kidneys clear. A higher number means the kidneys are working less well.'], egfr: ['Kidney filtering (eGFR)', 'How well your kidneys filter your blood. Higher is better; over 60 is normal.'], inr: ['Clotting time (INR)', 'How long your blood takes to clot. On warfarin the usual target is 2 to 3.'], hba1c: ['Average blood sugar (HbA1c)', 'Your average blood sugar over about 3 months. Under 7% is the usual goal.'], glucose: ['Blood sugar', 'The sugar in your blood right now.'], 'troponin i': ['Troponin', 'A heart muscle protein. Higher means the heart is under strain.'], bnp: ['BNP', 'A hormone the heart releases when it is working too hard.'], sodium: ['Sodium', 'A salt that keeps fluid balanced in your body.'], hemoglobin: ['Haemoglobin', 'The part of red blood cells that carries oxygen.'], wbc: ['White blood cells', 'Infection-fighting cells. Higher can mean an infection.'], 'ldl cholesterol': ['LDL ("bad") cholesterol', 'Cholesterol that can build up in arteries. Lower is better.'], tsh: ['Thyroid test (TSH)', 'Shows how your thyroid gland is working.'], lactate: ['Lactate', 'Can rise when the body is short of oxygen or very unwell.'] };
  const PLAIN_MED = [[/pril\b|sartan/i, 'lowers blood pressure and protects the kidneys'], [/dipine\b/i, 'lowers blood pressure'], [/olol\b|carvedilol/i, 'slows the heart and lowers blood pressure'], [/metformin/i, 'lowers blood sugar'], [/insulin/i, 'lowers blood sugar'], [/warfarin|apixaban|rivaroxaban|dabigatran|enoxaparin|heparin/i, 'thins the blood to prevent clots and stroke'], [/aspirin|clopidogrel|ticagrelor/i, 'helps prevent heart attacks and clots'], [/statin/i, 'lowers cholesterol'], [/furosemide|bumetanide|torsemide|thiazide/i, 'removes extra fluid (a water tablet)'], [/spironolactone/i, 'removes extra fluid and supports the heart'], [/meropenem|cef|cillin|vancomycin|azithro|cipro|levoflox|doxy/i, 'an antibiotic to treat infection'], [/prazole/i, 'reduces stomach acid'], [/levothyroxine/i, 'replaces thyroid hormone'], [/morphine|oxycodone|hydromorphone|fentanyl|tramadol/i, 'pain relief (an opioid)'], [/paracetamol|acetaminophen/i, 'pain and fever relief'], [/salbutamol|albuterol|tiotropium/i, 'opens the airways']];
  const plainMed = (d) => (PLAIN_MED.find(([re]) => re.test(d)) || [null, 'ask your care team what this is for'])[1];
  T.VIEWS.mytwin = (u) => {
    const p = T.P(u.patientId); if (!p) return { title: 'My health twin', sub: '', body: '<p class="muted">No record is linked to this account.</p>' };
    audit('portal-view', { patient: p, resource: 'health twin', purpose: 'Individual access' });
    const sel = (UI.myTwinSys || null);
    const st = Object.fromEntries(SYSTEMS.map((s) => [s.id, systemState(p, s)]));
    const lvls = Object.fromEntries(SYSTEMS.map((s) => [s.id, st[s.id].level]));
    const svg = body(p, sel, lvls).replace(/data-act="pt-twin-sys"/g, 'data-act="my-sys"');
    const explain = (s) => {
      const e = st[s.id]; const probs = p.problems.filter((x) => s.prob.test(x)).map(plainProblem);
      const labs = p.labs.filter((l) => s.labs.test(l.test) && l.flag).map((l) => { const k = PLAIN_LAB[l.test.toLowerCase()]; return `${k ? k[0] : l.test} is ${/H/.test(l.flag) ? 'higher' : 'lower'} than normal (${l.value}${l.unit ? ' ' + l.unit : ''})`; });
      const meds = activeMeds(p).filter((m) => fxOf(m.drug)[s.id]).map((m) => m.drug);
      const parts = [];
      if (probs.length) parts.push(`You have ${probs.join('; ')}.`);
      if (labs.length) parts.push(`${labs.join('; ')}.`);
      if (s.id === 'heart' && /\d/.test(p.vitals.bp)) { const sb = num(String(p.vitals.bp).split('/')[0]); if (sb >= 140) parts.push(`Your blood pressure today is ${p.vitals.bp}; the usual goal is under 140/90.`); }
      if (s.id === 'lungs' && p.vitals.spo2 <= 95) parts.push(`Your oxygen level is ${p.vitals.spo2}%.`);
      if (meds.length) parts.push(`Medicines that help here: ${meds.join(', ')}.`);
      if (s.id === 'msk' && has(p, /knee arthroplasty|knee replacement/i)) parts.push('Your physiotherapists will help you get moving on your new knee.');
      return parts.join(' ') || (e.level ? 'Your care team is keeping an eye on this.' : 'Nothing in your record suggests a problem here.');
    };
    const curSel = sel || SYSTEMS.slice().sort((a, b) => lvls[b.id] - lvls[a.id])[0].id;
    const rows = SYSTEMS.map((s) => { const l = st[s.id].level; return `<button class="my-sys lv${l} ${curSel === s.id ? 'on' : ''}" data-act="my-sys" data-s="${s.id}"><i></i><span><b>${esc(PLAIN_SYS[s.id])}</b><small>${PLAIN_LVL[l][1]}</small></span></button>`; }).join('');
    const selS = SYSTEMS.find((s) => s.id === sel) || SYSTEMS.slice().sort((a, b) => lvls[b.id] - lvls[a.id])[0];
    const detail = `<div class="my-detail lv${lvls[selS.id]}"><h3>${esc(PLAIN_SYS[selS.id])} · ${PLAIN_LVL[lvls[selS.id]][1]}</h3><p>${esc(explain(selS))}</p></div>`;
    const labsH = T.hist ? T.hist.labs(p) : [];
    const numbers = labsH.map((s) => { const k = PLAIN_LAB[s.test.toLowerCase()] || [s.test, '']; const c = s.pts[s.pts.length - 1], a = s.pts.length > 1 ? s.pts[s.pts.length - 2] : null; const [lo, hi] = T.hist.refRange(s.ref);
      const dir = a && c.v !== a.v ? `${c.v > a.v ? 'Up' : 'Down'} from ${a.raw} (${T.hist.dayLbl(a.at)})` : a ? 'No change since last time' : 'First result';
      return `<li class="${c.flag ? 'flag' : ''}"><div><b>${esc(k[0])}</b><small>${esc(k[1])}</small></div><div class="my-num"><b>${esc(c.raw)}</b><span>${esc(s.unit || '')}</span><small>Normal: ${esc(s.ref || '—')}</small></div>${s.pts.length > 1 ? T.hist.spark(s.pts.map((x) => x.v), { w: 96, h: 26, lo, hi, cls: c.flag && c.flag.length > 1 ? 'crit' : c.flag ? 'warn' : '' }) : '<span></span>'}<small class="my-dir">${esc(dir)}</small></li>`; }).join('');
    const vs = T.hist ? T.hist.vitals(p).slice(-12) : [];
    const vit = vs.length ? [['Blood pressure', `${vs[vs.length - 1].sbp}/${vs[vs.length - 1].dbp}`, 'mmHg', 'Under 140/90', vs.map((x) => x.sbp), 140], ['Heart rate', vs[vs.length - 1].hr, 'beats a minute', '60 to 100', vs.map((x) => x.hr), 100], ['Oxygen level', vs[vs.length - 1].spo2 + '%', '', '95% or more', vs.map((x) => x.spo2), null]].map(([n, v, un, nm, ser]) => `<div class="my-vital"><span>${esc(n)}</span><b>${esc(String(v))}</b><small>${un ? esc(un) + ' · ' : ''}healthy: ${esc(nm)}</small>${T.hist.spark(ser, { w: 120, h: 28 })}</div>`).join('') : '';
    const cp = T.careplan && T.careplan.summary(p);
    const goals = cp && cp.goals.length ? cp.goals.map(({ g, st: gs, cur }) => `<li class="${gs}"><b>${esc(g.text)}</b><span>${gs === 'met' ? 'Done' : gs === 'improving' ? 'Getting there' : gs === 'nodata' ? 'Waiting for a result' : 'Not there yet'}${cur ? ` · now ${esc(cur.raw)}` : ''}</span></li>`).join('') : '';
    const meds = p.meds.map((m) => `<li><b>${esc(m.drug)}</b> <span class="muted">${esc([m.dose, m.route, m.freq].filter((x) => x && !/held/i.test(x)).join(' '))}</span><span>${esc(plainMed(m.drug))}${/held|stopped/i.test(m.status + ' ' + m.dose) ? '. <b>On hold for now</b>; do not restart it on your own.' : /pending/i.test(m.status) ? '. Waiting for your doctor to confirm.' : '.'}</span></li>`).join('');
    const qs = [];
    SYSTEMS.filter((s) => lvls[s.id] === 2).forEach((s) => qs.push(`What is being done about my ${PLAIN_SYS[s.id].toLowerCase()}?`));
    p.labs.filter((l) => l.flag && l.flag.length > 1).forEach((l) => qs.push(`My ${(PLAIN_LAB[l.test.toLowerCase()] || [l.test])[0].toLowerCase()} is ${/H/.test(l.flag) ? 'high' : 'low'}. What does that mean for me?`));
    p.meds.filter((m) => /held/i.test(m.status + ' ' + m.dose)).forEach((m) => qs.push(`When can I restart ${m.drug}?`));
    if (has(p, /hypertens/i)) qs.push('What should my blood pressure be at home, and how often should I check it?');
    if (has(p, /diabet/i)) qs.push('How should I take my diabetes medicine around my hospital stay?');
    if (has(p, /knee arthroplasty|knee replacement/i)) qs.push('When can I start physiotherapy, and how do I look after the wound?');
    qs.push('What should make me call or come back?');
    return { title: 'My health twin', sub: 'Your record, explained in plain language · only you and your care team can see it',
      body: `<div class="banner info"><p>This page explains what is already in your record. It is not a diagnosis, and forecasts and risk scores are kept for your care team. If something here worries you, ask them.</p></div>
        <div class="my-twin">
          ${panel('How your body is doing', `<div class="my-map">${svg}<div class="my-rows">${rows}</div></div>${detail}<div class="legend" style="margin-top:10px"><span><i class="nw-low"></i>Looking good</span><span><i class="nw-mid"></i>Being watched</span><span><i class="nw-high"></i>Needs attention</span></div>`)}
          <div class="my-col">
            ${vit ? panel('Your vital signs', `<div class="my-vitals">${vit}</div>`) : ''}
            ${goals ? panel('Goals your care team set', `<ul class="my-goals">${goals}</ul>`) : ''}
            ${panel('Questions to ask your care team', `<ul class="my-qs">${qs.slice(0, 6).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`)}
          </div>
        </div>
        ${numbers ? panel('Your test results over time', `<ul class="my-labs">${numbers}</ul>`) : ''}
        ${panel('Your medicines and what they do', `<ul class="my-meds">${meds || '<li class="muted">No medicines on your list.</li>'}</ul>`)}` };
  };
  ACT['my-sys'] = (d) => { UI.myTwinSys = d.s; render(); };

  /* ---------- Tab ---------- */
  CHART.twin = function (u, p) {
    ['ptTwin', 'ptTwinView', 'ptTwinHour', 'ptTwinSys', 'ptTwinOpt', 'ptTwinAsk'].forEach((k) => { UI[k] = UI[k] || {}; });
    stopPlay(); GEO = {};
    const sel = UI.ptTwinSys[p.id] || null;
    const lv = levers(p);
    const on = UI.ptTwin[p.id] || (UI.ptTwin[p.id] = baseSet(lv));
    const opt = UI.ptTwinOpt[p.id] || (UI.ptTwinOpt[p.id] = {});
    const rs = risks(p);
    const view = UI.ptTwinView[p.id] || 'overview';
    const h = clamp(UI.ptTwinHour[p.id] || 0, 0, H);
    const bset = baseSet(lv);
    const sim = project(p, lv, on, opt), base = project(p, lv, bset, {});
    const ev = events(p, sim), evB = events(p, base);
    const same = scenKey(on, opt, lv) === scenKey(bset, {}, lv);
    const ctx = { u, p, lv, on, opt, rs, sim, base, h, sel, ev, evB, storyHtml: story(p, base, sim, ev, evB, same) };
    CUR = { p, sim, on }; sim.__lv = lv;
    monSet(sim, p, h);
    const cf = confidence(p);
    const changed = lv.filter((l) => on.has(l.id) !== !!l.pre).length;
    const counts = `${p.problems.length} problems · ${p.labs.length} results · ${p.meds.length} medications · vitals`;
    const nav = `<nav class="twin-nav" aria-label="Twin views">${VIEWS.map(([id, l]) => `<button class="${view === id ? 'on' : ''}" data-act="pt-twin-view" data-p="${p.id}" data-v="${id}" ${view === id ? 'aria-current="true"' : ''}>${l}</button>`).join('')}</nav>`;
    const nCrit = ev.filter((e) => e.cls === 'crit').length;
    const head = `<div class="twin-head"><div class="twin-id"><span class="dot"></span><div><b>Digital twin · ${esc(p.name.split(' ')[0])}</b><small>Synced ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · ${counts} · hourly to +72 h · confidence ${cf.score}%</small></div></div>
      <div class="twin-state">${changed ? pill('accent', `${changed} lever${changed > 1 ? 's' : ''} changed`) : pill('', 'Record as is')}${nCrit ? pill('crit', `${nCrit} danger event${nCrit > 1 ? 's' : ''} in 72 h`) : pill('ok', 'No danger events in 72 h')}</div></div>`;
    const R = { overview: vOverview, ask: vAsk, anatomy: vAnatomy, physiology: vPhysiology, forecast: vForecast, pk: vPK, meds: vMeds, scenarios: vScenarios, sources: vSources }[view] || vOverview;
    const html = `<div class="banner info"><p><b>Digital twin.</b> A live model of ${esc(p.name.split(' ')[0])} built only from the record. Illustrative rules, not a validated model: simulations are logged and change nothing in the record.</p></div>
      ${head}${nav}<div class="twin-view" data-view="${view}">${R(ctx)}</div>`;
    monSet(sim, p, h);
    return html;
  };
  T.after.push(() => { if (CUR && document.querySelector('.twin-view')) scrubTo(clamp((UI.ptTwinHour || {})[CUR.p.id] || 0, 0, H)); });

  const pidOf = (d) => d.p || (location.hash.split('-')[1]) || '';
  ACT['pt-twin-view'] = (d) => { UI.ptTwinView = UI.ptTwinView || {}; UI.ptTwinView[pidOf(d)] = d.v; render(); };
  ACT['pt-twin-sys'] = (d) => { const pid = pidOf(d); UI.ptTwinSys = UI.ptTwinSys || {}; UI.ptTwinSys[pid] = UI.ptTwinSys[pid] === d.s ? null : d.s; render(); };
  ACT['pt-twin-reset'] = (d) => { if (UI.ptTwin) delete UI.ptTwin[d.p]; if (UI.ptTwinOpt) delete UI.ptTwinOpt[d.p]; audit('twin-simulate', { patient: T.P(d.p), detail: 'reset to record' }); render(); };
  ACT['pt-twin-play'] = (d) => {
    if (PLAY) { stopPlay(); return; }
    const pid = pidOf(d); UI.ptTwinHour = UI.ptTwinHour || {};
    let h = UI.ptTwinHour[pid] || 0; if (h >= H) h = 0;
    document.querySelectorAll('[data-act=pt-twin-play]').forEach((b) => { b.textContent = '❚❚ Pause'; b.setAttribute('aria-pressed', 'true'); });
    PLAY = setInterval(() => {
      if (!document.querySelector('[data-twin-hour]')) { stopPlay(); return; }
      h += 1; UI.ptTwinHour[pid] = h; scrubTo(h);
      if (h >= H) stopPlay();
    }, 140);
  };
  ACT['pt-twin-save'] = (d) => {
    const set = (UI.ptTwin || {})[d.p]; if (!set) return;
    const lv = levers(T.P(d.p)), opt = (UI.ptTwinOpt || {})[d.p] || {};
    UI.ptTwinScen = UI.ptTwinScen || {}; const list = UI.ptTwinScen[d.p] = UI.ptTwinScen[d.p] || [];
    const key = scenKey(set, opt, lv);
    if (list.some((s) => scenKey(new Set(s.levers), s.opt || {}, lv) === key)) { T.toast('That scenario is already saved.'); return; }
    const name = 'Scenario ' + String.fromCharCode(65 + (list.length % 26));
    list.push({ name, levers: [...set], opt: JSON.parse(JSON.stringify(opt)), at: Date.now() });
    audit('twin-scenario', { patient: T.P(d.p), detail: `saved ${name}: ${[...set].join(', ') || 'no levers'} (simulation only)` });
    T.toast(`${name} saved for this session.`); render();
  };
  ACT['pt-twin-load'] = (d) => { const s = ((UI.ptTwinScen || {})[d.p] || [])[+d.i]; if (!s) return; UI.ptTwin[d.p] = new Set(s.levers); UI.ptTwinOpt[d.p] = JSON.parse(JSON.stringify(s.opt || {})); audit('twin-scenario', { patient: T.P(d.p), detail: `loaded ${s.name} (simulation only)` }); render(); };
  ACT['pt-twin-del'] = (d) => { const list = (UI.ptTwinScen || {})[d.p] || []; const s = list[+d.i]; if (!s) return; list.splice(+d.i, 1); audit('twin-scenario', { patient: T.P(d.p), detail: `deleted ${s.name}` }); render(); };
  T.CHANGE = T.CHANGE || {};
  T.CHANGE['pt-twin-lever'] = (v, el) => {
    const s = (UI.ptTwin || {})[el.dataset.p]; if (!s) return;
    if (el.checked) s.add(el.dataset.l); else s.delete(el.dataset.l);
    audit('twin-simulate', { patient: T.P(el.dataset.p), detail: `${el.checked ? 'on' : 'off'}: ${el.dataset.l} (simulation only)` });
    render();
  };
  T.CHANGE['pt-twin-opt'] = (v, el) => {
    UI.ptTwinOpt = UI.ptTwinOpt || {}; const o = UI.ptTwinOpt[el.dataset.p] = UI.ptTwinOpt[el.dataset.p] || {};
    o[el.dataset.l] = Object.assign({}, o[el.dataset.l], { [el.dataset.k]: +v });
    const s = (UI.ptTwin || {})[el.dataset.p]; if (s) s.add(el.dataset.l);
    audit('twin-simulate', { patient: T.P(el.dataset.p), detail: `${el.dataset.l} ${el.dataset.k}=${v} (simulation only)` });
    render();
  };
  T.ptwin = { askFacts: (p) => askFacts(askCtx(p)), offlineAnswer: (p, q) => { const c = askCtx(p); return offlineAnswer(c, q, askFacts(c)); }, project, risks, levers, scores, confidence, events, pkSeries, HOURS };
})(window.Tessera);
