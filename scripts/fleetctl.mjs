#!/usr/bin/env node
const command = process.argv[2] || 'status';
const port = Number(process.env.PI_SETUP_DAEMON_PORT || 4269);
const requestId = crypto.randomUUID();

if (command === 'manage') {
  const payload = process.argv[3] || JSON.stringify({ action: 'noop' });
  const res = await fetch(`http://127.0.0.1:${port}/manage`, {
    method: 'POST',
    body: payload,
    headers: { 'x-request-id': requestId },
  });
  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }
  console.log(await res.text());
  process.exit(0);
}

const endpoint = command === 'health'
  ? '/health'
  : command === 'diagnostics'
    ? '/diagnostics'
    : '/metrics';
const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
  headers: { 'x-request-id': requestId },
});
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
console.log(await res.text());
