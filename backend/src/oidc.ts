/* Phase 5: sign-in through an identity provider (Okta, Microsoft Entra ID, or any OpenID Connect
   issuer). Authorization-code flow with PKCE, state and nonce; the ID token's signature is checked
   against the provider's published keys (RS256), and so are issuer, audience, expiry and nonce. The
   provider must assert that multi-factor authentication happened (amr contains "mfa"). No library:
   Node's crypto verifies the JWT. */
import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';

const b64u = (b: Buffer) => b.toString('base64url');
const cache = new Map<string, { at: number; v: any }>();
async function getJson(url: string, ttl = 600000) {
  const c = cache.get(url); if (c && Date.now() - c.at < ttl) return c.v;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`identity provider: ${url} returned ${r.status}`);
  const v = await r.json(); cache.set(url, { at: Date.now(), v }); return v;
}
export const discover = (issuer: string) => getJson(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration');
export const clearOidcCache = () => cache.clear();

export function pkce() { const verifier = b64u(randomBytes(32)); return { verifier, challenge: b64u(createHash('sha256').update(verifier).digest()) }; }
export const randomState = () => b64u(randomBytes(24));

export async function authorizeUrl(cfg: { issuer: string; clientId: string; redirect: string }, state: string, nonce: string, challenge: string) {
  const d = await discover(cfg.issuer);
  const u = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirect, scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
  return u.toString();
}

export async function exchange(cfg: { issuer: string; clientId: string; clientSecret: string; redirect: string }, code: string, verifier: string) {
  const d = await discover(cfg.issuer);
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirect, code_verifier: verifier, client_id: cfg.clientId });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (cfg.clientSecret) headers.authorization = 'Basic ' + Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64');
  const r = await fetch(d.token_endpoint, { method: 'POST', headers, body });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error(`token exchange failed (${r.status}${j.error ? ': ' + j.error : ''})`);
  return j.id_token as string;
}

/* Verifies the ID token and returns its claims, or throws with the reason. */
export async function verifyIdToken(cfg: { issuer: string; clientId: string }, idToken: string, nonce: string, now = Date.now()) {
  const parts = String(idToken).split('.'); if (parts.length !== 3) throw new Error('malformed ID token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error(`unsupported algorithm ${header.alg}`);
  const d = await discover(cfg.issuer);
  let jwks = await getJson(d.jwks_uri);
  let jwk = (jwks.keys || []).find((k: any) => k.kid === header.kid);
  if (!jwk) { cache.delete(d.jwks_uri); jwks = await getJson(d.jwks_uri); jwk = (jwks.keys || []).find((k: any) => k.kid === header.kid); } // the provider rotated its keys
  if (!jwk) throw new Error('signing key not published by the provider');
  const ok = createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('ID token signature is invalid');
  if (claims.iss !== d.issuer) throw new Error('ID token from the wrong issuer');
  if (!(claims.aud === cfg.clientId || (Array.isArray(claims.aud) && claims.aud.includes(cfg.clientId)))) throw new Error('ID token for another application');
  if (!(claims.exp * 1000 > now - 60000)) throw new Error('ID token expired');
  if (claims.nonce !== nonce) throw new Error('ID token nonce does not match');
  if (!(Array.isArray(claims.amr) && claims.amr.includes('mfa'))) throw new Error('the identity provider did not confirm multi-factor authentication');
  return claims;
}
