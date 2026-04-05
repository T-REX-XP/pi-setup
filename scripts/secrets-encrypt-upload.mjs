#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

const workerUrl = process.env.PI_SETUP_WORKER_URL;
const bootstrapToken = process.env.PI_SETUP_BOOTSTRAP_TOKEN;
const passphrase = process.env.PI_SETUP_MASTER_KEY;
const name = process.argv[2];
const inputFile = process.argv[3];

if (!workerUrl || !bootstrapToken || !passphrase || !name || !inputFile) {
  console.error('Usage: PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MASTER_KEY=... node scripts/secrets-encrypt-upload.mjs <secret-name> <input-file>');
  process.exit(1);
}

const plaintext = await readFile(inputFile, 'utf8');
const key = createHash('sha256').update(passphrase).digest();
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();

const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/secrets/upsert`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${bootstrapToken}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    name,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    algorithm: 'AES-256-GCM',
    version: '1'
  })
});

console.log(await res.text());
if (!res.ok) process.exit(1);
