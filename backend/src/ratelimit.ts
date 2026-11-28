/* Phase 5: rate limits (token buckets, in memory). Sign-in is limited per address; the API per session
   or address; FHIR per token. Over the limit the request gets 429 with Retry-After, and the event is
   audited at most once a minute per key so a flood cannot flood the audit log too.
   Several API instances behind a load balancer need a shared store (Redis) or the AWS WAF rate rule;
   this keeps one instance honest and documents the limits. */
export interface Limit { perMinute: number; burst: number; }
export const LIMITS: Record<string, Limit> = {
  auth: { perMinute: 20, burst: 10 },   // sign-in steps per address (account lockout also applies)
  api: { perMinute: 600, burst: 120 },  // per session or address
  fhir: { perMinute: 120, burst: 40 },  // per app token or address
};
const buckets = new Map<string, { tokens: number; at: number }>();
const lastAudit = new Map<string, number>();
export function take(kind: string, key: string, now = Date.now()): { ok: boolean; retryAfter: number; auditNow: boolean } {
  const l = LIMITS[kind]; const k = kind + '|' + key;
  const b = buckets.get(k) || { tokens: l.burst, at: now };
  b.tokens = Math.min(l.burst, b.tokens + ((now - b.at) / 60000) * l.perMinute); b.at = now;
  if (b.tokens >= 1) { b.tokens -= 1; buckets.set(k, b); return { ok: true, retryAfter: 0, auditNow: false }; }
  buckets.set(k, b);
  const retryAfter = Math.ceil(((1 - b.tokens) / l.perMinute) * 60);
  const la = lastAudit.get(k) || 0; const auditNow = now - la > 60000; if (auditNow) lastAudit.set(k, now);
  return { ok: false, retryAfter, auditNow };
}
export const resetLimits = () => { buckets.clear(); lastAudit.clear(); };
// Drop idle buckets so memory stays bounded
setInterval(() => { const cut = Date.now() - 10 * 60000; for (const [k, b] of buckets) if (b.at < cut) buckets.delete(k); }, 60000).unref();
