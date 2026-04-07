#!/usr/bin/env node
const workerUrl = process.env.PI_SETUP_WORKER_URL;
const adminToken = process.env.PI_SETUP_BOOTSTRAP_TOKEN;
const machineId = process.argv[2];
const secretName = process.argv[3];
const ttlSeconds = Number(process.argv[4] || process.env.PI_SETUP_ENROLLMENT_TTL_SECONDS || 600);

if (!workerUrl || !adminToken || !machineId || !secretName) {
  console.error('Usage: PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... node scripts/enrollment-token-issue.mjs <machine-id> <secret-name> [ttl-seconds]');
  process.exit(1);
}

const requestId = crypto.randomUUID();
const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/enrollment-tokens/issue`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
    'x-request-id': requestId,
  },
  body: JSON.stringify({ machineId, secretName, ttlSeconds })
});

const text = await res.text();
console.log(text);
if (!res.ok) process.exit(1);
console.error(`
Next step (on the machine you are enrolling — issuing a token does not register the node by itself):
  export PI_SETUP_ENROLLMENT_TOKEN='<paste the "token" JWT from above>'
  PI_SETUP_WORKER_URL=... PI_SETUP_MASTER_KEY=... node scripts/machine-enroll.mjs .env.runtime

After that, run the fleet daemon with PI_SETUP_WORKER_URL + PI_SETUP_BOOTSTRAP_TOKEN so heartbeats appear in the dashboard.
`);
