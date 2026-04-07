// src/lib/api.ts — Worker API client
// Reads config from localStorage for dashboard-side auth.

/** Thrown for HTTP error responses from the Worker (includes optional tracing id). */
export class WorkerApiError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'WorkerApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

export function formatWorkerError(err: unknown): string {
  if (err instanceof WorkerApiError) {
    const id = err.requestId ? ` — request ${err.requestId}` : '';
    return `${err.message}${id}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function messageFromErrorBody(body: unknown): string | undefined {
  if (body == null || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  const err = o.error;
  const msg = o.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return undefined;
}

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

  const url = `${workerUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error(
      `Could not reach the worker at ${workerUrl}. Check the URL, your network, and that the Worker allows this origin (CORS).`,
    );
  }

  const requestId = res.headers.get('x-request-id') || undefined;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    const fromBody =
      typeof parsed === 'string' && parsed.trim()
        ? parsed.slice(0, 200)
        : messageFromErrorBody(parsed);
    const base =
      fromBody ||
      (res.status === 401 || res.status === 403
        ? 'Unauthorized — check your admin token.'
        : res.statusText || `HTTP ${res.status}`);
    throw new WorkerApiError(base, res.status, requestId);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new Error('Worker returned a response that is not valid JSON.');
  }
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
  if (!workerUrl) throw new Error('Worker URL not configured');
  if (!token) throw new Error('Admin token not configured');
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
