<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fetchSessions, fetchUsage, timeAgo, type Session, type UsageMetric } from '$lib/api';

  let sessions: Session[] = [];
  let metrics: UsageMetric[] = [];
  let loading = true;
  let error = '';
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
        fetchSessions(machineFilter || undefined),
        fetchUsage(machineFilter || undefined),
      ]);
      if (s.status === 'fulfilled') sessions = s.value.sessions;
      if (u.status === 'fulfilled') metrics = u.value.metrics;
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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

<div class="flex items-center justify-between mb-4">
  <div>
    <h1>Sessions</h1>
    {#if machineFilter}
      <p class="text-muted text-sm mt-1">Filtered by machine: <code>{machineFilter}</code>
        <a href="/sessions">Clear</a>
      </p>
    {:else}
      <p class="text-muted text-sm mt-1">{sessions.length} session{sessions.length !== 1 ? 's' : ''} across all machines</p>
    {/if}
  </div>
  <div class="flex gap-2 items-center">
    {#if loading}<span class="spinner" />{/if}
    <button class="btn" on:click={load}>↻ Refresh</button>
  </div>
</div>

{#if error}
  <div class="error-banner card">{error}</div>
{/if}

{#if sessions.length === 0 && !loading}
  <div class="card empty-state">
    <p>No sessions recorded yet. Sessions appear here once the fleet daemon starts pushing them.</p>
  </div>
{:else}
  <div class="card table-card">
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
              <code>{s.session_id.slice(0, 8)}…</code>
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
  h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  .table-card { padding: 0; overflow: hidden; }
  .session-id code { font-size: 0.8rem; color: var(--text-muted); font-family: 'SF Mono', monospace; }
  .error-banner { background: var(--red-dim); border-color: var(--red); color: var(--red); margin-bottom: 1rem; }
  .empty-state { color: var(--text-muted); text-align: center; padding: 3rem; }
</style>
