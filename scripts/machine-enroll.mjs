#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDecipheriv, createHash } from 'node:crypto';

const workerUrl = process.env.PI_SETUP_WORKER_URL;
const enrollmentToken = process.env.PI_SETUP_ENROLLMENT_TOKEN;
const passphrase = process.env.PI_SETUP_MASTER_KEY;
const outFile = process.argv[2] || '.env.runtime';

if (!workerUrl || !enrollmentToken || !passphrase) {
  console.error('Usage: PI_SETUP_WORKER_URL=... PI_SETUP_ENROLLMENT_TOKEN=... PI_SETUP_MASTER_KEY=... node scripts/machine-enroll.mjs [output-file]');
  process.exit(1);
}

const enrollRes = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/machines/enroll`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${enrollmentToken}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    enrolledFrom: 'scripts/machine-enroll.mjs'
  })
});
if (!enrollRes.ok) {
  console.error(await enrollRes.text());
  process.exit(1);
}
const enrollPayload = await enrollRes.json();
const bootstrapToken = enrollPayload.bootstrapToken;
const secretName = enrollPayload.secretName;

const secretRes = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/secrets/${encodeURIComponent(secretName)}`, {
  headers: { authorization: `Bearer ${bootstrapToken}` }
});
if (!secretRes.ok) {
  console.error(await secretRes.text());
  process.exit(1);
}
const payload = await secretRes.json();
const secret = payload.secret;
const key = createHash('sha256').update(passphrase).digest();
const iv = Buffer.from(secret.iv, 'base64');
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
const ciphertext = Buffer.from(secret.ciphertext, 'base64');
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
await writeFile(outFile, plaintext, 'utf8');
console.log(`Enrolled ${enrollPayload.machineId} and wrote decrypted secret ${secretName} to ${outFile}`);
