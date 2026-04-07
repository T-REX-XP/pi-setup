// src/lib/api.ts — Worker API client
// Reads config from localStorage for dashboard-side auth.

export type Machine = {
  machine_id: string;
  hostname: string;
  platform: string;
  arch: string;
  enrolled_at: string | null;
  last_seen_at: string | null;
  status: string;
};

export type FleetHeartbeat = {
  machineId: string;
  hostname: string;
  platform: string;
  uptimeSeconds: number;
  loadavg: number[];
  memory: { total: number; free: number; used: number };
  cpuCount: number;
  arch: string;
  timestamp: string;
  receivedAt: string;
  stale: boolean;
};

export type Session = {
  session_id: string;
  machine_id: string;
  cwd: string | null;
  model: string | null;
  provider: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  message_count: number;
};

export type UsageMetric = {
  id: string;
  machine_id: string;
  session_id: string | null;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  recorded_at: string;
};

function getConfig() {
  if (typeof localStorage === 'undefined') return { workerUrl: '', token: '' };
  return {
    workerUrl: (localStorage.getItem('pi_worker_url') || '').replace(/\/$/, ''),
    token: localStorage.getItem('pi_token') || '',
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const { workerUrl, token } = getConfig();
  if (!workerUrl) throw new Error('Worker URL not configured');
  const res = await fetch(`${workerUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function fetchHeartbeats(): Promise<{ heartbeats: FleetHeartbeat[] }> {
  return apiGet('/v1/fleet/heartbeats');
}

export async function fetchMachines(): Promise<{ machines: Machine[] }> {
  return apiGet('/v1/machines');
}

export async function fetchSessions(machineId?: string): Promise<{ sessions: Session[] }> {
  const qs = machineId ? `?machineId=${encodeURIComponent(machineId)}` : '';
  return apiGet(`/v1/sessions${qs}`);
}

export async function fetchUsage(machineId?: string): Promise<{ metrics: UsageMetric[] }> {
  const qs = machineId ? `?machineId=${encodeURIComponent(machineId)}` : '';
  return apiGet(`/v1/usage${qs}`);
}

export function openRelaySocket(machineId: string, role: 'observer'): WebSocket {
  const { workerUrl, token } = getConfig();
  const wsUrl = workerUrl.replace(/^http/, 'ws');
  const ws = new WebSocket(`${wsUrl}/v1/relay/${encodeURIComponent(machineId)}?role=${role}&token=${encodeURIComponent(token)}`);
  return ws;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function machineStatus(heartbeat: FleetHeartbeat | undefined): 'online' | 'stale' | 'offline' {
  if (!heartbeat) return 'offline';
  if (heartbeat.stale) return 'stale';
  const age = Date.now() - Date.parse(heartbeat.receivedAt);
  if (age > 180_000) return 'stale';
  return 'online';
}
