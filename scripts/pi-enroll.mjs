#!/usr/bin/env node
/**
 * Single entry for enrollment: issues a short-lived token (admin) or enrolls this machine (target).
 *
 * Reads `.env.runtime` (or `PI_SETUP_ENV_FILE`) and `sync.json` for anything not already in the environment.
 * No prompts — set variables or files, then run:
 *
 *   npm run enroll
 *
 * Admin (bootstrap token in env/file, no enrollment JWT): POST /v1/enrollment-tokens/issue with
 * machineId = slug(hostname) or PI_SETUP_ENROLL_MACHINE_ID, secretName from PI_SETUP_SECRET_NAME
 * or sync.json `secretName` or default pi-secrets-<machineId>. Prints a one-line command for the target.
 *
 * Target: PI_SETUP_ENROLL_BUNDLE from admin paste, or PI_SETUP_ENROLLMENT_TOKEN + PI_SETUP_MASTER_KEY
 * in env/file. Writes `.env.runtime` (decrypted secret + fleet footer) unless --plain.
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv, createHash } from 'node:crypto';
import {
  loadPiEnvFile,
  resolvePiEnvFilePath,
  writeEnrolledRuntimeFile,
} from './lib/pi-env-file.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function slug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function readSyncJson() {
  const p = path.join(ROOT, 'sync.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  let envFileOpt;
  let outFile = '.env.runtime';
  let plain = false;
  let bundleArg;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--pi-runtime' || a === '--runtime-env') && argv[i + 1]) {
      envFileOpt = argv[++i];
      continue;
    }
    if (a === '--out' && argv[i + 1]) {
      outFile = argv[++i];
      continue;
    }
    if (a === '--plain') {
      plain = true;
      continue;
    }
    if (a === '--bundle' && argv[i + 1]) {
      bundleArg = argv[++i];
      continue;
    }
    if (a === '--env-file') {
      console.error(
        'Use --pi-runtime <path> (Node reserves --env-file). Or set PI_SETUP_ENV_FILE.',
      );
      process.exit(1);
    }
    if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    }
    rest.push(a);
  }
  if (rest[0]) outFile = rest[0];
  return { envFileOpt, outFile, plain, bundleArg };
}

const { envFileOpt, outFile, plain: plainFlag, bundleArg } = parseArgs(process.argv.slice(2));
const plain = plainFlag || process.env.PI_SETUP_ENROLL_PLAIN_OUTPUT === '1';

/** @param {string} b64 */
function decodeBundle(b64) {
  const raw = Buffer.from(b64, 'base64url').toString('utf8');
  const j = JSON.parse(raw);
  if (j.v !== 1 || typeof j.w !== 'string' || typeof j.t !== 'string' || typeof j.k !== 'string') {
    throw new Error('Invalid PI_SETUP_ENROLL_BUNDLE (expected v1 with w,t,k)');
  }
  return { workerUrl: j.w, enrollmentToken: j.t, masterKey: j.k };
}

const bundleRaw = bundleArg || process.env.PI_SETUP_ENROLL_BUNDLE;
if (bundleRaw) {
  try {
    const d = decodeBundle(bundleRaw.trim());
    process.env.PI_SETUP_WORKER_URL = d.workerUrl;
    process.env.PI_SETUP_ENROLLMENT_TOKEN = d.enrollmentToken;
    process.env.PI_SETUP_MASTER_KEY = d.masterKey;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
} else {
  const envPath = resolvePiEnvFilePath({ cwd: process.cwd(), root: ROOT, explicit: envFileOpt });
  await loadPiEnvFile(envPath, { override: false });
}

const sync = readSyncJson();
const workerUrl = (process.env.PI_SETUP_WORKER_URL || sync.workerUrl || '').replace(/\/$/, '');
const machineId = slug(
  process.env.PI_SETUP_ENROLL_MACHINE_ID ||
    (typeof sync.enrollMachineId === 'string' && sync.enrollMachineId.trim()
      ? sync.enrollMachineId.trim()
      : os.hostname()),
);
const secretName =
  process.env.PI_SETUP_SECRET_NAME ||
  (typeof sync.secretName === 'string' && sync.secretName.trim()
    ? sync.secretName.trim()
    : `pi-secrets-${machineId}`);

const enrollmentToken = process.env.PI_SETUP_ENROLLMENT_TOKEN || '';
const bootstrapToken = process.env.PI_SETUP_BOOTSTRAP_TOKEN || '';
const masterKey = process.env.PI_SETUP_MASTER_KEY || '';

// ── Enroll (JWT present) ─────────────────────────────────────────────────────
if (enrollmentToken) {
  if (!workerUrl || !masterKey) {
    console.error(
      'Enroll mode: need PI_SETUP_WORKER_URL (or sync.json workerUrl), PI_SETUP_ENROLLMENT_TOKEN, PI_SETUP_MASTER_KEY.',
    );
    process.exit(1);
  }

  const enrollRes = await fetch(`${workerUrl}/v1/machines/enroll`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${enrollmentToken}`,
      'content-type': 'application/json',
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      enrolledFrom: 'scripts/pi-enroll.mjs',
    }),
  });
  if (!enrollRes.ok) {
    console.error(await enrollRes.text());
    process.exit(1);
  }
  const enrollPayload = await enrollRes.json();
  const scopedBootstrap = enrollPayload.bootstrapToken;
  const resolvedSecret = enrollPayload.secretName;
  const mid = enrollPayload.machineId;

  const secretRes = await fetch(`${workerUrl}/v1/secrets/${encodeURIComponent(resolvedSecret)}`, {
    headers: {
      authorization: `Bearer ${scopedBootstrap}`,
      'x-request-id': crypto.randomUUID(),
    },
  });
  if (!secretRes.ok) {
    console.error(await secretRes.text());
    process.exit(1);
  }
  const { secret } = await secretRes.json();
  const key = createHash('sha256').update(masterKey).digest();
  const iv = Buffer.from(secret.iv, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  if (plain) {
    await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
    await writeFile(outFile, plaintext, 'utf8');
  } else {
    await writeEnrolledRuntimeFile(outFile, {
      secretPlaintext: plaintext,
      workerUrl,
      bootstrapToken: scopedBootstrap,
      machineId: mid,
    });
  }

  try {
    const syncPath = path.join(ROOT, 'sync.json');
    const next = { ...sync, workerUrl };
    await writeFile(syncPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  } catch {
    /* optional */
  }

  console.log(
    `Enrolled ${mid} → ${outFile}${plain ? ' (plain)' : ' (+ fleet footer). Run: npm run daemon'}`,
  );
  process.exit(0);
}

// ── Issue (bootstrap present, no enrollment JWT) ────────────────────────────
if (bootstrapToken) {
  if (!workerUrl) {
    console.error('Issue mode: set workerUrl in sync.json or PI_SETUP_WORKER_URL.');
    process.exit(1);
  }
  if (!masterKey) {
    console.error('Issue mode: PI_SETUP_MASTER_KEY required in .env.runtime to build the target one-liner.');
    process.exit(1);
  }

  const ttlSeconds = Math.max(
    60,
    Number(process.env.PI_SETUP_ENROLLMENT_TTL_SECONDS || 600),
  );

  const res = await fetch(`${workerUrl}/v1/enrollment-tokens/issue`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bootstrapToken}`,
      'content-type': 'application/json',
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({ machineId, secretName, ttlSeconds }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(bodyText);
    process.exit(1);
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    console.error(bodyText);
    process.exit(1);
  }
  const token = body.token;
  if (!token) {
    console.error('No token in response:', bodyText);
    process.exit(1);
  }

  const bundle = Buffer.from(
    JSON.stringify({ v: 1, w: workerUrl, t: token, k: masterKey }),
    'utf8',
  ).toString('base64url');

  console.error(`Issued enrollment for machineId=${machineId} secretName=${secretName} (TTL ${ttlSeconds}s)`);
  console.error('\nOn the target (repo root), run exactly:\n');
  console.error(`PI_SETUP_ENROLL_BUNDLE='${bundle}' npm run enroll\n`);
  console.log(JSON.stringify({ ok: true, machineId, secretName, ttlSeconds }, null, 0));
  process.exit(0);
}

console.error(`Nothing to do. Either:

  Admin — put in .env.runtime: PI_SETUP_WORKER_URL (or set sync.json workerUrl), PI_SETUP_BOOTSTRAP_TOKEN, PI_SETUP_MASTER_KEY
         Optional: PI_SETUP_ENROLL_MACHINE_ID, PI_SETUP_SECRET_NAME (default secret: pi-secrets-<machineId>)

  Target — PI_SETUP_ENROLL_BUNDLE='<paste from admin>' npm run enroll
         or put PI_SETUP_ENROLLMENT_TOKEN + PI_SETUP_MASTER_KEY (+ worker URL) in .env.runtime and run npm run enroll
`);
process.exit(1);
