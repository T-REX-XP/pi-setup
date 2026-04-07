<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import {
    fetchHeartbeats, fetchSessions, openRelaySocket, withRetry,
    machineStatus, timeAgo, formatBytes, userMessage,
    ApiError,
    type FleetHeartbeat, type Session,
  } from '$lib/api';

  const machineId = decodeURIComponent($page.params.id ?? '');

  let heartbeat: FleetHeartbeat | undefined;
  let sessions: Session[] = [];
  let loading = true;
  let error = '';

  // Live relay WebSocket
  let ws: WebSocket | null = null;
  let relayLog: string[] = [];
  let agentOnline = false;
  let relayConnected = false;
  let relayError = '';
  let relayGaveUp = false;          // true after max retries exhausted
  let relayRetryCount = 0;
  const RELAY_MAX_RETRIES = 10;
  const RELAY_BASE_DELAY  = 1_000; // ms
  const RELAY_MAX_DELAY   = 30_000;

  let interval: ReturnType<typeof setInterval>;

  onMount(() => {
    load();
    connectRelay();
    interval = setInterval(load, 30_000);
  });

  onDestroy(() => {
    clearInterval(interval);
    ws?.close();
  });

  async function load() {
    try {
      const [hb, s] = await Promise.allSettled([
        withRetry(() => fetchHeartbeats()),
        withRetry(() => fetchSessions(machineId)),
      ]);
      const errParts: string[] = [];
      if (hb.status === 'fulfilled') {
        heartbeat = hb.value.heartbeats.find((h) => h.machineId === machineId);
      } else {
        errParts.push(`Heartbeats: ${userMessage(hb.reason)}`);
      }
      if (s.status === 'fulfilled') {
        sessions = s.value.sessions;
      } else {
        errParts.push(`Sessions: ${userMessage(s.reason)}`);
      }
      error = errParts.join(' — ');
    } catch (e) {
      error = userMessage(e);
    } finally {
      loading = false;
    }
  }

  function connectRelay() {
    if (relayGaveUp) return;
    try {
      relayError = '';
      ws = openRelaySocket(machineId, 'observer');
      ws.onopen = () => { relayConnected = true; relayError = ''; relayRetryCount = 0; };
      ws.onclose = () => {
        relayConnected = false;
        agentOnline = false;
        if (relayGaveUp) return;
        relayRetryCount++;
        if (relayRetryCount > RELAY_MAX_RETRIES) {
          relayGaveUp = true;
          relayError = 'Relay unavailable after multiple attempts. Click “Reconnect” to try again.';
          return;
        }
        const delay = Math.min(RELAY_BASE_DELAY * 2 ** (relayRetryCount - 1), RELAY_MAX_DELAY);
        relayError = `Relay disconnected. Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${relayRetryCount}/${RELAY_MAX_RETRIES})`;
        setTimeout(connectRelay, delay);
      };
      ws.onerror = () => {
        relayConnected = false;
        // onerror always precedes onclose; set message here, onclose handles reconnect
        relayError = 'WebSocket error — check worker URL, token, and that the relay route is deployed.';
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'relay:welcome') { agentOnline = msg.agentOnline; return; }
          if (msg.type === 'relay:agent-connected') { agentOnline = true; return; }
          if (msg.type === 'relay:agent-disconnected') { agentOnline = false; return; }
          // Render text content from agent messages
          const text = msg.content || msg.text || JSON.stringify(msg, null, 2);
          const ts = new Date().toLocaleTimeString();
          relayLog = [`[${ts}] ${text}`, ...relayLog].slice(0, 200);
        } catch {
          relayLog = [ev.data, ...relayLog].slice(0, 200);
        }
      };
    } catch (e) {
      relayError = userMessage(e);
    }
  }

  function manualReconnect() {
    relayGaveUp = false;
    relayRetryCount = 0;
    relayError = '';
    ws?.close();
    connectRelay();
  }

  $: status = heartbeat ? machineStatus(heartbeat) as 'online'|'stale'|'offline' : 'offline';
</script>

<svelte:head><title>pi fleet — {machineId}</title></svelte:head>

<a href="/" class="back text-muted text-sm">← Back to fleet</a>

<div class="flex items-center justify-between mt-4 mb-4">
  <div>
    <h1>{heartbeat?.hostname ?? machineId}</h1>
    <p class="text-muted text-sm mt-1">{machineId}</p>
  </div>
  <span class="badge {status}">{status}</span>
</div>

{#if error}
  <div class="error-banner card">{error}</div>
{/if}
{#if relayError}
  <div class="error-banner card relay-warn">
    {relayError}
    {#if relayGaveUp}
      <button class="btn btn-sm" style="margin-left:1rem" on:click={manualReconnect}>↻ Reconnect</button>
    {/if}
  </div>
{/if}

{#if heartbeat}
  <!-- ── System metrics ── -->
  <div class="grid-3 mt-4">
    <div class="card stat">
      <div class="stat-label">CPU load (1m)</div>
      <div class="stat-value">{heartbeat.loadavg[0].toFixed(2)}</div>
    </div>
    <div class="card stat">
      <div class="stat-label">Memory used</div>
      <div class="stat-value">{formatBytes(heartbeat.memory.used)}<span class="stat-sub"> / {formatBytes(heartbeat.memory.total)}</span></div>
    </div>
    <div class="card stat">
      <div class="stat-label">Uptime</div>
      <div class="stat-value">{Math.floor(heartbeat.uptimeSeconds / 3600)}h {Math.floor((heartbeat.uptimeSeconds % 3600) / 60)}m</div>
    </div>
    <div class="card stat">
      <div class="stat-label">Platform</div>
      <div class="stat-value text-sm">{heartbeat.platform} / {heartbeat.arch}</div>
    </div>
    <div class="card stat">
      <div class="stat-label">CPU cores</div>
      <div class="stat-value">{heartbeat.cpuCount}</div>
    </div>
    <div class="card stat">
      <div class="stat-label">Last seen</div>
      <div class="stat-value text-sm">{timeAgo(heartbeat.receivedAt)}</div>
    </div>
  </div>
{/if}

<!-- ── Live relay ── -->
<div class="card relay-card mt-6">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span class="relay-dot" class:connected={relayConnected} />
      <span class="text-sm" style="font-weight:600">Live Agent Stream</span>
      {#if agentOnline}
        <span class="badge active">agent online</span>
      {:else}
        <span class="badge offline">agent offline</span>
      {/if}
    </div>
    <span class="text-muted text-sm">{relayConnected ? 'relay connected' : 'relay disconnected'}</span>
  </div>
  <div class="relay-log mt-2">
    {#if relayLog.length === 0}
      <span class="text-muted text-sm">Waiting for agent activity…</span>
    {:else}
      {#each relayLog as line}
        <div class="relay-line">{line}</div>
      {/each}
    {/if}
  </div>
</div>

<!-- ── Recent sessions ── -->
<div class="mt-6">
  <h2 class="mb-4">Recent Sessions</h2>
  {#if sessions.length === 0}
    <div class="card empty-state">No sessions recorded for this machine yet.</div>
  {:else}
    <div class="card table-card">
      <table>
        <thead>
          <tr>
            <th>Session</th><th>Model</th><th>Status</th><th>Messages</th><th>Started</th>
          </tr>
        </thead>
        <tbody>
          {#each sessions as s (s.session_id)}
            <tr>
              <td><code class="text-muted">{s.session_id.slice(0,8)}…</code></td>
              <td class="text-muted">{s.model || '—'}</td>
              <td><span class="badge {s.status === 'active' ? 'active' : 'offline'}">{s.status}</span></td>
              <td>{s.message_count}</td>
              <td class="text-muted">{timeAgo(s.started_at)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  h2 { font-size: 1rem; font-weight: 600; }
  .back { display: inline-block; }

  .grid-3 { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
  .stat { padding: 1rem; }
  .stat-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .stat-value { font-size: 1.2rem; font-weight: 700; margin-top: 4px; }
  .stat-sub { font-size: 0.75rem; font-weight: 400; color: var(--text-muted); }

  .relay-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--text-muted);
    transition: background 0.3s;
  }
  .relay-dot.connected { background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  .relay-log {
    background: rgba(0,0,0,0.3);
    border-radius: 8px;
    padding: 12px;
    max-height: 320px;
    overflow-y: auto;
    font-family: 'SF Mono', 'Cascadia Code', monospace;
    font-size: 0.78rem;
    line-height: 1.6;
  }
  .relay-line { color: var(--text-muted); white-space: pre-wrap; word-break: break-word; }
  .relay-line:first-child { color: var(--text); }

  .table-card { padding: 0; overflow: hidden; }
  code { font-family: 'SF Mono', monospace; }
  .error-banner { background: var(--red-dim); border-color: var(--red); color: var(--red); margin-bottom: 1rem; }
  .relay-warn { background: var(--amber-dim); border-color: var(--amber); color: var(--amber); }
  .empty-state { color: var(--text-muted); text-align: center; padding: 2rem; }
</style>
