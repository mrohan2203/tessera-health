/* Tessera Health — diagnostics: Laboratory (LIS), Radiology (RIS/PACS), Blood bank. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, esc, clone, P, U, me, nid, pill, statePill, allergyChips, tiles, panel, table, ago, timeStr, toast, audit, openModal, render, save } = T;
  const S = () => T.S;
  const UI = T.UI;

  T.inits.push((s) => {
    const fill = (k, v) => { if (s[k] === undefined) s[k] = clone(v); };
    fill('labOrders', SEED.labOrders); fill('radOrders', SEED.radOrders); fill('bloodUnits', SEED.bloodUnits); fill('crossmatch', SEED.crossmatch);
  });

  const ptCell = (p) => `<b>${esc(p.name)}</b><span class="sub">MRN ${esc(p.mrn)}${p.dob ? ' · DOB ' + p.dob : ''} · ${p.age}${p.sex}</span>`;
  function flagFor(o, v) {
    const x = parseFloat(v); if (isNaN(x)) return '';
    if (o.critHi != null && x >= o.critHi) return 'HH';
    if (o.critLo != null && x <= o.critLo) return 'LL';
    if (o.hi != null && x > o.hi) return 'H';
    if (o.lo != null && x < o.lo) return 'L';
    return '';
  }
  function raiseCritical(patient, test, value, ref, lab, doctor) {
    S().results.unshift({ id: nid('R'), patient, test, value, flag: 'HH', ref, lab, mOff: 0, slaMin: 30, state: 'New', trail: [{ who: me().name, what: `Critical value phoned to ${U(doctor).name}; read-back confirmed`, at: new Date().toISOString() }] });
  }

  /* ======================= Laboratory ======================= */
  VIEWS.lab = (u) => {
    const isPath = u.role === 'pathologist';
    const order = { Resulted: 0, Ordered: 1, Collected: 2, Received: 3, Released: 4 };
    const list = S().labOrders.slice().sort((a, b) => (isPath ? order[a.status] - order[b.status] : 0) || (a.priority === 'STAT' ? -1 : 0) - (b.priority === 'STAT' ? -1 : 0));
    audit('view-lab-worklist', { patients: list.map((o) => T.tok(P(o.patient))).join(' ') });
    const rows = list.map((o) => { const p = P(o.patient);
      let act = '';
      if (!isPath) act = o.status === 'Ordered' ? `<button class="btn small primary" data-act="lab-step" data-o="${o.id}">Collect and label</button>` : o.status === 'Collected' ? `<button class="btn small primary" data-act="lab-step" data-o="${o.id}">Receive in lab</button>` : o.status === 'Received' ? `<button class="btn small primary" data-act="lab-result" data-o="${o.id}">Enter result…</button>` : o.status === 'Resulted' ? '<span class="kpi-note">Waiting for pathologist</span>' : '';
      else act = o.status === 'Resulted' ? `<button class="btn small primary" data-act="lab-verify" data-o="${o.id}">Verify and release…</button>` : '';
      const val = o.value != null ? `<b class="num">${esc(o.value)}</b> ${esc(o.unit)} ${o.flag || flagFor(o, o.value) ? pill((o.flag || flagFor(o, o.value)).length > 1 ? 'crit' : 'warn', o.flag || flagFor(o, o.value)) : ''}` : '<span class="muted">—</span>';
      return `<tr><td>${o.priority === 'STAT' ? pill('crit', 'STAT') : o.priority === 'Urgent' ? pill('warn', 'Urgent') : 'Routine'}</td><td><b>${esc(o.test)}</b><span class="sub mono">${o.id} · LOINC ${o.loinc}</span></td><td>${ptCell(p)}</td><td>${esc(o.specimen)}</td><td>${val}<span class="sub">ref ${esc(o.ref)}</span></td><td>${statePill(o.status)}${o.auto ? '<span class="sub">Autoverified</span>' : ''}${o.releasedBy ? `<span class="sub">${esc(o.releasedBy)}</span>` : ''}</td><td>${act}</td></tr>`; });
    return { title: isPath ? 'Verification queue' : 'Lab worklist', sub: 'Order → collect → receive → result → verify → release', body:
      tiles(SEED.labFlow.map((s) => [S().labOrders.filter((o) => o.status === s).length, s, s === 'Resulted' ? 'warn' : ''])) +
      `<div class="banner info"><p>Results inside the reference range autoverify. Abnormal and critical results wait for a pathologist. Critical values are phoned to the ordering physician with read-back and open a closed-loop result. The lab sees what it needs to label and run specimens, not the chart.</p></div>` +
      panel('Orders', table(['Priority', 'Test', 'Patient', 'Specimen', 'Result', 'Status', ''], rows), '', true) };
  };
  Object.assign(ACT, {
    'lab-step': (d) => { const o = S().labOrders.find((x) => x.id === d.o); o.status = o.status === 'Ordered' ? 'Collected' : 'Received'; audit('lab-' + o.status.toLowerCase(), { patient: P(o.patient), resource: o.id }); save(); render(); toast(o.status === 'Collected' ? 'Specimen labeled with barcode and two identifiers.' : 'Received in lab.'); },
    'lab-result': (d) => { const o = S().labOrders.find((x) => x.id === d.o);
      openModal({ title: `Result · ${o.test}`, form: 'lab-result', submit: 'Save result', body: `<input type="hidden" name="o" value="${o.id}">${o.text ? `<div class="field"><label for="lr">Result</label><select id="lr" name="v"><option>No growth at 24 h</option><option>Gram-negative rods in 1 of 2 bottles</option></select></div>` : `<div class="field"><label for="lr">Value (${esc(o.unit)})</label><input id="lr" name="v" type="number" step="any" required><small>Reference ${esc(o.ref)}${o.critHi != null ? ` · critical ≥ ${o.critHi}` : ''}${o.critLo != null ? ` · critical ≤ ${o.critLo}` : ''}</small></div>`}` }); },
    'lab-verify': (d) => { const o = S().labOrders.find((x) => x.id === d.o); const fl = o.flag || flagFor(o, o.value);
      openModal({ title: `Verify · ${o.test}`, form: 'lab-verify', submit: 'Verify and release', danger: fl.length > 1, body: `<input type="hidden" name="o" value="${o.id}"><p><b class="num" style="font-size:20px">${esc(o.value)}</b> ${esc(o.unit)} ${fl ? pill(fl.length > 1 ? 'crit' : 'warn', fl) : ''} · ref ${esc(o.ref)}</p><p class="muted">${esc(P(o.patient).name)} · ordered by ${esc(U(o.by).name)}</p>${fl.length > 1 ? `<label class="row" style="gap:8px"><input type="checkbox" name="call" required> Critical value phoned to ${esc(U(o.by).name)}; read-back confirmed</label>` : ''}` }); }
  });
  Object.assign(FORMS, {
    'lab-result'(f) { const o = S().labOrders.find((x) => x.id === f.o); o.value = f.v; o.resultedBy = me().name; const fl = o.text ? (/rods/.test(f.v) ? 'A' : '') : flagFor(o, f.v); o.flag = fl;
      if (!fl) { o.status = 'Released'; o.auto = true; o.releasedBy = 'Autoverified by rules'; } else o.status = 'Resulted';
      UI.modal = null; audit('lab-result', { patient: P(o.patient), resource: o.id, detail: fl ? `flag ${fl}, held for verification` : 'autoverified' }); save(); render(); toast(fl ? 'Abnormal result held for pathologist verification.' : 'Normal result autoverified and released.'); },
    'lab-verify'(f) { const o = S().labOrders.find((x) => x.id === f.o); const fl = o.flag || flagFor(o, o.value); o.status = 'Released'; o.releasedBy = me().name; o.flag = fl;
      if (fl.length > 1) raiseCritical(o.patient, o.test, `${o.value} ${o.unit}`, o.ref, 'Laboratory', o.by);
      UI.modal = null; audit('lab-release', { patient: P(o.patient), resource: o.id, detail: fl.length > 1 ? 'critical, phoned with read-back' : '' }); save(); render(); toast(fl.length > 1 ? 'Released. Critical result opened for the ordering physician.' : 'Released to the chart.'); }
  });

  /* ======================= Radiology ======================= */
  function contrastCheck(o) {
    if (!o.contrast) return null; const p = P(o.patient);
    const eg = p.labs.find((l) => l.test === 'eGFR');
    const allergy = p.allergies.find((a) => /contrast|iod/i.test(a.agent));
    if (allergy) return { level: 'warn', text: `Prior reaction to iodinated contrast (${allergy.reaction}). Premedicate or use non-contrast protocol.` };
    if (eg && +eg.value < 30) return { level: 'crit', text: `eGFR ${eg.value}. High risk for contrast nephropathy: change to non-contrast or document why contrast is essential.` };
    return null;
  }
  VIEWS.radiology = (u) => {
    const list = S().radOrders.slice().sort((a, b) => (a.priority === 'STAT' ? -1 : 0) - (b.priority === 'STAT' ? -1 : 0));
    audit('view-rad-worklist', { patients: list.map((o) => T.tok(P(o.patient))).join(' ') });
    const rows = list.map((o) => { const p = P(o.patient); const cc = contrastCheck(o);
      const next = { Ordered: 'Protocol and schedule', Scheduled: 'Patient arrived', Arrived: 'Start exam', 'In progress': 'Complete exam' }[o.status];
      const act = next ? `<button class="btn small" data-act="rad-step" data-o="${o.id}">${next}</button>` : o.status === 'Completed' ? `<button class="btn small primary" data-act="rad-open" data-o="${o.id}">Read and report</button>` : `<button class="btn small" data-act="rad-open" data-o="${o.id}">View report</button>`;
      return `<tr ${UI.radSel === o.id ? 'style="outline:2px solid var(--accent);outline-offset:-2px"' : ''}><td>${o.priority === 'STAT' ? pill('crit', 'STAT') : o.priority === 'Urgent' ? pill('warn', 'Urgent') : 'Routine'}</td><td class="mono">${o.acc}</td><td><b>${o.modality}</b> · ${esc(o.study)}${o.contrast ? '<span class="sub">IV contrast</span>' : ''}</td><td>${ptCell(p)}</td><td>${statePill(o.status)}${cc ? `<span class="sub">${pill(cc.level, 'Contrast check')}</span>` : ''}</td><td>${act}</td></tr>`; });
    let detail = '';
    const o = list.find((x) => x.id === UI.radSel);
    if (o) {
      const p = P(o.patient); const cc = contrastCheck(o); const rep = o.report;
      audit('view-study', { patient: p, resource: o.acc });
      const priors = list.filter((x) => x.patient === p.id && x.id !== o.id).map((x) => `${x.modality} ${x.study} (${x.status})`);
      detail = panel(`${o.acc} · ${esc(o.study)}`, `<div class="grid-2"><div class="stack"><canvas id="rad-canvas" class="viewer" width="512" height="512" data-kind="${o.phantom}" aria-label="Image viewer placeholder"></canvas><span class="kpi-note">PACS viewer placeholder. Production streams DICOM through the server-side proxy, with no images cached on the device.</span></div>
        <div class="stack"><dl class="kv" style="margin:0"><div><dt>Patient</dt><dd style="margin:0">${esc(p.name)} · ${p.age}${p.sex}</dd></div><div><dt>Ordering</dt><dd style="margin:0">${esc(U(o.by).name)}</dd></div><div><dt>Priority</dt><dd style="margin:0">${esc(o.priority)}</dd></div></dl>
          <div><b>Indication</b><p>${esc(o.indication)}</p></div>
          <div class="chips"><span class="muted" style="font-size:12px;margin-right:4px">ALLERGIES</span>${allergyChips(p)}</div>
          ${cc ? `<div class="banner ${cc.level}"><p>${esc(cc.text)}</p></div>` : ''}
          ${priors.length ? `<p class="kpi-note">Other imaging: ${priors.map(esc).join(' · ')}</p>` : ''}
          ${rep && o.status === 'Reported' ? `<div class="note"><b>Final report</b>${rep.critical ? pill('crit', 'Critical finding communicated') : ''}<p><b>Technique.</b> ${esc(rep.technique)}</p><p><b>Findings.</b> ${esc(rep.findings)}</p><p><b>Impression.</b> ${esc(rep.impression)}</p><span class="kpi-note">Signed by ${esc(rep.by)}</span></div>` :
            `<form data-form="rad-report" class="stack"><input type="hidden" name="o" value="${o.id}">
              <div class="field"><label for="rr-t">Technique</label><textarea id="rr-t" name="technique" style="min-height:50px" required>${o.modality} ${esc(o.study.toLowerCase())}.</textarea></div>
              <div class="field"><label for="rr-f">Findings</label><textarea id="rr-f" name="findings" required>${o.phantom === 'sdh' ? 'Crescentic hyperdense extra-axial collection over the right convexity, maximal thickness 11 mm, with 6 mm leftward midline shift. No skull fracture.' : ''}</textarea></div>
              <div class="field"><label for="rr-i">Impression</label><textarea id="rr-i" name="impression" style="min-height:50px" required>${o.phantom === 'sdh' ? 'Acute right subdural hematoma with mass effect.' : ''}</textarea></div>
              <label class="row" style="gap:8px"><input type="checkbox" name="critical" ${o.phantom === 'sdh' ? 'checked' : ''}> Critical finding: phone ordering physician and open a closed-loop result</label>
              <div><button class="btn primary" type="submit">Sign report</button></div></form>`}
        </div></div>`);
    }
    return { title: 'Radiology', sub: 'RIS worklist · reporting · contrast safety', body:
      tiles([[list.filter((x) => x.status === 'Ordered').length, 'To protocol'], [list.filter((x) => ['Scheduled', 'Arrived', 'In progress'].includes(x.status)).length, 'In department'], [list.filter((x) => x.status === 'Completed').length, 'Awaiting report', 'warn'], [list.filter((x) => x.report && x.report.critical).length, 'Critical findings']]) +
      `<div class="banner info"><p>Radiologists see the order, indication, allergies and contrast-relevant labs. Full charts stay with the care team.</p></div>` +
      panel('Worklist', table(['Priority', 'Accession', 'Study', 'Patient', 'Status', ''], rows), '', true) + detail };
  };
  Object.assign(ACT, {
    'rad-step': (d) => { const o = S().radOrders.find((x) => x.id === d.o);
      if (o.status === 'Ordered') { const cc = contrastCheck(o); if (cc && cc.level === 'crit') { openModal({ title: 'Contrast safety check', form: 'rad-protocol', submit: 'Apply and schedule', body: `<input type="hidden" name="o" value="${o.id}"><div class="banner crit"><p>${esc(cc.text)}</p></div><div class="field"><label for="rp">Decision</label><select id="rp" name="how" required><option value="">Choose</option><option value="noncon">Change to non-contrast protocol</option><option value="override">Contrast essential: documented with ordering physician</option></select></div>` }); return; } }
      o.status = SEED.radFlow[SEED.radFlow.indexOf(o.status) + 1]; audit('rad-' + o.status.toLowerCase().replace(' ', '-'), { patient: P(o.patient), resource: o.acc }); save(); render(); },
    'rad-open': (d) => { UI.radSel = d.o; render(); setTimeout(() => { const c = document.getElementById('rad-canvas'); c && c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0); }
  });
  Object.assign(FORMS, {
    'rad-protocol'(f) { const o = S().radOrders.find((x) => x.id === f.o); if (f.how === 'noncon') { o.contrast = false; o.study = o.study.replace(/with IV contrast.*$/i, 'without contrast'); } else o.contrastOverride = true; o.status = 'Scheduled'; UI.modal = null; audit('rad-protocol', { patient: P(o.patient), resource: o.acc, detail: f.how === 'noncon' ? 'changed to non-contrast' : 'contrast override documented' }); save(); render(); },
    'rad-report'(f) { const o = S().radOrders.find((x) => x.id === f.o); o.report = { technique: f.technique, findings: f.findings, impression: f.impression, critical: !!f.critical, by: me().name, at: new Date().toISOString() }; o.status = 'Reported';
      if (f.critical) raiseCritical(o.patient, `${o.modality}: ${o.study}`, f.impression, 'Normal', 'Radiology', o.by);
      audit('rad-report-sign', { patient: P(o.patient), resource: o.acc, detail: f.critical ? 'critical finding' : '' }); save(); render(); toast(f.critical ? 'Report signed. Critical finding sent to the ordering physician.' : 'Report signed.'); }
  });
  // Image viewer placeholder: a simple synthetic phantom per study type
  T.after.push((u, route) => {
    if (route !== 'radiology') return;
    const c = document.getElementById('rad-canvas'); if (!c) return;
    const g = c.getContext('2d'); const k = c.dataset.kind; const W = 512;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    const ell = (x, y, rx, ry, col) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
    if (k === 'sdh') { ell(256, 256, 190, 225, '#e8e8e8'); ell(256, 256, 176, 211, '#7d7d7d'); ell(256, 256, 120, 150, '#6a6a6a'); g.beginPath(); g.ellipse(256, 256, 176, 211, 0, -1.2, 1.2); g.ellipse(250, 256, 160, 205, 0, 1.2, -1.2, true); g.fillStyle = '#cfcfcf'; g.fill(); ell(240, 256, 16, 60, '#333'); }
    else if (k === 'abd') { ell(256, 256, 220, 170, '#5d5d5d'); ell(256, 256, 205, 155, '#777'); ell(256, 330, 30, 26, '#f0f0f0'); ell(350, 230, 26, 22, '#9a9a9a'); ell(170, 230, 60, 50, '#888'); ell(355, 290, 30, 24, '#a9a9a9'); }
    else if (k === 'chest') { ell(256, 256, 230, 180, '#666'); ell(170, 250, 80, 130, '#111'); ell(342, 250, 80, 130, '#111'); ell(270, 280, 60, 70, '#aaa'); ell(256, 400, 30, 22, '#eee'); }
    else if (k === 'us') { g.fillStyle = '#111'; g.beginPath(); g.moveTo(256, 40); g.lineTo(470, 470); g.lineTo(42, 470); g.closePath(); g.fill(); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(200,200,200,${Math.random() * 0.35})`; const y = 60 + Math.random() * 410, sp = (y - 40) * 0.5; g.fillRect(256 + (Math.random() * 2 - 1) * sp, y, 2, 2); } ell(256, 300, 70, 45, '#050505'); }
    else { g.fillStyle = '#222'; g.fillRect(0, 0, W, W); ell(256, 256, 120, 230, '#3a3a3a'); g.fillStyle = '#ddd'; g.fillRect(226, 40, 60, 432); g.fillStyle = '#bbb'; g.fillRect(150, 300, 212, 40); }
    g.fillStyle = '#9ad'; g.font = '13px monospace'; g.fillText('TESSERA PACS · DEMO PHANTOM', 12, 22); g.fillText('W:400 L:40', 12, 500);
  });

  /* ======================= Blood bank ======================= */
  const COMPAT = { 'O-': ['O-'], 'O+': ['O+', 'O-'], 'A-': ['A-', 'O-'], 'A+': ['A+', 'A-', 'O+', 'O-'], 'B-': ['B-', 'O-'], 'B+': ['B+', 'B-', 'O+', 'O-'], 'AB-': ['AB-', 'A-', 'B-', 'O-'], 'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'] };
  const unitStatus = (x) => x.issued ? 'Issued' : x.expDays < 0 ? 'Quarantined — expired' : x.reservedFor ? 'Reserved' : 'Available';
  VIEWS.bloodbank = (u) => {
    const units = S().bloodUnits;
    const avail = units.filter((x) => unitStatus(x) === 'Available' && x.product === 'PRBC');
    const groups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((g) => [avail.filter((x) => x.group === g).length, `${g} PRBC`, avail.filter((x) => x.group === g).length === 0 ? 'warn' : '']);
    const uRows = units.slice().sort((a, b) => a.expDays - b.expDays).map((x) => { const st = unitStatus(x); return `<tr><td class="mono">${esc(x.id)}</td><td><b>${x.group}</b></td><td>${x.product}</td><td>${T.dayStr(x.expDays)}<span class="sub">${x.expDays < 0 ? `expired ${-x.expDays} d ago` : `in ${x.expDays} d`}</span></td><td>${pill(st === 'Available' ? 'ok' : st === 'Reserved' ? 'warn' : st === 'Issued' ? 'info' : 'crit', st)}${st.startsWith('Quarantined') ? '<span class="sub">Blocked from crossmatch and issue</span>' : ''}</td></tr>`; });
    const xRows = S().crossmatch.map((x) => { const p = P(x.patient);
      const act = x.state === 'Requested' ? `<button class="btn small primary" data-act="bb-xm" data-x="${x.id}">Type and crossmatch</button>` : x.state === 'Crossmatched' ? `<button class="btn small primary" data-act="bb-issue" data-x="${x.id}">Issue…</button>` : '';
      return `<tr><td>${ptCell(p)}</td><td><b>${esc(p.bloodGroup)}</b></td><td>${x.units} × ${x.product}<span class="sub">${esc(x.reason)}</span></td><td>${esc(U(x.by).name)}<span class="sub">${ago(x.reqOff)}</span></td><td>${statePill(x.state)}${x.unitIds ? `<span class="sub mono">${x.unitIds.map(esc).join(', ')}</span>` : ''}</td><td>${act}</td></tr>`; });
    return { title: 'Blood bank', sub: 'Inventory · type and crossmatch · two-person issue', body:
      `<div class="tiles">${groups.map(([n, l, c]) => `<div class="tile ${c}"><b>${n}</b><span>${l}</span></div>`).join('')}</div>` +
      `<div class="banner warn"><p>${units.filter((x) => x.expDays < 0).length} expired unit(s) quarantined automatically. Expired units can't be crossmatched or issued.</p></div>` +
      panel('Crossmatch and issue', table(['Patient', 'Group', 'Request', 'Ordered by', 'State', ''], xRows), '', true) +
      panel('Units by expiry', table(['Unit number', 'Group', 'Product', 'Expiry', 'Status'], uRows), '', true) };
  };
  Object.assign(ACT, {
    'bb-xm': (d) => { const x = S().crossmatch.find((y) => y.id === d.x); const p = P(x.patient);
      const ok = S().bloodUnits.filter((v) => v.product === x.product && unitStatus(v) === 'Available' && (COMPAT[p.bloodGroup] || []).includes(v.group)).sort((a, b) => (a.group === p.bloodGroup ? -1 : 1) - (b.group === p.bloodGroup ? -1 : 1) || a.expDays - b.expDays);
      const expiredSame = S().bloodUnits.filter((v) => v.group === p.bloodGroup && v.expDays < 0);
      if (ok.length < x.units) { toast(`Not enough compatible ${p.bloodGroup} units in date. Order from the regional supplier.`); return; }
      const pick = ok.slice(0, x.units); pick.forEach((v) => { v.reservedFor = x.id; }); x.unitIds = pick.map((v) => v.id); x.state = 'Crossmatched';
      audit('bb-crossmatch', { patient: p, detail: `${pick.map((v) => v.group).join(', ')} for recipient ${p.bloodGroup}` }); save(); render();
      toast(expiredSame.length ? `Crossmatched with ${pick.map((v) => v.group).join(', ')}. The expired ${p.bloodGroup} unit was skipped.` : 'Crossmatched.'); },
    'bb-issue': (d) => { const x = S().crossmatch.find((y) => y.id === d.x); const others = S().users.filter((v) => v.id !== me().id && ['nurse', 'lab', 'pathologist', 'doctor'].includes(v.role) && v.status === 'active');
      openModal({ title: 'Issue blood · two-person check', form: 'bb-issue', submit: 'Issue units', body: `<input type="hidden" name="x" value="${x.id}"><p>${x.units} × ${x.product} for <b>${esc(P(x.patient).name)}</b> (${esc(P(x.patient).bloodGroup)})</p>
        ${['Patient wristband matches the request (name, MRN, DOB)', 'Unit numbers match the crossmatch record', 'ABO/Rh compatible', 'Units in date and visually intact'].map((t, i) => `<label class="row" style="gap:8px"><input type="checkbox" name="c${i}" required> ${t}</label>`).join('')}
        <div class="field"><label for="bw">Second verifier</label><select id="bw" name="w" required><option value="">Choose</option>${others.map((v) => `<option>${esc(v.name)}</option>`).join('')}</select></div>` }); }
  });
  FORMS['bb-issue'] = (f) => { const x = S().crossmatch.find((y) => y.id === f.x); x.state = 'Issued'; x.issuedBy = me().name; x.verifiedBy = f.w; /* the server checks the second verifier */ S().bloodUnits.filter((v) => (x.unitIds || []).includes(v.id)).forEach((v) => { v.issued = true; }); UI.modal = null; audit('bb-issue', { patient: P(x.patient), detail: `verified with ${f.w}` }); save(); render(); toast('Issued. Transfusion start time is charted on the eMAR.'); };

  /* ---------- homes ---------- */
  T.HOME.lab = T.HOME.pathologist = (u) => {
    const lo = S().labOrders;
    return { title: u.role === 'pathologist' ? 'Laboratory · pathologist' : 'Laboratory', sub: `${T.dayStr(0)} · specimen to result`, body:
      tiles([[lo.filter((o) => o.priority === 'STAT' && o.status !== 'Released').length, 'STAT open', 'crit'], [lo.filter((o) => o.status === 'Ordered').length, 'Awaiting collection'], [lo.filter((o) => ['Collected', 'Received'].includes(o.status)).length, 'In lab'], [lo.filter((o) => o.status === 'Resulted').length, 'Awaiting verification', 'warn'], [lo.filter((o) => o.status === 'Released').length, 'Released'], [S().crossmatch.filter((x) => x.state !== 'Issued').length, 'Blood requests open']]) +
      `<div class="row"><a class="btn primary" href="#lab">${u.role === 'pathologist' ? 'Open verification queue' : 'Open worklist'}</a><a class="btn" href="#bloodbank">Blood bank</a></div>` };
  };
  T.HOME.radiologist = (u) => {
    const r = S().radOrders;
    return { title: 'Radiology', sub: `${T.dayStr(0)} · ${esc(u.name)}`, body:
      tiles([[r.filter((o) => o.priority === 'STAT' && o.status !== 'Reported').length, 'STAT open', 'crit'], [r.filter((o) => o.status === 'Completed').length, 'Awaiting report', 'warn'], [r.filter((o) => o.status === 'Ordered').length, 'To protocol'], [r.filter((o) => o.status === 'Reported').length, 'Reported']]) + `<div><a class="btn primary" href="#radiology">Open worklist</a></div>` };
  };
  Object.assign(T.counts, {
    lab: (u) => { const n = S().labOrders.filter((o) => u.role === 'pathologist' ? o.status === 'Resulted' : ['Ordered', 'Collected', 'Received'].includes(o.status)).length; return n ? `<span class="count">${n}</span>` : ''; },
    radiology: () => { const n = S().radOrders.filter((o) => o.status === 'Completed').length; return n ? `<span class="count crit">${n}</span>` : ''; },
    bloodbank: () => { const n = S().crossmatch.filter((x) => x.state !== 'Issued').length; return n ? `<span class="count">${n}</span>` : ''; }
  });
})(window.Tessera);
