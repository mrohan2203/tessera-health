/* Tessera Health — Rapid response and code blue record.
   Called from the Vitals tab when NEWS2 reaches 5 (urgent) or from the Rapid response page.
   The event screen is a live, timed record: elapsed clock, CPR cycle and adrenaline timers,
   one-tap interventions, rhythm checks and shocks, drug buttons chosen from the record and run
   through the same safety check as the care plan, the reversible causes (Hs and Ts) pre-flagged
   from labs and problems, team roles with arrival times, and vitals that also update the chart.
   Code blue respects code status: with DNR/DNI on file, CPR cannot be logged until a clinician
   confirms a documented reversal. Closing drafts a note from the log; signing files it in the
   chart and adds a post-event review to the care plan. Calls, overrides, closes and signatures
   are audited. Doses are illustrative; follow local ALS/ACLS protocol. */
(function (T) {
  'use strict';
  const { VIEWS, CHART, ACT, FORMS, esc, pill, panel, audit, render } = T;
  const UI = T.UI;
  const S = () => T.S;
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const lab = (p, re) => p.labs.find((l) => re.test(l.test));
  const has = (p, re) => p.problems.some((x) => re.test(x));
  const me = () => T.me() || {};
  T.inits.push((s) => { if (!s.rrEvents) s.rrEvents = []; }); // module state, created once at boot
  const events = () => S().rrEvents;
  const activeFor = (pid) => events().find((e) => e.patient === pid && e.status === 'active');
  const clinical = (u) => u && (u.role === 'doctor' || u.role === 'nurse');
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const clock = (at) => new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const DNR = (p) => /DNR|DNI|comfort/i.test(p.code || '');
  T.extraRoutes = T.extraRoutes || {}; ['doctor', 'nurse'].forEach((r) => { (T.extraRoutes[r] = T.extraRoutes[r] || []).push('event'); });

  /* ---------- Actions on an event ---------- */
  function start(p, kind, why) {
    const v = p.vitals || {}; const n = T.news2 ? T.news2(p).sc : null;
    const ev = { id: T.nid('RR'), patient: p.id, kind, calledAt: Date.now(), calledBy: me().name, status: 'active', trigger: { news: n, vitals: `HR ${v.hr}, BP ${v.bp}, RR ${v.rr}, SpO₂ ${v.spo2}%, T ${v.temp} °F`, why: why || '' }, team: [], log: [], hs: {} };
    ev.log.push({ at: ev.calledAt, kind: 'call', text: `${kind === 'code' ? 'Code blue' : 'Rapid response'} called${n != null ? ` · NEWS2 ${n}` : ''}${why ? ` · ${why}` : ''}`, by: me().name });
    events().push(ev);
    audit('rr-call', { patient: p, purpose: 'Emergency response', detail: `${kind === 'code' ? 'Code blue' : 'Rapid response'}${n != null ? ` · NEWS2 ${n}` : ''}` });
    T.save(); return ev;
  }
  function log(ev, kind, text, extra) { ev.log.push(Object.assign({ at: Date.now(), kind, text, by: me().name }, extra || {})); T.save(); }

  /* Drugs suggested from the record, plus the arrest drugs during a code. */
  function drugList(p, ev) {
    const k = lab(p, /^potassium/i), kv = k ? num(k.value) : null, out = [];
    if (ev.kind === 'code') out.push(['Adrenaline (epinephrine) 1 mg IV', 'Every 3–5 min'], ['Amiodarone 300 mg IV', 'After the 3rd shock (VF/pVT)'], ['Amiodarone 150 mg IV', 'After the 5th shock']);
    if (kv != null && kv > 6) out.push(['Calcium gluconate 10% 30 mL IV over 5–10 min', `Potassium ${k.value}: protects the heart`], ['Insulin regular 10 units IV with dextrose 50% 25 g IV', 'Shifts potassium into cells'], ['Salbutamol 10 mg nebulised', 'Shifts potassium into cells']);
    if (p.meds.some((m) => /morphine|oxycodone|hydromorphone|fentanyl/i.test(m.drug))) out.push(['Naloxone 400 micrograms IV', 'Opioid on the medication list']);
    if (has(p, /diabet/i)) out.push(['Dextrose 10% 150 mL IV', 'If glucose below 70 mg/dL']);
    if (ev.kind !== 'code') out.push(['Sodium chloride 0.9% 500 mL IV bolus', 'If hypotensive']);
    return out;
  }
  /* Reversible causes, with the record's evidence. */
  function hsTs(p) {
    const k = lab(p, /^potassium/i), kv = k ? num(k.value) : null, v = p.vitals || {};
    return [
      ['hypoxia', 'Hypoxia', v.spo2 <= 92 ? `SpO₂ ${v.spo2}%` : ''],
      ['hypovol', 'Hypovolaemia', (lab(p, /h(a)?emoglobin/i) && /L/.test(lab(p, /h(a)?emoglobin/i).flag || '')) || (lab(p, /^INR/i) && num(lab(p, /^INR/i).value) > 4) ? 'Bleeding risk (INR or Hb)' : ''],
      ['k', 'Hypo/hyperkalaemia, metabolic', kv != null && (kv > 5.5 || kv < 3.5) ? `Potassium ${k.value} ${k.unit}` : ''],
      ['temp', 'Hypothermia', v.temp && v.temp < 95 ? `Temp ${v.temp} °F` : ''],
      ['thromb', 'Thrombosis (coronary or pulmonary)', has(p, /coronary|myocard|\bMI\b|angina|embol|DVT|I25/i) ? (p.problems.find((x) => /coronary|myocard|\bMI\b|angina|embol|DVT|I25/i.test(x)) || '').replace(/\s*\(.*$/, '') : ''],
      ['tension', 'Tension pneumothorax', ''],
      ['tamp', 'Tamponade', ''],
      ['tox', 'Toxins', p.meds.filter((m) => !/held/i.test(m.status) && /digoxin|olol|dipine|opioid|morphine|oxycodone|tricyclic|amitriptyline/i.test(m.drug)).map((m) => m.drug).join(', ')]
    ];
  }

  /* ---------- Event screen ---------- */
  const ROLES = ['Team leader', 'Airway', 'Compressions', 'Medications', 'Recorder', 'Nurse in charge'];
  const RAPID_ACTS = [['o2', 'Oxygen started, titrate to SpO₂ 94–98%'], ['iv', 'IV access (18G)'], ['bloods', 'Bloods sent: VBG, electrolytes, FBC, lactate'], ['ecg', '12-lead ECG done'], ['monitor', 'Continuous cardiac monitoring'], ['glucose', 'Capillary glucose checked'], ['senior', 'Senior review requested'], ['position', 'Positioned upright / recovery position']];
  const CODE_ACTS = [['cpr', 'CPR started'], ['pads', 'Defibrillator pads on'], ['shock', 'Shock delivered 200 J biphasic'], ['airway', 'Airway secured (supraglottic or tube)'], ['io', 'IO / IV access'], ['etco2', 'Waveform capnography on'], ['rosc', 'ROSC achieved'], ['stopcpr', 'CPR stopped']];
  const RHYTHMS = ['VF', 'Pulseless VT', 'PEA', 'Asystole', 'Sinus with pulse'];
  function timers(ev) {
    const now = Date.now(), L = ev.log;
    const last = (re) => L.slice().reverse().find((x) => re.test(x.code || x.kind));
    const cpr = last(/^cpr$/), stop = last(/^(rosc|stopcpr)$/), rhythm = last(/^rhythm$/), adr = L.slice().reverse().find((x) => x.kind === 'drug' && /adrenaline|epinephrine/i.test(x.text));
    const cprOn = cpr && (!stop || stop.at < cpr.at);
    const cycleFrom = cprOn ? Math.max(cpr.at, rhythm && rhythm.at > cpr.at ? rhythm.at : cpr.at) : null;
    return { cprOn, nextRhythm: cycleFrom ? cycleFrom + 120e3 : null, adrDue: adr && cprOn ? adr.at + 240e3 : null, shocks: L.filter((x) => x.code === 'shock').length, adrN: L.filter((x) => x.kind === 'drug' && /adrenaline|epinephrine/i.test(x.text)).length };
  }
  VIEWS.event = (u, args) => {
    const ev = events().find((e) => e.id === args.join('-'));
    if (!ev) return { title: 'Event not found', sub: '', body: '<p class="muted">This event does not exist.</p>' };
    const p = T.P(ev.patient);
    if (!clinical(u) || (ev.status !== 'active' && !T.careRel(u, p))) return { title: 'Restricted', sub: '', body: '<p class="muted">Closed event records are visible to the care team only.</p>' };
    if (UI.rrViewed !== ev.id) { UI.rrViewed = ev.id; audit('view-event', { patient: p, purpose: 'Emergency response', detail: `${ev.kind === 'code' ? 'Code blue' : 'Rapid response'} ${ev.id}` }); }
    const t = timers(ev), live = ev.status === 'active', isCode = ev.kind === 'code';
    const kv = lab(p, /^potassium/i), inr = lab(p, /^INR/i), eg = lab(p, /^eGFR/i);
    const head = `<div class="rr-head k-${ev.kind} ${live ? 'is-live' : 'is-closed'}">
      <div><span class="rr-kind">${isCode ? 'CODE BLUE' : 'RAPID RESPONSE'}</span><b>${esc(p.name)}</b><small>${esc(p.bed || p.unit || '')} · ${p.age} ${esc(p.sex)} · ${esc(p.weightKg ? p.weightKg + ' kg' : 'weight not recorded')} · called ${esc(clock(ev.calledAt))} by ${esc(ev.calledBy)}</small></div>
      <div class="rr-clocks"><div><span>Elapsed</span><b data-rr-clock="elapsed" data-t="${ev.calledAt}">${mmss((live ? Date.now() : ev.closedAt) - ev.calledAt)}</b></div>
        ${isCode && live ? `<div class="${t.cprOn ? '' : 'off'}"><span>Rhythm check</span><b data-rr-clock="down" data-t="${t.nextRhythm || ''}">${t.nextRhythm ? mmss(t.nextRhythm - Date.now()) : '—'}</b></div><div class="${t.adrDue ? '' : 'off'}"><span>Adrenaline due</span><b data-rr-clock="down" data-t="${t.adrDue || ''}">${t.adrDue ? mmss(t.adrDue - Date.now()) : '—'}</b></div><div><span>Shocks · adrenaline</span><b>${t.shocks} · ${t.adrN}</b></div>` : ''}</div></div>`;
    const alerts = [
      DNR(p) && `<div class="rr-alert crit"><b>${esc(p.code)} on file.</b> ${isCode ? (ev.dnrConfirmed ? `Reversal confirmed by ${esc(ev.dnrConfirmed.by)}: ${esc(ev.dnrConfirmed.reason)}` : 'Do not start CPR or intubation unless the code status has been reversed and documented.') : 'Escalation should respect the documented limits of treatment.'}</div>`,
      p.allergies.length && `<div class="rr-alert warn"><b>Allergies:</b> ${esc(p.allergies.map((a) => `${a.agent} (${a.reaction})`).join(', '))}</div>`,
      p.allergiesUnknown && '<div class="rr-alert warn"><b>Allergies unknown.</b></div>'
    ].filter(Boolean).join('');
    const facts = `<dl class="rr-facts">${[kv && ['Potassium', `${kv.value} ${kv.unit}`, kv.flag], inr && ['INR', inr.value, inr.flag], eg && ['eGFR', eg.value, eg.flag], ['NEWS2 at call', String(ev.trigger.news), ev.trigger.news >= 7 ? 'HH' : ev.trigger.news >= 5 ? 'H' : ''], ['Code status', p.code, DNR(p) ? 'HH' : '']].filter(Boolean).map(([k, v, f]) => `<div><dt>${esc(k)}</dt><dd class="${f && f.length > 1 ? 'crit' : f ? 'warn' : ''}">${esc(v)}</dd></div>`).join('')}</dl><p class="muted" style="font-size:12px;margin:6px 0 0">Trigger: ${esc(ev.trigger.vitals)}</p>`;
    const acts = live ? `<div class="rr-acts">${(isCode ? CODE_ACTS : RAPID_ACTS).map(([c, l]) => `<button class="rr-btn ${c}" data-act="rr-log" data-e="${ev.id}" data-c="${c}">${esc(l)}</button>`).join('')}</div>
      ${isCode ? `<div class="rr-rhythm"><span>Rhythm check</span>${RHYTHMS.map((r) => `<button class="btn small" data-act="rr-rhythm" data-e="${ev.id}" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : `<div class="row" style="gap:8px;margin-top:8px"><button class="btn small danger" data-act="rr-escalate" data-e="${ev.id}">Escalate to code blue</button></div>`}` : '';
    const dnrGate = live && isCode && DNR(p) && !ev.dnrConfirmed ? `<form data-form="rr-dnr" class="rr-dnr"><input type="hidden" name="e" value="${ev.id}"><input name="reason" required minlength="10" placeholder="Documented reversal of ${esc(p.code)} (who, when, why)"><button class="btn small" type="submit">Confirm reversal</button></form>` : '';
    const drugs = live ? `<div class="rr-drugs">${drugList(p, ev).map(([d, why]) => { const c = T.careplan ? T.careplan.checkDrug(p, d) : { level: 'ok', reasons: [] }; return `<button class="rr-drug ${c.level}" data-act="rr-drug" data-e="${ev.id}" data-d="${esc(d)}"><b>${esc(d)}</b><small>${esc(why)}${c.level !== 'ok' ? ` · ${esc(c.reasons[0])}` : ''}</small></button>`; }).join('')}</div>
      <form data-form="rr-drug" class="rr-inline"><input type="hidden" name="e" value="${ev.id}"><input name="drug" required placeholder="Other drug, dose and route"><button class="btn small" type="submit">Give</button></form>
      ${UI.rrBlocked && UI.rrBlocked.e === ev.id ? `<form data-form="rr-drug" class="rr-inline rr-ovr"><input type="hidden" name="e" value="${ev.id}"><input type="hidden" name="drug" value="${esc(UI.rrBlocked.d)}"><p><b>${esc(UI.rrBlocked.d)}</b> is blocked: ${esc(UI.rrBlocked.reasons.join(' '))}</p><input name="override" required minlength="10" placeholder="Emergency reason to give it anyway (logged)"><button class="btn small danger" type="submit">Give anyway</button><button class="btn small" type="button" data-act="rr-unblock">Cancel</button></form>` : ''}` : '';
    const vit = live ? `<form data-form="rr-vitals" class="rr-inline rr-vit"><input type="hidden" name="e" value="${ev.id}">${[['hr', 'HR'], ['sbp', 'Sys'], ['dbp', 'Dia'], ['rr', 'RR'], ['spo2', 'SpO₂']].map(([k, l]) => `<label><span>${l}</span><input name="${k}" type="number" inputmode="numeric" required></label>`).join('')}<button class="btn small" type="submit">Log vitals</button></form>` : '';
    const hs = hsTs(p).map(([k, l, evd]) => `<label class="rr-h ${evd ? 'flag' : ''} ${ev.hs[k] ? 'on' : ''}"><input type="checkbox" data-change="rr-hs" data-e="${ev.id}" data-k="${k}" ${ev.hs[k] ? 'checked' : ''} ${live ? '' : 'disabled'}><span>${esc(l)}${evd ? `<small>${esc(evd)}</small>` : ''}</span></label>`).join('');
    const staff = T.S.users.filter((x) => (x.role === 'doctor' || x.role === 'nurse') && x.status !== 'suspended');
    const team = ROLES.map((r) => { const m = ev.team.find((x) => x.role === r); return `<div class="rr-role"><span>${esc(r)}</span>${m ? `<b>${esc(m.name)}</b><small>arrived +${mmss(m.at - ev.calledAt)}</small>` : live ? `<select data-change="rr-team" data-e="${ev.id}" data-r="${esc(r)}" aria-label="${esc(r)}"><option value="">Assign…</option>${staff.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>` : '<span class="muted">—</span>'}</div>`; }).join('');
    const logRows = ev.log.slice().reverse().map((x) => `<li class="rr-l ${x.kind} ${x.override ? 'ovr' : ''}"><span class="mono">+${mmss(x.at - ev.calledAt)}</span><span class="mono muted">${clock(x.at)}</span><span>${esc(x.text)}${x.override ? `<small>Override: ${esc(x.override)}</small>` : ''}</span><span class="muted">${esc(x.by || '')}</span></li>`).join('');
    const close = live ? panel('Close the event', `<form data-form="rr-close" class="rr-close"><input type="hidden" name="e" value="${ev.id}"><select name="outcome" required><option value="">Outcome…</option>${(isCode ? ['ROSC, transferred to ICU', 'ROSC, remains on unit', 'Death (time of death recorded)', 'Stood down (no arrest)'] : ['Stabilised, remains on unit', 'Transferred to ICU', 'Escalated to code blue', 'Stood down', 'Limits of treatment agreed']).map((o) => `<option>${esc(o)}</option>`).join('')}</select><button class="btn primary small" type="submit">Close and draft the record</button></form>`) : '';
    const note = !live && !ev.note ? panel('Event record (draft)', `<form data-form="rr-sign" class="stack"><input type="hidden" name="e" value="${ev.id}"><textarea name="text" rows="16" class="rr-note">${esc(draftNote(ev, p))}</textarea><div class="row" style="gap:8px"><button class="btn primary" type="submit">Sign and file in the chart</button><span class="muted" style="font-size:12px">Drafted from the timed log. Edit before signing.</span></div></form>`) : ev.note ? panel('Event record', `<p class="muted" style="margin:0 0 8px">Signed by ${esc(ev.note.by)} ${esc(new Date(ev.note.at).toLocaleString())} · filed in Notes</p><pre class="rr-note">${esc(ev.note.text)}</pre>`) : '';
    return { title: `${isCode ? 'Code blue' : 'Rapid response'} · ${esc(p.name)}`, sub: `${live ? 'Live record · every entry is time-stamped' : `Closed ${esc(new Date(ev.closedAt).toLocaleString())} · ${esc(ev.outcome)}`} · doses are illustrative, follow local ALS/ACLS protocol`,
      body: `${head}${alerts}
        <div class="rr-grid"><div class="rr-main">
          ${live ? panel(isCode ? 'Resuscitation' : 'Interventions', `${dnrGate}${acts}`) : ''}
          ${live ? panel('Drugs', drugs + '<p class="muted" style="font-size:12px;margin:8px 0 0">Every drug runs the same allergy, potassium, anticoagulant and kidney check as the care plan.</p>') : ''}
          ${live ? panel('Vitals', vit) : ''}
          ${panel(`Timed log <small class="muted">${ev.log.length} entries</small>`, `<ol class="rr-log">${logRows}</ol>`, '', true)}
          ${note}
        </div><aside class="rr-side">
          ${panel('From the record', facts)}
          ${panel('Reversible causes (Hs and Ts)', `<div class="rr-hs">${hs}</div><p class="muted" style="font-size:12px;margin:8px 0 0">Highlighted causes have evidence in the record.</p>`)}
          ${panel('Team', team)}
          ${close}
        </aside></div>` };
  };
  function draftNote(ev, p) {
    const T0 = ev.calledAt; const L = ev.log;
    const drugs = L.filter((x) => x.kind === 'drug'), ovr = L.filter((x) => x.override);
    return `${ev.kind === 'code' ? 'CODE BLUE RECORD' : 'RAPID RESPONSE RECORD'} — ${p.bed || p.unit || ''}
Called ${clock(T0)} by ${ev.calledBy}. Trigger: NEWS2 ${ev.trigger.news}; ${ev.trigger.vitals}.${ev.trigger.why ? ' ' + ev.trigger.why + '.' : ''}
Code status: ${p.code}.${ev.dnrConfirmed ? ` Reversal documented by ${ev.dnrConfirmed.by}: ${ev.dnrConfirmed.reason}.` : ''} Allergies: ${p.allergies.map((a) => `${a.agent} (${a.reaction})`).join(', ') || 'none known'}.
Team: ${ev.team.map((m) => `${m.role} ${m.name} (+${mmss(m.at - T0)})`).join('; ') || 'not recorded'}.

Timeline:
${L.map((x) => `+${mmss(x.at - T0)}  ${x.text}${x.override ? ` [override: ${x.override}]` : ''}  (${x.by})`).join('\n')}

Drugs given: ${drugs.map((x) => x.text.replace(/^Given: /, '')).join('; ') || 'none'}.${ovr.length ? `\nSafety overrides: ${ovr.map((x) => `${x.text} — ${x.override}`).join('; ')}.` : ''}
Reversible causes considered: ${hsTs(p).filter(([k]) => ev.hs[k]).map(([, l]) => l).join(', ') || 'none recorded'}.
Outcome: ${ev.outcome} at +${mmss(ev.closedAt - T0)}. Duration ${Math.round((ev.closedAt - T0) / 60000)} min.
Plan: post-event review within 1 hour; family updated: ____.`;
  }

  /* ---------- Rapid response page (list) ---------- */
  VIEWS.events = (u) => {
    const mine = T.myPatients(u);
    const act = events().filter((e) => e.status === 'active');
    const done = events().filter((e) => e.status !== 'active' && T.careRel(u, T.P(e.patient))).slice(-20).reverse();
    const cards = act.map((e) => { const p = T.P(e.patient); return `<a class="rr-card k-${e.kind}" href="#event-${e.id}"><span class="rr-kind">${e.kind === 'code' ? 'CODE BLUE' : 'RAPID RESPONSE'}</span><b>${esc(p.name)}</b><small>${esc(p.bed || p.unit || '')} · called by ${esc(e.calledBy)}</small><b class="mono" data-rr-clock="elapsed" data-t="${e.calledAt}">${mmss(Date.now() - e.calledAt)}</b><span class="btn small primary">Join</span></a>`; }).join('');
    const rows = done.map((e) => { const p = T.P(e.patient); return `<tr><td><a href="#event-${e.id}">${e.kind === 'code' ? 'Code blue' : 'Rapid response'}</a></td><td>${esc(p.name)}</td><td>${esc(new Date(e.calledAt).toLocaleString())}</td><td>${Math.round((e.closedAt - e.calledAt) / 60000)} min</td><td>${esc(e.outcome)}</td><td>${e.note ? pill('ok', 'Signed') : pill('warn', 'Record unsigned')}</td></tr>`; });
    const call = `<form data-form="rr-call" class="rr-callform"><select name="p" required aria-label="Patient"><option value="">Patient…</option>${mine.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.bed || p.unit || '')}${T.news2 ? ` · NEWS2 ${T.news2(p).sc}` : ''}</option>`).join('')}</select><select name="kind" aria-label="Type"><option value="rapid">Rapid response</option><option value="code">Code blue</option></select><input name="why" placeholder="Reason (optional)"><button class="btn danger" type="submit">Call</button></form>`;
    return { title: 'Rapid response', sub: 'Live emergency records · active events are open to any doctor or nurse responding; every view is logged',
      body: `${panel('Active now', cards ? `<div class="rr-cards">${cards}</div>` : '<p class="muted">No active events.</p>')}${panel('Call for a patient in your care', call)}${panel('Recent events', T.table(['Event', 'Patient', 'Called', 'Duration', 'Outcome', 'Record'], rows), '', true)}` };
  };

  /* ---------- Hooks: Vitals tab banner, vitals logging, app-wide alert, live clocks ---------- */
  const origVitals = CHART.vitals;
  CHART.vitals = (u, p) => {
    const a = activeFor(p.id), n = T.news2 ? T.news2(p).sc : 0;
    const ban = a ? `<div class="rr-banner k-${a.kind}"><b>${a.kind === 'code' ? 'Code blue' : 'Rapid response'} in progress</b><span data-rr-clock="elapsed" data-t="${a.calledAt}">${mmss(Date.now() - a.calledAt)}</span><a class="btn small" href="#event-${a.id}">Open the record</a></div>`
      : n >= 5 && clinical(u) ? `<div class="rr-banner ${n >= 7 ? 'k-code' : 'k-rapid'}"><b>NEWS2 ${n}: ${n >= 7 ? 'emergency response' : 'urgent clinical review'}</b><span>${n >= 7 ? 'Call the rapid response team now.' : 'Escalate to the responsible clinician; consider a rapid response call.'}</span><button class="btn small ${n >= 7 ? 'danger' : ''}" data-act="rr-start" data-p="${p.id}" data-k="rapid">Call rapid response</button><button class="btn small danger" data-act="rr-start" data-p="${p.id}" data-k="code">Code blue</button></div>`
        : clinical(u) ? `<div class="rr-mini"><button class="btn small ghost" data-act="rr-start" data-p="${p.id}" data-k="rapid">Call rapid response</button><button class="btn small ghost" data-act="rr-start" data-p="${p.id}" data-k="code">Code blue</button></div>` : '';
    return ban + origVitals(u, p);
  };
  const origVForm = FORMS.vitals;
  FORMS.vitals = (f) => { origVForm(f); const p = T.P(f.p), a = p && activeFor(p.id); if (a) { log(a, 'vitals', `Vitals: HR ${f.hr}, BP ${f.sbp}/${f.dbp}, RR ${f.rr}, SpO₂ ${f.spo2}%, T ${f.temp} °F${T.news2 ? `, NEWS2 ${T.news2(p).sc}` : ''}`); } };
  T.after.push((u, route) => {
    if (!clinical(u)) return;
    const act = events().filter((e) => e.status === 'active' && !(route === 'event'));
    const main = document.querySelector('.main'); if (!main || !act.length) return;
    const b = document.createElement('div'); b.className = 'rr-global';
    b.innerHTML = act.map((e) => { const p = T.P(e.patient); return `<a href="#event-${e.id}" class="k-${e.kind}"><b>${e.kind === 'code' ? 'CODE BLUE' : 'RAPID RESPONSE'}</b> ${esc(p.bed || p.unit || '')} · ${esc(p.name.split(' ')[0])} <span data-rr-clock="elapsed" data-t="${e.calledAt}">${mmss(Date.now() - e.calledAt)}</span><span class="go">Join</span></a>`; }).join('');
    main.insertBefore(b, main.firstChild);
  });
  setInterval(() => {
    document.querySelectorAll('[data-rr-clock]').forEach((el) => { const t = +el.dataset.t; if (!t) return; el.textContent = el.dataset.rrClock === 'elapsed' ? mmss(Date.now() - t) : (t - Date.now() >= 0 ? mmss(t - Date.now()) : `−${mmss(Date.now() - t)}`); el.classList.toggle('late', el.dataset.rrClock === 'down' && Date.now() > t); });
  }, 1000);

  /* ---------- Handlers ---------- */
  ACT['rr-start'] = (d) => { const p = T.P(d.p); if (!p) return; const a = activeFor(p.id); if (a) { location.hash = 'event-' + a.id; return; } const ev = start(p, d.k, ''); location.hash = 'event-' + ev.id; };
  FORMS['rr-call'] = (f) => { const p = T.P(f.p); if (!p || !T.careRel(T.me(), p)) return; const a = activeFor(p.id); const ev = a || start(p, f.kind, (f.why || '').trim()); location.hash = 'event-' + ev.id; };
  const get = (id) => events().find((e) => e.id === id && e.status === 'active');
  ACT['rr-log'] = (d) => {
    const ev = get(d.e); if (!ev) return; const p = T.P(ev.patient);
    if (d.c === 'cpr' && DNR(p) && !ev.dnrConfirmed) { T.toast(`${p.code} on file. Confirm a documented reversal before starting CPR.`); return; }
    const L = Object.fromEntries((ev.kind === 'code' ? CODE_ACTS : RAPID_ACTS)); log(ev, 'action', L[d.c] || d.c, { code: d.c }); render();
  };
  ACT['rr-rhythm'] = (d) => { const ev = get(d.e); if (!ev) return; log(ev, 'rhythm', `Rhythm check: ${d.r}${/VF|VT/.test(d.r) ? ' (shockable)' : /PEA|Asystole/.test(d.r) ? ' (non-shockable)' : ''}`, { code: 'rhythm' }); render(); };
  ACT['rr-escalate'] = (d) => { const ev = get(d.e); if (!ev) return; ev.kind = 'code'; log(ev, 'call', 'Escalated to code blue'); audit('rr-call', { patient: T.P(ev.patient), purpose: 'Emergency response', detail: 'Escalated to code blue' }); render(); };
  ACT['rr-drug'] = (d) => giveDrug(d.e, d.d, '');
  ACT['rr-unblock'] = () => { UI.rrBlocked = null; render(); };
  function giveDrug(eid, drug, override) {
    const ev = get(eid); if (!ev || !drug) return; const p = T.P(ev.patient);
    const c = T.careplan ? T.careplan.checkDrug(p, drug) : { level: 'ok', reasons: [] };
    if (c.level === 'block' && !override) { UI.rrBlocked = { e: eid, d: drug, reasons: c.reasons }; render(); return; }
    UI.rrBlocked = null;
    log(ev, 'drug', `Given: ${drug}`, override ? { override } : c.level === 'caution' ? { caution: c.reasons.join(' ') } : null);
    if (override) audit('rr-drug-override', { patient: p, purpose: 'Emergency response', detail: `${drug}: ${c.reasons.join(' ')} · reason: ${override}` });
    render();
  }
  FORMS['rr-drug'] = (f) => giveDrug(f.e, (f.drug || '').trim(), (f.override || '').trim());
  FORMS['rr-dnr'] = (f) => { const ev = get(f.e); if (!ev) return; ev.dnrConfirmed = { by: me().name, at: Date.now(), reason: f.reason.trim() }; log(ev, 'note', `Code status reversal documented: ${f.reason.trim()}`); audit('rr-dnr-reversal', { patient: T.P(ev.patient), purpose: 'Emergency response', detail: f.reason.trim() }); render(); };
  FORMS['rr-vitals'] = (f) => {
    const ev = get(f.e); if (!ev) return; const p = T.P(ev.patient);
    const v = { hr: +f.hr, sbp: +f.sbp, dbp: +f.dbp, rr: +f.rr, spo2: +f.spo2, temp: p.vitals.temp };
    if (T.hist) T.hist.logVitals(p, v, 'Rapid response');
    T.patchPatient(p.id, { vitals: { bp: `${v.sbp}/${v.dbp}`, hr: v.hr, rr: v.rr, temp: v.temp, spo2: v.spo2 } });
    log(ev, 'vitals', `Vitals: HR ${v.hr}, BP ${v.sbp}/${v.dbp}, RR ${v.rr}, SpO₂ ${v.spo2}%${T.news2 ? `, NEWS2 ${T.news2(p).sc}` : ''}`); render();
  };
  T.CHANGE = T.CHANGE || {};
  T.CHANGE['rr-hs'] = (v, el) => { const ev = get(el.dataset.e); if (!ev) return; ev.hs[el.dataset.k] = el.checked; if (el.checked) log(ev, 'note', `Considered: ${hsTs(T.P(ev.patient)).find(([k]) => k === el.dataset.k)[1]}`); else T.save(); render(); };
  T.CHANGE['rr-team'] = (v, el) => { const ev = get(el.dataset.e); const u = T.U(v); if (!ev || !u) return; ev.team.push({ role: el.dataset.r, name: u.name, id: u.id, at: Date.now() }); log(ev, 'team', `${el.dataset.r}: ${u.name} arrived`); render(); };
  FORMS['rr-close'] = (f) => {
    const ev = get(f.e); if (!ev || !f.outcome) return; const p = T.P(ev.patient);
    ev.status = 'closed'; ev.closedAt = Date.now(); ev.outcome = f.outcome; log(ev, 'close', `Event closed: ${f.outcome}`);
    audit('rr-close', { patient: p, purpose: 'Emergency response', detail: `${ev.kind === 'code' ? 'Code blue' : 'Rapid response'} · ${f.outcome} · ${Math.round((ev.closedAt - ev.calledAt) / 60000)} min · ${ev.log.length} entries` });
    T.save(); render(); window.scrollTo(0, 0);
  };
  FORMS['rr-sign'] = (f) => {
    const ev = events().find((e) => e.id === f.e); if (!ev || ev.note) return; const p = T.P(ev.patient);
    ev.note = { text: f.text, by: me().name, at: Date.now() };
    S().notes.push({ id: T.nid('N'), patient: p.id, author: me().name, kind: ev.kind === 'code' ? 'Code blue record' : 'Rapid response record', mOff: 0, at: new Date().toISOString(), signed: true, text: f.text, addenda: [] });
    if (T.careplan) { const pl = T.careplan.plan(p.id); pl.tasks.push({ id: T.nid('TK'), sys: 'safety', text: `Post-event review after the ${ev.kind === 'code' ? 'code blue' : 'rapid response'}`, owner: 'Doctor', dueH: 1, created: Date.now(), by: me().name }); }
    audit('rr-sign', { patient: p, purpose: 'Emergency response', detail: `${ev.kind === 'code' ? 'Code blue' : 'Rapid response'} record signed and filed` });
    T.save(); render(); T.toast('Record signed and filed in Notes. A post-event review was added to the care plan.');
  };

  T.rr = { events, activeFor, start, drugList, hsTs, draftNote };
})(window.Tessera);
