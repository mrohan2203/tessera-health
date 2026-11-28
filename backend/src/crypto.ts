/* Cryptography for the security core. Node's built-in crypto only.
   - Envelope encryption: each patient has its own 256-bit data key (DEK). Fields are encrypted with
     AES-256-GCM under that DEK; the DEK is stored wrapped by a key-encryption key (KEK).
     LocalKms keeps the KEK in .env for development. In production the same interface is backed by
     AWS KMS (GenerateDataKey / Decrypt), so the KEK never leaves the HSM.
   - Blind indexes: HMAC-SHA256 of a normalised value, so the API can find a patient by MRN or exact
     name without storing either in plain text.
   - Passwords: scrypt (N=2^15, r=8, p=1) with a per-user salt.
   - TOTP (RFC 6238): 30-second, 6-digit codes, compatible with any authenticator app. */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { env } from './env.ts';

export interface Kms { wrap(dek: Buffer): Buffer; unwrap(wrapped: Buffer): Buffer; }

function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]); // version 1 | iv | tag | ciphertext
}
function open(key: Buffer, box: Buffer): Buffer {
  if (box[0] !== 1) throw new Error('unknown ciphertext version');
  const iv = box.subarray(1, 13), tag = box.subarray(13, 29), ct = box.subarray(29);
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export class LocalKms implements Kms {
  #kek: Buffer;
  constructor(hex: string) { this.#kek = Buffer.from(hex, 'hex'); if (this.#kek.length !== 32) throw new Error('KEK must be 32 bytes'); }
  wrap(dek: Buffer) { return seal(this.#kek, dek); }
  unwrap(w: Buffer) { return open(this.#kek, w); }
}
export const kms: Kms = new LocalKms(env.KEK_HEX);

export const newDek = () => randomBytes(32);
export const encField = (dek: Buffer, v: unknown) => (v == null ? null : seal(dek, Buffer.from(typeof v === 'string' ? v : JSON.stringify(v), 'utf8')));
export const decText = (dek: Buffer, b: Buffer | null) => (b ? open(dek, b).toString('utf8') : null);
export const decJson = (dek: Buffer, b: Buffer | null) => (b ? JSON.parse(open(dek, b).toString('utf8')) : null);
export const sealWithKek = (v: string) => kms.wrap(Buffer.from(v, 'utf8'));
export const openWithKek = (b: Buffer) => kms.unwrap(b).toString('utf8');

const indexKey = Buffer.from(env.INDEX_KEY_HEX, 'hex');
export const blindIndex = (v: string) => createHmac('sha256', indexKey).update(String(v).trim().toLowerCase().replace(/\s+/g, ' ')).digest();

export function hashPassword(pw: string): string {
  const salt = randomBytes(16); const h = scryptSync(pw, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, N, r, p, s, h] = stored.split('$'); if (alg !== 'scrypt') return false;
  const got = scryptSync(pw, Buffer.from(s, 'base64'), 32, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(got, Buffer.from(h, 'base64'));
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
function unbase32(s: string) { let bits = 0, val = 0; const out: number[] = []; for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export const newTotpSecret = () => base32(randomBytes(20));
export function totp(secret: string, at = Date.now(), step = 0): string {
  const counter = Math.floor(at / 30000) + step; const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
export const verifyTotp = (secret: string, code: string) => [-1, 0, 1].some((s) => timingSafeEqual(Buffer.from(totp(secret, Date.now(), s)), Buffer.from(String(code).padStart(6, '0').slice(0, 6))));

const pepper = Buffer.from(env.SESSION_PEPPER_HEX, 'hex');
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const sessionHash = (t: string) => createHash('sha256').update(pepper).update(t).digest();
export const patientToken = (mrn: string) => 'PT-' + createHmac('sha256', indexKey).update('token|' + mrn).digest('hex').slice(0, 6).toUpperCase();
