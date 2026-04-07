<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    fetchHeartbeats, fetchMachines, deleteMachine, withRetry,
    machineStatus, timeAgo, formatBytes, userMessage, formatMachineOs,
    ApiError,
    type FleetHeartbeat, type Machine,
  } from '$lib/api';
  import PlatformIcon from '$lib/PlatformIcon.svelte';

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
          os_release: null,
          enrolled_from: null,
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
          os_release: null,
          enrolled_from: null,
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
  <div class="setup-panel card card--static">
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
      <button type="button" class="btn" on:click={saveConfig}>Connect</button>
    </div>
  </div>
{:else}
  <!-- ── Fleet overview ── -->
  <div class="flex items-center justify-between mb-4">
    <div>
      <h1 class="page-title">Fleet</h1>
      <p class="text-muted text-sm mt-1">
        {machines.length} machine{machines.length !== 1 ? 's' : ''} ·
        <span class="stat-online">{onlineCount} online</span>
        {#if staleCount} · <span class="stat-stale">{staleCount} stale</span>{/if}
        {#if offlineCount} · <span class="stat-offline">{offlineCount} offline</span>{/if}
      </p>
    </div>
    <div class="flex gap-2 items-center">
      {#if loading}<span class="spinner" aria-hidden="true" />{/if}
      <button type="button" class="btn" on:click={load}>
        <svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        Refresh
      </button>
      <button type="button" class="btn btn-ghost" on:click={() => { configured = false; }}>
        <svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
        Config
      </button>
    </div>
  </div>

  {#if error}
    <div class="error-banner" role="alert">{error}</div>
  {/if}

  {#if loading && machines.length === 0}
    <div class="grid-auto">
      {#each Array(3) as _}
        <div class="card card--static skeleton" aria-hidden="true" />
      {/each}
    </div>
  {:else if machines.length === 0}
    <div class="card card--static empty-state">
      <p>No machines yet. Make sure the fleet daemon is running on your machines.</p>
    </div>
  {:else}
    <div class="grid-auto">
      {#each machines as machine (machine.machine_id)}
        {@const hb = heartbeatMap[machine.machine_id]}
        {@const status = statusOf(machine)}
        <article class="card machine-card">
          <a href="/machine/{encodeURIComponent(machine.machine_id)}" class="machine-card-body">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <PlatformIcon platform={hb?.platform ?? machine.platform} size={28} />
                <span class="hostname truncate">{machine.hostname}</span>
              </div>
              <span class="badge {status} flex-shrink-0">{status}</span>
            </div>
            <div class="meta-row mt-2">
              <span class="text-muted text-sm">{formatMachineOs(machine, hb)}</span>
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
          </a>
          <footer class="machine-card-footer">
            <button type="button" class="btn btn-danger btn-sm" on:click={(e) => openDeleteModal(machine, e)}>Remove</button>
          </footer>
        </article>
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
{/if}
