<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    fetchHeartbeats, fetchMachines, deleteMachine, withRetry,
    machineStatus, timeAgo, formatBytes, userMessage,
    ApiError,
    type FleetHeartbeat, type Machine,
  } from '$lib/api';

  export let params: Record<string, string> = {};

  let machines: Machine[] = [];
  let heartbeats: FleetHeartbeat[] = [];
  let heartbeatMap: Record<string, FleetHeartbeat> = {};
  let loading = true;
  let error = '';
  let workerUrl = '';
  let token = '';
  let configured = false;
  let interval: ReturnType<typeof setInterval>;

  let deleteTarget: Machine | null = null;
  let deleting = false;
  let deleteError = '';

  function openDeleteModal(machine: Machine, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    deleteTarget = machine;
    deleteError = '';
  }
  function closeDeleteModal() { deleteTarget = null; deleting = false; deleteError = ''; }

  async function confirmDelete() {
    if (!deleteTarget) return;
    deleting = true;
    deleteError = '';
    try {
      await deleteMachine(deleteTarget.machine_id);
      const id = deleteTarget.machine_id;
      machines = machines.filter((m) => m.machine_id !== id);
      heartbeats = heartbeats.filter((h) => h.machineId !== id);
      delete heartbeatMap[id];
      heartbeatMap = heartbeatMap;
      closeDeleteModal();
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'auth') {
        configured = false;
        deleteError = 'Authentication failed — please re-enter your credentials.';
      } else {
        deleteError = userMessage(e);
      }
    } finally {
      deleting = false;
    }
  }

  onMount(() => {
    workerUrl = localStorage.getItem('pi_worker_url') || '';
    token = localStorage.getItem('pi_token') || '';
    configured = Boolean(workerUrl && token);
    if (configured) load();
    interval = setInterval(() => { if (configured) load(); }, 30_000);
  });

  onDestroy(() => clearInterval(interval));

  function saveConfig() {
    localStorage.setItem('pi_worker_url', workerUrl);
    localStorage.setItem('pi_token', token);
    configured = Boolean(workerUrl && token);
    if (configured) load();
  }

  async function load() {
    try {
      const [hb, m] = await Promise.allSettled([
        withRetry(() => fetchHeartbeats()),
        withRetry(() => fetchMachines()),
      ]);
      const errParts: string[] = [];

      // Check if any rejection is an auth error → drop back to config screen
      const reasons = [
        hb.status === 'rejected' ? hb.reason : null,
        m.status === 'rejected' ? m.reason : null,
      ].filter(Boolean);
      const hasAuthError = reasons.some((r) => r instanceof ApiError && r.kind === 'auth');
      if (hasAuthError) {
        configured = false;
        error = 'Authentication failed — please re-enter your credentials.';
        loading = false;
        return;
      }

      if (hb.status === 'fulfilled') {
        heartbeats = hb.value.heartbeats;
        heartbeatMap = Object.fromEntries(heartbeats.map((h) => [h.machineId, h]));
      } else {
        errParts.push(`Heartbeats: ${userMessage(hb.reason)}`);
      }

      if (m.status === 'fulfilled') {
        machines = m.value.machines || [];
      } else if (hb.status === 'fulfilled') {
        machines = [];
      }

      // D1 can be empty while KV has enrollments / heartbeats only — still show fleet from heartbeats
      if (m.status === 'fulfilled' && hb.status === 'fulfilled' && machines.length === 0 && heartbeats.length > 0) {
        machines = heartbeats.map((h) => ({
          machine_id: h.machineId,
          hostname: h.hostname,
          platform: h.platform,
          arch: h.arch,
          enrolled_at: null,
          last_seen_at: h.receivedAt,
          status: machineStatus(h),
        }));
      } else if (m.status === 'rejected' && hb.status === 'fulfilled') {
        errParts.push(`Machines: ${userMessage(m.reason)}`);
        machines = heartbeats.map((h) => ({
          machine_id: h.machineId,
          hostname: h.hostname,
          platform: h.platform,
          arch: h.arch,
          enrolled_at: null,
          last_seen_at: h.receivedAt,
          status: machineStatus(h),
        }));
      } else if (m.status === 'rejected' && hb.status === 'rejected') {
        errParts.push(`Machines: ${userMessage(m.reason)}`);
        machines = [];
      }

      error = errParts.join(' — ');
    } catch (e) {
      error = userMessage(e);
    } finally {
      loading = false;
    }
  }

  $: statusOf = (m: Machine) => {
    const hb = heartbeatMap[m.machine_id];
    return machineStatus(hb) as 'online' | 'stale' | 'offline';
  };

  $: onlineCount = machines.filter((m) => statusOf(m) === 'online').length;
  $: staleCount  = machines.filter((m) => statusOf(m) === 'stale').length;
  $: offlineCount = machines.filter((m) => statusOf(m) === 'offline').length;
</script>

<svelte:head><title>pi fleet — machines</title></svelte:head>

<span class="sr-only" aria-hidden="true">{Object.keys(params).length ? '' : ''}</span>

{#if !configured}
  <!-- ── Config panel ── -->
  <div class="setup-panel card">
    <h2>Connect to your Worker</h2>
    <p class="text-muted mt-1">Enter your Cloudflare Worker URL and admin token to view your fleet.</p>
    <div class="form mt-4">
      <label>
        Worker URL
        <input type="url" bind:value={workerUrl} placeholder="https://pi-setup-secrets.YOUR.workers.dev" />
      </label>
      <label>
        Admin token
        <input type="password" bind:value={token} placeholder="Bearer token (PI_SETUP_BOOTSTRAP_TOKEN)" />
      </label>
      <button class="btn" on:click={saveConfig}>Connect</button>
    </div>
  </div>
{:else}
  <!-- ── Fleet overview ── -->
  <div class="flex items-center justify-between mb-4">
    <div>
      <h1>Fleet</h1>
      <p class="text-muted text-sm mt-1">
        {machines.length} machine{machines.length !== 1 ? 's' : ''} ·
        <span class="online-text">{onlineCount} online</span>
        {#if staleCount} · <span class="stale-text">{staleCount} stale</span>{/if}
        {#if offlineCount} · <span class="offline-text">{offlineCount} offline</span>{/if}
      </p>
    </div>
    <div class="flex gap-2 items-center">
      {#if loading}<span class="spinner" />{/if}
      <button class="btn" on:click={load}>↻ Refresh</button>
      <button class="btn btn-ghost" on:click={() => { configured = false; }}>⚙ Config</button>
    </div>
  </div>

  {#if error}
    <div class="error-banner card">{error}</div>
  {/if}

  {#if loading && machines.length === 0}
    <div class="loading-placeholder">
      {#each Array(3) as _}
        <div class="card skeleton" />
      {/each}
    </div>
  {:else if machines.length === 0}
    <div class="card empty-state">
      <p>No machines yet. Make sure the fleet daemon is running on your machines.</p>
    </div>
  {:else}
    <div class="grid-auto">
      {#each machines as machine (machine.machine_id)}
        {@const hb = heartbeatMap[machine.machine_id]}
        {@const status = statusOf(machine)}
        <a href="/machine/{encodeURIComponent(machine.machine_id)}" class="card machine-card">
          <div class="flex items-center justify-between">
            <span class="hostname">{machine.hostname}</span>
            <span class="badge {status}">{status}</span>
          </div>
          <div class="meta-row mt-2">
            <span class="text-muted text-sm">{machine.platform} / {machine.arch}</span>
            <span class="text-muted text-sm">last seen {timeAgo(hb?.receivedAt ?? machine.last_seen_at)}</span>
          </div>
          {#if hb}
            <div class="metrics mt-2">
              <div class="metric">
                <span class="metric-label">CPU</span>
                <span>{hb.loadavg[0].toFixed(2)}</span>
              </div>
              <div class="metric">
                <span class="metric-label">RAM</span>
                <span>{formatBytes(hb.memory.used)} / {formatBytes(hb.memory.total)}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Cores</span>
                <span>{hb.cpuCount}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Uptime</span>
                <span>{Math.floor(hb.uptimeSeconds / 3600)}h</span>
              </div>
            </div>
          {/if}
          <div class="card-actions mt-2">
            <button class="btn btn-danger btn-sm" on:click={(e) => openDeleteModal(machine, e)}>Remove</button>
          </div>
        </a>
      {/each}
    </div>
  {/if}

  {#if deleteTarget}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={closeDeleteModal}>
      <div class="modal-card card" on:click|stopPropagation>
        <h3>Remove machine</h3>
        <p class="text-muted mt-2">
          Permanently remove <strong>{deleteTarget.hostname}</strong> and all its sessions, usage data, and heartbeat? This cannot be undone.
        </p>
        {#if deleteError}
          <div class="error-banner card mt-2">{deleteError}</div>
        {/if}
        <div class="modal-actions mt-4">
          <button class="btn btn-ghost" on:click={closeDeleteModal} disabled={deleting}>Cancel</button>
          <button class="btn btn-danger" on:click={confirmDelete} disabled={deleting}>
            {deleting ? 'Removing…' : 'Remove machine'}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }

  .setup-panel { max-width: 520px; margin: 4rem auto; }
  .setup-panel h2 { font-size: 1.1rem; font-weight: 600; }
  .form { display: flex; flex-direction: column; gap: 1rem; }
  .form label { display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; color: var(--text-muted); }

  .machine-card { display: block; text-decoration: none !important; color: var(--text); cursor: pointer; }
  .machine-card:hover { text-decoration: none; }
  .hostname { font-weight: 600; font-size: 0.95rem; }

  .meta-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; }

  .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .metric { display: flex; flex-direction: column; gap: 1px; }
  .metric-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }

  .online-text  { color: var(--green); }
  .stale-text   { color: var(--amber); }
  .offline-text { color: var(--red); }

  .error-banner { background: var(--red-dim); border-color: var(--red); color: var(--red); margin-bottom: 1rem; }

  .loading-placeholder { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap: 1rem; }
  .skeleton { height: 140px; background: var(--bg-card); animation: shimmer 1.5s infinite; }
  @keyframes shimmer { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

  .empty-state { color: var(--text-muted); text-align: center; padding: 3rem; }

  .btn-ghost { background: transparent; border-color: var(--border); color: var(--text-muted); }
  .btn-ghost:hover { background: rgba(255,255,255,0.05); color: var(--text); }

  .card-actions { display: flex; justify-content: flex-end; }
  .btn-danger { background: var(--red); border-color: var(--red); color: #fff; }
  .btn-danger:hover { opacity: 0.85; }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-sm { font-size: 0.78rem; padding: 4px 10px; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal-card { max-width: 440px; width: 90%; }
  .modal-card h3 { font-size: 1.05rem; font-weight: 600; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
