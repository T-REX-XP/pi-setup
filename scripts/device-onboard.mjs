#!/usr/bin/env node
/**
 * device-onboard.mjs — Single-command new machine onboarding
 *
 * ── Admin: issue an enrollment token ──────────────────────────────────────
 *   node scripts/device-onboard.mjs --issue
 *   # prompts for any missing env vars, prints a ready-to-paste command for the new machine
 *
 * ── New machine: enroll + start daemon ────────────────────────────────────
 *   node scripts/device-onboard.mjs
 *   # or paste the command printed by --issue (all vars pre-filled)
 *
 * All required values can be supplied as env vars to skip interactive prompts:
 *   PI_SETUP_WORKER_URL, PI_SETUP_BOOTSTRAP_TOKEN, PI_SETUP_MASTER_KEY
 *   PI_SETUP_ENROLLMENT_TOKEN  (enroll mode only)
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createDecipheriv, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isIssueMode = process.argv.includes('--issue');

const rl = createInterface({ input, output });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEnv(name) {
  return process.env[name] || '';
}

async function prompt(question, defaultValue = '') {
  const hint = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`  ${question}${hint}: `)).trim();
  return answer || defaultValue;
}

async function requireEnv(name, question, isSecret = false) {
  let value = getEnv(name);
  if (!value) {
    if (isSecret) {
      value = (await rl.question(`  ${question}: `)).trim();
    } else {
      value = await prompt(question);
    }
  } else {
    console.log(`  ${question}: (using $${name})`);
  }
  if (!value) {
    console.error(`\n✘  ${name} is required.\n`);
    rl.close();
    process.exit(1);
  }
  return value;
}

function slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ─── Issue mode (admin machine) ───────────────────────────────────────────────

async function issueMode() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  pi-setup ▸ Issue enrollment token  (admin)              ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  This generates a short-lived token you paste on the     ║');
  console.log('║  new machine. Missing values will be prompted below.     ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const workerUrl  = await requireEnv('PI_SETUP_WORKER_URL',      'Worker URL  (https://…workers.dev)');
  const adminToken = await requireEnv('PI_SETUP_BOOTSTRAP_TOKEN', 'Admin bootstrap token', true);
  const masterKey  = await requireEnv('PI_SETUP_MASTER_KEY',      'Master key  (AES passphrase)', true);

  const defaultMachineId  = slug(os.hostname());
  const machineId         = slug(await prompt('Machine ID for the new device', defaultMachineId));
  const defaultSecretName = `pi-secrets-${machineId}`;
  const secretName        = await prompt('Secret name (KV key with encrypted config)', defaultSecretName);
  const ttlRaw            = await prompt('Token TTL in seconds', '600');
  const ttlSeconds        = Math.max(60, Number(ttlRaw) || 600);

  rl.close();

  console.log(`\n  → Issuing enrollment token for "${machineId}"…`);

  const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/enrollment-tokens/issue`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({ machineId, secretName, ttlSeconds }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`\n✘  Failed to issue token:\n${body}\n`);
    process.exit(1);
  }

  let tokenJson;
  try { tokenJson = JSON.parse(body); } catch {
    console.error(`\n✘  Unexpected response:\n${body}\n`);
    process.exit(1);
  }

  const enrollmentToken = tokenJson.token;
  if (!enrollmentToken) {
    console.error('\n✘  No "token" field in response:', body, '\n');
    process.exit(1);
  }

  const cmd =
    `PI_SETUP_WORKER_URL='${workerUrl}' \\\n` +
    `PI_SETUP_ENROLLMENT_TOKEN='${enrollmentToken}' \\\n` +
    `PI_SETUP_MASTER_KEY='${masterKey}' \\\n` +
    `node scripts/device-onboard.mjs`;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✔  Token issued!  Paste this on the NEW machine:        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(cmd);
  console.log(`\n  ⏱  Expires in ${ttlSeconds}s — paste within that window.\n`);
}

// ─── Enroll mode (new machine) ────────────────────────────────────────────────

async function enrollMode() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  pi-setup ▸ Enroll this machine                          ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Missing values will be prompted below.                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const workerUrl       = await requireEnv('PI_SETUP_WORKER_URL',       'Worker URL  (https://…workers.dev)');
  const enrollmentToken = await requireEnv('PI_SETUP_ENROLLMENT_TOKEN', 'Enrollment token (from admin --issue)', true);
  const masterKey       = await requireEnv('PI_SETUP_MASTER_KEY',       'Master key  (AES passphrase)', true);

  // Positional arg overrides default output path
  const outFile = process.argv.slice(2).find(a => !a.startsWith('--')) || '.env.runtime';

  // ── Step 1: Enroll ────────────────────────────────────────────────────────
  console.log(`\n  → Enrolling ${os.hostname()}…`);

  const enrollRes = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/machines/enroll`, {
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
      enrolledFrom: 'scripts/device-onboard.mjs',
    }),
  });

  if (!enrollRes.ok) {
    console.error(`\n✘  Enrollment failed:\n${await enrollRes.text()}\n`);
    process.exit(1);
  }

  const enrollPayload  = await enrollRes.json();
  const bootstrapToken = enrollPayload.bootstrapToken;
  const secretName     = enrollPayload.secretName;
  const machineId      = enrollPayload.machineId;
  console.log(`  ✔  Enrolled as: ${machineId}`);

  // ── Step 2: Fetch + decrypt secret ────────────────────────────────────────
  console.log(`  → Fetching secret "${secretName}"…`);

  const secretRes = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/secrets/${encodeURIComponent(secretName)}`, {
    headers: {
      authorization: `Bearer ${bootstrapToken}`,
      'x-request-id': crypto.randomUUID(),
    },
  });

  if (!secretRes.ok) {
    console.error(`\n✘  Failed to fetch secret:\n${await secretRes.text()}\n`);
    process.exit(1);
  }

  const { secret } = await secretRes.json();
  const key        = createHash('sha256').update(masterKey).digest();
  const iv         = Buffer.from(secret.iv, 'base64');
  const decipher   = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  const plaintext  = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
  await writeFile(outFile, plaintext, 'utf8');
  console.log(`  ✔  Secrets written to: ${outFile}`);

  // ── Step 3: Persist worker URL in sync.json ───────────────────────────────
  try {
    const syncPath = path.join(ROOT, 'sync.json');
    let cfg = {};
    try { cfg = JSON.parse(await readFile(syncPath, 'utf8')); } catch {}
    cfg.workerUrl = workerUrl;
    await writeFile(syncPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log(`  ✔  sync.json updated`);
  } catch { /* non-fatal */ }

  // ── Step 4: Daemon ────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✔  Machine enrolled successfully!                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const daemonChoice = await prompt(
    'Start fleet daemon?\n\n' +
    '    1 — Start now (foreground)\n' +
    '    2 — Install systemd user service (Linux)\n' +
    '    3 — Skip (print manual command)\n\n' +
    '  Choice',
    '1'
  );
  rl.close();

  const daemonEnv = {
    ...process.env,
    PI_SETUP_WORKER_URL:      workerUrl,
    PI_SETUP_BOOTSTRAP_TOKEN: bootstrapToken,
    PI_SETUP_MACHINE_ID:      machineId,
  };

  if (daemonChoice === '1') {
    console.log('\n  → Starting fleet daemon  (Ctrl+C to stop)…\n');
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'fleet-daemon.mjs')], {
      env: daemonEnv,
      stdio: 'inherit',
      cwd: ROOT,
    });
    child.on('exit', code => process.exit(code ?? 0));
  } else if (daemonChoice === '2') {
    if (os.platform() !== 'linux') {
      console.log('\n  ⚠  Systemd is only available on Linux.\n');
    } else {
      await installSystemd({ workerUrl, bootstrapToken, machineId });
      return;
    }
    printManualDaemonCmd({ workerUrl, bootstrapToken, machineId });
  } else {
    printManualDaemonCmd({ workerUrl, bootstrapToken, machineId });
  }
}

// ─── Systemd install ─────────────────────────────────────────────────────────

async function installSystemd({ workerUrl, bootstrapToken, machineId }) {
  const unit = `[Unit]
Description=pi-setup fleet daemon (${machineId})
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} ${path.join(ROOT, 'scripts', 'fleet-daemon.mjs')}
Restart=always
RestartSec=5
Environment=PI_SETUP_WORKER_URL=${workerUrl}
Environment=PI_SETUP_BOOTSTRAP_TOKEN=${bootstrapToken}
Environment=PI_SETUP_MACHINE_ID=${machineId}
Environment=PI_SETUP_DAEMON_PORT=4269

[Install]
WantedBy=default.target
`;

  const serviceDir  = path.join(os.homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(serviceDir, 'pi-setup-fleet.service');
  await mkdir(serviceDir, { recursive: true });
  await writeFile(servicePath, unit, 'utf8');

  console.log(`\n  ✔  Systemd unit written to: ${servicePath}`);
  console.log('\n  Enable and start:\n');
  console.log('    systemctl --user daemon-reload');
  console.log('    systemctl --user enable --now pi-setup-fleet');
  console.log('    systemctl --user status pi-setup-fleet\n');
}

function printManualDaemonCmd({ workerUrl, bootstrapToken, machineId }) {
  console.log('\n  To start the daemon later:\n');
  console.log(
    `    PI_SETUP_WORKER_URL='${workerUrl}' \\\n` +
    `    PI_SETUP_BOOTSTRAP_TOKEN='${bootstrapToken}' \\\n` +
    `    PI_SETUP_MACHINE_ID='${machineId}' \\\n` +
    `    node scripts/fleet-daemon.mjs\n`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  if (isIssueMode) {
    await issueMode();
  } else {
    await enrollMode();
  }
} catch (err) {
  rl.close();
  console.error('\n✘  Unexpected error:', err?.message ?? err, '\n');
  process.exit(1);
}
