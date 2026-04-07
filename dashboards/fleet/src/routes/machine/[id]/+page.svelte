<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import {
    fetchHeartbeats, fetchSessions, fetchMachines, deleteMachine, openRelaySocket, withRetry,
    sendLaunchSession, dispatchCommandAck,
    machineStatus, timeAgo, formatBytes, userMessage, formatMachineOs,
    ApiError,
    type FleetHeartbeat, type Session, type Machine, type CommandAck,
  } from '$lib/api';
  import PlatformIcon from '$lib/PlatformIcon.svelte';

  export let params: { id?: string } = {};

  const machineId = decodeURIComponent(params.id ?? $page.params.id ?? '');

  let heartbeat: FleetHeartbeat | undefined;
  /** D1 row (enrollment metadata: os_release, enrolled_from, …). */
  let d1Machine: Machine | null = null;
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
  let relayDestroyed = false;       // set on onDestroy to suppress reconnects
  let relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    relayDestroyed = true;
    if (relayReconnectTimer !== null) clearTimeout(relayReconnectTimer);
    clearInterval(interval);
    if (launchSuccessTimer !== null) clearTimeout(launchSuccessTimer);
    // Null handlers before closing so onclose doesn't schedule another reconnect
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); ws = null; }
  });

  async function load() {
    try {
      const [hb, s, mac] = await Promise.allSettled([
        withRetry(() => fetchHeartbeats()),
        withRetry(() => fetchSessions(machineId)),
        withRetry(() => fetchMachines()),
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
      if (mac.status === 'fulfilled') {
        d1Machine = mac.value.machines.find((x) => x.machine_id === machineId) ?? null;
      } else {
        d1Machine = null;
      }
      error = errParts.join(' — ');
    } catch (e) {
      error = userMessage(e);
    } finally {
      loading = false;
    }
  }

  function connectRelay() {
    if (relayDestroyed || relayGaveUp) return;
    try {
      relayError = '';
      ws = openRelaySocket(machineId, 'observer');
      ws.onopen = () => { relayConnected = true; relayError = ''; relayRetryCount = 0; };
      ws.onclose = () => {
        relayConnected = false;
        agentOnline = false;
        if (relayDestroyed || relayGaveUp) return;
        relayRetryCount++;
        if (relayRetryCount > RELAY_MAX_RETRIES) {
          relayGaveUp = true;
          relayError = 'Relay unavailable after multiple attempts. Click "Reconnect" to try again.';
          return;
        }
        const delay = Math.min(RELAY_BASE_DELAY * 2 ** (relayRetryCount - 1), RELAY_MAX_DELAY);
        relayError = `Relay disconnected. Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${relayRetryCount}/${RELAY_MAX_RETRIES})`;
        relayReconnectTimer = setTimeout(connectRelay, delay);
      };
      ws.onerror = () => {
        relayConnected = false;
        // onerror always precedes onclose; set message here, onclose handles reconnect
        relayError = 'WebSocket error — check worker URL, token, and that the relay route is deployed.';
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // Dispatch command:ack to pending sendLaunchSession promises (do not show in relay log)
          if (msg.type === 'command:ack' && ws) {
            dispatchCommandAck(ws, msg as CommandAck);
            return;
          }
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
    if (relayDestroyed) return;
    // Cancel any pending auto-reconnect
    if (relayReconnectTimer !== null) { clearTimeout(relayReconnectTimer); relayReconnectTimer = null; }
    relayGaveUp = false;
    relayRetryCount = 0;
    relayError = '';
    // Null handlers on the old socket BEFORE closing so onclose doesn't fire a competing reconnect
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); ws = null; }
    connectRelay();
  }

  $: status = heartbeat ? machineStatus(heartbeat) as 'online'|'stale'|'offline' : 'offline';

  async function launchSession() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      launchError = 'Relay is not connected — cannot send command.';
      return;
    }
    if (!agentOnline) {
      launchError = 'Agent is offline — the daemon must be running to launch sessions.';
      return;
    }
    launching = true;
    launchError = '';
    launchSuccess = '';
    try {
      const ack = await sendLaunchSession(ws, launchPrompt || undefined);
      launchSuccess = `Session ${ack.sessionName ?? 'unknown'} launched ✓`;
      launchPrompt = '';
      if (launchSuccessTimer !== null) clearTimeout(launchSuccessTimer);
      launchSuccessTimer = setTimeout(() => { launchSuccess = ''; }, 8_000);
      // Refresh sessions list after a short delay (session file may not exist yet)
      setTimeout(load, 3_000);
    } catch (e) {
      launchError = userMessage(e);
    } finally {
      launching = false;
    }
  }

  let showDeleteModal = false;
  let deleting = false;
  let deleteError = '';

  // ── Launch session state ──
  let launching = false;
  let launchPrompt = '';
  let launchError = '';
  let launchSuccess = '';
  let launchSuccessTimer: ReturnType<typeof setTimeout> | null = null;

  function openDeleteModal() { showDeleteModal = true; deleteError = ''; }
  function closeDeleteModal() { showDeleteModal = false; deleting = false; deleteError = ''; }

  async function confirmDelete() {
    deleting = true;
    deleteError = '';
    try {
      // Delete first — only tear down relay after confirmed success
      await deleteMachine(machineId);
      // Success: prevent relay from reconnecting, then close it
      relayDestroyed = true;
      if (relayReconnectTimer !== null) { clearTimeout(relayReconnectTimer); relayReconnectTimer = null; }
      if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); ws = null; }
      goto('/');
    } catch (e) {
      // Delete failed — relay is untouched, no recovery needed
      deleteError = userMessage(e);
      deleting = false;
    }
  }
</script>

<svelte:head><title>pi fleet — {machineId}</title></svelte:head>

<a href="/" class="back text-muted text-sm">← Back to fleet</a>

<div class="flex items-center justify-between mt-4 mb-4 gap-3">
  <div class="flex items-center gap-3 min-w-0">
    <PlatformIcon platform={heartbeat?.platform ?? d1Machine?.platform ?? ''} size={40} />
    <div class="min-w-0">
      <h1 class="page-title truncate">{heartbeat?.hostname ?? d1Machine?.hostname ?? machineId}</h1>
      <p class="text-muted text-sm mt-1 truncate">{machineId}</p>
      {#if d1Machine || heartbeat}
        <p class="text-muted text-xs mt-1">{formatMachineOs(d1Machine, heartbeat)}</p>
      {/if}
      {#if d1Machine?.enrolled_from}
        <p class="text-muted text-xs mt-1">Enrolled via {d1Machine.enrolled_from}</p>
      {/if}
    </div>
  </div>
  <div class="flex gap-2 items-center flex-shrink-0">
    <span class="badge {status}">{status}</span>
    <button type="button" class="btn btn-danger btn-sm" on:click={openDeleteModal}>Remove</button>
  </div>
</div>

{#if error}
  <div class="error-banner" role="alert">{error}</div>
{/if}
{#if relayError}
  <div class="error-banner error-banner--warn banner-row" role="status">
    <span class="banner-row-text">{relayError}</span>
    {#if relayGaveUp}
      <button type="button" class="btn btn-sm flex-shrink-0" on:click={manualReconnect}>
        <svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        Reconnect
      </button>
    {/if}
  </div>
{/if}

{#if heartbeat}
  <!-- ── System metrics ── -->
  <div class="grid-stat mt-4">
    <div class="card card--static stat-tile">
      <div class="stat-label">CPU load (1m)</div>
      <div class="stat-value">{heartbeat.loadavg[0].toFixed(2)}</div>
    </div>
    <div class="card card--static stat-tile">
      <div class="stat-label">Memory used</div>
      <div class="stat-value">{formatBytes(heartbeat.memory.used)}<span class="stat-sub"> / {formatBytes(heartbeat.memory.total)}</span></div>
    </div>
    <div class="card card--static stat-tile">
      <div class="stat-label">Uptime</div>
      <div class="stat-value">{Math.floor(heartbeat.uptimeSeconds / 3600)}h {Math.floor((heartbeat.uptimeSeconds % 3600) / 60)}m</div>
    </div>
    <div class="card card--static stat-tile">
      <div class="stat-label">OS</div>
      <div class="stat-value text-sm">{formatMachineOs(d1Machine, heartbeat)}</div>
    </div>
    <div class="card card--static stat-tile">
      <div class="stat-label">CPU cores</div>
      <div class="stat-value">{heartbeat.cpuCount}</div>
    </div>
    <div class="card card--static stat-tile">
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
      <span class="relay-title">Live Agent Stream</span>
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

<!-- ── Launch remote session ── -->
{#if relayConnected && agentOnline}
<div class="card mt-4">
  <div class="relay-header mb-3">
    <span class="relay-title">Launch Remote Session</span>
  </div>
  <div class="launch-row">
    <input
      type="text"
      class="input launch-input"
      placeholder="Optional prompt — e.g. 'fix the login bug'"
      bind:value={launchPrompt}
      disabled={launching}
      on:keydown={(e) => { if (e.key === 'Enter' && !launching) launchSession(); }}
    />
    <button
      type="button"
      class="btn-launch"
      on:click={launchSession}
      disabled={launching}
    >
      {launching ? 'Launching…' : 'Launch Session'}
    </button>
  </div>
  {#if launchError}
    <div class="error-banner mt-2" role="alert">{launchError}</div>
  {/if}
  {#if launchSuccess}
    <div class="success-banner mt-2" role="status">{launchSuccess}</div>
  {/if}
</div>
{/if}

<!-- ── Recent sessions ── -->
<div class="mt-6">
  <h2 class="section-title mb-4">Recent Sessions</h2>
  {#if sessions.length === 0}
    <div class="card card--static empty-state">No sessions recorded for this machine yet.</div>
  {:else}
    <div class="card card--static table-card">
      <table>
        <thead>
          <tr>
            <th>Session</th><th>Model</th><th>Status</th><th>Messages</th><th>Started</th>
          </tr>
        </thead>
        <tbody>
          {#each sessions as s (s.session_id)}
            <tr>
              <td><code class="text-muted font-mono">{s.session_id.slice(0,8)}…</code></td>
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

{#if showDeleteModal}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-backdrop" on:click={closeDeleteModal}>
    <div class="modal-card card" on:click|stopPropagation>
      <h3>Remove machine</h3>
      <p class="text-muted mt-2">
        Permanently remove <strong>{heartbeat?.hostname ?? machineId}</strong> and all its sessions, usage data, and heartbeat? This cannot be undone.
      </p>
      {#if deleteError}
        <div class="error-banner mt-2" role="alert">{deleteError}</div>
      {/if}
      <div class="modal-actions mt-4">
        <button type="button" class="btn btn-ghost" on:click={closeDeleteModal} disabled={deleting}>Cancel</button>
        <button type="button" class="btn btn-danger-solid" on:click={confirmDelete} disabled={deleting}>
          {deleting ? 'Removing…' : 'Remove machine'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .launch-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .launch-input {
    flex: 1;
  }
  .btn-launch {
    white-space: nowrap;
    padding: 0.375rem 0.875rem;
    border-radius: 0.375rem;
    background: var(--color-accent, #3b82f6);
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 0.875rem;
    transition: opacity 0.15s;
  }
  .btn-launch:hover:not(:disabled) { opacity: 0.88; }
  .btn-launch:disabled { opacity: 0.45; cursor: not-allowed; }
  .success-banner {
    background: var(--color-success-bg, rgba(16,185,129,0.12));
    color: var(--color-success-text, #4ade80);
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
  }
  .back { display: inline-block; }
  .banner-row-text {
    flex: 1;
    min-width: 0;
    line-height: 1.45;
  }
</style>
