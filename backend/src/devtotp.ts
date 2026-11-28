/* Development helper: prints the current 6-digit code for a seeded user, standing in for their
   authenticator app. Reads backend/.dev-credentials.json (git-ignored). Usage: npm run totp -- elena.cardio */
import { readFileSync } from 'node:fs';
import { totp } from './crypto.ts';
const who = process.argv[2];
const creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8'));
if (!who || !creds[who]) { console.error('usage: npm run totp -- <username>'); process.exit(1); }
console.log(totp(creds[who].totpSecret));
