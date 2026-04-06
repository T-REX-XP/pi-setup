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

function log(level, event, details = {}) {
  console[level](JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    machineId,
    port,
    ...details,
  }));
}

function requestId(req) {
  return req.headers['x-request-id'] || crypto.randomUUID();
}

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
      lastRequestId: null,
    };
  }

  const lastAttemptAt = new Date().toISOString();
  const correlationId = crypto.randomUUID();
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/fleet/heartbeat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bootstrapToken}`,
        'content-type': 'application/json',
        'x-request-id': correlationId,
      },
      body: JSON.stringify(currentSnapshot),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(payload?.error || JSON.stringify(payload) || `HTTP ${res.status}`);
    }
    log('info', 'heartbeat.push.ok', {
      requestId: payload?.requestId || correlationId,
      remoteRequestId: payload?.requestId || null,
      status: res.status,
      hostname: currentSnapshot.hostname,
    });
    return {
      enabled: true,
      machineId,
      lastAttemptAt,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      lastRequestId: payload?.requestId || correlationId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', 'heartbeat.push.failed', {
      requestId: correlationId,
      error: message,
    });
    return {
      enabled: true,
      machineId,
      lastAttemptAt,
      lastSuccessAt: null,
      lastError: message,
      lastRequestId: correlationId,
    };
  }
}

async function refreshState() {
  const currentSnapshot = await snapshot();
  const heartbeat = await pushHeartbeat(currentSnapshot);
  return {
    ...currentSnapshot,
    heartbeat,
    diagnostics: {
      daemonPort: port,
      heartbeatIntervalMs,
      workerConfigured: Boolean(workerUrl && bootstrapToken),
      lastRefreshedAt: new Date().toISOString(),
    },
  };
}

await mkdir(runtimeDir, { recursive: true });
let lastSnapshot = await refreshState();
await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');
setInterval(async () => {
  try {
    lastSnapshot = await refreshState();
    await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');
  } catch (error) {
    log('error', 'state.refresh.failed', { error: error instanceof Error ? error.message : String(error) });
  }
}, heartbeatIntervalMs);

const server = http.createServer(async (req, res) => {
  const reqId = requestId(req);
  const respond = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': String(reqId) });
    res.end(JSON.stringify(body, null, 2));
  };

  if (!req.url) {
    respond(400, { ok: false, error: 'missing url', requestId: reqId });
    return;
  }

  log('info', 'http.request', { requestId: reqId, method: req.method, path: req.url });

  if (req.method === 'POST' && req.url === '/manage') {
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', async () => {
      const command = body || '{}';
      await writeFile(commandFile, `${new Date().toISOString()} ${command}\n`, { flag: 'a' });
      log('info', 'daemon.command.accepted', { requestId: reqId, bytes: command.length });
      respond(200, { ok: true, accepted: true, requestId: reqId });
    });
    return;
  }

  if (req.url === '/health') {
    respond(200, {
      ok: true,
      service: 'pi-setup-fleet-daemon',
      timestamp: new Date().toISOString(),
      machineId,
      remoteHeartbeatEnabled: Boolean(workerUrl && bootstrapToken),
      requestId: reqId,
    });
    return;
  }

  if (req.url === '/metrics') {
    respond(200, { ...lastSnapshot, requestId: reqId });
    return;
  }

  if (req.url === '/diagnostics') {
    let commandsQueued = 0;
    try {
      const commandLog = await readFile(commandFile, 'utf8');
      commandsQueued = commandLog.trim() ? commandLog.trim().split('\n').length : 0;
    } catch {
      commandsQueued = 0;
    }
    respond(200, {
      ok: true,
      requestId: reqId,
      diagnostics: {
        machineId,
        daemonPort: port,
        heartbeatIntervalMs,
        workerConfigured: Boolean(workerUrl && bootstrapToken),
        commandLogPath: commandFile,
        commandsQueued,
        latestStatePath: stateFile,
        lastSnapshot,
      },
    });
    return;
  }

  if (req.url === '/state') {
    try {
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': String(reqId) });
      res.end(await readFile(stateFile, 'utf8'));
    } catch {
      respond(200, { ...lastSnapshot, requestId: reqId });
    }
    return;
  }

  respond(404, { ok: false, error: 'not found', requestId: reqId });
});

server.listen(port, '127.0.0.1', () => {
  log('info', 'daemon.started', { listen: `http://127.0.0.1:${port}`, workerConfigured: Boolean(workerUrl && bootstrapToken) });
});
