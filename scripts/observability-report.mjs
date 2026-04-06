#!/usr/bin/env node
const workerUrl = process.env.PI_SETUP_WORKER_URL;
const adminToken = process.env.PI_SETUP_BOOTSTRAP_TOKEN;
const machineId = process.argv[2] || '';
const limit = Math.min(Math.max(Number(process.argv[3] || process.env.PI_SETUP_OBSERVABILITY_LIMIT || 20), 1), 100);

if (!workerUrl || !adminToken) {
  console.error('Usage: PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... node scripts/observability-report.mjs [machine-id] [limit]');
  process.exit(1);
}

async function getJson(path) {
  const requestId = crypto.randomUUID();
  const res = await fetch(`${workerUrl.replace(/\/$/, '')}${path}`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-request-id': requestId,
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: 'invalid json response', raw: text };
  }
  if (!res.ok) {
    console.error(JSON.stringify({ path, status: res.status, data }, null, 2));
    process.exit(1);
  }
  return data;
}

const diagnostics = await getJson('/v1/diagnostics');
const query = new URLSearchParams({ limit: String(limit) });
if (machineId) query.set('machineId', machineId);
const websocketEvents = await getJson(`/v1/observability/websocket-events?${query.toString()}`);
const heartbeats = await getJson('/v1/fleet/heartbeats');

const summary = {
  ok: true,
  generatedAt: new Date().toISOString(),
  machineFilter: machineId || null,
  diagnostics: diagnostics.diagnostics,
  fleet: {
    count: heartbeats.count,
    stale: (heartbeats.heartbeats || []).filter((item) => item.stale).length,
    machines: (heartbeats.heartbeats || []).map((item) => ({
      machineId: item.machineId,
      hostname: item.hostname,
      timestamp: item.timestamp,
      stale: item.stale,
      lastRequestId: item.requestId || item.heartbeat?.lastRequestId || null,
    })),
  },
  websocket: {
    count: websocketEvents.count,
    events: websocketEvents.events || [],
  },
};

console.log(JSON.stringify(summary, null, 2));
