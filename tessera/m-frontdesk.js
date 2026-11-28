/* Tessera Health — front office: OPD queue, registration, appointments, engagement,
   insurance desk, and the patient portal. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, esc, clone, P, U, me, nid, pill, statePill, tiles, panel, table, money, ago, timeStr, toast, audit, openModal, render, save, DEPT, maskId } = T;
  const S = () => T.S;
  const UI = T.UI;

  T.inits.push((s) => {
    const fill = (k, v) => { if (s[k] === undefined) s[k] = clone(v); };
    fill('reminders', SEED.reminders); fill('followups', SEED.followups); fill('insCases', SEED.insCases); fill('portalRequests', []);
  });

  const visitType = (a) => /follow|review|check/i.test(a.reason) ? 'Follow-up' : /consult/i.test(a.reason) ? 'Consult' : 'Visit';
  const phoneCell = T.phoneCell;

  /* ======================= Front desk: OPD queue ======================= */
  T.HOME.receptionist = (u) => {
    const list = S().appts.slice().sort((a, b) => a.time.localeCompare(b.time));
    audit('view-opd-queue', { patients: list.map((a) => T.tok(P(a.patient))).join(' ') });
    const rows = list.map((a, i) => { const p = P(a.patient); const idx = S().appts.indexOf(a);
      const wait = a.checkedInAt ? Math.round((Date.now() - new Date(a.checkedInAt)) / 60000) : null;
      const act = a.status === 'Scheduled' ? `<button class="btn small primary" data-act="opd-checkin" data-i="${idx}">Check in</button>` : a.status === 'No-show' ? `<button class="btn small" data-act="opd-resched" data-i="${idx}">Reschedule…</button>` : '';
      return `<tr><td class="mono">${a.time}</td><td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn} · DOB ${p.dob || '—'}</span></td><td>${visitType(a)}<span class="sub">${esc(U(a.provider).name)}</span></td><td>${esc(p.payer)}</td><td>${phoneCell(p)}</td><td>${statePill(a.status)}${wait != null ? `<span class="sub">waiting ${wait} min</span>` : ''}</td><td>${act}</td></tr>`; });
    return { title: 'OPD queue', sub: `Outpatient front desk · ${T.dayStr(0)}`, body:
      tiles([[list.length, 'Visits today'], [list.filter((a) => a.status === 'Scheduled').length, 'Not arrived'], [list.filter((a) => ['Arrived', 'Waiting'].includes(a.status)).length, 'Waiting', 'warn'], [list.filter((a) => a.status === 'In room').length, 'In room'], [list.filter((a) => a.status === 'Completed').length, 'Completed', 'ok'], [list.filter((a) => a.status === 'No-show').length, 'No-show', 'crit']]) +
      `<div class="banner info"><p>Front desk sees who is coming, coverage and contact details. Visit reasons and clinical details stay with the care team.</p></div>` +
      `<div class="row"><a class="btn primary" href="#registration">Register walk-in</a><a class="btn" href="#appointments">Book appointment</a></div>` +
      panel('Queue', table(['Time', 'Patient', 'Visit', 'Coverage', 'Phone', 'Status', ''], rows), '<span class="kpi-note">Wait time counts from check-in. Visits left open from an earlier day are closed overnight.</span>', true) };
  };
  Object.assign(ACT, {
    'opd-checkin': (d) => { const a = S().appts[+d.i]; a.status = 'Arrived'; a.checkedInAt = new Date().toISOString(); audit('opd-checkin', { patient: P(a.patient) }); save(); render(); toast('Checked in. The clinician sees the patient as arrived.'); },
    'opd-resched': (d) => { const a = S().appts[+d.i]; a.status = 'Rescheduled'; S().reminders.unshift({ patient: a.patient, kind: 'Appointment', channel: 'SMS', when: 'Now', status: 'Scheduled', msg: 'We missed you today. Reply R to reschedule or call (415) 555-0100.' }); audit('opd-reschedule', { patient: P(a.patient) }); save(); render(); toast('Marked for rescheduling and an outreach reminder was queued.'); }
  });

  /* ======================= Registration ======================= */
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  function lev(a, b) { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
  VIEWS.registration = (u) => {
    const q = (UI.regQ || '').toLowerCase();
    const list = T.allPts().filter((p) => !q || p.name.toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q) || (p.alias || '').toLowerCase().includes(q)).slice(0, 40);
    audit('list-registry', { resource: q ? `search "${q}"` : 'registry', patients: list.map(T.tok).join(' '), detail: `${list.length} returned` });
    const rows = list.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.alias ? `<span class="sub">formerly ${esc(p.alias)}</span>` : ''}<span class="sub">MRN ${esc(p.mrn)}</span></td><td>${p.dob || '—'}</td><td>${p.sex}</td><td>${phoneCell(p)}</td><td>${esc(p.payer)}<span class="sub mono">${p.memberId ? maskId(p.memberId) : ''}</span></td><td>${statePill(p.status)}</td><td>${p.memberId ? `<button class="btn small" data-act="reg-elig" data-p="${p.id}">Check eligibility</button>` : ''}</td></tr>`);
    const dup = UI.regDup;
    return { title: 'Registration', sub: 'One master patient index · duplicate check on every new record', body:
      `<div class="grid-2"><div class="stack"><form data-form="reg-search" class="row"><input class="search" name="q" value="${esc(UI.regQ || '')}" placeholder="Search by name, MRN or alias" aria-label="Search registry"><button class="btn" type="submit">Search</button></form>
        ${panel('Registry', table(['Patient', 'DOB', 'Sex', 'Phone', 'Coverage', 'Status', ''], rows), `<span class="kpi-note">${list.length} shown · search is logged</span>`, true)}</div>
      ${panel('Register patient', `${dup ? `<div class="banner warn"><p><b>Possible duplicate.</b> ${esc(dup.match.name)} · MRN ${esc(dup.match.mrn)} · DOB ${dup.match.dob}. Use the existing record unless you are sure this is a different person.</p><div class="row"><button class="btn small primary" data-act="reg-use">Use existing record</button><button class="btn small" data-act="reg-force">Create new anyway</button></div></div>` : ''}
        <form data-form="reg-new" class="stack">
          <div class="field"><label for="rg-f">First name</label><input id="rg-f" name="first" required value="${esc(dup ? dup.f.first : '')}"></div>
          <div class="field"><label for="rg-l">Last name</label><input id="rg-l" name="last" required value="${esc(dup ? dup.f.last : '')}"></div>
          <div class="field"><label for="rg-d">Date of birth</label><input id="rg-d" name="dob" type="date" required value="${esc(dup ? dup.f.dob : '')}"></div>
          <div class="field"><label for="rg-s">Sex</label><select id="rg-s" name="sex"><option value="F">Female</option><option value="M">Male</option></select></div>
          <div class="field"><label for="rg-ph">Mobile</label><input id="rg-ph" name="phone" inputmode="numeric" pattern="[0-9]{10}" placeholder="10 digits" required value="${esc(dup ? dup.f.phone : '')}"></div>
          <div class="field"><label for="rg-pay">Coverage</label><select id="rg-pay" name="payer"><option>Medicare Part B</option><option>Medi-Cal (Medicaid)</option><option>Aetna PPO</option><option>Blue Shield of California HMO</option><option>Kaiser Permanente HMO</option><option>Self-pay</option></select></div>
          <div class="field"><label for="rg-m">Member ID</label><input id="rg-m" name="member" value="${esc(dup ? dup.f.member : '')}"></div>
          <div><button class="btn primary" type="submit">Register</button></div>
        </form><p class="kpi-note">Try registering "Radha Bhat", DOB 1960-09-12, to see duplicate detection.</p>`)}</div>` };
  };
  function createPatient(f) {
    const n = S().extraPatients.length; const age = new Date().getFullYear() - +f.dob.slice(0, 4);
    const p = { id: T.store && T.store.live ? T.nid('R') : 'R' + (100 + n), mrn: String(103100 + n), _forced: !!f.forced, /* live: unique id; the server issues the MRN */ name: `${f.first.trim()} ${f.last.trim()}`, age, sex: f.sex, dob: f.dob, phone: f.phone, dept: 'GMED', consults: [], unit: null, bed: null, status: 'Outpatient', attending: 'U-2002', payer: f.payer, memberId: f.member || '', code: 'Full code', weightKg: 0, heightCm: 0, allergies: [], problems: ['New patient — intake pending'], vitals: { bp: '—', hr: '—', rr: '—', temp: '—', spo2: '—' }, meds: [], labs: [], bloodGroup: 'Unknown' };
    S().extraPatients.push(p); audit('mpi-register', { patient: p, detail: f.forced ? 'duplicate warning overridden' : 'no duplicate found' }); save(); return p;
  }
  Object.assign(FORMS, {
    'reg-search'(f) { UI.regQ = f.q || ''; render(); },
    'reg-new'(f) {
      const full = norm(f.first + f.last);
      const match = T.allPts().find((p) => p.dob === f.dob && lev(norm(p.name), full) <= 2);
      if (match) { UI.regDup = { match, f }; audit('mpi-duplicate-warning', { patient: match }); render(); return; }
      const p = createPatient(f); UI.regDup = null; render(); toast(`Registered ${p.name}, MRN ${p.mrn}.`);
    }
  });
  Object.assign(ACT, {
    'reg-use': () => { const m = UI.regDup.match; UI.regDup = null; UI.regQ = m.mrn; audit('mpi-duplicate-avoided', { patient: m }); render(); toast('Using the existing record. No duplicate created.'); },
    'reg-force': () => { const p = createPatient(Object.assign({}, UI.regDup.f, { forced: true })); UI.regDup = null; render(); toast(`Registered ${p.name}. Flagged for MPI review.`); },
    'reg-elig': (d) => { const p = P(d.p); audit('eligibility-check', { patient: p, detail: '270/271' }); toast(`271: ${p.payer} active. Primary care copay $25.`); }
  });

  /* ======================= Appointments ======================= */
  const SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
  VIEWS.appointments = (u) => {
    const docs = S().users.filter((x) => x.role === 'doctor' && x.status === 'active');
    const avail = docs.map((d) => { const taken = S().appts.filter((a) => a.provider === d.id && !['No-show', 'Rescheduled'].includes(a.status)).map((a) => T.toMin(a.time)); const free = SLOTS.filter((s) => !taken.some((t) => Math.abs(t - T.toMin(s)) < 30));
      return `<tr><td><b>${esc(d.name)}</b><span class="sub">${esc(DEPT[d.dept])}</span></td><td>${free.length}</td><td class="mono" style="font-size:12px">${free.slice(0, 6).join(' · ')}${free.length > 6 ? ' …' : ''}</td></tr>`; });
    const list = S().appts.slice().sort((a, b) => a.time.localeCompare(b.time)).map((a) => { const p = P(a.patient); return `<tr><td class="mono">${a.time}</td><td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn}</span></td><td>${esc(U(a.provider).name)}</td><td>${visitType(a)}</td><td>${statePill(a.status)}</td></tr>`; });
    const pts = T.allPts().filter((p) => !p.unidentified && !['Discharged'].includes(p.status)).map((p) => `<option value="${p.id}">${esc(p.name)} · MRN ${p.mrn}</option>`).join('');
    return { title: 'Appointments', sub: 'Doctor directory and availability · booking', body:
      `<div class="grid-2">${panel('Availability today', table(['Doctor', 'Open slots', 'Next available'], avail), '', true)}
      ${panel('Book appointment', `<form data-form="appt" class="stack"><div class="field"><label for="ap-p">Patient</label><select id="ap-p" name="p" required>${pts}</select></div>
        <div class="field"><label for="ap-d">Doctor</label><select id="ap-d" name="d" required>${docs.map((d) => `<option value="${d.id}">${esc(d.name)} · ${esc(DEPT[d.dept])}</option>`).join('')}</select></div>
        <div class="field"><label for="ap-t">Time</label><select id="ap-t" name="t" required>${SLOTS.map((s) => `<option>${s}</option>`).join('')}</select><small>Double-booking is blocked.</small></div>
        <div class="field"><label for="ap-k">Visit type</label><select id="ap-k" name="k"><option>Follow-up visit</option><option>New patient visit</option><option>Telehealth follow-up</option></select></div>
        <div><button class="btn primary" type="submit">Book</button></div></form>`)}</div>` +
      panel("Today's appointments", table(['Time', 'Patient', 'Doctor', 'Type', 'Status'], list), '', true) };
  };
  FORMS.appt = (f) => {
    const clash = S().appts.find((a) => a.provider === f.d && !['No-show', 'Rescheduled'].includes(a.status) && Math.abs(T.toMin(a.time) - T.toMin(f.t)) < 30); // visits are 30 minutes
    if (clash) { toast(`${U(f.d).name} already has a visit at ${clash.time}. Pick a slot at least 30 minutes away.`); return; }
    S().appts.push({ patient: f.p, time: f.t, reason: f.k, provider: f.d, status: 'Scheduled' });
    S().reminders.unshift({ patient: f.p, kind: 'Appointment', channel: 'SMS', when: 'Day before, 09:00', status: 'Scheduled', msg: 'You have an upcoming visit at Bayview. Reply C to confirm or call (415) 555-0100.' });
    audit('appointment-book', { patient: P(f.p), detail: `${U(f.d).name} ${f.t}` }); save(); render(); toast('Booked. A reminder is queued.');
  };

  /* ======================= Engagement ======================= */
  VIEWS.engagement = () => {
    const rem = S().reminders.map((r, i) => { const p = P(r.patient); return `<tr><td><b>${esc(p.name)}</b><span class="sub">${esc(r.kind)}</span></td><td>${esc(r.channel)}</td><td>“${esc(r.msg)}”</td><td>${esc(r.when)}</td><td>${statePill(r.status)}${r.status === 'Scheduled' ? ` <button class="btn small" data-act="rem-send" data-i="${i}">Send now</button>` : ''}</td></tr>`; });
    const fu = S().followups.map((f, i) => { const p = P(f.patient); return `<tr><td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn}</span></td><td>${esc(f.kind)}</td><td>${pill(f.risk === 'High' ? 'crit' : f.risk === 'Medium' ? 'warn' : 'ok', f.risk + ' risk')}</td><td>${f.dueOff === 0 ? 'Today' : `In ${f.dueOff} d`}</td><td>${f.done ? pill('ok', f.done) : `<button class="btn small" data-act="fu-log" data-i="${i}">Log call…</button>`}</td></tr>`; });
    return { title: 'Reminders & follow-up', sub: 'Outbound messages carry no clinical details', body:
      tiles([['68%', 'Portal activation'], [S().reminders.filter((r) => r.status !== 'Scheduled').length, 'Reminders sent'], [S().followups.filter((f) => !f.done).length, 'Follow-up calls due', 'warn']]) +
      `<div class="banner info"><p>SMS, email and push messages never include diagnoses, medications or results. They point the patient to the secure app.</p></div>` +
      panel('Reminders', table(['Patient', 'Channel', 'Message', 'When', 'Status'], rem), '', true) + panel('Post-discharge and care follow-up', table(['Patient', 'Call', 'Risk', 'Due', ''], fu), '', true) };
  };
  Object.assign(ACT, {
    'rem-send': (d) => { const r = S().reminders[+d.i]; r.status = 'Delivered'; r.when = 'Just now'; audit('reminder-send', { patient: P(r.patient), detail: r.channel }); save(); render(); },
    'fu-log': (d) => openModal({ title: 'Log follow-up call', form: 'fu-log', submit: 'Save', body: `<input type="hidden" name="i" value="${d.i}"><div class="field"><label for="fo">Outcome</label><select id="fo" name="o" required><option value="">Choose</option><option>Reached, doing well</option><option>Reached, concern escalated to nurse line</option><option>No answer, voicemail left (no details)</option></select></div>` })
  });
  FORMS['fu-log'] = (f) => { const x = S().followups[+f.i]; x.done = f.o; UI.modal = null; audit('followup-call', { patient: P(x.patient), detail: f.o }); save(); render(); };

  /* ======================= Insurance desk ======================= */
  VIEWS.insurance = (u) => {
    const cases = S().insCases;
    if (!UI.insSel) UI.insSel = cases[0].id;
    const c = cases.find((x) => x.id === UI.insSel); const p = P(c.patient);
    audit('view-ins-case', { patient: p, resource: c.id });
    const list = cases.map((x) => { const q = P(x.patient); return `<tr class="clickable" data-act="ins-sel" data-c="${x.id}" ${x.id === c.id ? 'style="outline:2px solid var(--accent);outline-offset:-2px"' : ''}><td class="mono">${x.id}</td><td><b>${esc(q.name)}</b><span class="sub">${esc(x.kind)}</span></td><td>${esc(x.payer)}</td><td class="num">${money(x.amount)}</td><td>${statePill(x.status)}</td></tr>`; });
    const showPol = UI.revealed.has('ins' + c.id);
    const docs = c.docs.map((d, i) => `<tr><td>${esc(d.n)}</td><td>${d.ok ? pill('ok', 'Attached') : d.req ? pill('warn', 'Requested from HIM') : pill('crit', 'Missing')}</td><td>${d.ok ? '' : d.req ? `<button class="btn small" data-act="ins-recv" data-c="${c.id}" data-i="${i}">Mark received</button>` : `<button class="btn small primary" data-act="ins-req" data-c="${c.id}" data-i="${i}">Request from HIM</button>`}</td></tr>`);
    const allDocs = c.docs.every((d) => d.ok);
    const detail = `<dl class="kv" style="margin:0"><div><dt>Patient</dt><dd style="margin:0">${esc(p.name)} · DOB ${p.dob}</dd></div><div><dt>Payer</dt><dd style="margin:0">${esc(c.payer)}</dd></div>
      <div><dt>Member ID</dt><dd style="margin:0"><span class="mono">${showPol ? esc(p.memberId) : maskId(p.memberId)}</span> ${showPol ? '' : `<button class="linkbtn" data-act="ins-reveal" data-c="${c.id}">Reveal</button>`}</dd></div>
      <div><dt>Service</dt><dd style="margin:0">${esc(c.service)}</dd></div><div><dt>Amount</dt><dd class="num" style="margin:0">${money(c.amount)}</dd></div><div><dt>Status</dt><dd style="margin:0">${statePill(c.status)}${c.ref ? `<span class="sub mono">${esc(c.ref)}</span>` : ''}</dd></div></dl>
      ${panel('Documents', table(['Document', 'State', ''], docs), '<span class="kpi-note">Health Information Management attaches the minimum necessary records. You see the list, not the contents.</span>', true)}
      <div class="stack" style="gap:6px"><h3>Payer messages</h3>${c.thread.map((m) => `<div class="note"><b>${esc(m.from)}</b><span class="kpi-note">${m.at ? timeStr(m.at) : ago(m.off)}</span><p>${esc(m.text)}</p></div>`).join('') || '<p class="muted">No messages.</p>'}
        <form data-form="ins-reply" class="row"><input type="hidden" name="c" value="${c.id}"><input class="search" name="text" required placeholder="Reply to payer" aria-label="Reply to payer"><button class="btn" type="submit">Send</button></form></div>
      <div class="stack" style="gap:4px"><h3>Timeline</h3><div class="trail">${c.timeline.map((t) => `<span>${t.at ? timeStr(t.at) : ago(t.off)} · ${esc(t.t)}</span>`).join('')}</div></div>
      ${['Approved', 'Submitted', 'Denied'].includes(c.status) ? '' : `<div class="row"><button class="btn primary" data-act="ins-submit" data-c="${c.id}" ${allDocs ? '' : 'disabled'}>Submit to payer (X12 275)</button>${allDocs ? '' : '<span class="kpi-note">Attach every document first.</span>'}</div>`}
      ${c.status === 'Submitted' ? `<div class="row"><button class="btn primary" data-act="ins-decide" data-c="${c.id}" data-d="Approved">Record approval</button><button class="btn danger" data-act="ins-decide" data-c="${c.id}" data-d="Denied">Record denial</button></div>` : ''}`;
    return { title: 'Pre-authorization & claims', sub: 'Insurance desk · payer correspondence', body:
      tiles([[cases.filter((x) => x.kind === 'Prior authorization' && !['Approved', 'Denied'].includes(x.status)).length, 'Pre-auth pending', 'warn'], [cases.filter((x) => x.status === 'Payer query').length, 'Payer queries', 'crit'], [cases.filter((x) => x.status === 'Approved').length, 'Approved', 'ok'], [money(cases.reduce((n, x) => n + x.amount, 0)), 'Value in progress']]) +
      `<div class="grid-2">${panel('Cases', table(['Case', 'Patient', 'Payer', 'Amount', 'Status'], list), '', true)}${panel(`${c.id} · ${esc(c.kind)}`, detail)}</div>` };
  };
  const ic = (id) => S().insCases.find((x) => x.id === id);
  Object.assign(ACT, {
    'ins-sel': (d) => { UI.insSel = d.c; render(); },
    'ins-reveal': (d) => { UI.revealed.add('ins' + d.c); audit('reveal-member-id', { patient: P(ic(d.c).patient) }); render(); },
    'ins-req': (d) => { const c = ic(d.c); c.docs[+d.i].req = true; c.timeline.push({ at: new Date().toISOString(), t: `Requested "${c.docs[+d.i].n}" from HIM` }); audit('him-request', { patient: P(c.patient), detail: c.docs[+d.i].n }); save(); render(); },
    'ins-recv': (d) => { const c = ic(d.c); c.docs[+d.i].ok = true; c.timeline.push({ at: new Date().toISOString(), t: `HIM attached "${c.docs[+d.i].n}"` }); save(); render(); },
    'ins-submit': (d) => { const c = ic(d.c); c.status = 'Submitted'; c.timeline.push({ at: new Date().toISOString(), t: 'Submitted to payer with X12 275 attachments' }); audit('payer-submit', { patient: P(c.patient), resource: c.id }); save(); render(); toast('Sent to payer.'); },
    'ins-decide': (d) => { const c = ic(d.c); c.status = d.d; if (d.d === 'Approved') c.ref = 'AUTH-' + (7700000 + S().seq++);
      c.timeline.push({ at: new Date().toISOString(), t: `Payer decision: ${d.d}` });
      if (c.id === 'PA-501' && d.d === 'Approved') { const dc = S().discharges.find((x) => x.patient === c.patient); if (dc) { const st = dc.steps.find((s) => s.owner === 'billing'); if (st && st.state === 'Blocked') { st.state = 'Pending'; st.blocker = 'Authorization received; billing can clear'; } } }
      audit('payer-decision', { patient: P(c.patient), resource: c.id, detail: d.d }); save(); render(); toast(d.d === 'Approved' ? 'Approved. The discharge billing step is unblocked.' : 'Denial recorded. Appeal window: 60 days.'); }
  });
  FORMS['ins-reply'] = (f) => { const c = ic(f.c); c.thread.push({ from: me().name, at: new Date().toISOString(), text: f.text }); if (c.status === 'Payer query') c.status = 'Documents needed'; audit('payer-message', { patient: P(c.patient), resource: c.id }); save(); render(); };
  T.HOME.insurance = () => {
    const cases = S().insCases;
    return { title: 'Insurance desk', sub: 'Authorizations, payer queries and claim attachments', body:
      tiles([[cases.length, 'Open cases'], [cases.filter((x) => x.status === 'Payer query').length, 'Payer queries', 'crit'], [cases.reduce((n, x) => n + x.docs.filter((d) => !d.ok).length, 0), 'Documents missing', 'warn'], [cases.filter((x) => x.status === 'Approved').length, 'Approved', 'ok']]) +
      `<div class="banner info"><p>The insurance desk works from service codes, amounts and a document list. It has no access to charts, notes or results.</p></div><div><a class="btn primary" href="#insurance">Open cases</a></div>` };
  };
  T.counts.insurance = () => { const n = S().insCases.filter((x) => x.status === 'Payer query').length; return n ? `<span class="count crit">${n}</span>` : ''; };

  /* ======================= Patient portal ======================= */
  const mine = (u) => P(u.patientId);
  const pview = (u, what) => audit('portal-view', { patient: mine(u), resource: what, purpose: 'Individual access' });
  function balance(p) { return S().claims.filter((c) => c.patient === p.id && c.status !== 'Paid').reduce((n, c) => n + c.charge * 0.2, 0); }
  T.HOME.patient = (u) => {
    const p = mine(u); pview(u, 'home');
    const nextTele = S().tele.find((t) => t.patient === p.id && t.status === 'Scheduled');
    const results = p.labs.length + S().labOrders.filter((o) => o.patient === p.id && o.status === 'Released').length + S().radOrders.filter((o) => o.patient === p.id && o.status === 'Reported').length;
    const stay = p.status === 'Admitted' ? `You're staying in ${T.UNIT[p.unit]}${p.bed ? ', bed ' + p.bed : ''}.` : '';
    return { title: `Welcome, ${esc(p.name.split(' ')[0])}`, sub: `MRN ${p.mrn} · ${SEED.org.name}`, body:
      (stay ? `<div class="banner info"><p>${esc(stay)} Your care team can see updates here as they happen in the hospital record.</p></div>` : '') +
      tiles([[nextTele ? nextTele.when : '—', 'Next visit'], [results, 'Results available'], [p.meds.filter((m) => /Active/.test(m.status)).length, 'Active medications'], [money(balance(p)), 'Estimated balance']]) +
      `<div class="grid">${panel('Quick actions', `<div class="row"><a class="btn" href="#mytwin">My health twin</a><a class="btn" href="#myresults">See results</a><a class="btn" href="#mymeds">Request a refill</a><a class="btn" href="#access">Who viewed my record</a></div>`)}
      ${panel('Your care team', `<p>${esc(U(p.attending).name)} · ${esc(U(p.attending).title)}</p>${p.consults.map((c) => `<p class="muted">${esc(DEPT[c])}</p>`).join('')}`)}</div>` };
  };
  VIEWS.visits = (u) => { const p = mine(u); pview(u, 'visits');
    const rows = S().appts.filter((a) => a.patient === p.id).map((a) => `<tr><td>Today ${a.time}</td><td>${esc(U(a.provider).name)}</td><td>${esc(a.reason)}</td><td>${statePill(a.status)}</td></tr>`)
      .concat(S().tele.filter((t) => t.patient === p.id).map((t) => `<tr><td>${esc(t.when)}</td><td>${esc(U(t.provider).name)}</td><td>Video: ${esc(t.reason)}</td><td>${statePill(t.status)}</td></tr>`))
      .concat(S().ot.filter((c) => c.patient === p.id).map((c) => `<tr><td>Today ${c.scheduled}</td><td>${esc(U(c.surgeon).name)}</td><td>Surgery: ${esc(c.procedure)}</td><td>${statePill(c.stage)}</td></tr>`));
    return { title: 'Visits', sub: 'Past and upcoming', body: panel('Visits', table(['When', 'With', 'What', 'Status'], rows), '', true) }; };
  VIEWS.myresults = (u) => { const p = mine(u); pview(u, 'results');
    const plain = (l) => !l.flag ? 'Within the normal range.' : l.flag.length > 1 ? 'Well outside the normal range. Your care team has been alerted.' : l.flag === 'H' ? 'Higher than the normal range.' : 'Lower than the normal range.';
    const rows = p.labs.map((l) => { const s = T.hist && T.hist.lab(p, l.test); const d = T.hist && T.hist.labDelta(p, l.test); const [lo, hi] = T.hist ? T.hist.refRange(l.ref) : []; return `<tr><td><b>${esc(l.test)}</b></td><td class="num">${esc(l.value)} ${esc(l.unit)}${d && d.dir ? `<span class="sub">${d.dir > 0 ? 'Up' : 'Down'} from ${esc(d.prev.raw)} ${esc(T.hist.dayLbl(d.prev.at))}</span>` : ''}</td><td>${s && s.pts.length > 1 ? T.hist.spark(s.pts.map((x) => x.v), { lo, hi }) : ''}</td><td>${esc(l.ref)}</td><td>${plain(l)}</td><td>${T.dayStr(l.dOff)}</td></tr>`; })
      .concat(S().labOrders.filter((o) => o.patient === p.id && o.status === 'Released').map((o) => `<tr><td><b>${esc(o.test)}</b></td><td class="num">${esc(o.value)} ${esc(o.unit)}</td><td></td><td>${esc(o.ref)}</td><td>${plain(o)}</td><td>Today</td></tr>`));
    const img = S().radOrders.filter((o) => o.patient === p.id && o.status === 'Reported').map((o) => `<tr><td><b>${esc(o.study)}</b></td><td>${esc(o.report.impression)}</td></tr>`);
    return { title: 'Results', sub: 'Released to you as soon as they are final (21st Century Cures Act)', body: panel('Lab results', table(['Test', 'Result', 'Your trend', 'Normal range', 'What it means', 'Date'], rows), '', true) + panel('Imaging', table(['Study', 'Impression'], img), '', true) }; };
  VIEWS.mymeds = (u) => { const p = mine(u); pview(u, 'medications');
    const rows = p.meds.map((m, i) => `<tr><td><b>${esc(m.drug)}</b></td><td>${esc(m.dose)} ${esc(m.route)} ${esc(m.freq)}</td><td>${statePill(m.status)}</td><td>${/Active/.test(m.status) ? `<button class="btn small" data-act="pt-refill" data-i="${i}">Request refill</button>` : ''}</td></tr>`);
    return { title: 'Medications', sub: 'Your current medication list', body: panel('Medications', table(['Medication', 'How to take', 'Status', ''], rows), '', true) + (S().portalRequests.some((r) => !r.patient || r.patient === p.id) ? panel('Requests', table(['Request', 'Sent', 'Status'], S().portalRequests.filter((r) => !r.patient || r.patient === p.id).map((r) => `<tr><td>${esc(r.t)}</td><td>${timeStr(r.at)}</td><td>${statePill(r.state || 'Pending')}${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}</td></tr>`)), '', true) : '') }; };
  VIEWS.bills = (u) => { const p = mine(u); pview(u, 'bills');
    const rows = S().claims.filter((c) => c.patient === p.id).map((c) => `<tr><td>${T.dayStr(c.dOff)}</td><td>${c.cpt.map((x) => esc(SEED.cptDesc[x] || x)).join(', ')}</td><td class="num">${money(c.charge)}</td><td>${statePill(c.status)}</td><td class="num">${c.status === 'Paid' ? money(0) : money(c.charge * 0.2)}</td></tr>`);
    return { title: 'Bills', sub: 'Estimates assume 20% coinsurance until the payer responds', body: panel('Statements', table(['Date of service', 'Services', 'Billed', 'Insurance', 'You may owe'], rows), '', true) +
      panel('Help paying', `<p>Bayview offers interest-free payment plans and financial assistance based on household income.</p><div class="row"><button class="btn" data-act="pt-fa">Apply for financial assistance</button><button class="btn" disabled title="Payments are disabled in the prototype">Pay online (disabled in demo)</button></div>`) }; };
  VIEWS.access = (u) => { const p = mine(u); const t = T.tok(p); pview(u, 'access log');
    const rows = S().audit.filter((e) => e.patient && e.patient.includes(t) && e.actor !== u.id).slice().reverse().map((e) => { const a = U(e.actor); return `<tr><td>${timeStr(e.ts)}</td><td><b>${esc(a ? a.name : 'System')}</b><span class="sub">${esc(a ? a.title : '')}</span></td><td>${esc(e.action.replace(/-/g, ' '))}</td><td>${esc(e.purpose)}</td><td>${pill(e.outcome === 'success' ? 'ok' : 'crit', e.outcome)}</td></tr>`; });
    return { title: 'Who viewed my record', sub: 'Every access to your record, from the hospital audit log', body: `<div class="banner info"><p>If something here looks wrong, contact the Privacy Office at (415) 555-0199. You can also request a formal accounting of disclosures.</p></div>` + panel('Access history', table(['When', 'Who', 'What', 'Purpose', 'Result'], rows), `<span class="kpi-note">${rows.length} events</span>`, true) }; };
  Object.assign(ACT, {
    'pt-refill': (d) => { const u = me(), p = mine(u); const m = p.meds[+d.i]; S().portalRequests.push({ id: nid('RF'), t: `Refill: ${m.drug} ${m.dose}`, at: new Date().toISOString(), patient: p.id, drug: `${m.drug} ${m.dose} ${m.route} ${m.freq}`, state: 'Pending' }); audit('portal-refill-request', { patient: p, detail: m.drug }); save(); render(); toast('Refill request sent to your care team.'); },
    'pt-fa': () => { audit('portal-financial-assistance', { patient: mine(me()) }); toast('Application started. A financial counselor will call you within 2 business days.'); }
  });
})(window.Tessera);
