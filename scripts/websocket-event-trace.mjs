#!/usr/bin/env node
const workerUrl = process.env.PI_SETUP_WORKER_URL;
const adminToken = process.env.PI_SETUP_BOOTSTRAP_TOKEN;
const machineId = process.argv[2] || process.env.PI_SETUP_MACHINE_ID;
const eventType = process.argv[3];
const direction = process.argv[4] || 'system';
const status = process.argv[5] || 'ok';
const connectionId = process.argv[6] || undefined;

if (!workerUrl || !adminToken || !machineId || !eventType) {
  console.error('Usage: PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... node scripts/websocket-event-trace.mjs <machine-id> <event-type> [direction] [status] [connection-id]');
  process.exit(1);
}

const requestId = crypto.randomUUID();
const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/observability/websocket-events`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
    'x-request-id': requestId,
  },
  body: JSON.stringify({
    machineId,
    eventType,
    direction,
    status,
    connectionId,
    timestamp: new Date().toISOString(),
    metadata: {
      source: 'scripts/websocket-event-trace.mjs',
    },
  }),
});

const text = await res.text();
console.log(text);
if (!res.ok) process.exit(1);
