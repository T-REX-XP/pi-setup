#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const runtimeDir = path.resolve('.pi/runtime');
const stateFile = path.join(runtimeDir, 'fleet-daemon.json');
const commandFile = path.join(runtimeDir, 'fleet-commands.jsonl');
const port = Number(process.env.PI_SETUP_DAEMON_PORT || 4269);

async function snapshot() {
  const cpus = os.cpus();
  return {
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

await mkdir(runtimeDir, { recursive: true });
let lastSnapshot = await snapshot();
await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');
setInterval(async () => {
  lastSnapshot = await snapshot();
  await writeFile(stateFile, JSON.stringify(lastSnapshot, null, 2) + '\n', 'utf8');
}, 15000);

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
    res.end(JSON.stringify({ ok: true, service: 'pi-setup-fleet-daemon', timestamp: new Date().toISOString() }));
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
