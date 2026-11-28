/* Phase 4b: Privacy Sentinel on the server. Rules run over the real audit log (tokens, never names):
   repeated out-of-scope attempts, after-hours access by non-clinical roles, VIP records opened outside
   the care team, break-the-glass use, staff opening a relative's record, and unusual volume. Each alert
   is explained and carries its evidence rows. Naming the patient is a separate, audited step. */

export interface AuditRow { seq: number; ts: Date; actor: string; role: string; action: string; resource: string; patient_token: string; outcome: string; detail: string; purpose: string; }
export interface Alert { id: string; risk: 'High' | 'Medium' | 'Low'; rule: string; who: string; pt: string; why: string; evidence: string[]; }
export interface SentinelCtx { vipTokens: Set<string>; relatives: Record<string, string[]>; /* user id -> tokens of relatives */ names: Record<string, string>; tz: string; }

const CLINICAL = new Set(['doctor', 'nurse', 'pharmacist']);
const PHI_ACTIONS = /^(view-chart|census|phi-reveal|fhir-read|write-)/;
const tokensOf = (r: AuditRow) => String(r.patient_token || '').split(/\s+/).filter(Boolean);
const hourIn = (d: Date, tz: string) => +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(d);
const when = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d);

export function analyse(rows: AuditRow[], ctx: SentinelCtx): Alert[] {
  const out: Alert[] = [];
  const name = (id: string) => ctx.names[id] || id;
  const ev = (r: AuditRow) => `${when(r.ts, ctx.tz)} · ${r.action}${r.detail ? ' · ' + r.detail.slice(0, 120) : ''}`;
  const group = <T>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => { (m[k(x)] ||= []).push(x); return m; }, {} as Record<string, T[]>);

  // 1. Repeated blocked attempts to open records outside the caller's role or care
  const denied = rows.filter((r) => r.outcome === 'denied' && (r.action === 'chart-denied' || (/^write-/.test(r.action) && /care relationship/.test(r.detail))));
  for (const [actor, es] of Object.entries(group(denied, (r) => r.actor))) {
    if (es.length < 2 || actor === 'anonymous') continue;
    out.push({ id: `PS-DENY-${actor}`, risk: es.length >= 3 ? 'High' : 'Medium', rule: 'Repeated blocked chart access', who: actor, pt: [...new Set(es.flatMap(tokensOf))].join(' ') || '—',
      why: `${name(actor)} was blocked ${es.length} times opening records outside their role or care relationships.`, evidence: es.slice(-8).map(ev) });
  }
  // 2. After-hours access to health data by a non-clinical role
  const late = rows.filter((r) => !CLINICAL.has(r.role) && r.role !== 'patient' && PHI_ACTIONS.test(r.action) && r.outcome === 'success' && (hourIn(r.ts, ctx.tz) >= 22 || hourIn(r.ts, ctx.tz) < 6));
  for (const [actor, es] of Object.entries(group(late, (r) => r.actor)))
    out.push({ id: `PS-NIGHT-${actor}`, risk: 'Medium', rule: 'After-hours access by a non-clinical role', who: actor, pt: [...new Set(es.flatMap(tokensOf))].slice(0, 6).join(' ') || '—',
      why: `${name(actor)} (${es[0].role}) accessed patient data between 22:00 and 06:00, ${es.length} time(s).`, evidence: es.slice(-6).map(ev) });
  // 3. VIP records opened without a care relationship (emergency access or pharmacy-wide view)
  const vip = rows.filter((r) => r.action === 'view-chart' && tokensOf(r).some((t) => ctx.vipTokens.has(t)) && /access: (btg|pharmacy)/.test(r.detail));
  for (const [k, es] of Object.entries(group(vip, (r) => r.actor + '|' + r.patient_token)))
    out.push({ id: `PS-VIP-${k}`, risk: 'Medium', rule: 'VIP record opened outside the care team', who: es[0].actor, pt: es[0].patient_token,
      why: 'A record flagged for extra protection was opened by someone without a care relationship at the time.', evidence: es.slice(-6).map(ev) });
  // 4. Break-the-glass: every use is reviewed; VIP makes it high risk
  for (const r of rows.filter((x) => x.action === 'break-the-glass' && x.outcome === 'success')) {
    const isVip = tokensOf(r).some((t) => ctx.vipTokens.has(t));
    out.push({ id: `PS-BTG-${r.seq}`, risk: isVip ? 'High' : 'Low', rule: 'Break-the-glass access', who: r.actor, pt: r.patient_token || '—', why: `${name(r.actor)} used emergency access.${isVip ? ' The record is VIP-flagged.' : ''}`, evidence: [ev(r)] });
  }
  // 5. Staff opening the record of a relative (from HR records)
  for (const [actor, toks] of Object.entries(ctx.relatives)) for (const t of toks) {
    const es = rows.filter((r) => r.actor === actor && r.outcome === 'success' && /^(view-chart|write-|fhir-read)/.test(r.action) && tokensOf(r).includes(t));
    if (es.length) out.push({ id: `PS-REL-${actor}-${t}`, risk: 'High', rule: "Staff member accessed a relative's record", who: actor, pt: t, why: `${name(actor)} accessed the record of someone listed as a relative in HR records.`, evidence: es.slice(-6).map(ev) });
  }
  // 6. Unusual volume: one person opening many different charts in an hour
  const views = rows.filter((r) => r.action === 'view-chart' && r.outcome === 'success');
  for (const [k, es] of Object.entries(group(views, (r) => r.actor + '|' + new Date(r.ts).toISOString().slice(0, 13)))) {
    const distinct = new Set(es.flatMap(tokensOf));
    if (distinct.size >= 15) out.push({ id: `PS-VOL-${k}`, risk: 'Medium', rule: 'Unusual number of charts opened', who: es[0].actor, pt: [...distinct].slice(0, 6).join(' '), why: `${name(es[0].actor)} opened ${distinct.size} different charts within one hour.`, evidence: es.slice(-5).map(ev) });
  }
  const order = { High: 0, Medium: 1, Low: 2 };
  return out.sort((a, b) => order[a.risk] - order[b.risk]);
}
