#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDecipheriv, createHash } from 'node:crypto';

const workerUrl = process.env.PI_SETUP_WORKER_URL;
const bootstrapToken = process.env.PI_SETUP_BOOTSTRAP_TOKEN;
const secretName = process.argv[2] || process.env.PI_SETUP_SECRET_NAME;
const outFile = process.argv[3] || '.env.runtime';
const passphrase = process.env.PI_SETUP_MASTER_KEY;

if (!workerUrl || !bootstrapToken || !secretName || !passphrase) {
  console.error('Usage: PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MASTER_KEY=... node scripts/secrets-sync.mjs <secret-name> [output-file]');
  process.exit(1);
}

const requestId = crypto.randomUUID();
const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/secrets/${encodeURIComponent(secretName)}`, {
  headers: {
    authorization: `Bearer ${bootstrapToken}`,
    'x-request-id': requestId,
  }
});
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const payload = await res.json();
const secret = payload.secret;
const key = createHash('sha256').update(passphrase).digest();
const iv = Buffer.from(secret.iv, 'base64');
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
const ciphertext = Buffer.from(secret.ciphertext, 'base64');
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
await writeFile(outFile, plaintext, 'utf8');
console.log(`Wrote decrypted secret to ${outFile}`);
