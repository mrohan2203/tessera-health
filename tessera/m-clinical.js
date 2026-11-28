/* Tessera Health — clinical modules: Ambient Doctor, Telemedicine, ER, ICU, Bed board,
   Handover (ISBAR), Clinical pathways, Discharge orchestrator, OT suite, Day care. */
(function (T) {
  'use strict';
  const { SEED, VIEWS, ACT, FORMS, esc, clone, P, U, me, nid, pill, statePill, allergyChips, tiles, panel, table, ago, timeStr, toast, audit, careRel, openModal, render, save, DEPT, UNIT } = T;
  const S = () => T.S;
  const UI = T.UI;

  T.inits.push((s) => {
    const fill = (k, v) => { if (s[k] === undefined) s[k] = clone(v); };
    fill('er', SEED.er); fill('ot', SEED.ot); fill('daycare', SEED.daycare); fill('handovers', SEED.handovers);
    fill('pathways', SEED.pathways); fill('discharges', SEED.discharges); fill('tele', SEED.tele); fill('rpm', SEED.rpm);
    fill('bedStatus', SEED.bedStatus); fill('bedRequests', []); fill('extraPatients', []); fill('patientPatches', {});
    fill('erx', [{ patient: 'P06', drug: 'Albuterol HFA 90 mcg, 2 puffs q4–6h PRN', pharmacy: 'Bayview Outpatient Pharmacy', by: 'U-2002', status: 'Sent (NCPDP SCRIPT)', controlled: false }, { patient: 'P09', drug: 'Mupirocin 2% ointment, apply BID', pharmacy: 'Bayview Outpatient Pharmacy', by: 'U-2002', status: 'Sent (NCPDP SCRIPT)', controlled: false }]);
    if (s.consents === undefined) {
      s.consents = [
        { patient: 'P08', kind: 'Surgical consent — left total knee arthroplasty', state: 'Done', by: 'Dr. Caroline Weiss', at: T.iso(1440), detail: 'Risks, benefits, alternatives discussed; interpreter not needed' },
        { patient: 'P07', kind: 'Surgical consent — laparoscopic cholecystectomy', state: 'Done', by: 'Dr. Caroline Weiss', at: T.iso(2880), detail: 'Includes possible conversion to open' },
        { patient: 'P03', kind: 'Surgical consent — laparoscopic appendectomy', state: 'Done', by: 'Dr. Caroline Weiss', at: T.iso(420) },
        { patient: 'P21', kind: 'Blood transfusion consent', state: 'Done', by: 'Dr. Samuel Okafor', at: T.iso(10080), detail: 'Valid for series, 12 months' },
        { patient: 'P02', kind: 'Research — cardiac outcomes registry', state: 'Declined', by: 'Dr. Elena Marsh', at: T.iso(2000), detail: 'Record excluded from registry extracts' }
      ];
    }
    fill('ambientNotes', []);
  });

  /* ---------- helpers ---------- */
  const f2c = (f) => (f - 32) * 5 / 9;
  function news2(p) {
    const v = p.vitals; const sbp = +String(v.bp).split('/')[0]; const t = f2c(v.temp);
    let sc = 0, three = false;
    const add = (n) => { sc += n; if (n === 3) three = true; };
    add(v.rr <= 8 ? 3 : v.rr <= 11 ? 1 : v.rr <= 20 ? 0 : v.rr <= 24 ? 2 : 3);
    add(v.spo2 <= 91 ? 3 : v.spo2 <= 93 ? 2 : v.spo2 <= 95 ? 1 : 0);
    if (RESP[p.id]) add(2);
    add(sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3);
    add(v.hr <= 40 ? 3 : v.hr <= 50 ? 1 : v.hr <= 90 ? 0 : v.hr <= 110 ? 1 : v.hr <= 130 ? 2 : 3);
    add(t <= 35 ? 3 : t <= 36 ? 1 : t <= 38 ? 0 : t <= 39 ? 1 : 2);
    if (p.avpu && p.avpu !== 'A') add(3);
    const risk = sc >= 7 ? 'High' : sc >= 5 ? 'Medium' : three ? 'Low-medium' : 'Low';
    return { sc, risk };
  }
  T.news2 = news2;
  const RESP = { P04: 'BiPAP (DNI)', P01: 'Nasal cannula 2 L/min', P13: 'Nasal cannula 4 L/min' };
  const newsPill = (n) => pill(n.risk === 'High' ? 'crit' : n.risk === 'Medium' ? 'warn' : n.risk === 'Low-medium' ? 'warn' : 'ok', `NEWS2 ${n.sc} · ${n.risk}`);
  const ptLink = (p, tab = 'overview') => `<a href="#patient-${p.id}-${tab}">${esc(p.name)}</a>`;
  const mins = (m) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;

  /* ======================= Ambient Doctor ======================= */
  // Live capture: the published page uses the platform's `dictation` capability (Anthropic speech-to-text);
  // a local copy falls back to the browser's Web Speech API. Drafting uses Claude through `sample`,
  // and falls back to a rule-based draft where Claude isn't available. Role-play only: no BAA covers either path.
  T.caps = T.caps || {};
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const inViewer = !!(window.claude && window.claude.use);
  const asFile = location.protocol === 'file:';
  if (inViewer) {
    window.claude.use('dictation').then((d) => {
      T.caps.dictation = d; if (!d) return;
      d.onPartial(({ text }) => { const a = UI.amb; if (a) { a.partial = text; a.lastAudio = Date.now(); paintTranscript(); } });
      d.onFinal(({ text }) => { if (UI.amb) UI.amb.lastAudio = Date.now(); addFinal(text); });
      d.onState(({ state, reason }) => {
        const a = UI.amb; if (!a) return;
        a.status = state === 'listening' ? 'listening' : state === 'idle' ? 'idle' : 'starting';
        a.listening = state === 'listening' || state === 'finishing';
        if (state === 'listening') { a.startedAt = a.startedAt || Date.now(); loopMeter(); }
        if (state === 'idle') { a.partial = ''; if (reason && !['stopped', 'viewer_stopped', 'hidden'].includes(reason)) a.micMsg = micCopy(reason); }
        if (a.step === 'capture') render();
      });
      if (UI.amb && UI.amb.step === 'capture') render();
    });
    window.claude.use('sample').then((s) => { T.caps.sample = s; });
  }
  const micCopy = (code) => ({ not_granted: 'Microphone access is blocked for this page. Allow it in the browser\'s site settings, or type the conversation or load the sample.', dismissed: 'The microphone question was closed. Press Start listening to be asked again.', unavailable: 'Dictation isn\'t available for this account or browser. Type the conversation or load the sample.', rate_limited: 'Dictation is busy right now. Try again in a moment.', time_limit: 'Listening stopped after 60 minutes.', no_service: 'This browser has its speech recognition service switched off. Browser speech works in Google Chrome and Microsoft Edge; Brave, Arc, Comet and some other Chromium browsers block it. Open this page in Google Chrome, use the published link, or type the conversation.', flapping: 'Speech recognition kept stopping right after it started. Check that the right microphone is selected and the page is not opened as a file, then press Start listening again.' }[code] || 'The microphone or speech service failed. Try again, or type the conversation.');
  const engine = () => T.caps.dictation ? 'dictation' : (!inViewer && SR) ? 'webspeech' : 'manual';
  const ENGINE_LABEL = { dictation: 'Anthropic speech-to-text (platform dictation)', webspeech: "your browser's speech recognition (Chrome sends audio to Google)", manual: 'typed or sample conversation (no microphone available here)' };

  function addFinal(text) {
    const a = UI.amb; if (!a || !text || !text.trim()) return;
    const last = a.segments[a.segments.length - 1];
    if (last && last.who === a.speaker) last.text += (/^\s/.test(text) ? '' : ' ') + text.trim();
    else a.segments.push({ who: a.speaker, text: text.trim() });
    a.partial = ''; a.justAdded = a.segments.length - 1; paintTranscript();
  }
  const wordCount = (a) => a.segments.reduce((k, s) => k + s.text.split(/\s+/).filter(Boolean).length, 0);
  function transcriptHtml(a) {
    const segs = a.segments.map((s, i) => `<div class="${i === a.justAdded ? 'fresh' : ''}"><b><button class="linkbtn" data-act="amb-seg" data-i="${i}" title="Switch speaker">${s.who}</button></b><span>${esc(s.text)}</span></div>`).join('');
    const live = a.partial ? `<div class="partial"><b>${a.speaker}</b><span>${esc(a.partial)}<i class="caret"></i></span></div>` : '';
    return segs + live || '<p class="muted">Finished phrases land here, labeled with the speaker. Click a label to fix it.</p>';
  }
  function captionText(a) {
    if (a.partial) return esc(a.partial) + '<i class="caret"></i>';
    if (a.status === 'starting') return '<span class="muted">Starting the microphone…</span>';
    if (a.listening) { const last = a.segments[a.segments.length - 1]; return last && Date.now() - (a.lastAudio || 0) < 4000 ? esc(last.text.split(/\s+/).slice(-14).join(' ')) : '<span class="muted">Listening. Start speaking…</span>'; }
    return a.segments.length ? '<span class="muted">Paused. Press Start listening to continue.</span>' : '<span class="muted">Press Start listening and talk. Words appear here as they are recognized.</span>';
  }
  function paintTranscript() {
    const a = UI.amb, el = document.getElementById('amb-transcript'); if (!a || !el) return;
    el.innerHTML = transcriptHtml(a); el.scrollTop = el.scrollHeight;
    const cap = document.getElementById('amb-caption'); if (cap) cap.innerHTML = captionText(a);
    const spk = document.getElementById('amb-cap-who'); if (spk) spk.textContent = a.speaker;
    const end = document.getElementById('amb-end'); if (end) end.disabled = !a.segments.length;
    const n = document.getElementById('amb-words'); if (n) n.textContent = wordCount(a) + ' words';
  }

  // Live level meter + timer. Real microphone level on the local copy; activity-driven on platform dictation (the page never gets audio there).
  let raf = null;
  const hist = new Array(32).fill(0);
  function loopMeter() {
    if (raf) return;
    const tick = () => {
      const a = UI.amb, c = document.getElementById('amb-meter');
      if (!a || !a.listening) { raf = null; hist.fill(0); drawMeter(c); return; }
      let lvl = 0;
      if (a.audio) { a.audio.an.getByteTimeDomainData(a.audio.buf); let s = 0; for (const v of a.audio.buf) { const d = (v - 128) / 128; s += d * d; } lvl = Math.min(1, Math.sqrt(s / a.audio.buf.length) * 5); }
      else lvl = Date.now() - (a.lastAudio || 0) < 450 ? 0.3 + Math.random() * 0.6 : 0.04 + Math.random() * 0.04;
      hist.push(lvl); hist.shift(); drawMeter(c);
      const t = document.getElementById('amb-timer'); if (t && a.startedAt) { const s = Math.floor((Date.now() - a.startedAt) / 1000); t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
      if (!a.partial) { const cap = document.getElementById('amb-caption'); if (cap && !cap.querySelector('.caret')) cap.innerHTML = captionText(a); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function drawMeter(c) {
    if (!c) return; const g = c.getContext('2d'); const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0d6b70';
    const bw = W / hist.length;
    hist.forEach((v, i) => { const h = Math.max(2, v * H); g.fillRect(i * bw + 1, (H - h) / 2, bw - 2, h); });
  }
  function startAudio(a) {
    try { const Ctx = window.AudioContext || window.webkitAudioContext; const ctx = new Ctx(); const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(a.stream).connect(an); a.audio = { ctx, an, buf: new Uint8Array(an.fftSize) }; } catch (err) { a.audio = null; }
  }
  function releaseMic(a) {
    if (!a) return;
    if (a.audio) { try { a.audio.ctx.close(); } catch (err) { /* ignore */ } a.audio = null; }
    if (a.stream) { a.stream.getTracks().forEach((t) => t.stop()); a.stream = null; }
  }

  // Web Speech (local copy only). The mic is opened once with getUserMedia and held for the whole capture,
  // so Chrome asks once; recognition restarts after pauses with a back-off instead of a tight loop.
  let rec = null;
  async function webStart() {
    const a = UI.amb;
    a.status = 'starting'; a.micMsg = null; a.fails = 0; render();
    try { if (!a.stream && !a.noHold) { a.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); startAudio(a); } }
    catch (err) { if (UI.amb === a) { a.status = 'idle'; a.listening = false; a.micMsg = micCopy('not_granted'); render(); } return; }
    if (UI.amb !== a) { releaseMic(a); return; }
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.onstart = () => { a.status = 'listening'; a.listening = true; a.startedAt = a.startedAt || Date.now(); a.lastStart = Date.now(); a.heard = false; if (a.step === 'capture' && !a.renderedListening) { a.renderedListening = true; render(); } loopMeter(); };
    rec.onresult = (e) => { if (UI.amb !== a) return; a.heard = true; a.lastAudio = Date.now(); let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) addFinal(r[0].transcript); else interim += r[0].transcript; } a.partial = interim; paintTranscript(); };
    rec.onerror = (e) => {
      if (UI.amb !== a) return; a.lastErr = e.error;
      if (e.error === 'not-allowed') { a.wantListen = false; a.micMsg = micCopy('not_granted'); }
      else if (e.error === 'service-not-allowed' || e.error === 'network') { a.wantListen = false; a.micMsg = micCopy('no_service') + ` (error: ${e.error})`; }
      else if (e.error === 'language-not-supported') { a.wantListen = false; a.micMsg = 'This browser can\'t recognize US English speech. Type the conversation or use the published link.'; }
      else if (e.error === 'audio-capture') { if (!a.noHold) { a.noHold = true; a.retryBare = true; } else { a.wantListen = false; a.micMsg = 'No microphone could be opened. Check the input device in System Settings › Sound, then try again. (error: audio-capture)'; } }
    };
    rec.onend = () => {
      if (UI.amb !== a) return;
      if (a.wantListen) {
        const quick = Date.now() - (a.lastStart || 0) < 1500 && !a.heard;
        // Some Macs won't let the speech engine share a microphone the page already holds: let go of ours (the meter then follows speech activity) and retry.
        if ((quick || a.retryBare) && a.stream && !a.triedBare) { a.triedBare = true; a.retryBare = false; a.noHold = true; releaseMic(a); setTimeout(() => { if (a.wantListen && UI.amb === a) { try { rec.start(); } catch (err) { /* already starting */ } } }, 300); return; }
        a.fails = quick ? (a.fails || 0) + 1 : 0;
        if (a.fails < 4) { setTimeout(() => { if (a.wantListen && UI.amb === a) { try { rec.start(); } catch (err) { /* already starting */ } } }, 250 * (a.fails + 1)); return; }
        a.wantListen = false; a.micMsg = micCopy('flapping') + ` (last error: ${a.lastErr || 'none reported'})`;
      }
      a.listening = false; a.status = 'idle'; a.partial = ''; a.renderedListening = false; a.triedBare = false; releaseMic(a);
      if (a.step === 'capture') render();
    };
    a.wantListen = true;
    try { rec.start(); } catch (err) { a.status = 'idle'; a.micMsg = micCopy('upstream_error'); releaseMic(a); render(); }
  }
  function stopListening() {
    const a = UI.amb; if (!a) return Promise.resolve();
    a.wantListen = false;
    if (engine() === 'dictation' && T.caps.dictation.active()) return T.caps.dictation.stop().catch(() => {});
    if (rec) { try { rec.stop(); } catch (err) { /* ignore */ } }
    releaseMic(a);
    return Promise.resolve();
  }

  function scriptFor(p) {
    if (SEED.ambientScripts[p.id]) return SEED.ambientScripts[p.id];
    const first = p.name.split(' ')[0];
    const probs = p.problems.map((x) => x.split(' (')[0]);
    return { transcript: [['Clinician', `Hi ${first}, how have things been since your last visit?`], ['Patient', 'Mostly fine. A little tired some days.'], ['Clinician', `Let us go over your ${probs[0].toLowerCase()} and your medications.`], ['Patient', 'I have been taking them as prescribed.'], ['Clinician', `Your blood pressure today is ${p.vitals.bp}. Continue your current medicines and follow up in three months.`]] };
  }

  // Rule-based draft, used where Claude isn't available (local copy, or the viewer declined)
  function offlineDraft(p, segs) {
    const said = (who) => segs.filter((s) => s.who === who).map((s) => s.text.trim());
    const sentences = (arr) => arr.flatMap((t) => t.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter(Boolean);
    const cl = sentences(said('Clinician')), pt = sentences(said('Patient'));
    const planRe = /\b(start|begin|prescrib|refer|order|schedul|continu|increas|decreas|stop|hold|check|repeat|follow|return|teach|recheck)\w*/i;
    const plan = cl.filter((x) => planRe.test(x));
    const orders = [];
    plan.forEach((x) => {
      const m = x.match(/\b(?:start|begin|prescribe)\w*\s+(?:you\s+on\s+|on\s+)?(?:a\s+(?:low\s+)?dose\s+of\s+)?([a-z][a-z-]{3,}(?:\s+\d+(?:\.\d+)?\s*(?:mg|mcg|units?|g))?)/i);
      if (m && !/listening|recording|with|the|your/i.test(m[1])) orders.push({ type: 'Medication', text: `${m[1]} [confirm dose, route, frequency]` });
      const r = x.match(/refer(?:ral)?\s+(?:you\s+)?to\s+([a-z][a-z ]+?)(?:\s+(?:to|for)\b|[.,]|$)/i);
      if (r) orders.push({ type: 'Referral', text: `Referral: ${r[1].trim()}` });
      const t = x.match(/\b(?:order|check|repeat|recheck)\w*\s+(?:a\s+|an\s+|your\s+)?([a-z0-9 -]*?(?:a1c|hba1c|potassium|panel|blood count|cbc|lipid|thyroid|x-?ray|ultrasound|ct|mri|ecg|ekg)[a-z ]*)/i);
      if (t) orders.push({ type: /x-?ray|ultrasound|\bct\b|mri/i.test(t[1]) ? 'Imaging' : 'Lab', text: t[1].trim() });
    });
    const words = segs.reduce((k, s) => k + s.text.split(/\s+/).length, 0);
    const v = p.vitals;
    return {
      source: 'offline',
      soap: `S: ${pt.length ? pt.join(' ') : 'Patient history not captured [confirm].'}\nO: From chart: BP ${v.bp}, HR ${v.hr}, SpO₂ ${v.spo2}%. Exam not dictated [confirm].\nA: ${p.problems.slice(0, 3).map((x) => x.split(' (')[0]).join('; ')} [confirm against today's discussion].\nP: ${plan.length ? plan.join(' ') : 'Plan not stated [confirm].'}`,
      icd: p.problems.slice(0, 3).map((x) => { const m = x.match(/\(([^)]+)\)/); return { code: m ? m[1].split(',')[0].trim() : '', desc: x.split(' (')[0] }; }).filter((c) => c.code),
      cpt: [{ code: words > 180 ? '99214' : '99213', desc: words > 180 ? 'Office visit, established, moderate MDM' : 'Office visit, established, low MDM' }],
      orders, flags: ['Rule-based draft: check every section before signing.']
    };
  }
  function draftPrompt(p, segs, reason) {
    const lines = (arr) => arr.length ? arr.map((x) => '- ' + x).join('\n') : '- none recorded';
    return `You are drafting an outpatient clinical note for the clinician to review, edit and sign. This is a product demo: the patient is fictional and the conversation is role-played.

CHART CONTEXT (fictional)
Patient: ${p.age}-year-old ${p.sex === 'M' ? 'male' : 'female'}. Visit reason: ${reason || 'not stated'}.
Problem list:
${lines(p.problems)}
Medications:
${lines(p.meds.map((m) => `${m.drug} ${m.dose} ${m.route} ${m.freq} (${m.status})`))}
Allergies:
${lines(p.allergies.map((a) => `${a.agent}: ${a.reaction}`))}
Latest vitals: BP ${p.vitals.bp}, HR ${p.vitals.hr}, RR ${p.vitals.rr}, temp ${p.vitals.temp} F, SpO2 ${p.vitals.spo2}%.
Recent labs:
${lines(p.labs.map((l) => `${l.test} ${l.value} ${l.unit} (ref ${l.ref})`))}

TRANSCRIPT (speaker labels were set by hand and may be wrong; infer who is speaking from what is said)
${segs.map((s) => `${s.who}: ${s.text.trim()}`).join('\n')}

INSTRUCTIONS
- soap: a concise SOAP note in plain text, four lines or short paragraphs starting "S:", "O:", "A:", "P:". Use only facts from the transcript and chart context. Never invent exam findings, vitals or results. Put "[confirm]" after anything uncertain.
- icd: up to 4 ICD-10-CM codes the note supports, each {"code": "...", "desc": "..."}.
- cpt: the office visit E/M code (99202-99205 new, 99212-99215 established) justified by medical decision making, plus any procedure clearly performed, each {"code": "...", "desc": "..."}.
- orders: only orders or referrals the clinician clearly stated, each {"type": "Medication" | "Lab" | "Imaging" | "Referral" | "Nursing", "text": "..."}. Medication text includes drug, dose, route and frequency; add "[confirm dose]" when the dose was not said.
- flags: up to 3 short strings the clinician should double-check, such as a planned drug that conflicts with an allergy or current medication. Empty array if none.

Reply with only this JSON object: {"soap": "...", "icd": [], "cpt": [], "orders": [], "flags": []}`;
  }
  function normalizeDraft(j) {
    const arr = (x) => Array.isArray(x) ? x : [];
    const code = (c) => typeof c === 'string' ? { code: c.split(' ')[0], desc: c.split(' ').slice(1).join(' ') } : { code: String(c.code || ''), desc: String(c.desc || c.description || '') };
    return { source: 'claude', soap: String(j.soap || ''), icd: arr(j.icd).map(code).filter((c) => c.code), cpt: arr(j.cpt).map(code).filter((c) => c.code),
      orders: arr(j.orders).map((o) => ({ type: ['Medication', 'Lab', 'Imaging', 'Referral', 'Nursing'].includes(o.type) ? o.type : 'Nursing', text: String(o.text || '') })).filter((o) => o.text), flags: arr(j.flags).map(String).slice(0, 3) };
  }
  const DRAFT_ERR = { rate_limited: 'Claude is busy or your usage limit was reached. Try again in a little while.', session_expired: 'Your claude.ai session expired. Sign in again, then try again.', refused: 'Claude declined to draft from this transcript. Edit the transcript and try again.', empty_completion: 'Claude returned nothing. Try again, or shorten the transcript.', invalid_json: 'The draft came back in the wrong format. Try again.', prompt_too_large: 'The transcript is too long to draft in one go. Remove some of it and try again.' };
  async function draftNote() {
    const a = UI.amb, p = P(a.patient);
    a.drafting = true; a.draft = null; a.err = null; a.note = null; render();
    const s = T.caps.sample;
    if (!s) { a.draft = offlineDraft(p, a.segments); a.drafting = false; a.note = inViewer ? 'Claude isn\'t available in this view, so this is a rule-based draft.' : 'Running locally, so this is a rule-based draft. On the published link, Claude writes it.'; render(); return; }
    a.ctl = new AbortController();
    try {
      const j = await s.json(draftPrompt(p, a.segments, a.reason), { signal: a.ctl.signal, cache: false });
      if (UI.amb !== a) return;
      a.draft = normalizeDraft(j || {});
      if (!a.draft.soap) throw { code: 'empty_completion' };
      audit('ai-draft-created', { patient: p, detail: 'Claude draft from live transcript' });
    } catch (e) {
      if (UI.amb !== a) return;
      const code = e && e.code;
      if (code === 'cancelled') a.err = 'Drafting stopped.';
      else if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) { T.caps.sample = null; a.draft = offlineDraft(p, a.segments); a.note = 'Claude isn\'t allowed for this page, so this is a rule-based draft.'; }
      else a.err = DRAFT_ERR[code] || 'Drafting failed. Try again.';
    }
    a.drafting = false; render();
  }

  VIEWS.ambient = (u) => {
    const queue = (T.S.appts).filter((a) => a.provider === u.id && !['Completed', 'No-show'].includes(a.status)).map((a) => ({ p: P(a.patient), when: a.time, reason: a.reason, kind: 'Clinic' }))
      .concat(S().tele.filter((t) => t.provider === u.id && ['In session', 'Waiting room'].includes(t.status)).map((t) => ({ p: P(t.patient), when: t.when, reason: t.reason, kind: 'Video' })))
      .filter((q) => careRel(u, q.p));
    const done = S().ambientNotes.filter((n) => n.by === u.id);
    const qRows = queue.map((q) => `<tr><td class="mono">${esc(q.when)}</td><td><b>${esc(q.p.name)}</b><span class="sub">${q.p.age}${q.p.sex} · MRN ${q.p.mrn}</span></td><td>${esc(q.reason)}<span class="sub">${q.kind}</span></td>
      <td>${done.some((d) => d.patient === q.p.id) ? pill('ok', 'Note signed') : `<button class="btn small primary" data-act="amb-start" data-p="${q.p.id}" data-r="${esc(q.reason)}">Start ambient visit</button>`}</td></tr>`);
    let work = `<p class="muted">Pick a patient from the queue. Tessera records consent, transcribes the conversation live, drafts the note with Claude, and saves nothing until you sign.</p>
      <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px"><li>Record the patient's consent to recording</li><li>Capture the conversation live from the microphone</li><li>Review Claude's draft note, codes and suggested orders</li><li>Sign. The transcript is discarded, orders wait for your signature in CPOE, codes go to billing</li></ol>`;
    const a = UI.amb;
    if (a && P(a.patient)) {
      const p = P(a.patient);
      const steps = ['consent', 'capture', 'review'];
      const stepper = `<div class="stepper">${['Consent', 'Capture', 'Review & sign'].map((l, i) => `<span class="${steps.indexOf(a.step) > i ? 'done' : steps.indexOf(a.step) === i ? 'now' : ''}">${l}</span>`).join('')}</div>`;
      if (a.step === 'consent') {
        work = `${stepper}<h3>${esc(p.name)} · ${p.age}${p.sex}</h3><div class="chips">${allergyChips(p)}</div>
          <form data-form="amb-consent" class="stack"><div class="field"><label for="amb-m">How was consent given?</label><select id="amb-m" name="method" required><option value="">Choose</option><option>Verbal, documented by clinician</option><option>Signed in patient app</option><option>Signed on tablet</option></select></div>
          <label class="row" style="gap:8px"><input type="checkbox" name="ok" required> The patient agrees to this visit being recorded and transcribed. California requires all-party consent.</label>
          <div class="row"><button class="btn primary" type="submit">Record consent and start</button><button class="btn" type="button" data-act="amb-decline">Patient declined</button><button class="btn" type="button" data-act="amb-cancel">Cancel</button></div></form>`;
      } else if (a.step === 'capture') {
        const eng = engine();
        const spk = (who) => `<button class="btn small ${a.speaker === who ? 'primary' : ''}" data-act="amb-speaker" data-w="${who}" aria-pressed="${a.speaker === who}">${who} speaking</button>`;
        const st = a.status || 'idle';
        const elapsed = a.startedAt ? Math.floor((Date.now() - a.startedAt) / 1000) : 0;
        const btn = eng === 'manual' ? '' : st === 'listening' ? '<button class="btn danger" data-act="amb-stop">■ Stop listening</button>' : st === 'starting' ? '<button class="btn" data-act="amb-stop">Cancel</button>' : `<button class="btn primary" data-act="amb-listen">● ${a.segments.length ? 'Resume listening' : 'Start listening'}</button>`;
        work = `${stepper}<div class="row between"><h3>Capturing · ${esc(p.name)}</h3>${st === 'listening' ? pill('crit', '● Listening') : st === 'starting' ? pill('warn', 'Waiting for microphone…') : pill('', 'Not listening')}</div>
          <div class="banner warn"><p><b>Role-play only.</b> Use made-up patients. Speech goes to ${ENGINE_LABEL[eng]}, and no business associate agreement covers this prototype.</p></div>
          ${eng === 'webspeech' && asFile ? '<div class="banner info"><p><b>Opened as a file.</b> Chrome can\'t remember microphone permission for files, so it may keep asking. Run it from localhost (see README) or use the published link.</p></div>' : ''}
          ${a.micMsg ? `<div class="banner info"><p>${esc(a.micMsg)}</p></div>` : ''}
          <section class="live ${st === 'listening' ? 'on' : ''}" aria-label="Live transcription">
            <div class="live-head"><span class="live-dot" aria-hidden="true"></span><b>${st === 'listening' ? 'LIVE' : 'Live transcription'}</b><span class="mono" id="amb-timer">${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}</span><span class="kpi-note" id="amb-words">${wordCount(a)} words</span><canvas id="amb-meter" width="160" height="28" aria-hidden="true"></canvas></div>
            <p class="caption" aria-live="polite"><span class="cap-who" id="amb-cap-who">${a.speaker}</span><span id="amb-caption">${captionText(a)}</span></p>
          </section>
          <div class="row">${btn}${spk('Clinician')}${spk('Patient')}</div>
          <h3>Transcript</h3>
          <div class="transcript" id="amb-transcript">${transcriptHtml(a)}</div>
          <form data-form="amb-line" class="row"><select name="who" aria-label="Speaker"><option>Clinician</option><option>Patient</option></select><input class="search" name="text" placeholder="Type a line instead of speaking" aria-label="Typed line" required><button class="btn" type="submit">Add</button></form>
          <div class="row"><button class="btn primary" id="amb-end" data-act="amb-draft" ${a.segments.length ? '' : 'disabled'}>End capture and draft note</button><button class="btn" data-act="amb-sample">Load sample conversation</button><button class="btn" data-act="amb-cancel">Discard</button></div>`;
      } else {
        const d = a.draft;
        if (a.drafting) work = `${stepper}<div class="stack"><h3>Drafting with Claude…</h3><p class="muted">Usually 5–60 seconds. The first time, claude.ai asks you to allow this page to use Claude.</p><div><button class="btn" data-act="amb-abort">Stop</button></div></div>`;
        else if (!d) work = `${stepper}<div class="banner warn"><p>${esc(a.err || 'No draft yet.')}</p></div><div class="row"><button class="btn primary" data-act="amb-redraft">Try again</button><button class="btn" data-act="amb-back">Back to transcript</button></div>`;
        else {
          const ord = d.orders.map((o, i) => `<label class="row" style="gap:8px"><input type="checkbox" name="o${i}" checked> ${esc(o.type)}: ${esc(o.text)}</label>`).join('') || '<span class="muted">No orders were stated in the conversation.</span>';
          work = `${stepper}<div class="row between"><h3>Draft · ${esc(p.name)}</h3><div class="chips">${pill('info', 'Unsigned draft')}${pill(d.source === 'claude' ? 'accent' : 'warn', d.source === 'claude' ? 'Drafted by Claude' : 'Rule-based draft')}</div></div>
            ${a.note ? `<div class="banner info"><p>${esc(a.note)}</p></div>` : ''}
            ${d.flags.length ? `<div class="flag warn"><h4>Check before signing</h4>${d.flags.map((f) => `<p>${esc(f)}</p>`).join('')}</div>` : ''}
            <details><summary class="linkbtn">Transcript (${a.segments.length} turns)</summary><div class="transcript" style="margin-top:8px">${transcriptHtml(a)}</div></details>
            <form data-form="amb-sign" class="stack">
              <div class="field"><label for="amb-soap">SOAP note (edit before signing)</label><textarea id="amb-soap" name="soap" style="min-height:220px">${esc(d.soap)}</textarea></div>
              <div class="grid"><div class="stack" style="gap:6px"><h3>Diagnoses (ICD-10-CM)</h3>${d.icd.map((c, i) => `<label class="row" style="gap:8px"><input type="checkbox" name="icd${i}" checked> <span><span class="mono">${esc(c.code)}</span> ${esc(c.desc)}</span></label>`).join('') || '<span class="muted">None suggested.</span>'}</div>
              <div class="stack" style="gap:6px"><h3>Visit codes (CPT)</h3>${d.cpt.map((c, i) => `<label class="row" style="gap:8px"><input type="checkbox" name="cpt${i}" checked> <span><span class="mono">${esc(c.code)}</span> ${esc(c.desc)}</span></label>`).join('') || '<span class="muted">None suggested.</span>'}</div></div>
              <div class="stack" style="gap:6px"><h3>Orders stated in the visit</h3>${ord}<span class="kpi-note">Accepted orders go to CPOE as "pending signature" and pass the usual safety checks.</span></div>
              <div class="row"><button class="btn primary" type="submit">Sign note</button><button class="btn" type="button" data-act="amb-redraft">Redraft</button><button class="btn" type="button" data-act="amb-back">Back to transcript</button><button class="btn" type="button" data-act="amb-cancel">Discard</button></div>
            </form>`;
        }
      }
    }
    return { title: 'Ambient Doctor', sub: 'Consent-first ambient documentation · clinician signs every note', body:
      tiles([[queue.length, 'In my queue'], [done.length, 'Ambient notes signed today'], [queue.filter((q) => q.kind === 'Video').length, 'Video visits waiting']]) +
      (a ? panel('Ambient workspace', work) + panel("Today's queue", table(['Time', 'Patient', 'Reason', ''], qRows), '', true)
        : `<div class="grid-2">${panel("Today's queue", table(['Time', 'Patient', 'Reason', ''], qRows), '', true)}${panel('Ambient workspace', work)}</div>`) };
  };
  T.after.push((u, route) => { if (route === 'ambient' && UI.amb && UI.amb.step === 'capture') paintTranscript(); });
  Object.assign(ACT, {
    'amb-start': (d) => { UI.amb = { patient: d.p, reason: d.r, step: 'consent', segments: [], partial: '', speaker: 'Clinician', listening: false }; render(); },
    'amb-cancel': () => { const a = UI.amb; if (a) { stopListening(); if (a.ctl) a.ctl.abort(); audit('ambient-discarded', { patient: P(a.patient), detail: 'no note saved; transcript discarded' }); } UI.amb = null; render(); },
    'amb-decline': () => { const p = P(UI.amb.patient); S().consents.push({ patient: p.id, kind: 'Ambient recording', state: 'Declined', by: me().name, at: new Date().toISOString() }); audit('consent-recorded', { patient: p, detail: 'ambient recording declined' }); UI.amb = null; save(); toast('Recording declined. Document the visit manually.'); location.hash = `patient-${p.id}-notes`; },
    // Must stay synchronous: dictation.start() has to run inside the click.
    'amb-listen': () => {
      const a = UI.amb; a.micMsg = null;
      if (engine() === 'dictation') { T.caps.dictation.start({ language: 'en-US' }).catch((e) => { if (UI.amb === a) { a.micMsg = e.code === 'stopped' ? null : micCopy(e.code); a.listening = false; a.status = 'idle'; render(); } }); a.status = 'starting'; audit('ambient-capture-start', { patient: P(a.patient), detail: 'platform dictation' }); render(); return; }
      if (engine() === 'webspeech') { audit('ambient-capture-start', { patient: P(a.patient), detail: 'browser speech recognition' }); webStart(); }
    },
    'amb-stop': () => { stopListening().then(() => { const a = UI.amb; if (a) { a.listening = false; a.status = 'idle'; a.partial = ''; render(); } }); },
    'amb-speaker': (d) => { UI.amb.speaker = d.w; document.querySelectorAll('[data-act="amb-speaker"]').forEach((b) => { const on = b.dataset.w === d.w; b.classList.toggle('primary', on); b.setAttribute('aria-pressed', on); }); paintTranscript(); },
    'amb-seg': (d) => { const s = UI.amb.segments[+d.i]; s.who = s.who === 'Clinician' ? 'Patient' : 'Clinician'; paintTranscript(); },
    'amb-sample': () => { const a = UI.amb; a.segments = scriptFor(P(a.patient)).transcript.map(([who, text]) => ({ who, text })); paintTranscript(); },
    'amb-draft': () => { const a = UI.amb; if (!a.segments.length) return; stopListening().then(() => { if (UI.amb !== a) return; a.listening = false; a.step = 'review'; draftNote(); }); },
    'amb-redraft': () => draftNote(),
    'amb-abort': () => { if (UI.amb && UI.amb.ctl) UI.amb.ctl.abort(); },
    'amb-back': () => { UI.amb.step = 'capture'; UI.amb.draft = null; render(); }
  });
  Object.assign(FORMS, {
    'amb-consent'(f) { const p = P(UI.amb.patient); S().consents.push({ patient: p.id, kind: 'Ambient recording', state: 'Done', by: me().name, at: new Date().toISOString(), detail: f.method }); audit('consent-recorded', { patient: p, detail: `ambient recording: ${f.method}` }); UI.amb.step = 'capture'; save(); render(); },
    'amb-line'(f) { const a = UI.amb; const sp = a.speaker; a.speaker = f.who; a.segments.push({ who: f.who, text: f.text.trim() }); a.speaker = sp; render(); },
    'amb-sign'(f) {
      const u = me(), a = UI.amb, p = P(a.patient), d = a.draft;
      S().notes.push({ id: nid('N'), patient: p.id, author: u.name, kind: `Progress note (ambient${d.source === 'claude' ? ', Claude draft' : ''}, clinician-signed)`, mOff: 0, at: new Date().toISOString(), signed: true, ai: true, text: f.soap, addenda: [] });
      const orders = d.orders.filter((o, i) => f['o' + i]);
      orders.forEach((o) => { const type = o.type; const flag = T.cds(p, type, o.text); const ord = { id: nid('O'), patient: p.id, type, text: o.text, priority: 'Routine', status: 'Pending signature', by: u.id }; if (flag) ord.flag = flag; S().orders.unshift(ord); });
      const icd = d.icd.filter((c, i) => f['icd' + i]).map((c) => c.code);
      const cpt = d.cpt.filter((c, i) => f['cpt' + i]).map((c) => c.code);
      let claim = S().claims.find((c) => c.patient === p.id && ['Ready to submit', 'Open encounter'].includes(c.status));
      // One E/M (992xx) level per visit: the signed note's level replaces any pre-coded one.
      if (claim) { const em = cpt.some((c) => /^992/.test(c)); claim.cpt = [...new Set(claim.cpt.filter((c) => !(em && /^992/.test(c))).concat(cpt))]; claim.icd = [...new Set(claim.icd.concat(icd))]; claim.note = 'Codes updated from signed ambient note'; }
      else if (cpt.length) S().claims.push({ id: nid('C'), patient: p.id, dOff: 0, setting: 'Outpatient', cpt, icd, charge: 180 * cpt.length, status: 'Ready to submit', paid: 0, note: 'Created from signed ambient note' });
      S().ambientNotes.push({ patient: p.id, by: u.id, at: new Date().toISOString() });
      audit('ai-note-signed', { patient: p, detail: `${orders.length} order(s) to CPOE, ${cpt.length} CPT to billing` });
      audit('ambient-transcript-discarded', { patient: p, dedupe: false });
      UI.amb = null; save(); render(); toast(`Note signed. Transcript discarded.${orders.length ? ` ${orders.length} order(s) waiting for your signature in CPOE.` : ''}`);
    }
  });

  /* ======================= Telemedicine ======================= */
  VIEWS.tele = (u) => {
    const sess = S().tele.filter((t) => careRel(u, P(t.patient))).map((t) => { const p = P(t.patient);
      const act = t.status === 'In session' ? `<button class="btn small primary" data-act="tm-join" data-t="${t.id}">Rejoin video</button> <button class="btn small" data-act="tm-end" data-t="${t.id}">End visit</button>` : t.status === 'Waiting room' ? `<button class="btn small primary" data-act="tm-admit" data-t="${t.id}">Admit and join</button>` : t.status === 'Scheduled' ? `<button class="btn small" data-act="tm-join" data-t="${t.id}">Open room</button>` : pill('ok', 'Summary sent to portal');
      return `<tr><td><b>${esc(p.name)}</b><span class="sub">${p.age}${p.sex} · MRN ${p.mrn}</span></td><td>${esc(t.reason)}<span class="sub">${esc(t.when)} · ${t.mins} min · ${esc(U(t.provider).name)}</span></td><td>${statePill(t.status)}</td><td>${act}</td></tr>`; });
    const rpm = S().rpm.filter((r) => careRel(u, P(r.patient))).map((r, i) => { const p = P(r.patient);
      return `<tr><td><b>${esc(p.name)}</b><span class="sub">MRN ${p.mrn}</span></td><td>${esc(r.device)}</td><td>${pill(r.level, r.reading)}</td><td>${r.ack ? pill('ok', `Reviewed by ${r.ack}`) : `<button class="btn small" data-act="rpm-ack" data-i="${S().rpm.indexOf(r)}">Mark reviewed</button>`}</td></tr>`; });
    const erx = S().erx.filter((e) => careRel(u, P(e.patient))).map((e) => `<tr><td><b>${esc(P(e.patient).name)}</b></td><td>${esc(e.drug)}${e.controlled ? ' ' + pill('crit', 'EPCS') : ''}</td><td>${esc(e.pharmacy)}</td><td>${pill('ok', e.status)}</td></tr>`);
    const opts = T.myPatients(u).filter((p) => !p.unidentified).map((p) => `<option value="${p.id}">${esc(p.name)} · MRN ${p.mrn}</option>`).join('');
    return { title: 'Telemedicine', sub: 'Video visits · remote monitoring · e-prescribing', body:
      tiles([[S().tele.filter((t) => t.status === 'In session' && careRel(u, P(t.patient))).length, 'In session'], [S().tele.filter((t) => t.status === 'Waiting room' && careRel(u, P(t.patient))).length, 'Waiting room', 'warn'], [rpm.length, 'Monitoring alerts', rpm.length ? 'crit' : ''], [erx.length, 'e-Prescriptions sent']]) +
      panel('Video visits', table(['Patient', 'Visit', 'Status', ''], sess), '<span class="kpi-note">Video runs on a BAA-covered vendor. Invite links carry no patient details.</span>', true) +
      `<div class="grid-2">${panel('Remote monitoring alerts', table(['Patient', 'Device', 'Reading', ''], rpm), '', true)}
      ${panel('New e-prescription', `<form data-form="erx" class="stack"><div class="field"><label for="rx-p">Patient</label><select id="rx-p" name="p" required>${opts}</select></div>
        <div class="field"><label for="rx-d">Drug and directions</label><input id="rx-d" name="drug" required placeholder="e.g. Metoprolol succinate 25 mg PO daily"></div>
        <div class="field"><label for="rx-ph">Pharmacy</label><select id="rx-ph" name="pharmacy"><option>Bayview Outpatient Pharmacy</option><option>Patient's preferred retail pharmacy</option></select></div>
        <label class="row" style="gap:8px"><input type="checkbox" name="twofa"> I confirmed with my security key (required for controlled substances, DEA EPCS)</label>
        <div><button class="btn primary" type="submit">Send prescription</button></div></form>`)}</div>` +
      panel('Sent prescriptions', table(['Patient', 'Drug', 'Pharmacy', 'Status'], erx), '', true) };
  };
  Object.assign(ACT, {
    'tm-join': (d) => { const t = S().tele.find((x) => x.id === d.t); audit('telehealth-join', { patient: P(t.patient) }); toast('Video room opened (prototype: no camera is used).'); },
    'tm-admit': (d) => { const t = S().tele.find((x) => x.id === d.t); t.status = 'In session'; audit('telehealth-admit', { patient: P(t.patient) }); save(); render(); toast('Patient admitted from the waiting room.'); },
    'tm-end': (d) => { const t = S().tele.find((x) => x.id === d.t); t.status = 'Completed'; audit('telehealth-end', { patient: P(t.patient) }); save(); render(); toast('Visit ended. After-visit summary sent to the patient portal.'); },
    'rpm-ack': (d) => { const r = S().rpm[+d.i]; r.ack = me().name; audit('rpm-review', { patient: P(r.patient), detail: r.reading }); save(); render(); }
  });
  FORMS.erx = (f) => {
    const controlled = /(oxycodone|hydrocodone|morphine|lorazepam|alprazolam|tramadol|codeine)/i.test(f.drug);
    if (controlled && !f.twofa) { toast('Controlled substance: confirm with your security key first (EPCS).'); return; }
    S().erx.unshift({ patient: f.p, drug: f.drug, pharmacy: f.pharmacy, by: me().id, status: 'Sent (NCPDP SCRIPT)', controlled });
    audit('erx-sent', { patient: P(f.p), detail: controlled ? 'EPCS two-factor' : '' }); save(); render(); toast('Prescription sent.');
  };

  /* ======================= Emergency department ======================= */
  VIEWS.er = (u) => {
    const list = S().er.filter((e) => !['Discharged', 'Admitted'].includes(e.status));
    audit('view-er-board', { patients: list.map((e) => T.tok(P(e.patient))).join(' ') });
    const by = [1, 2, 3, 4, 5].map((lvl) => {
      const rows = list.filter((e) => e.esi === lvl).map((e) => { const p = P(e.patient); const target = SEED.esiTarget[e.esi];
        const late = !e.provider && e.mOff > target;
        const v = p.vitals;
        return `<tr><td><span class="esi esi${e.esi}">${e.esi}</span></td><td><b>${ptLink(p)}</b><span class="sub">${p.unidentified ? 'Unidentified · temp MRN ' + esc(p.mrn) : `${p.age}${p.sex} · MRN ${p.mrn}`}</span></td>
          <td>${esc(e.complaint)}<span class="sub">${esc(e.arrival)} · bay ${esc(p.bed || '—')}</span></td><td class="mono">BP ${v.bp} · HR ${v.hr} · SpO₂ ${v.spo2}%</td>
          <td>${mins(e.mOff)}${late ? `<span class="sub">${pill('crit', `Over ${target}-min target`)}</span>` : ''}${e.triagedOff == null ? `<span class="sub">${pill('warn', 'Not triaged')}</span>` : ''}</td>
          <td>${statePill(e.status)}<span class="sub">${e.provider ? esc(U(e.provider).name) : 'No provider'}</span></td>
          <td><div class="row" style="gap:6px">${e.triagedOff == null ? `<button class="btn small primary" data-act="er-triage" data-e="${e.id}">Triage</button>` : ''}${!e.provider ? `<button class="btn small" data-act="er-take" data-e="${e.id}">Assign to me</button>` : ''}${p.unidentified ? `<button class="btn small" data-act="er-identify" data-e="${e.id}">Identify</button>` : ''}<button class="btn small" data-act="er-admit" data-e="${e.id}">Admit…</button><button class="btn small" data-act="er-dc" data-e="${e.id}">Discharge</button></div></td></tr>`; });
      return rows.length ? `<tr><td colspan="7" style="background:var(--surface-2);font-weight:600">ESI ${lvl} · ${['Resuscitation', 'Emergent', 'Urgent', 'Less urgent', 'Non-urgent'][lvl - 1]} (${rows.length})</td></tr>` + rows.join('') : '';
    }).join('');
    const d2t = list.filter((e) => e.triagedOff != null).map((e) => e.mOff - e.triagedOff);
    return { title: 'Emergency board', sub: 'Emergency Severity Index (ESI) · not real-time; refreshes when you act', body:
      tiles([[list.length, 'In department'], [list.filter((e) => e.esi <= 2).length, 'ESI 1–2', 'crit'], [list.filter((e) => e.status === 'Waiting').length, 'Waiting', 'warn'], [list.filter((e) => !e.provider && e.mOff > SEED.esiTarget[e.esi]).length, 'Over target', 'crit'], [d2t.length ? Math.round(d2t.reduce((a, b) => a + b, 0) / d2t.length) + ' min' : '—', 'Avg door-to-triage'], [S().bedRequests.filter((r) => !r.done).length, 'Admits waiting for bed']]) +
      `<div class="row"><button class="btn primary" data-act="er-unknown">Register unknown patient</button><span class="kpi-note">Unknown patients get a temporary MRN and alias; identifying them later merges into one record.</span></div>` +
      panel('Department', `<div class="tbl"><table class="t"><thead><tr><th>ESI</th><th>Patient</th><th>Complaint</th><th>Vitals</th><th>Waited</th><th>Status</th><th></th></tr></thead><tbody>${by || '<tr><td colspan="7" class="muted">Department is empty.</td></tr>'}</tbody></table></div>`, '', true) };
  };
  const erE = (id) => S().er.find((x) => x.id === id);
  Object.assign(ACT, {
    'er-take': (d) => { const e = erE(d.e); e.provider = me().id; e.status = 'In treatment'; audit('er-assign', { patient: P(e.patient) }); save(); render(); },
    'er-triage': (d) => openModal({ title: 'Triage', form: 'er-triage', submit: 'Save triage', body: `<input type="hidden" name="e" value="${d.e}"><div class="field"><label for="esi">ESI level</label><select id="esi" name="esi">${[1, 2, 3, 4, 5].map((n) => `<option ${erE(d.e).esi === n ? 'selected' : ''}>${n}</option>`).join('')}</select><small>1 = needs life-saving intervention now · 5 = no resources expected</small></div>` }),
    'er-identify': (d) => openModal({ title: 'Identify patient', form: 'er-identify', submit: 'Merge into one record', body: `<input type="hidden" name="e" value="${d.e}"><p>The temporary record and everything charted under it are merged into the identified record. The alias stays searchable and the merge is audited.</p><div class="field"><label for="id-n">Full name</label><input id="id-n" name="name" required></div><div class="field"><label for="id-d">Date of birth</label><input id="id-d" name="dob" type="date" required></div><div class="field"><label for="id-s">Identified by</label><select id="id-s" name="src"><option>Driver's license in belongings</option><option>Family at bedside</option><option>Prior record match (MPI)</option></select></div>` }),
    'er-admit': (d) => openModal({ title: 'Admit patient', form: 'er-admit', submit: 'Request bed', body: `<input type="hidden" name="e" value="${d.e}"><div class="field"><label for="ad-u">Unit</label><select id="ad-u" name="unit"><option value="CICU">${UNIT.CICU}</option><option value="W4B">${UNIT.W4B}</option><option value="PEDW">${UNIT.PEDW}</option></select></div><div class="field"><label for="ad-r">Admitting service</label><select id="ad-r" name="dept">${Object.entries(DEPT).filter(([k]) => ['CARD', 'GMED', 'SURG', 'PEDS'].includes(k)).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>` }),
    'er-dc': (d) => { const e = erE(d.e); e.status = 'Discharged'; audit('er-discharge', { patient: P(e.patient) }); save(); render(); toast('Discharged from the ER. Summary sent to the portal.'); },
    'er-unknown': () => openModal({ title: 'Register unknown patient', form: 'er-unknown', submit: 'Register', body: `<div class="field"><label for="uk-s">Sex</label><select id="uk-s" name="sex"><option value="M">Male</option><option value="F">Female</option><option value="U">Unknown</option></select></div><div class="field"><label for="uk-a">Approximate age</label><input id="uk-a" name="age" type="number" min="0" max="110" value="40" required></div><div class="field"><label for="uk-c">Chief complaint</label><input id="uk-c" name="complaint" required></div><div class="field"><label for="uk-e">ESI level</label><select id="uk-e" name="esi"><option>1</option><option selected>2</option><option>3</option><option>4</option><option>5</option></select></div>` })
  });
  Object.assign(FORMS, {
    'er-triage'(f) { const e = erE(f.e); e.esi = +f.esi; e.triagedOff = 0; UI.modal = null; audit('er-triage', { patient: P(e.patient), detail: 'ESI ' + f.esi }); save(); render(); },
    'er-identify'(f) { const e = erE(f.e), p = P(e.patient); const alias = p.name; const age = new Date().getFullYear() - +f.dob.slice(0, 4);
      T.patchPatient(p.id, { name: f.name.trim(), dob: f.dob, age, unidentified: false, alias, mrn: '10' + String(3000 + S().seq++), payer: 'Self-pay — financial counseling referral' });
      UI.modal = null; audit('mpi-identify', { patient: p, detail: `alias "${alias}" merged · ${f.src}` }); render(); toast('Identified. One record, alias kept for search.'); },
    'er-admit'(f) { const e = erE(f.e), p = P(e.patient); S().bedRequests.push({ id: nid('BR'), patient: p.id, unit: f.unit, dept: f.dept, at: new Date().toISOString(), done: false }); e.status = 'Admit requested'; UI.modal = null; audit('admit-request', { patient: p, detail: `${UNIT[f.unit]} · ${DEPT[f.dept]}` }); save(); render(); toast('Bed requested. Front desk and the unit charge nurse see it on the bed board.'); },
    'er-unknown'(f) {
      const n = S().extraPatients.length + 414; const sexW = f.sex === 'M' ? 'Male' : f.sex === 'F' ? 'Female' : 'Person';
      const p = { id: T.store && T.store.live ? T.nid('X') : 'X' + n, mrn: 'T-0' + n, name: `Unknown ${sexW} · Trauma-0${n}`, unidentified: true, age: +f.age, sex: f.sex === 'U' ? 'M' : f.sex, dob: '', phone: '', dept: 'EMER', consults: [], unit: 'ER', bed: '—', status: 'Emergency', attending: me().id, payer: 'Unknown — registration pending', memberId: '', code: 'Full code', weightKg: 75, heightCm: 170, allergies: [], allergiesUnknown: true, problems: [f.complaint], vitals: { bp: '—/—', hr: '—', rr: '—', temp: '—', spo2: '—' }, meds: [], labs: [], bloodGroup: 'Unknown' };
      S().extraPatients.push(p); S().er.push({ id: nid('E'), patient: p.id, esi: +f.esi, complaint: f.complaint, arrival: 'Ambulance', mOff: 0, triagedOff: 0, status: 'Waiting', provider: null });
      UI.modal = null; audit('mpi-register-unknown', { patient: p, detail: 'temporary MRN issued' }); save(); render(); toast(`Registered as ${p.name}.`);
    }
  });

  /* ======================= ICU board ======================= */
  VIEWS.icu = (u) => {
    const pts = T.allPts().filter((p) => p.unit === 'CICU').map((p) => ({ p, n: news2(p) })).sort((a, b) => b.n.sc - a.n.sc);
    const cards = pts.map(({ p, n }) => {
      const can = careRel(u, p); const iso = (SEED.isolation || []).find((i) => i.patient === p.id); const hai = (S().hai || []).filter((h) => h.patient === p.id);
      if (!can) return `<div class="bay"><span class="bed">${esc(p.bed)}</span><b>Occupied</b><span class="muted">Not in your care scope</span>${newsPill(n)}</div>`;
      return `<a class="bay" href="#patient-${p.id}-overview" style="text-decoration:none;color:inherit"><div class="row between"><span class="bed">${esc(p.bed)}</span>${newsPill(n)}</div><b>${esc(p.name)}</b><span class="muted">${p.age}${p.sex} · ${esc(p.problems[0].split(' (')[0])}</span>
        <span class="mono" style="font-size:12px">BP ${p.vitals.bp} · HR ${p.vitals.hr} · RR ${p.vitals.rr} · SpO₂ ${p.vitals.spo2}%</span>
        <div class="chips">${RESP[p.id] ? pill('info', RESP[p.id]) : ''}${iso ? pill('warn', `${iso.type} isolation`) : ''}${hai.map((h) => pill('crit', h.type)).join('')}${p.code !== 'Full code' ? pill('crit', p.code) : ''}</div></a>`;
    }).join('');
    return { title: 'ICU board', sub: 'Cardiac ICU · sorted by NEWS2 acuity', body:
      tiles([[pts.length, 'ICU patients'], [pts.filter((x) => x.n.risk === 'High').length, 'NEWS2 high', 'crit'], [pts.filter((x) => RESP[x.p.id]).length, 'Respiratory support'], [pts.filter((x) => (SEED.isolation || []).some((i) => i.patient === x.p.id)).length, 'Isolation', 'warn']]) +
      `<div class="board">${cards}</div><p class="kpi-note">NEWS2 is computed from the latest charted vitals (RR, SpO₂, supplemental O₂, systolic BP, HR, temperature, consciousness).</p>` };
  };

  /* ======================= Bed board ======================= */
  function occupant(bed) { return T.allPts().find((p) => p.bed === bed.bed && p.unit === bed.unit && !['Discharged'].includes(p.status)); }
  VIEWS.beds = (u) => {
    const st = S().bedStatus;
    const reqs = S().bedRequests.filter((r) => !r.done);
    const canManage = ['receptionist', 'nurse'].includes(u.role);
    const units = ['CICU', 'W4B', 'PEDW', 'PACU'].map((un) => {
      const beds = SEED.beds.filter((b) => b.unit === un);
      const cards = beds.map((b) => { const p = occupant(b); const s = p ? 'Occupied' : st[b.bed] || 'Available';
        let who = '';
        if (p) { const clin = ['doctor', 'nurse', 'pharmacist'].includes(u.role) && careRel(u, p); who = clin ? `<b>${esc(p.name)}</b><span class="muted">${esc(p.problems[0].split(' (')[0])}</span>` : u.role === 'receptionist' ? `<b>${esc(p.name)}</b><span class="muted">MRN ${p.mrn}</span>` : '<b>Occupied</b><span class="muted">Details limited to the care team</span>'; }
        const resv = SEED.bedReservations[b.bed] && s === 'Reserved' ? `<span class="muted">Held for ${u.role === 'receptionist' || careRel(u, P(SEED.bedReservations[b.bed])) ? esc(P(SEED.bedReservations[b.bed]).name) : 'incoming patient'}</span>` : '';
        const acts = canManage && !p ? (s === 'Cleaning' ? `<button class="btn small" data-act="bed-clean" data-b="${b.bed}">Mark clean</button>` : s === 'Available' && reqs.some((r) => r.unit === un) ? `<button class="btn small primary" data-act="bed-assign" data-b="${b.bed}" data-u="${un}">Assign admit</button>` : '') : '';
        return `<div class="bay ${p ? '' : 'empty'}"><div class="row between"><span class="bed">${esc(b.bed)}</span>${pill(s === 'Occupied' ? 'info' : s === 'Available' ? 'ok' : s === 'Cleaning' || s === 'Reserved' ? 'warn' : 'crit', s)}</div>${who}${resv}${acts}</div>`; }).join('');
      const occ = beds.filter((b) => occupant(b)).length;
      return panel(`${UNIT[un]} · ${occ}/${beds.length} occupied`, `<div class="board">${cards}</div>`);
    }).join('');
    const reqRows = reqs.map((r) => { const p = P(r.patient); return `<tr><td>${u.role === 'receptionist' || careRel(u, p) ? `<b>${esc(p.name)}</b>` : '<span class="muted">Restricted</span>'}<span class="sub">from Emergency</span></td><td>${esc(UNIT[r.unit])}</td><td>${esc(DEPT[r.dept])}</td><td>${timeStr(r.at)}</td></tr>`; });
    const total = SEED.beds.length, occAll = SEED.beds.filter((b) => occupant(b)).length;
    return { title: 'Bed board', sub: 'Inpatient bed management · names shown only to the care team and admissions', body:
      tiles([[total, 'Beds'], [occAll, 'Occupied'], [SEED.beds.filter((b) => !occupant(b) && !(st[b.bed])).length, 'Available'], [Object.values(st).filter((x) => x === 'Cleaning').length, 'Cleaning', 'warn'], [Math.round(occAll / total * 100) + '%', 'Occupancy'], [reqs.length, 'Admits waiting', reqs.length ? 'warn' : '']]) +
      (reqs.length ? panel('Admission requests', table(['Patient', 'Unit', 'Service', 'Requested'], reqRows), '', true) : '') + units };
  };
  Object.assign(ACT, {
    'bed-clean': (d) => { delete S().bedStatus[d.b]; audit('bed-status', { resource: d.b, detail: 'cleaned' }); save(); render(); },
    'bed-assign': (d) => { const r = S().bedRequests.find((x) => !x.done && x.unit === d.u); const p = P(r.patient);
      T.patchPatient(p.id, { unit: d.u, bed: d.b, status: 'Admitted', dept: r.dept, consults: [...new Set((p.consults || []).concat(['EMER']))] });
      r.done = true; const e = S().er.find((x) => x.patient === p.id); if (e) e.status = 'Admitted';
      audit('bed-assign', { patient: p, resource: d.b }); save(); render(); toast(`Bed ${d.b} assigned. The unit can see the patient now.`); }
  });

  /* ======================= Handover (ISBAR) ======================= */
  VIEWS.handover = (u) => {
    const list = S().handovers.filter((h) => careRel(u, P(h.patient)));
    const cards = list.map((h) => { const p = P(h.patient);
      return `<article class="panel"><div class="body"><div class="row between"><div class="stack" style="gap:2px"><h3>${ptLink(p)} · ${esc(p.bed || '')}</h3><span class="muted" style="font-size:12.5px">${esc(h.from)} → ${esc(h.to)}</span></div>
        <div class="chips">${pill(h.status === 'Unstable' ? 'crit' : h.status === 'Watch' ? 'warn' : 'ok', h.status)}${h.ack ? pill('ok', `Acknowledged by ${h.ack.by}`) : pill('warn', 'Awaiting acknowledgement')}</div></div>
        <div class="isbar"><b>S</b><span>${esc(h.s)}</span><b>B</b><span>${esc(h.b)}</span><b>A</b><span>${esc(h.a)}</span><b>R</b><span>${esc(h.r)}</span></div>
        <div class="stack" style="gap:4px"><h3>Outstanding tasks</h3>${h.tasks.map((t, i) => `<label class="row" style="gap:8px"><input type="checkbox" data-act="ho-task" data-h="${h.id}" data-i="${i}" ${t.done ? 'checked' : ''}> ${esc(t.t)} · due ${esc(t.due)} ${t.urgent ? pill('crit', 'Urgent') : ''}</label>`).join('')}</div>
        ${h.ack ? '' : `<div><button class="btn small primary" data-act="ho-ack" data-h="${h.id}">Acknowledge handover</button></div>`}</div></article>`; }).join('');
    const opts = T.myPatients(u).map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.bed || '')}</option>`).join('');
    return { title: 'Clinical handover', sub: 'ISBAR · read-back acknowledgement · tasks with deadlines', body:
      tiles([[list.length, 'Handovers'], [list.filter((h) => !h.ack).length, 'Awaiting acknowledgement', 'warn'], [list.reduce((n, h) => n + h.tasks.filter((t) => t.urgent && !t.done).length, 0), 'Urgent tasks open', 'crit'], [list.filter((h) => h.status === 'Unstable').length, 'Unstable', 'crit']]) +
      `<div class="grid-2"><div class="stack">${cards || '<p class="muted">No handovers in your scope.</p>'}</div>${panel('New handover', `<form data-form="handover" class="stack"><div class="field"><label for="ho-p">Patient</label><select id="ho-p" name="p" required>${opts}</select></div>
        <div class="field"><label for="ho-st">Status</label><select id="ho-st" name="status"><option>Stable</option><option>Watch</option><option>Unstable</option></select></div>
        ${['s|Situation', 'b|Background', 'a|Assessment', 'r|Recommendation'].map((x) => { const [k, l] = x.split('|'); return `<div class="field"><label for="ho-${k}">${l}</label><textarea id="ho-${k}" name="${k}" required style="min-height:54px"></textarea></div>`; }).join('')}
        <div class="field"><label for="ho-t">Task (optional)</label><input id="ho-t" name="task" placeholder="e.g. Repeat lactate at 02:00"></div>
        <div><button class="btn primary" type="submit">Hand over</button></div></form>`)}</div>` };
  };
  Object.assign(ACT, {
    'ho-ack': (d) => { const h = S().handovers.find((x) => x.id === d.h); h.ack = { by: me().name, at: new Date().toISOString() }; audit('handover-ack', { patient: P(h.patient) }); save(); render(); },
    'ho-task': (d, el) => { const h = S().handovers.find((x) => x.id === d.h); h.tasks[+d.i].done = !h.tasks[+d.i].done; audit('handover-task', { patient: P(h.patient), detail: h.tasks[+d.i].t }); save(); render(); }
  });
  FORMS.handover = (f) => { const u = me(); S().handovers.unshift({ id: nid('H'), patient: f.p, from: u.name + ' (now)', to: 'Next shift', status: f.status, ack: null, s: f.s, b: f.b, a: f.a, r: f.r, tasks: f.task ? [{ t: f.task, due: 'Next shift', urgent: f.status === 'Unstable', done: false }] : [] }); audit('handover-create', { patient: P(f.p) }); save(); render(); toast('Handover created. The next shift must acknowledge it.'); };

  /* ======================= Clinical pathways ======================= */
  VIEWS.pathways = (u) => {
    const list = S().pathways.filter((w) => careRel(u, P(w.patient)));
    const cards = list.map((w) => { const p = P(w.patient); const done = w.steps.filter((s) => s.by).length; const complete = done === w.steps.length;
      const elapsed = w.startOff; const behind = !complete && elapsed > w.target;
      const next = w.steps.findIndex((s) => !s.by);
      return `<article class="panel"><div class="body"><div class="row between"><div class="stack" style="gap:2px"><h3>${esc(w.name)}</h3><span class="muted" style="font-size:12.5px">${ptLink(p)} · ${p.age}${p.sex} · ${esc(T.location_(p))}</span></div>${behind ? pill('crit', 'Behind target') : complete ? pill('ok', 'Complete') : pill('info', 'On track')}</div>
        <div class="stack" style="gap:4px"><div class="row between"><span>${esc(w.metric)}: <b class="num">${mins(elapsed)}</b> of ${w.target} min target</span><span class="muted">${done}/${w.steps.length} steps</span></div><div class="minibar ${behind ? 'over' : ''}"><i style="width:${Math.min(100, elapsed / w.target * 100)}%"></i></div></div>
        <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">${w.steps.map((s, i) => `<li ${s.by ? '' : 'class="muted"'}>${s.by ? '✓ ' : ''}${esc(s.t)}${s.by ? `<span class="sub">${esc(s.by)} · ${s.at ? timeStr(s.at) : ago(s.off)}${s.note ? ' · ' + esc(s.note) : ''}</span>` : i === next ? ' ' + pill('warn', 'Next') : ''}</li>`).join('')}</ol>
        ${complete ? '' : `<div><button class="btn small primary" data-act="pw-next" data-w="${w.id}">Complete next step</button></div>`}</div></article>`; }).join('');
    return { title: 'Clinical pathways', sub: 'Time-critical protocols: STEMI, sepsis, stroke', body:
      tiles([[list.length, 'Active pathways'], [list.filter((w) => w.steps.some((s) => !s.by) && w.startOff > w.target).length, 'Behind target', 'crit'], [list.reduce((n, w) => n + w.steps.filter((s) => s.by).length, 0), 'Steps completed']]) +
      `<div class="grid">${cards || '<p class="muted">No pathways for patients in your scope.</p>'}</div>` };
  };
  ACT['pw-next'] = (d) => { const w = S().pathways.find((x) => x.id === d.w); const s = w.steps.find((x) => !x.by); s.by = me().name; s.at = new Date().toISOString(); audit('pathway-step', { patient: P(w.patient), detail: `${w.name}: ${s.t}` }); save(); render(); };

  /* ======================= Discharge orchestrator ======================= */
  const OWNER_LABEL = { doctor: 'Physician', pharmacist: 'Pharmacy', billing: 'Billing', nurse: 'Nursing', receptionist: 'Front desk / transport' };
  VIEWS.discharge = (u) => {
    const clinical = ['doctor', 'nurse', 'pharmacist'].includes(u.role);
    const list = S().discharges.filter((d) => clinical ? careRel(u, P(d.patient)) : true);
    const cards = list.map((d) => { const p = P(d.patient); const done = d.steps.filter((s) => s.state === 'Done').length; const pct = Math.round(done / d.steps.length * 100);
      const steps = d.steps.map((s, i) => { const mine = s.owner === u.role && (!clinical || careRel(u, p)) && !(u.role === 'nurse' && p.unit !== u.unit);
        const act = s.state === 'Done' ? '' : mine && s.owner === 'doctor' ? `<a class="btn small primary" href="#dcsum-${d.id}">Write summary</a>` : mine ? (s.state === 'Blocked' ? `<button class="btn small primary" data-act="dc-resolve" data-d="${d.id}" data-i="${i}">Resolve…</button>` : `<button class="btn small primary" data-act="dc-done" data-d="${d.id}" data-i="${i}">Mark complete</button>`) : `<span class="kpi-note">Owned by ${OWNER_LABEL[s.owner]}</span>`;
        return `<tr><td><b>${OWNER_LABEL[s.owner]}</b></td><td>${esc(s.t)}${s.blocker ? `<span class="sub">⚠ ${esc(s.blocker)}</span>` : ''}${s.by ? `<span class="sub">${esc(s.by)}</span>` : ''}</td><td>${statePill(s.state)}</td><td>${act}</td></tr>`; }).join('');
      return `<article class="panel"><header><div class="stack" style="gap:2px"><h2>${clinical ? ptLink(p) : esc(p.name)}</h2><span class="muted" style="font-size:12.5px">MRN ${p.mrn} · ${esc(T.location_(p))} · decided ${ago(d.decidedOff)} by ${esc(U(d.by).name)}</span></div><div class="row" style="gap:8px"><b class="num">${pct}%</b><div class="minibar" style="width:120px"><i style="width:${pct}%"></i></div></div></header>
        <div class="body flush"><div class="tbl"><table class="t"><tbody>${steps}</tbody></table></div></div>
        ${clinical ? `<div class="body"><span class="kpi-note">Follow-up: ${d.followUp.map(esc).join(' · ')}</span></div>` : ''}</article>`; }).join('');
    return { title: 'Discharge orchestrator', sub: 'Each department completes only its own step', body:
      tiles([[list.length, 'Active discharges'], [list.reduce((n, d) => n + d.steps.filter((s) => s.state === 'Blocked').length, 0), 'Blockers', 'crit'], [list.filter((d) => d.steps.every((s) => s.state === 'Done')).length, 'Ready to leave', 'ok'], [list.reduce((n, d) => n + d.steps.filter((s) => s.owner === u.role && s.state !== 'Done').length, 0), 'Waiting on your team', 'warn']]) +
      (clinical ? '' : '<div class="banner info"><p>You see the discharge checklist, not clinical details or follow-up plans.</p></div>') + `<div class="stack">${cards || '<p class="muted">No active discharges in your scope.</p>'}</div>` };
  };
  Object.assign(ACT, {
    'dc-done': (d) => { const x = S().discharges.find((y) => y.id === d.d); const s = x.steps[+d.i]; s.state = 'Done'; s.by = me().name; audit('discharge-step', { patient: P(x.patient), detail: s.t }); save(); render(); },
    'dc-resolve': (d) => openModal({ title: 'Resolve blocker', form: 'dc-resolve', submit: 'Resolve and complete', body: `<input type="hidden" name="d" value="${d.d}"><input type="hidden" name="i" value="${d.i}"><p>${esc(S().discharges.find((y) => y.id === d.d).steps[+d.i].blocker)}</p><div class="field"><label for="dr">Resolution</label><select id="dr" name="how" required><option value="">Choose</option><option>Authorization received</option><option>Patient signed payment plan</option><option>Financial assistance application filed</option><option>Charity care approved</option></select></div><small class="kpi-note">Federal EMTALA and hospital policy: a balance never delays a medically ready discharge; this clears the financial step only.</small>` })
  });
  FORMS['dc-resolve'] = (f) => { const x = S().discharges.find((y) => y.id === f.d); const s = x.steps[+f.i]; s.state = 'Done'; s.by = `${me().name} · ${f.how}`; delete s.blocker; UI.modal = null; audit('discharge-step', { patient: P(x.patient), detail: `${s.t}: ${f.how}` }); save(); render(); };

  /* ======================= OT suite ======================= */
  const CK = SEED.whoChecklist;
  const phaseDone = (c, k) => CK[k].every((_, i) => c.check[k][i]);
  VIEWS.ot = (u) => {
    const cases = S().ot;
    if (!UI.otCase) UI.otCase = (cases.find((c) => c.stage === 'Preparation') || cases[0]).id;
    const c = cases.find((x) => x.id === UI.otCase);
    const board = cases.map((x) => { const p = P(x.patient); return `<button class="bay ${x.id === c.id ? 'sel' : ''}" style="text-align:left;cursor:pointer;font:inherit;color:inherit" data-act="ot-sel" data-c="${x.id}"><div class="row between"><span class="bed">${x.room} · ${x.scheduled}</span>${statePill(x.stage)}</div><b>${esc(x.procedure)}</b><span class="muted">${esc(p.name)} · ${esc(U(x.surgeon).name)}</span>${x.consent !== 'Signed' ? pill('crit', 'Consent not signed') : ''}</button>`; }).join('');
    const p = P(c.patient);
    audit('view-ot-case', { patient: p, resource: c.id });
    const si = SEED.otStages.indexOf(c.stage);
    const stepper = `<div class="stepper">${SEED.otStages.map((s, i) => `<span class="${i < si ? 'done' : i === si ? 'now' : ''}">${s}</span>`).join('')}</div>`;
    const phase = (k, label, when) => `<div class="stack" style="gap:6px"><h3>${label} <span class="muted" style="font-weight:400">· ${when}</span> ${phaseDone(c, k) ? pill('ok', 'Complete') : ''}</h3><div class="checklist">${CK[k].map((t, i) => `<label><input type="checkbox" data-act="ot-check" data-c="${c.id}" data-k="${k}" data-i="${i}" ${c.check[k][i] ? 'checked' : ''} ${c.stage === 'Completed' ? 'disabled' : ''}> ${esc(t)}</label>`).join('')}</div></div>`;
    let gate = '', nextLabel = '';
    if (c.stage === 'Scheduled') { nextLabel = 'Move to preparation'; if (c.consent !== 'Signed') gate = 'Surgical consent must be signed first.'; }
    if (c.stage === 'Preparation') { nextLabel = 'Start surgery'; if (!phaseDone(c, 'signIn') || !phaseDone(c, 'timeOut')) gate = 'Sign-in and time-out must be fully checked.'; }
    if (c.stage === 'In surgery') { nextLabel = 'Move to recovery'; if (!phaseDone(c, 'signOut')) gate = 'Sign-out must be fully checked.'; }
    if (c.stage === 'Recovery') nextLabel = p.id === 'P08' ? 'Complete and transfer to Ward 4B (bed 4B-09)' : 'Complete case';
    const detail = `<div class="ptheader"><div class="stack" style="gap:2px"><h2>${c.room} · ${esc(c.procedure)}</h2><span class="muted">CPT ${c.cpt} · site ${esc(c.site)} · scheduled ${c.scheduled}</span></div>${statePill(c.stage)}</div>
      ${stepper}
      <dl class="kv" style="margin:0"><div><dt>Patient</dt><dd style="margin:0">${ptLink(p)} · ${p.age}${p.sex}</dd></div><div><dt>Surgeon</dt><dd style="margin:0">${esc(U(c.surgeon).name)}</dd></div><div><dt>Anesthesia</dt><dd style="margin:0">${esc(c.anesthesia)}</dd></div><div><dt>Consent</dt><dd style="margin:0">${c.consent === 'Signed' ? pill('ok', 'Signed') : pill('crit', 'Not signed')}</dd></div><div><dt>Blood group</dt><dd style="margin:0">${esc(p.bloodGroup)}</dd></div>${c.ebl ? `<div><dt>Est. blood loss</dt><dd style="margin:0">${esc(c.ebl)}</dd></div>` : ''}</dl>
      <div class="chips"><span class="muted" style="font-size:12px;margin-right:4px">ALLERGIES</span>${allergyChips(p)}</div>
      ${c.note ? `<div class="banner info"><p>${esc(c.note)}</p></div>` : ''}
      <div class="grid">${phase('signIn', 'Sign-in', 'before anesthesia')}${phase('timeOut', 'Time-out', 'before incision')}${phase('signOut', 'Sign-out', 'before leaving OR')}</div>
      ${c.stage !== 'Completed' ? `<div class="row">${gate ? `<div class="banner warn"><p>${gate}</p></div>` : ''}<button class="btn primary" data-act="ot-next" data-c="${c.id}" ${gate ? 'disabled' : ''}>${nextLabel}</button>${c.consent !== 'Signed' && me().role === 'doctor' ? `<button class="btn" data-act="ot-consent" data-c="${c.id}">Record consent…</button>` : ''}</div>` : ''}
      <p class="kpi-note">WHO Surgical Safety Checklist. A stage can't advance until its phase is complete.</p>`;
    return { title: 'OT suite', sub: `Operating rooms · ${T.dayStr(0)}`, body:
      tiles([[cases.length, 'Cases today'], [cases.filter((x) => x.stage === 'In surgery').length, 'In surgery', 'warn'], [cases.filter((x) => x.stage === 'Recovery').length, 'In recovery'], [cases.filter((x) => x.consent !== 'Signed').length, 'Consent missing', 'crit'], [new Set(cases.filter((x) => ['Preparation', 'In surgery'].includes(x.stage)).map((x) => x.room)).size + '/3', 'Rooms in use']]) +
      `<div class="board">${board}</div>` + panel('Case', detail) };
  };
  Object.assign(ACT, {
    'ot-sel': (d) => { UI.otCase = d.c; render(); },
    'ot-check': (d) => { const c = S().ot.find((x) => x.id === d.c); c.check[d.k][d.i] = !c.check[d.k][d.i]; audit('who-checklist', { patient: P(c.patient), detail: `${d.k}: ${CK[d.k][+d.i]}` }); save(); render(); },
    'ot-next': (d) => { const c = S().ot.find((x) => x.id === d.c); const i = SEED.otStages.indexOf(c.stage); c.stage = SEED.otStages[i + 1];
      if (c.stage === 'Completed' && c.patient === 'P08') { T.patchPatient('P08', { unit: 'W4B', bed: '4B-09' }); delete S().bedStatus['4B-09']; }
      audit('ot-stage', { patient: P(c.patient), detail: `${c.id} → ${c.stage}` }); save(); render(); toast(`${c.room}: ${c.stage}.`); },
    'ot-consent': (d) => openModal({ title: 'Record surgical consent', form: 'ot-consent', submit: 'Record consent', body: `<input type="hidden" name="c" value="${d.c}"><p>${esc(S().ot.find((x) => x.id === d.c).procedure)}</p><label class="row" style="gap:8px"><input type="checkbox" name="r" required> Risks, benefits and alternatives discussed; questions answered</label><div class="field"><label for="cw">Witness</label><input id="cw" name="w" required placeholder="Name of witness"></div><div class="field"><label for="ci">Interpreter</label><select id="ci" name="i"><option>Not needed</option><option>Spanish, in person</option><option>Video interpreter</option></select></div>` })
  });
  FORMS['ot-consent'] = (f) => { const c = S().ot.find((x) => x.id === f.c); c.consent = 'Signed'; S().consents.push({ patient: c.patient, kind: 'Surgical consent — ' + c.procedure, state: 'Done', by: me().name, at: new Date().toISOString(), detail: `Witness ${f.w}; interpreter: ${f.i}` }); UI.modal = null; audit('consent-recorded', { patient: P(c.patient), detail: c.procedure }); save(); render(); };

  /* ======================= Day care ======================= */
  VIEWS.daycare = (u) => {
    const list = S().daycare.filter((d) => d.phase !== 'Discharged');
    const cards = list.map((d) => { const p = P(d.patient); const i = SEED.dayPhases.indexOf(d.phase);
      const dbp = +String(p.vitals.bp).split('/')[1]; const flags = [];
      if (dbp >= 100) flags.push(pill('crit', 'Diastolic ≥ 100: notify physician before procedure'));
      if (/transfusion/i.test(d.procedure)) { const xm = (S().crossmatch || []).find((x) => x.patient === p.id); flags.push(xm && xm.state === 'Issued' ? pill('ok', 'Blood issued · bedside check done') : pill('warn', 'Waiting for blood bank')); }
      return `<div class="bay"><div class="row between"><span class="bed">${esc(p.bed)}</span>${pill(d.phase === 'Ready for discharge' ? 'ok' : d.phase === 'In procedure' ? 'info' : d.phase === 'Recovery' ? 'accent' : 'warn', d.phase)}</div><b>${ptLink(p)}</b><span class="muted">${p.age}${p.sex} · ${esc(d.procedure)}</span>
        <span class="mono" style="font-size:12px">BP ${p.vitals.bp} · HR ${p.vitals.hr} · SpO₂ ${p.vitals.spo2}%</span><span class="kpi-note">${mins(d.mOff)} in phase</span><div class="chips">${flags.join('')}</div>
        <div><button class="btn small ${d.phase === 'Ready for discharge' ? 'primary' : ''}" data-act="dc-phase" data-p="${p.id}">${d.phase === 'Ready for discharge' ? 'Discharge home' : 'Move to ' + SEED.dayPhases[i + 1].toLowerCase()}</button></div></div>`; }).join('');
    return { title: 'Day care unit', sub: 'Same-day procedures, infusions and transfusions', body:
      tiles([[list.length, 'Occupied bays'], [list.filter((d) => d.phase === 'In procedure').length, 'In procedure'], [list.filter((d) => d.phase === 'Recovery').length, 'In recovery'], [list.filter((d) => d.phase === 'Ready for discharge').length, 'Ready for discharge', 'ok']]) + `<div class="board">${cards}</div>` };
  };
  ACT['dc-phase'] = (d) => { const x = S().daycare.find((y) => y.patient === d.p); x.phase = SEED.dayPhases[SEED.dayPhases.indexOf(x.phase) + 1]; x.mOff = 0; if (x.phase === 'Discharged') T.patchPatient(d.p, { status: 'Discharged' }); audit('daycare-phase', { patient: P(d.p), detail: x.phase }); save(); render(); };

  /* ======================= Peri-op home ======================= */
  T.HOME['nurse:PERIOP'] = (u) => {
    const cases = S().ot; const dc = S().daycare.filter((d) => d.phase !== 'Discharged');
    const rows = cases.map((c) => { const p = P(c.patient); return `<tr class="clickable" data-act="go" data-href="#ot"><td class="mono">${c.scheduled}</td><td>${c.room}</td><td><b>${esc(c.procedure)}</b><span class="sub">${esc(p.name)} · ${esc(U(c.surgeon).name)}</span></td><td>${statePill(c.stage)}${c.consent !== 'Signed' ? ' ' + pill('crit', 'No consent') : ''}</td></tr>`; });
    return { title: 'Peri-operative services', sub: `OR schedule and day care · ${T.dayStr(0)}`, body:
      tiles([[cases.length, 'OR cases'], [cases.filter((c) => c.stage === 'In surgery').length, 'In surgery'], [cases.filter((c) => c.stage === 'Recovery').length, 'In PACU'], [dc.length, 'Day care bays used'], [dc.filter((d) => d.phase === 'Ready for discharge').length, 'Ready to go home', 'ok']]) +
      panel('OR schedule', table(['Time', 'Room', 'Procedure', 'Stage'], rows), '<a href="#ot">Open OT suite</a>', true) };
  };

  /* ---------- nav counts ---------- */
  Object.assign(T.counts, {
    er: () => { const n = S().er.filter((e) => !['Discharged', 'Admitted'].includes(e.status) && !e.provider && e.mOff > SEED.esiTarget[e.esi]).length; return n ? `<span class="count crit">${n}</span>` : ''; },
    handover: (u) => { const n = S().handovers.filter((h) => !h.ack && careRel(u, P(h.patient))).length; return n ? `<span class="count">${n}</span>` : ''; },
    discharge: (u) => { const n = S().discharges.reduce((k, d) => k + d.steps.filter((s) => s.owner === u.role && s.state !== 'Done').length, 0); return n ? `<span class="count">${n}</span>` : ''; },
    beds: () => { const n = S().bedRequests.filter((r) => !r.done).length; return n ? `<span class="count">${n}</span>` : ''; },
    ambient: (u) => { const n = (T.S.appts).filter((a) => a.provider === u.id && !['Completed', 'No-show'].includes(a.status)).length - S().ambientNotes.filter((x) => x.by === u.id).length; return n > 0 ? `<span class="count">${n}</span>` : ''; }
  });
})(window.Tessera);
