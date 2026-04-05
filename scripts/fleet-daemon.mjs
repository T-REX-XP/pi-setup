#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const runtimeDir = path.resolve('.pi/runtime');
const stateFile = path.join(runtimeDir, 'fleet-daemon.json');
const commandFile = path.join(runtimeDir, 'fleet-commands.jsonl');
const port = Number(process.env.PI_SETUP_DAEMON_PORT || 4269);
const heartbeatIntervalMs = Number(process.env.PI_SETUP_HEARTBEAT_INTERVAL_MS || 15000);
const workerUrl = process.env.PI_SETUP_WORKER_URL;
const bootstrapToken = process.env.PI_SETUP_BOOTSTRAP_TOKEN;
const machineId = process.env.PI_SETUP_MACHINE_ID || os.hostname();

async function snapshot() {
  const cpus = os.cpus();
  return {
    machineId,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    uptimeSeconds: os.uptime(),
    loadavg: os.loadavg(),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    },
    cpuCount: cpus.length,
    arch: os.arch(),
    timestamp: new Date().toISOString(),
  };
}

async function pushHeartbeat(currentSnapshot) {
  if (!workerUrl || !bootstrapToken) {
    return {
      enabled: false,
      machineId,
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: null,
      lastError: null,
    };
  }

  const lastAttemptAt = new Date().toISOString();
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/fleet/heartbeat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bootstrapToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(currentSnapshot),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return {
      enabled: true,
      machineId,
      lastAttemptAt,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
    };
  } catch (error) {
    return {
      enabled: true,
      machineId,
      lastAttemptAt,
      lastSuccessAt: null,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refreshState() {
  const currentSnapshot = await snapshot();
  const heartbeat = await pushHeartbeat(currentSnapshot);
  return {
    ...currentSnapshot,
    heartbeat,
  };
}

await mkdir(runtimeDir, { recursive: true });
let lastSnapshot = await refreshState();
await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');
setInterval(async () => {
  lastSnapshot = await refreshState();
  await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');
}, heartbeatIntervalMs);

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end('missing url');
    return;
  }
  if (req.method === 'POST' && req.url === '/manage') {
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', async () => {
      const command = body || '{}';
      await writeFile(commandFile, `${new Date().toISOString()} ${command}\n`, { flag: 'a' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accepted: true }));
    });
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'pi-setup-fleet-daemon', timestamp: new Date().toISOString(), machineId, remoteHeartbeatEnabled: Boolean(workerUrl && bootstrapToken) }));
    return;
  }
  if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(lastSnapshot, null, 2));
    return;
  }
  if (req.url === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    try {
      res.end(await readFile(stateFile, 'utf8'));
    } catch {
      res.end(JSON.stringify(lastSnapshot, null, 2));
    }
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`pi-setup fleet daemon listening on http://127.0.0.1:${port}`);
});
