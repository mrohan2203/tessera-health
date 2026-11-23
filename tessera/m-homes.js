/* Tessera Health — role home visuals. Each role's home opens with a picture of its own work,
   drawn in the same tile language, above the existing stat tiles and lists. Access rules are
   unchanged: every visual reads only what that role's home already shows. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, esc, P, U, pill, money, toMin, nowMin, careRel, UNIT, DEPT } = T;
  const S = () => T.S;
  const initials = (n) => n.replace(/^Dr\.\s*/, '').replace(/,.*$/, '').split(/[\s·]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('');
  const hero = (title, sub, inner, extra = '') => `<section class="hero"><div class="hero-head"><div><h2>${title}</h2>${sub ? `<span class="kpi-note">${sub}</span>` : ''}</div>${extra}</div>${inner}</section>`;

  /* ---------- shared components ---------- */
  // Gantt lanes: rows of {label, items:[{start, mins, label, sub, cls, href}]}
  function lanes(rows, h0, h1) {
    const span = (h1 - h0) * 60; const pos = (m) => Math.max(0, Math.min(100, (m - h0 * 60) / span * 100));
    const nm = nowMin(); const hours = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
    return `<div class="lanes" style="--cols:${hours.length}"><div class="lanes-axis"><span></span><div>${hours.map((h) => `<i>${String(h).padStart(2, '0')}</i>`).join('')}</div></div>
      ${rows.map((r) => `<div class="lane"><span class="lane-label">${esc(r.label)}</span><div class="lane-track">${nm >= h0 * 60 && nm <= h1 * 60 ? `<b class="lane-now" style="left:${pos(nm)}%"></b>` : ''}${r.items.map((it) => `<a class="lane-item ${it.cls || ''}" href="${it.href || '#'}" style="left:${pos(it.start)}%;width:${Math.max(4, pos(it.start + it.mins) - pos(it.start))}%" title="${esc(it.label + (it.sub ? ' · ' + it.sub : ''))}"><b>${esc(it.label)}</b>${it.sub ? `<span>${esc(it.sub)}</span>` : ''}</a>`).join('')}</div></div>`).join('')}</div>`;
  }
  // Pipeline: [{label, n, cls, chips:[...]}]
  const flow = (stages) => `<div class="flow">${stages.map((s, i) => `<div class="flow-stage ${s.cls || ''}"><span class="flow-n">${s.n}</span><span class="flow-l">${esc(s.label)}</span>${s.chips && s.chips.length ? `<div class="flow-chips">${s.chips.join('')}</div>` : ''}</div>${i < stages.length - 1 ? '<span class="flow-arrow" aria-hidden="true"></span>' : ''}`).join('')}</div>`;
  const ring = (pct, label, sub, cls = '', target) => `<div class="ringcard"><div class="ring ${cls}" style="--p:${Math.max(0, Math.min(100, pct))}${target != null ? `;--t:${target}` : ''}" role="img" aria-label="${esc(label)} ${Math.round(pct)}%"><span>${Math.round(pct)}<small>%</small></span>${target != null ? '<i class="ring-target"></i>' : ''}</div><b>${esc(label)}</b>${sub ? `<span class="kpi-note">${sub}</span>` : ''}</div>`;
  const stackbar = (parts) => { const tot = parts.reduce((n, p) => n + p.v, 0) || 1; return `<div class="stackbar">${parts.filter((p) => p.v > 0).map((p) => `<i class="${p.cls}" style="flex:${p.v}" title="${esc(p.label)}"></i>`).join('')}</div><div class="legend">${parts.map((p) => `<span><i class="${p.cls}"></i>${esc(p.label)} <b>${p.fmt ? p.fmt(p.v) : p.v}</b> <span class="muted">${Math.round(p.v / tot * 100)}%</span></span>`).join('')}</div>`; };
  const kanban = (cols) => `<div class="kanban">${cols.map((c) => `<div class="kcol"><div class="khead"><span class="ksq ${c.cls || ''}"></span>${esc(c.label)}<b>${c.cards.length}</b></div>${c.cards.join('') || '<span class="kpi-note">None</span>'}</div>`).join('')}</div>`;

  /* ---------- nurse: unit floor map ---------- */
  function medsDue(p) { return SEED.mar.filter((m) => m.patient === p.id).reduce((n, m) => n + m.times.filter((t) => T.marState(m, t) === 'Due').length, 0); }
  function bedmap(u, unit) {
    const beds = SEED.beds.filter((b) => b.unit === unit);
    return `<div class="bedmap">${beds.map((b) => {
      const p = T.allPts().find((x) => x.unit === b.unit && x.bed === b.bed && x.status !== 'Discharged');
      const st = S().bedStatus[b.bed];
      if (!p) return `<div class="bt empty ${st ? 'st-' + st.toLowerCase() : ''}"><span class="bt-bed">${esc(b.bed)}</span><span class="bt-state">${esc(st || 'Available')}</span></div>`;
      if (!careRel(u, p)) return `<div class="bt other"><span class="bt-bed">${esc(b.bed)}</span><span class="bt-state">Occupied</span></div>`;
      const n = T.news2 ? T.news2(p) : { sc: 0, risk: 'Low' }; const due = medsDue(p);
      const iso = (SEED.isolation || []).some((i) => i.patient === p.id);
      return `<a class="bt news-${n.risk.toLowerCase().replace(/[^a-z]/g, '')} ${iso ? 'iso' : ''}" href="#patient-${p.id}-overview"><span class="bt-bed">${esc(b.bed)}</span><span class="bt-score" title="NEWS2">${n.sc}</span>
        <b class="bt-name">${esc(p.name)}</b><span class="bt-dx">${esc(p.problems[0].split(' (')[0])}</span>
        <span class="bt-flags">${p.allergies.length || p.allergiesUnknown ? '<i class="f red" title="Allergy"></i>' : ''}${p.code !== 'Full code' ? '<i class="f purple" title="' + esc(p.code) + '"></i>' : ''}${p.allergies.some((a) => /latex/i.test(a.agent)) ? '<i class="f green" title="Latex"></i>' : ''}${iso ? '<i class="f grey" title="Isolation"></i>' : ''}${due ? `<em>${due} med${due > 1 ? 's' : ''} due</em>` : '<em class="ok">Meds up to date</em>'}</span></a>`;
    }).join('')}</div><div class="legend"><span><i class="nw-low"></i>NEWS2 low</span><span><i class="nw-mid"></i>Low–medium / medium</span><span><i class="nw-high"></i>High</span><span><i class="f red"></i>Allergy</span><span><i class="f purple"></i>DNR</span><span><i class="f grey"></i>Isolation</span></div>`;
  }

  /* ---------- per-role visuals ---------- */
  const DUR = { 27447: 120, 47562: 90, 44970: 60 };
  const V = {
    doctor(u) {
      if (u.dept === 'SURG') return V.nurse({ unit: 'PERIOP', role: 'nurse' }).split('<section class="hero"><div class="hero-head"><div><h2>Day care bays')[0];
      if (u.dept !== 'EMER') return '';
      const er = S().er.filter((e) => !['Discharged', 'Admitted'].includes(e.status)).sort((a, b) => a.esi - b.esi || b.mOff - a.mOff);
      const cards = er.map((e) => { const p = P(e.patient); const tgt = SEED.esiTarget[e.esi]; const pct = tgt ? Math.min(100, e.mOff / tgt * 100) : 100; const late = !e.provider && e.mOff > tgt;
        return `<a class="ercard ${late ? 'late' : ''}" href="#patient-${p.id}-overview"><span class="esi esi${e.esi}">${e.esi}</span><div class="ercard-body"><b>${esc(p.name)}</b><span class="kpi-note">${esc(e.complaint)}</span><div class="waitbar"><i style="width:${pct}%"></i></div><span class="kpi-note">${e.mOff} min${tgt ? ` of ${tgt}-min target` : ' · immediate'} · ${e.provider ? esc(U(e.provider).name) : 'no provider'}</span></div></a>`; }).join('');
      return hero('Emergency department', 'Sorted by acuity; the bar fills toward each level\'s time-to-provider target', `<div class="ergrid">${cards}</div>`, '<a class="btn small primary" href="#er">Open board</a>');
    },
    nurse(u) {
      if (u.unit === 'PERIOP') {
        const rows = ['OR-1', 'OR-2', 'OR-3'].map((r) => ({ label: r, items: S().ot.filter((c) => c.room === r).map((c) => { const p = P(c.patient); return { start: toMin(c.scheduled), mins: DUR[c.cpt] || 90, label: c.procedure.split(',')[0].split('(')[0], sub: `${p.name} · ${c.stage}`, cls: 'stage-' + c.stage.toLowerCase().replace(/\s/g, ''), href: '#ot' }; }) }));
        const dc = S().daycare.filter((d) => d.phase !== 'Discharged');
        return hero('Operating rooms today', 'Blocks show scheduled start and expected length; color is the stage', lanes(rows, 6, 19)) +
          hero('Day care bays', `${dc.length} of 12 bays in use`, kanban(SEED.dayPhases.slice(0, 4).map((ph, i) => ({ label: ph, cls: 'k' + i, cards: dc.filter((d) => d.phase === ph).map((d) => { const p = P(d.patient); return `<a class="kcard" href="#daycare"><b>${esc(p.bed)} · ${esc(p.name)}</b><span>${esc(d.procedure)}</span></a>`; }) }))));
      }
      return hero(`${UNIT[u.unit]} · floor`, 'Each tile is a bed: color is NEWS2 acuity, dots are wristband alerts', bedmap(u, u.unit));
    },
    pharmacist() {
      const meds = S().orders.filter((o) => o.type === 'Medication');
      const st = { flagged: meds.filter((o) => o.status === 'Pending signature' && o.flag).length, pend: meds.filter((o) => o.status === 'Pending signature' && !o.flag).length, toVerify: meds.filter((o) => o.status === 'Signed' && !S().verified[o.id]).length, verified: meds.filter((o) => S().verified[o.id]).length };
      const shelf = SEED.inventory.map((i) => { const cls = i.expDays < 0 ? 'crit' : i.qty < i.reorder ? 'warn' : i.expDays <= 60 ? 'soon' : 'ok'; return `<div class="shelf-item ${cls}" title="${esc(i.item)} · lot ${i.lot}"><b>${esc(i.item.split(' ').slice(0, 2).join(' '))}</b><span>${i.expDays < 0 ? 'Expired · quarantined' : i.qty < i.reorder ? `${i.qty} left · reorder` : i.expDays <= 60 ? `Expires in ${i.expDays} d` : `${i.qty.toLocaleString()} on hand`}</span></div>`; }).join('');
      return hero('Medication order flow', 'From prescriber to dispensing', flow([{ label: 'Safety flag, awaiting prescriber', n: st.flagged, cls: st.flagged ? 'crit' : '' }, { label: 'Awaiting signature', n: st.pend }, { label: 'Signed, to verify', n: st.toVerify, cls: st.toVerify ? 'warn' : '' }, { label: 'Verified, released', n: st.verified, cls: 'ok' }]), '<a class="btn small primary" href="#verify">Open queue</a>') +
        hero('Shelf health', 'Lots sorted by risk: expired lots are blocked from dispensing', `<div class="shelf">${shelf}</div>`);
    },
    lab(u) {
      const lo = S().labOrders; const chip = (o) => `<span class="chip ${o.priority === 'STAT' ? 'stat' : ''}" title="${esc(o.test)}">${esc(o.test.split(' ')[0])} · ${esc(initials(P(o.patient).name))}</span>`;
      return hero('Specimen pipeline', 'STAT specimens are outlined in red', flow(SEED.labFlow.map((s) => ({ label: s === 'Resulted' ? (u.role === 'pathologist' ? 'Needs your verification' : 'Awaiting pathologist') : s, n: lo.filter((o) => o.status === s).length, cls: s === 'Resulted' ? 'warn' : s === 'Released' ? 'ok' : '', chips: lo.filter((o) => o.status === s && s !== 'Released').map(chip) }))), `<a class="btn small primary" href="#lab">Open ${u.role === 'pathologist' ? 'verification' : 'worklist'}</a>`);
    },
    radiologist() {
      const r = S().radOrders; const mods = ['CT', 'XR', 'US', 'MRI'];
      const tilesHtml = mods.map((m) => { const xs = r.filter((o) => o.modality === m); const wait = xs.filter((o) => o.status === 'Completed').length;
        return `<div class="modtile ${wait ? 'hot' : ''}"><span class="mod">${m}</span><b>${xs.length}</b><span class="kpi-note">${wait ? `${wait} waiting for your read` : xs.length ? 'Nothing to read' : 'No orders today'}</span><div class="dots">${xs.map((o) => `<i class="d-${o.status.toLowerCase().replace(/\s/g, '')}" title="${esc(o.study)} · ${o.status}"></i>`).join('')}</div></div>`; }).join('');
      return hero('By modality', 'Dots are studies, colored by stage', `<div class="modgrid">${tilesHtml}</div>`) + hero('Study flow', '', flow(SEED.radFlow.map((s) => ({ label: s === 'Completed' ? 'Ready to read' : s, n: r.filter((o) => o.status === s).length, cls: s === 'Completed' ? 'warn' : s === 'Reported' ? 'ok' : '' }))), '<a class="btn small primary" href="#radiology">Open worklist</a>');
    },
    receptionist() {
      const a = S().appts.slice().sort((x, y) => x.time.localeCompare(y.time));
      const card = (x) => { const p = P(x.patient); return `<div class="kcard"><b>${x.time} · ${esc(p.name)}</b><span>${esc(U(x.provider).name)}</span></div>`; };
      return hero('Front desk flow', 'Visit reasons stay with the care team', kanban([{ label: 'Expected', cls: 'k0', cards: a.filter((x) => x.status === 'Scheduled').map(card) }, { label: 'Checked in / waiting', cls: 'k1', cards: a.filter((x) => ['Arrived', 'Waiting'].includes(x.status)).map(card) }, { label: 'With clinician', cls: 'k2', cards: a.filter((x) => x.status === 'In room').map(card) }, { label: 'Done', cls: 'k3', cards: a.filter((x) => x.status === 'Completed').map(card) }, { label: 'No-show', cls: 'k4', cards: a.filter((x) => ['No-show', 'Rescheduled'].includes(x.status)).map(card) }]));
    },
    billing() {
      const c = S().claims; const sum = (f) => c.filter(f).reduce((n, x) => n + x.charge, 0);
      return hero('Accounts receivable', 'Open charges by where they sit in the revenue cycle', stackbar([{ label: 'Open encounter', v: sum((x) => x.status === 'Open encounter'), cls: 'sb1', fmt: money }, { label: 'Prior auth pending', v: sum((x) => x.status === 'Prior auth pending'), cls: 'sb2', fmt: money }, { label: 'Ready to submit', v: sum((x) => x.status === 'Ready to submit'), cls: 'sb3', fmt: money }, { label: 'Submitted', v: sum((x) => x.status === 'Submitted'), cls: 'sb4', fmt: money }, { label: 'Denied', v: sum((x) => x.status === 'Denied'), cls: 'sbx', fmt: money }])) +
        hero('Claim journey', '', flow([{ label: 'Open', n: c.filter((x) => x.status === 'Open encounter').length }, { label: 'Ready', n: c.filter((x) => x.status === 'Ready to submit').length }, { label: 'Submitted', n: c.filter((x) => x.status === 'Submitted').length }, { label: 'Paid', n: c.filter((x) => x.status === 'Paid').length, cls: 'ok' }, { label: 'Denied', n: c.filter((x) => x.status === 'Denied').length, cls: 'crit' }]));
    },
    insurance() {
      return hero('Cases', 'Dots are required documents: filled when attached', `<div class="casegrid">${S().insCases.map((c) => { const p = P(c.patient); const done = c.docs.filter((d) => d.ok).length; return `<a class="casecard ${c.status === 'Payer query' ? 'hot' : c.status === 'Approved' ? 'done' : ''}" href="#insurance" data-act="ins-open" data-c="${c.id}"><span class="mono kpi-note">${c.id} · ${esc(c.kind)}</span><b>${esc(p.name)}</b><span>${esc(c.payer)} · ${money(c.amount)}</span><div class="docdots">${c.docs.map((d) => `<i class="${d.ok ? 'on' : d.req ? 'req' : ''}" title="${esc(d.n)}"></i>`).join('')}<span class="kpi-note">${done}/${c.docs.length}</span></div>${pill(c.status === 'Approved' ? 'ok' : c.status === 'Payer query' ? 'crit' : 'warn', c.status)}</a>`; }).join('')}</div>`);
    },
    quality() {
      return hero('HEDIS measures', 'Ring = current rate; notch = target', `<div class="ringgrid">${SEED.measures.map((m) => { const r = m.num / m.den * 100; const ok = m.inverse ? r <= m.target : r >= m.target; return ring(r, m.code, `${esc(m.name)}${m.inverse ? ' · lower is better' : ''}`, ok ? 'good' : 'bad', m.target); }).join('')}</div>`, '<a class="btn small primary" href="#measures">All measures</a>');
    },
    admin(u) {
      const users = S().users; const mfa = users.filter((x) => x.mfa !== 'Not enrolled').length / users.length * 100;
      const chain = T.verifyChain(); const rev = S().btg.length ? S().btg.filter((g) => g.reviewed).length / S().btg.length * 100 : 100;
      const appr = S().roleRequests.filter((r) => r.status !== 'pending').length; const rq = S().roleRequests.length;
      const hours = Array.from({ length: 12 }, (_, i) => { const h = new Date(); h.setMinutes(0, 0, 0); h.setHours(h.getHours() - (11 - i)); return h; });
      const counts = hours.map((h) => S().audit.filter((e) => { const t = new Date(e.ts); return t >= h && t < new Date(h.getTime() + 3600e3); }).length);
      const denied = hours.map((h) => S().audit.filter((e) => { const t = new Date(e.ts); return e.outcome !== 'success' && t >= h && t < new Date(h.getTime() + 3600e3); }).length);
      const mx = Math.max(1, ...counts);
      return hero('Security posture', chain.ok ? `Audit chain intact · ${chain.n} events` : `Audit chain broken at event ${chain.at}`, `<div class="ringgrid">${ring(mfa, 'MFA enrolled', `${users.filter((x) => x.mfa !== 'Not enrolled').length} of ${users.length} accounts`, mfa === 100 ? 'good' : 'bad')}${ring(rev, 'Break-the-glass reviewed', `${S().btg.filter((g) => !g.reviewed).length} waiting`, rev === 100 ? 'good' : 'bad')}${ring(rq ? appr / rq * 100 : 100, 'Role changes decided', `${rq - appr} need a second approver`, rq === appr ? 'good' : 'bad')}${ring(S().reviewSigned ? 100 : Object.keys(S().review).length / Math.max(1, users.length - 1) * 100, 'Q4 access review', S().reviewSigned ? 'Signed off' : 'In progress', S().reviewSigned ? 'good' : 'bad')}</div>`) +
        hero('Record access, last 12 hours', 'Red = denied or blocked attempts', `<div class="bars">${counts.map((c, i) => `<div class="bar-col" title="${c} events, ${denied[i]} denied"><i style="height:${c / mx * 100}%"><em style="height:${c ? denied[i] / c * 100 : 0}%"></em></i><span>${String(hours[i].getHours()).padStart(2, '0')}</span></div>`).join('')}</div>`, '<a class="btn small primary" href="#audit">Audit log</a>');
    },
    executive() {
      const units = ['CICU', 'W4B', 'PEDW', 'PACU'];
      const pts = T.allPts();
      const mos = units.map((un) => { const beds = SEED.beds.filter((b) => b.unit === un); const occ = beds.filter((b) => pts.some((p) => p.unit === un && p.bed === b.bed && p.status !== 'Discharged')).length;
        return `<div class="hm-unit"><div class="hm-sq">${beds.map((b) => { const o = pts.some((p) => p.unit === un && p.bed === b.bed && p.status !== 'Discharged'); const st = S().bedStatus[b.bed]; return `<i class="${o ? 'occ' : st ? 'blk' : ''}"></i>`; }).join('')}</div><b>${esc(UNIT[un])}</b><span class="kpi-note">${occ}/${beds.length} beds</span></div>`; }).join('');
      const er = S().er.filter((e) => !['Discharged', 'Admitted'].includes(e.status));
      return hero('Hospital at a glance', 'One square per bed · filled = occupied · amber = cleaning, reserved or maintenance', `<div class="hm">${mos}</div>`) +
        hero('Emergency department by acuity', `${er.length} in department`, stackbar([1, 2, 3, 4, 5].map((l) => ({ label: `ESI ${l}`, v: er.filter((e) => e.esi === l).length, cls: 'esib' + l }))));
    },
    patient(u) {
      const p = P(u.patientId); const c = S().ot.find((x) => x.patient === p.id);
      const steps = c ? SEED.otStages : null; const i = c ? steps.indexOf(c.stage) : -1;
      const msg = c ? { Scheduled: 'Your surgery is scheduled.', Preparation: 'You are being prepared for surgery.', 'In surgery': 'Your surgery is in progress.', Recovery: 'You are in the recovery room. Your family can see this update.', Completed: `Surgery done. You are in ${UNIT[p.unit]}${p.bed ? ', bed ' + p.bed : ''}.` }[c.stage] : p.status === 'Admitted' ? `You are in ${UNIT[p.unit]}.` : 'No hospital stay right now.';
      return `<section class="hero patient-hero"><div class="hero-head"><div><span class="eyebrow">Today</span><h2>${esc(msg)}</h2></div></div>
        ${c ? `<div class="journey">${steps.map((s, k) => `<div class="jstep ${k < i ? 'done' : k === i ? 'now' : ''}"><i></i><span>${esc(s)}</span></div>`).join('')}</div><p class="kpi-note">${esc(c.procedure)} with ${esc(U(c.surgeon).name)}</p>` : ''}
        <div class="team">${[U(p.attending)].concat(p.consults.map((d) => S().users.find((x) => x.dept === d && x.role === 'doctor'))).filter(Boolean).map((x) => `<div class="tm"><span class="usertile role-${x.role}">${esc(initials(x.name))}</span><div><b>${esc(x.name)}</b><span class="kpi-note">${esc(x.title)}</span></div></div>`).join('')}</div></section>`;
    }
  };
  V.pathologist = V.lab;
  T.ui = { hero, lanes, flow, ring, stackbar, kanban };
  T.ACT['ins-open'] = (d) => { T.UI.insSel = d.c; location.hash = 'insurance'; };

  const baseHome = VIEWS.home;
  VIEWS.home = (u, args) => {
    const v = baseHome(u, args);
    const fn = V[u.role];
    if (fn) { try { v.body = fn(u) + v.body; } catch (e) { console.error(e); } }
    return v;
  };
})(window.Tessera);
