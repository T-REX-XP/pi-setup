<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fetchSessions, fetchUsage, withRetry, timeAgo, userMessage, type Session, type UsageMetric } from '$lib/api';

  export let params: Record<string, string> = {};

  let sessions: Session[] = [];
  let metrics: UsageMetric[] = [];
  let loading = true;
  let error = '';
  let sessionsFetchFailed = false;
  let machineFilter = '';
  let interval: ReturnType<typeof setInterval>;

  onMount(() => {
    const url = new URL(window.location.href);
    machineFilter = url.searchParams.get('machineId') || '';
    load();
    interval = setInterval(load, 30_000);
  });
  onDestroy(() => clearInterval(interval));

  async function load() {
    try {
      const [s, u] = await Promise.allSettled([
        withRetry(() => fetchSessions(machineFilter || undefined)),
        withRetry(() => fetchUsage(machineFilter || undefined)),
      ]);
      const errParts: string[] = [];
      if (s.status === 'fulfilled') {
        sessions = s.value.sessions;
        sessionsFetchFailed = false;
      } else {
        sessionsFetchFailed = true;
        errParts.push(`Sessions: ${userMessage(s.reason)}`);
      }
      if (u.status === 'fulfilled') {
        metrics = u.value.metrics;
      } else {
        errParts.push(`Usage: ${userMessage(u.reason)}`);
      }
      error = errParts.join(' — ');
    } catch (e) {
      error = userMessage(e);
      sessionsFetchFailed = true;
    } finally {
      loading = false;
    }
  }

  function sessionDuration(s: Session): string {
    const start = Date.parse(s.started_at);
    const end = s.ended_at ? Date.parse(s.ended_at) : Date.now();
    const ms = end - start;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  }

  // Aggregate usage per session for display
  function sessionCost(sessionId: string): string {
    const m = metrics.filter((x) => x.session_id === sessionId);
    const total = m.reduce((acc, x) => acc + x.cost_usd, 0);
    if (!total) return '—';
    return `$${total.toFixed(4)}`;
  }
  function sessionTokens(sessionId: string): string {
    const m = metrics.filter((x) => x.session_id === sessionId);
    const i = m.reduce((acc, x) => acc + x.input_tokens, 0);
    const o = m.reduce((acc, x) => acc + x.output_tokens, 0);
    if (!i && !o) return '—';
    return `${(i + o).toLocaleString()}`;
  }
</script>

<svelte:head><title>pi fleet — sessions</title></svelte:head>

<span class="sr-only" aria-hidden="true">{Object.keys(params).length >= 0 ? '' : ''}</span>

<div class="flex items-center justify-between mb-4">
  <div>
    <h1 class="page-title">Sessions</h1>
    {#if machineFilter}
      <p class="text-muted text-sm mt-1">Filtered by machine: <code class="font-mono">{machineFilter}</code>
        <a href="/sessions">Clear</a>
      </p>
    {:else}
      <p class="text-muted text-sm mt-1">{sessions.length} session{sessions.length !== 1 ? 's' : ''} across all machines</p>
    {/if}
  </div>
  <div class="flex gap-2 items-center">
    {#if loading}<span class="spinner" aria-hidden="true" />{/if}
    <button type="button" class="btn" on:click={load}>
      <svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
      Refresh
    </button>
    <a href="/" class="btn btn-ghost">Machines</a>
  </div>
</div>

{#if error}
  <div class="error-banner" role="alert">{error}</div>
{/if}

{#if sessions.length === 0 && !loading}
  <div class="card card--static empty-state empty-state--left">
    {#if sessionsFetchFailed}
      <p>Sessions could not be loaded. Fix the error above (URL, token, or network) and refresh.</p>
    {:else}
      <p class="empty-state-lead"><strong>No sessions in the Worker yet.</strong> The dashboard reads D1; rows are created when the fleet daemon POSTs Pi transcripts.</p>
      <ul class="empty-state-hints">
        <li>Run <code>npm run daemon</code> from the repo root on a machine where you use <code>pi</code>.</li>
        <li>Ensure <code>PI_SETUP_WORKER_URL</code> and <code>PI_SETUP_BOOTSTRAP_TOKEN</code> are set (e.g. in <code>.env.runtime</code> after enroll).</li>
        <li>The daemon must use the <strong>same current working directory</strong> as your Pi sessions — it only uploads files under <code>~/.pi/agent/sessions/</code> for that cwd.</li>
        <li>First scan runs ~30s after startup; default rescan every 2&nbsp;min — then refresh here.</li>
      </ul>
    {/if}
  </div>
{:else}
  <div class="card card--static table-card">
    <table>
      <thead>
        <tr>
          <th>Session</th>
          <th>Machine</th>
          <th>Model</th>
          <th>Status</th>
          <th>Messages</th>
          <th>Tokens</th>
          <th>Cost</th>
          <th>Duration</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>
        {#each sessions as s (s.session_id)}
          <tr>
            <td class="session-id">
              <code class="font-mono">{s.session_id.slice(0, 8)}…</code>
            </td>
            <td>
              <a href="/machine/{encodeURIComponent(s.machine_id)}">{s.machine_id.split('.')[0]}</a>
            </td>
            <td class="text-muted">{s.model || '—'}</td>
            <td><span class="badge {s.status === 'active' ? 'active' : s.status === 'ended' ? 'offline' : 'stale'}">{s.status}</span></td>
            <td>{s.message_count}</td>
            <td class="text-muted">{sessionTokens(s.session_id)}</td>
            <td class="text-muted">{sessionCost(s.session_id)}</td>
            <td class="text-muted">{sessionDuration(s)}</td>
            <td class="text-muted">{timeAgo(s.started_at)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .session-id code {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
</style>
