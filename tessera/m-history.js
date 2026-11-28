/* Tessera Health — Vitals and lab history.
   Every patient gets a past: a nursing flowsheet (vitals every 4 hours for 72 hours, plus anything
   charted since) and prior values for each numeric lab. History is synthetic, deterministic per
   patient, and ends exactly at the values in the record, so nothing contradicts the chart. Harish
   Malhotra (P01) has a hand-written story that matches his admission: potassium and creatinine
   climbing on an ARB with CKD, INR overshooting on warfarin. Charting vitals is care-team only and
   audited; new readings update the record, NEWS2 and the twin. */
(function (T) {
  'use strict';
  const { CHART, ACT, FORMS, esc, pill, panel, audit, render } = T;
  const UI = T.UI;
  const S = () => T.S;
  const H = 3600e3, D = 24 * H;
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const decimals = (s) => { const m = String(s).match(/\.(\d+)/); return m ? m[1].length : 0; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rng = (seed) => { let a = (T.fnv ? parseInt(T.fnv(seed), 16) : 7) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const dayAt = (off) => { const d = new Date(); d.setDate(d.getDate() + off); d.setHours(8, 0, 0, 0); return d.getTime(); };
  const refRange = (ref) => { const s = String(ref || ''); let m = s.match(/([\d.]+)\s*[–-]\s*([\d.]+)/); if (m) return [+m[1], +m[2]]; m = s.match(/^<\s*([\d.]+)/); if (m) return [null, +m[1]]; m = s.match(/^>\s*([\d.]+)/); if (m) return [+m[1], null]; return [null, null]; };
  const flagFor = (v, ref) => { const [lo, hi] = refRange(ref); if (hi != null && v > hi) return v > hi * 1.15 ? 'HH' : 'H'; if (lo != null && v < lo) return v < lo * 0.85 ? 'LL' : 'L'; return ''; };

  T.inits.push((s) => { if (!s.vitalsLog) s.vitalsLog = {}; });
  /* Original seed vitals, captured before any session edits, anchor the synthetic flowsheet. */
  const ORIG = {};
  (T.SEED.patients || []).forEach((p) => { ORIG[p.id] = JSON.parse(JSON.stringify(p.vitals || {})); });

  /* ---------- Labs ---------- */
  const STORY = { // days ago → value, oldest first; the record's own value is appended last
    P01: {
      Potassium: [[-4, 4.9], [-3, 5.2], [-2, 5.4], [-1, 5.7]],
      Creatinine: [[-90, 1.3], [-30, 1.4], [-3, 1.45], [-1, 1.5]],
      eGFR: [[-90, 60], [-30, 55], [-3, 52], [-1, 50]],
      INR: [[-9, 2.4], [-6, 2.8], [-4, 3.4], [-2, 4.6]],
      HbA1c: [[-280, 7.4], [-190, 7.7], [-100, 8.0]]
    }
  };
  const SLOW = /HbA1c|LDL|cholesterol|TSH|vitamin|ferritin|PSA/i;
  function labs(p) {
    const out = [];
    p.labs.forEach((l) => {
      const v0 = num(l.value); if (v0 == null || /pos|neg|detected/i.test(l.value)) return;
      const dp = decimals(l.value), at0 = dayAt(l.dOff || 0);
      const story = (STORY[p.id] || {})[l.test];
      let pts;
      if (story) pts = story.map(([d, v]) => ({ at: dayAt((l.dOff || 0) + d), v }));
      else {
        const r = rng(p.id + l.test), [lo, hi] = refRange(l.ref);
        const mid = lo != null && hi != null ? (lo + hi) / 2 : hi != null ? hi * 0.8 : lo != null ? lo * 1.15 : v0;
        const step = SLOW.test(l.test) ? 90 : /admitted|emergency/i.test(p.status) ? 1 : 30;
        pts = [4, 3, 2, 1].map((k) => {
          const pull = l.flag ? k / 5 : 0; // abnormal results were closer to normal before (a worsening course)
          const v = v0 + (mid - v0) * pull + v0 * (r() - 0.5) * 0.06;
          return { at: at0 - k * step * D, v };
        });
      }
      pts = pts.map((x) => ({ at: x.at, v: +x.v.toFixed(dp), src: 'Laboratory' })).concat([{ at: at0, v: v0, src: l.outside ? 'Outside record' : 'Laboratory', current: true }]);
      // Results released by the lab since the seed (for example a repeat potassium) come last
      (S().labOrders || []).filter((o) => o.patient === p.id && o.status === 'Released' && o.test.replace(/\s*\(.*\)$/, '').toLowerCase() === l.test.toLowerCase() && num(o.value) != null)
        .forEach((o) => pts.push({ at: Date.now() - o.mOff * 60000 + 20 * 60000, v: num(o.value), src: `Lab order ${o.id}`, current: true, ownFlag: o.flag }));
      pts.sort((a, b) => a.at - b.at);
      pts.forEach((x) => { x.flag = x.ownFlag != null ? (x.ownFlag || '') : x.current ? (l.flag || '') : flagFor(x.v, l.ref); x.raw = x.v.toFixed(dp); }); // the lab's own flag wins for the reported value
      out.push({ test: l.test, unit: l.unit, ref: l.ref, loinc: l.loinc, dp, pts });
    });
    return out;
  }
  const lab = (p, test) => labs(p).find((x) => x.test.toLowerCase() === String(test).toLowerCase()) || null;
  function labDelta(p, test) {
    const s = lab(p, test); if (!s || s.pts.length < 2) return null;
    const a = s.pts[s.pts.length - 2], b = s.pts[s.pts.length - 1];
    const d = b.v - a.v; return { prev: a, cur: b, d, dir: Math.abs(d) < Math.pow(10, -s.dp) / 2 ? 0 : d > 0 ? 1 : -1, s };
  }
  /* Observed rate of change per hour over the last `win` hours (null if fewer than 2 points). */
  function slope(p, test, win) {
    const s = lab(p, test); if (!s) return null;
    const now = s.pts[s.pts.length - 1].at, w = s.pts.filter((x) => now - x.at <= (win || 72) * H);
    if (w.length < 2) return null;
    return (w[w.length - 1].v - w[0].v) / ((w[w.length - 1].at - w[0].at) / H);
  }

  /* ---------- Vitals ---------- */
  const NORM = { hr: 78, sbp: 126, dbp: 78, rr: 16, spo2: 97, temp: 98.2 };
  const NURSES = ['Grace Lin, RN', 'Marcus Webb, RN', 'Priya Natarajan, RN'];
  const splitBP = (bp) => String(bp).split('/').map(num);
  function seedVitals(p) {
    const o = ORIG[p.id] || p.vitals || {}; const [s0, d0] = splitBP(o.bp);
    const cur = { hr: o.hr, sbp: s0, dbp: d0, rr: o.rr, spo2: o.spo2, temp: o.temp };
    const r = rng('v' + p.id), last = Math.floor((Date.now() - 40 * 60000) / (4 * H)) * 4 * H;
    const pts = [];
    for (let k = 18; k >= 0; k--) {
      const age = k * 4, f = age / 72, pt = { at: last - k * 4 * H, by: NURSES[(k + p.id.length) % 3], src: 'Flowsheet' };
      Object.keys(NORM).forEach((key) => {
        const c = cur[key]; if (c == null || isNaN(c)) return;
        const base = c + (NORM[key] - c) * 0.4; // further back, closer to the patient's usual
        const noise = { hr: 4, sbp: 6, dbp: 4, rr: 1.2, spo2: 0.8, temp: 0.25 }[key] * (r() - 0.5) * 2 * (k ? 1 : 0);
        let v = c + (base - c) * f + noise;
        v = key === 'temp' ? Math.round(v * 10) / 10 : Math.round(v);
        if (key === 'spo2') v = clamp(v, 80, 100);
        pt[key] = v;
      });
      pts.push(pt);
    }
    return pts;
  }
  function vitals(p) {
    const log = ((S().vitalsLog || {})[p.id] || []).map((x) => Object.assign({}, x));
    const pts = seedVitals(p).concat(log).sort((a, b) => a.at - b.at);
    // If the record changed some other way (for example a signed case sheet) chart that too
    const v = p.vitals || {}, [sb, db] = splitBP(v.bp), lastPt = pts[pts.length - 1];
    if (lastPt && (lastPt.hr !== v.hr || lastPt.sbp !== sb || lastPt.rr !== v.rr || lastPt.spo2 !== v.spo2 || lastPt.temp !== v.temp)) pts.push({ at: Date.now() - 5 * 60000, hr: v.hr, sbp: sb, dbp: db, rr: v.rr, spo2: v.spo2, temp: v.temp, by: 'Chart', src: 'Case sheet / record' });
    pts.forEach((x) => { x.news = T.news2 ? T.news2({ id: p.id, avpu: x.avpu || p.avpu, vitals: { bp: `${x.sbp}/${x.dbp}`, hr: x.hr, rr: x.rr, temp: x.temp, spo2: x.spo2 } }).sc : null; });
    return pts;
  }
  function logVitals(p, v, src, by) {
    const st = S(); (st.vitalsLog[p.id] = st.vitalsLog[p.id] || []).push(Object.assign({ at: Date.now(), by: by || (T.me() || {}).name, src: src || 'Flowsheet' }, v));
  }

  /* ---------- Drawing ---------- */
  function spark(vals, opt) {
    opt = opt || {}; const w = opt.w || 88, h = opt.h || 24; if (!vals.length) return '';
    const lo = Math.min(...vals, opt.lo != null ? opt.lo : Infinity), hi = Math.max(...vals, opt.hi != null ? opt.hi : -Infinity);
    const y = (v) => h - 3 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (h - 6), x = (i) => 2 + i * (w - 4) / Math.max(1, vals.length - 1);
    const band = opt.lo != null && opt.hi != null ? `<rect x="0" width="${w}" y="${y(opt.hi)}" height="${Math.max(0, y(opt.lo) - y(opt.hi))}" class="sp-band"/>` : '';
    return `<svg class="spark ${opt.cls || ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${band}<polyline points="${vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="2.6"/></svg>`;
  }
  const fmtT = (at) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const dayLbl = (at) => { const d = Math.round((dayAt(0) - new Date(at).setHours(8, 0, 0, 0)) / D); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
  /* Time chart: series [{at, v}], optional second series, reference band, threshold lines. */
  function tchart(series, opt) {
    const W = 560, Hh = opt.h || 170, L = 42, R = 12, Tp = 12, B = 26;
    const all = series.flatMap((s) => s.pts.map((x) => x.v)).concat(opt.lo != null ? [opt.lo] : [], opt.hi != null ? [opt.hi] : []);
    let y0 = Math.min(...all), y1 = Math.max(...all); const pad = (y1 - y0) * 0.1 || 1; y0 -= pad; y1 += pad;
    const t1 = opt.t1 || Date.now(), t0 = opt.t0 || Math.min(...series.flatMap((s) => s.pts.map((x) => x.at)));
    const X = (t) => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - R), Y = (v) => Tp + (1 - (v - y0) / (y1 - y0)) * (Hh - Tp - B);
    const band = opt.lo != null && opt.hi != null ? `<rect class="hb" x="${L}" width="${W - L - R}" y="${Y(Math.min(opt.hi, y1))}" height="${Math.max(0, Y(Math.max(opt.lo, y0)) - Y(Math.min(opt.hi, y1)))}"/>` : '';
    const yt = [0.15, 0.5, 0.85].map((k) => y0 + (y1 - y0) * k).map((v) => `<text class="ht" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${esc((opt.f || ((z) => z.toFixed(1)))(v))}</text>`).join('');
    const ticks = (opt.ticks || []).map(([t, l]) => `<line class="hg" x1="${X(t)}" x2="${X(t)}" y1="${Tp}" y2="${Hh - B}"/><text class="ht" x="${X(t)}" y="${Hh - 8}" text-anchor="middle">${esc(l)}</text>`).join('');
    const lines = series.map((s) => `<polyline class="hl ${s.cls || ''}" points="${s.pts.map((x) => `${X(x.at).toFixed(1)},${Y(x.v).toFixed(1)}`).join(' ')}"/>${s.pts.map((x) => `<circle class="hd ${s.cls || ''} ${x.flag ? 'fl' : ''}" r="${s.pts.length > 12 ? 2.2 : 3.4}" cx="${X(x.at).toFixed(1)}" cy="${Y(x.v).toFixed(1)}"><title>${esc(fmtT(x.at))} · ${esc(String(x.raw != null ? x.raw : x.v))}</title></circle>`).join('')}`).join('');
    return `<svg class="hchart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(opt.label || 'Trend')}">${band}${ticks}${yt}${lines}</svg>`;
  }
  const vticks = () => { const n = Date.now(); return [[n - 72 * H, '−72 h'], [n - 48 * H, '−48 h'], [n - 24 * H, '−24 h'], [n, 'Now']]; };

  /* ---------- Chart tab: Vitals ---------- */
  const VDEF = [
    ['hr', 'Heart rate', 'bpm', 51, 90, (v) => String(Math.round(v))], ['bp', 'Blood pressure', 'mmHg', 111, 140, (v) => String(Math.round(v))],
    ['rr', 'Respiratory rate', '/min', 12, 20, (v) => String(Math.round(v))], ['spo2', 'SpO₂', '%', 96, 100, (v) => String(Math.round(v))],
    ['temp', 'Temperature', '°F', 96.8, 100.4, (v) => v.toFixed(1)], ['news', 'NEWS2', 'score', 0, 4, (v) => String(Math.round(v))]
  ];
  const vcls = (k, v, x) => { if (v == null) return ''; if (k === 'hr') return v <= 40 || v >= 131 ? 'c3' : v >= 111 || v <= 50 ? 'c2' : v >= 91 ? 'c1' : ''; if (k === 'sbp') return v <= 90 || v >= 220 ? 'c3' : v <= 100 ? 'c2' : v <= 110 ? 'c1' : ''; if (k === 'rr') return v <= 8 || v >= 25 ? 'c3' : v >= 21 ? 'c2' : v <= 11 ? 'c1' : ''; if (k === 'spo2') return v <= 91 ? 'c3' : v <= 93 ? 'c2' : v <= 95 ? 'c1' : ''; if (k === 'temp') return v <= 95 ? 'c3' : v >= 102.2 ? 'c2' : v >= 100.4 || v <= 96.8 ? 'c1' : ''; if (k === 'news') return v >= 7 ? 'c3' : v >= 5 ? 'c2' : v >= 1 ? 'c1' : ''; return ''; };
  CHART.vitals = function (u, p) {
    const pts = vitals(p), last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const t0 = Date.now() - 72 * H, win = pts.filter((x) => x.at >= t0);
    const delta = (k) => { if (!prev || last[k] == null || prev[k] == null) return ''; const d = last[k] - prev[k]; if (Math.abs(d) < (k === 'temp' ? 0.05 : 0.5)) return '<small class="dl">no change</small>'; return `<small class="dl ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${k === 'temp' ? Math.abs(d).toFixed(1) : Math.abs(Math.round(d))}</small>`; };
    const tiles = VDEF.map(([k, n, unit, lo, hi, f]) => {
      const val = k === 'bp' ? `${last.sbp}/${last.dbp}` : last[k] != null ? f(last[k]) : '—';
      const c = vcls(k === 'bp' ? 'sbp' : k, k === 'bp' ? last.sbp : last[k]);
      return `<div class="vtile ${c}"><span>${esc(n)}</span><b>${esc(val)}</b><small>${esc(unit)}</small>${delta(k === 'bp' ? 'sbp' : k)}</div>`;
    }).join('');
    const charts = VDEF.map(([k, n, unit, lo, hi, f]) => {
      const s = k === 'bp' ? [{ pts: win.map((x) => ({ at: x.at, v: x.sbp })), cls: 'sys' }, { pts: win.map((x) => ({ at: x.at, v: x.dbp })), cls: 'dia' }] : [{ pts: win.filter((x) => x[k] != null).map((x) => ({ at: x.at, v: x[k], flag: vcls(k, x[k]) === 'c3' || vcls(k, x[k]) === 'c2' })) }];
      return `<div class="vchart"><div class="row between"><b>${esc(n)}</b><span class="muted" style="font-size:12px">${esc(unit)} · normal ${k === 'bp' ? '111–140 systolic' : `${f(lo)}–${f(hi)}`}</span></div>${tchart(s, { lo: k === 'bp' ? null : lo, hi: k === 'bp' ? null : hi, ticks: vticks(), t0, t1: Date.now(), f, label: n + ' over 72 hours', h: 150 })}</div>`;
    }).join('');
    const cols = pts.slice(-10).reverse();
    const rowsDef = [['hr', 'HR'], ['sbp', 'Systolic'], ['dbp', 'Diastolic'], ['rr', 'RR'], ['spo2', 'SpO₂'], ['temp', 'Temp °F'], ['news', 'NEWS2']];
    const sheet = `<div class="tbl"><table class="t flowsheet"><thead><tr><th></th>${cols.map((c) => `<th><span class="mono">${esc(new Date(c.at).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }))}</span><span class="sub">${esc(c.by || '')}</span></th>`).join('')}</tr></thead><tbody>${rowsDef.map(([k, n]) => `<tr><th scope="row">${n}</th>${cols.map((c) => `<td class="num ${vcls(k, c[k])}">${c[k] != null ? esc(String(c[k])) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const canChart = u.role === 'nurse' || u.role === 'doctor';
    const form = canChart ? `<form data-form="vitals" class="vform" autocomplete="off"><input type="hidden" name="p" value="${p.id}">
        ${[['hr', 'Heart rate', 'bpm', 20, 250, 1], ['sbp', 'Systolic', 'mmHg', 50, 260, 1], ['dbp', 'Diastolic', 'mmHg', 20, 160, 1], ['rr', 'Resp. rate', '/min', 4, 60, 1], ['spo2', 'SpO₂', '%', 50, 100, 1], ['temp', 'Temp', '°F', 90, 108, 0.1]].map(([k, l, un, mn, mx, st]) => `<label class="field"><span>${l} <small class="muted">${un}</small></span><input name="${k}" type="number" inputmode="decimal" min="${mn}" max="${mx}" step="${st}" required value="${k === 'sbp' ? last.sbp : k === 'dbp' ? last.dbp : last[k]}"></label>`).join('')}
        <label class="field"><span>Consciousness</span><select name="avpu">${[['A', 'Alert'], ['C', 'New confusion'], ['V', 'Voice'], ['P', 'Pain'], ['U', 'Unresponsive']].map(([v, l]) => `<option value="${v}" ${(p.avpu || 'A') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="vform-act"><button class="btn primary" type="submit">Chart vitals</button><span class="muted" style="font-size:12px">Pre-filled with the last set. Charting is logged and updates NEWS2, alerts and the digital twin.</span></div></form>` : '';
    return `<div class="vtiles">${tiles}</div>
      <p class="muted vmeta">Last charted ${esc(fmtT(last.at))} by ${esc(last.by || 'nursing')} · ${pts.length} sets on file · every 4 hours on this unit</p>
      ${canChart ? panel('Chart a new set', form) : ''}
      ${panel('Trends · last 72 hours', `<div class="vcharts">${charts}</div>`, '<span class="kpi-note">Shaded band: normal range · red dots: NEWS2 sub-score 2 or more</span>')}
      ${panel('Flowsheet', sheet, '<span class="kpi-note">Newest first · coloured by NEWS2 sub-score</span>', true)}`;
  };
  FORMS.vitals = (f) => {
    const p = T.P(f.p); if (!p) return;
    const v = { hr: +f.hr, sbp: +f.sbp, dbp: +f.dbp, rr: +f.rr, spo2: +f.spo2, temp: +f.temp };
    const bad = Object.entries({ hr: [20, 250], sbp: [50, 260], dbp: [20, 160], rr: [4, 60], spo2: [50, 100], temp: [90, 108] }).filter(([k, [a, b]]) => !(v[k] >= a && v[k] <= b));
    if (bad.length) { T.toast(`Check ${bad.map(([k]) => k.toUpperCase()).join(', ')}: outside a plausible range.`); return; }
    if (v.dbp >= v.sbp) { T.toast('Diastolic must be lower than systolic.'); return; }
    logVitals(p, Object.assign({ avpu: f.avpu }, v), 'Flowsheet');
    T.patchPatient(p.id, { vitals: { bp: `${v.sbp}/${v.dbp}`, hr: v.hr, rr: v.rr, temp: v.temp, spo2: v.spo2 }, avpu: f.avpu === 'A' ? undefined : f.avpu });
    const n = T.news2 ? T.news2(p) : { sc: 0, risk: '' };
    audit('record-vitals', { patient: p, detail: `HR ${v.hr} · BP ${v.sbp}/${v.dbp} · RR ${v.rr} · SpO₂ ${v.spo2}% · T ${v.temp} · NEWS2 ${n.sc}` });
    T.save(); render();
    T.toast(n.sc >= 7 ? `Vitals charted. NEWS2 ${n.sc}: emergency response, call the rapid response team now.` : n.sc >= 5 ? `Vitals charted. NEWS2 ${n.sc}: urgent review by the responsible clinician.` : `Vitals charted. NEWS2 ${n.sc}.`);
  };

  /* ---------- Results: trend per lab ---------- */
  function labCell(p, l) {
    const s = lab(p, l.test); if (!s || s.pts.length < 2) return { spark: '<span class="muted">—</span>', delta: '' };
    const [lo, hi] = refRange(l.ref); const vals = s.pts.map((x) => x.v); const d = labDelta(p, l.test);
    const fl = l.flag && (l.flag.length > 1 || l.flag === 'A') ? 'crit' : l.flag ? 'warn' : 'ok';
    return {
      spark: `<button class="sp-btn" data-act="lab-trend" data-p="${p.id}" data-t="${esc(l.test)}" aria-label="Show ${esc(l.test)} trend">${spark(vals, { lo, hi, cls: fl })}</button>`,
      delta: d && d.dir ? `<span class="sub ${d.dir > 0 ? 'up' : 'down'}">${d.dir > 0 ? '↑' : '↓'} from ${esc(d.prev.raw)} ${esc(dayLbl(d.prev.at))}</span>` : d ? `<span class="sub">unchanged since ${esc(dayLbl(d.prev.at))}</span>` : ''
    };
  }
  function labDetail(p, test) {
    const s = lab(p, test); if (!s) return '';
    const [lo, hi] = refRange(s.ref);
    const t0 = s.pts[0].at, t1 = s.pts[s.pts.length - 1].at;
    const span = (t1 - t0) / D, ticks = [[t0, fmtT(t0).split(',')[0]], [t1, 'Latest']];
    if (span > 4) ticks.splice(1, 0, [(t0 + t1) / 2, fmtT((t0 + t1) / 2).split(',')[0]]);
    const pct = s.pts.length > 1 ? ((s.pts[s.pts.length - 1].v - s.pts[0].v) / s.pts[0].v * 100) : 0;
    return `<div class="labtrend"><div class="row between"><b>${esc(s.test)} <small class="muted">${esc(s.unit || '')} · reference ${esc(s.ref || '—')}</small></b><button class="btn small" data-act="lab-trend" data-p="${p.id}" data-t="${esc(s.test)}">Close</button></div>
      ${tchart([{ pts: s.pts }], { lo: lo != null ? lo : null, hi: hi != null ? hi : null, ticks, t0, t1, f: (v) => v.toFixed(s.dp), label: s.test + ' trend', h: 170 })}
      <p class="muted" style="font-size:12.5px;margin:4px 0 8px">${s.pts.length} results over ${span < 2 ? Math.round(span * 24) + ' hours' : Math.round(span) + ' days'} · ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)}% from the first</p>
      <div class="tbl"><table class="t"><thead><tr><th>Date</th><th>Value</th><th>Flag</th><th>Source</th></tr></thead><tbody>${s.pts.slice().reverse().map((x) => `<tr><td class="mono">${esc(fmtT(x.at))}</td><td class="num"><b>${esc(x.raw)}</b></td><td>${x.flag ? pill(x.flag.length > 1 ? 'crit' : 'warn', x.flag) : pill('ok', 'Normal')}</td><td>${esc(x.src)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  ACT['lab-trend'] = (d) => { UI.labTrend = UI.labTrend === d.p + '|' + d.t ? null : d.p + '|' + d.t; if (UI.labTrend) audit('view-lab-trend', { patient: T.P(d.p), detail: d.t }); render(); };

  T.hist = { labs, lab, labDelta, slope, vitals, logVitals, spark, tchart, labCell, labDetail, refRange, flagFor, dayLbl, fmtT, vticks, H };
})(window.Tessera);
