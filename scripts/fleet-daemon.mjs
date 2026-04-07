#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadPiEnvFileSync, resolvePiEnvFilePath } from './lib/pi-env-file.mjs';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
loadPiEnvFileSync(resolvePiEnvFilePath({ cwd: process.cwd(), root: REPO_ROOT }), { override: false });

// Load sync.json config (optional, falls back to env vars)
let syncConfig = {};
try {
  syncConfig = JSON.parse(await readFile(path.resolve('sync.json'), 'utf8'));
} catch { /* no sync.json, use env vars */ }

const runtimeDir = path.resolve('.pi/runtime');
const stateFile = path.join(runtimeDir, 'fleet-daemon.json');
const commandFile = path.join(runtimeDir, 'fleet-commands.jsonl');
const pushedSessionsFile = path.join(runtimeDir, 'pushed-sessions.json');
const port = Number(process.env.PI_SETUP_DAEMON_PORT || syncConfig.daemonPort || 4269);
const heartbeatIntervalMs = Number(process.env.PI_SETUP_HEARTBEAT_INTERVAL_MS || syncConfig.heartbeatIntervalMs || 60000);
const gitSyncIntervalMs = Number(process.env.PI_SETUP_GIT_SYNC_INTERVAL_MS || syncConfig.gitSyncIntervalMs || 300000);
const sessionScanIntervalMs = Number(process.env.PI_SETUP_SESSION_SCAN_INTERVAL_MS || syncConfig.sessionScanIntervalMs || 120000);
const maxBackoffMs = Number(process.env.PI_SETUP_MAX_BACKOFF_MS || syncConfig.maxBackoffMs || 300000);
const workerUrl = process.env.PI_SETUP_WORKER_URL || syncConfig.workerUrl || '';
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
  const tmuxSessions = await scanTmuxSessions();
  return {
    ...currentSnapshot,
    tmuxSessions,
    heartbeat,
    diagnostics: {
      daemonPort: port,
      heartbeatIntervalMs,
      gitSyncIntervalMs,
      sessionScanIntervalMs,
      workerConfigured: Boolean(workerUrl && bootstrapToken),
      lastRefreshedAt: new Date().toISOString(),
    },
  };
}

// ─── Exponential backoff retry ───────────────────────────────────────────────
async function withBackoff(fn, label, initialDelayMs = 5000) {
  let delay = initialDelayMs;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      const msg = error instanceof Error ? error.message : String(error);
      log('warn', `${label}.retry`, { attempt, delayMs: delay, error: msg });
      await new Promise((res) => setTimeout(res, delay));
      delay = Math.min(delay * 2, maxBackoffMs);
    }
  }
}

// ─── Git sync ────────────────────────────────────────────────────────────────
async function gitSync() {
  try {
    await execFileAsync('git', ['fetch', 'origin', '--prune'], { cwd: process.cwd() });
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: process.cwd() });
    const branch = stdout.trim();
    await execFileAsync('git', ['merge', '--ff-only', `origin/${branch}`], { cwd: process.cwd() });
    log('info', 'git.sync.ok', { branch });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Not fatal — repo may have local uncommitted changes or no remote
    if (!msg.includes('Already up to date') && !msg.includes('not something we can merge')) {
      log('warn', 'git.sync.skipped', { reason: msg.split('\n')[0] });
    }
  }
}

// ─── Pi session discovery & transcript push ──────────────────────────────────
async function loadPushedSessions() {
  try {
    return JSON.parse(await readFile(pushedSessionsFile, 'utf8'));
  } catch {
    return {}; // { [sessionId]: { pushedAt, messageCount } }
  }
}

async function savePushedSessions(record) {
  await writeFile(pushedSessionsFile, JSON.stringify(record, null, 2), 'utf8');
}

function encodeCwd(cwd) {
  // Pi encodes cwd as '--path-segments--' replacing / with - 
  return '--' + cwd.replace(/^[/\\]/, '').replace(/[/\\]/g, '-') + '--';
}

async function scanPiSessions(cwd) {
  const sessionsBase = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const encoded = encodeCwd(cwd);
  const sessionDir = path.join(sessionsBase, encoded);
  try {
    const files = await readdir(sessionDir);
    return files
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({
        file: path.join(sessionDir, f),
        filename: f,
        // Filename: <ISO>_<UUID>.jsonl
        sessionId: f.replace(/\.jsonl$/, '').split('_').slice(1).join('_'),
        startedAt: f.split('_')[0].replace(/-/g, (m, i) => i < 10 ? '-' : (i === 10 ? 'T' : (i === 13 || i === 16 ? ':' : '.'))).replace(/-(\d{3})Z/, '.$1Z'),
      }));
  } catch {
    return [];
  }
}

// ─── Tmux session discovery ─────────────────────────────────────────────────
async function scanTmuxSessions() {
  try {
    const { stdout } = await execFileAsync('tmux', [
      'ls',
      '-F',
      '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}',
    ]);
    const sessions = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;
      const [name, createdEpoch, attached, windows] = line.split('|');
      if (!name || !name.startsWith('pi-')) continue;
      sessions.push({
        name,
        createdAt: new Date(Number(createdEpoch) * 1000).toISOString(),
        attached: attached === '1',
        windows: Number(windows) || 1,
      });
    }
    return sessions;
  } catch {
    // tmux not running or not installed — not an error
    return [];
  }
}

async function pushSessions() {
  if (!workerUrl || !bootstrapToken) return;
  const pushed = await loadPushedSessions();
  const cwd = process.cwd();
  const sessions = await scanPiSessions(cwd);

  for (const session of sessions) {
    try {
      const content = await readFile(session.file, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const messageCount = events.filter((e) => e.type === 'message' || e.type === 'tool_call' || e.type === 'tool_result').length;

      const prev = pushed[session.sessionId];
      if (prev && prev.messageCount === messageCount) continue; // nothing new

      // Parse model/provider from first model_change event
      const modelEvent = events.find((e) => e.type === 'model_change');
      const model = modelEvent?.modelId || null;
      const provider = modelEvent?.provider || null;

      // Detect session end
      const lastEvent = events.at(-1);
      const ended = lastEvent?.type === 'session_end';
      const endedAt = ended ? lastEvent.timestamp : null;

      // Extract usage from cost events
      const usageEvents = events.filter((e) => e.type === 'usage' || e.type === 'cost');
      const totalTokens = usageEvents.reduce((acc, e) => ({
        input: acc.input + (e.inputTokens || 0),
        output: acc.output + (e.outputTokens || 0),
        cost: acc.cost + (e.costUsd || e.cost || 0),
      }), { input: 0, output: 0, cost: 0 });

      const sessionPayload = {
        sessionId: session.sessionId,
        machineId,
        cwd,
        model,
        provider,
        startedAt: events[0]?.timestamp || session.startedAt,
        endedAt,
        status: ended ? 'ended' : 'active',
        messageCount,
      };

      await fetch(`${workerUrl.replace(/\/$/, '')}/v1/sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bootstrapToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(sessionPayload),
      });

      // Push usage if any
      if (totalTokens.input || totalTokens.output) {
        await fetch(`${workerUrl.replace(/\/$/, '')}/v1/usage`, {
          method: 'POST',
          headers: { authorization: `Bearer ${bootstrapToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            machineId,
            sessionId: session.sessionId,
            model,
            provider,
            inputTokens: totalTokens.input,
            outputTokens: totalTokens.output,
            costUsd: totalTokens.cost,
          }),
        });
      }

      pushed[session.sessionId] = { pushedAt: new Date().toISOString(), messageCount };
      log('info', 'session.pushed', { sessionId: session.sessionId, messageCount, ended });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log('warn', 'session.push.failed', { sessionId: session.sessionId, error: msg });
    }
  }

  await savePushedSessions(pushed);
}

await mkdir(runtimeDir, { recursive: true });
let lastSnapshot = await refreshState();
await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');

// Heartbeat loop with exponential backoff on network failures
setInterval(async () => {
  try {
    lastSnapshot = await refreshState();
    await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');
  } catch (error) {
    log('error', 'state.refresh.failed', { error: error instanceof Error ? error.message : String(error) });
  }
}, heartbeatIntervalMs);

// Git sync loop
setInterval(async () => {
  try { await gitSync(); }
  catch (error) { log('error', 'git.sync.error', { error: error instanceof Error ? error.message : String(error) }); }
}, gitSyncIntervalMs);
// Initial git sync after 10s (avoid blocking startup)
setTimeout(() => gitSync().catch(() => {}), 10_000);

// Pi session push loop
setInterval(async () => {
  try { await pushSessions(); }
  catch (error) { log('error', 'session.scan.error', { error: error instanceof Error ? error.message : String(error) }); }
}, sessionScanIntervalMs);
// Initial session scan after 30s
setTimeout(() => pushSessions().catch(() => {}), 30_000);

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
