// src/lib/api.ts — Worker API client
// Reads config from localStorage for dashboard-side auth.

/** Typed error kinds for granular UI feedback. */
export type ApiErrorKind = 'network' | 'auth' | 'server' | 'timeout' | 'unknown';

/**
 * Unified API error thrown by apiGet and openRelaySocket.
 * - kind='network'  → offline / DNS / CORS / request aborted before response
 * - kind='auth'     → HTTP 401 or 403
 * - kind='server'   → HTTP 429 or 5xx (transient, retryable)
 * - kind='timeout'  → AbortController fired after REQUEST_TIMEOUT_MS
 * - kind='unknown'  → any other HTTP error
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly requestId?: string;
  /** True when a retry makes sense (network blip, server overload). */
  readonly retryable: boolean;

  constructor(
    message: string,
    kind: ApiErrorKind,
    opts: { status?: number; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryable = kind === 'network' || kind === 'server' || kind === 'timeout';
  }
}

/** @deprecated Use ApiError — kept for backward-compat call sites. */
export class WorkerApiError extends ApiError {
  constructor(message: string, status: number, requestId?: string) {
    const kind: ApiErrorKind =
      status === 401 || status === 403
        ? 'auth'
        : status === 429 || status >= 500
          ? 'server'
          : 'unknown';
    super(message, kind, { status, requestId });
    this.name = 'WorkerApiError';
  }
}

/** Return a user-friendly string for any thrown value. */
export function userMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const suffix = e.requestId ? ` (request ${e.requestId})` : '';
    switch (e.kind) {
      case 'network':  return `Network error — are you online and is the Worker URL correct?${suffix}`;
      case 'auth':     return `Authentication failed — check your admin token.${suffix}`;
      case 'server':   return `Server error — the Worker returned ${e.status ?? 'an error'}. Try again shortly.${suffix}`;
      case 'timeout':  return `Request timed out — the Worker did not respond in time.${suffix}`;
      default:         return `${e.message}${suffix}`;
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** @deprecated Alias for userMessage — kept for backward-compat call sites. */
export const formatWorkerError = userMessage;

/** Retry fn up to maxRetries times, with exponential back-off, only when error.retryable. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 1_000,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxRetries || !(e instanceof ApiError) || !e.retryable) throw e;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
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
  /** Kernel/OS release from enrollment (e.g. Darwin kernel version on macOS). */
  os_release?: string | null;
  /** Client that performed enroll (e.g. scripts/pi-enroll.mjs). */
  enrolled_from?: string | null;
  enrolled_at: string | null;
  last_seen_at: string | null;
  status: string;
};

/** Short OS label for UI (maps Node `platform` to friendly name). */
export function osDisplayName(platform: string): string {
  const p = (platform || '').toLowerCase();
  if (p === 'darwin') return 'macOS';
  if (p === 'win32') return 'Windows';
  if (p === 'linux') return 'Linux';
  if (p.includes('bsd')) return 'BSD';
  return platform || 'Unknown';
}

/** One line: friendly OS · release · arch (heartbeat overrides live arch/platform when present). */
export function formatMachineOs(
  m: Pick<Machine, 'platform' | 'arch' | 'os_release'> | null | undefined,
  hb?: Pick<FleetHeartbeat, 'platform' | 'arch'> | null,
): string {
  const plat = hb?.platform || m?.platform || '';
  const arch = hb?.arch || m?.arch || '';
  const rel = m?.os_release?.trim() || '';
  const bits = [plat ? osDisplayName(plat) : '', rel, arch].filter(Boolean);
  return bits.length ? bits.join(' · ') : '—';
}

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

/** How long before an in-flight request is aborted. */
const REQUEST_TIMEOUT_MS = 15_000;

async function apiGet<T>(path: string): Promise<T> {
  const { workerUrl, token } = getConfig();
  if (!workerUrl) throw new ApiError('Worker URL not configured', 'unknown');

  const url = `${workerUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
      throw new ApiError(
        `Request to ${workerUrl} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`,
        'timeout',
      );
    }
    throw new ApiError(
      `Could not reach the Worker at ${workerUrl}. Check the URL, your network, and that the Worker allows this origin (CORS).`,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  const requestId = res.headers.get('x-request-id') || undefined;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    const fromBody =
      typeof parsed === 'string' && parsed.trim()
        ? parsed.slice(0, 200)
        : messageFromErrorBody(parsed);
    const base = fromBody || res.statusText || `HTTP ${res.status}`;
    const kind: ApiErrorKind =
      res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 429 || res.status >= 500
          ? 'server'
          : 'unknown';
    throw new ApiError(base, kind, { status: res.status, requestId });
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('Worker returned a response that is not valid JSON.', 'unknown');
  }
}

async function apiDelete<T>(path: string): Promise<T> {
  const { workerUrl, token } = getConfig();
  if (!workerUrl) throw new ApiError('Worker URL not configured', 'unknown');
  const url = `${workerUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
      throw new ApiError(`Request to ${workerUrl} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`, 'timeout');
    }
    throw new ApiError(
      `Could not reach the Worker at ${workerUrl}. Check the URL, your network, and that the Worker allows this origin (CORS).`,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
  const requestId = res.headers.get('x-request-id') || undefined;
  if (res.status === 404) return { ok: true, alreadyDeleted: true, requestId } as unknown as T;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    const fromBody = typeof parsed === 'string' && parsed.trim() ? parsed.slice(0, 200) : messageFromErrorBody(parsed);
    const base = fromBody || res.statusText || `HTTP ${res.status}`;
    const kind: ApiErrorKind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 || res.status >= 500 ? 'server' : 'unknown';
    throw new ApiError(base, kind, { status: res.status, requestId });
  }
  try { return (await res.json()) as T; }
  catch { throw new ApiError('Worker returned a response that is not valid JSON.', 'unknown'); }
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

/** Delete a machine and all its data. 404 is treated as success. Never retried. */
export async function deleteMachine(
  machineId: string,
): Promise<{ ok: boolean; alreadyDeleted?: boolean }> {
  return apiDelete(`/v1/machines/${encodeURIComponent(machineId)}`);
}

export function openRelaySocket(machineId: string, role: 'observer'): WebSocket {
  const { workerUrl, token } = getConfig();
  if (!workerUrl) throw new ApiError('Worker URL not configured — go back and re-enter your credentials.', 'unknown');
  if (!token) throw new ApiError('Admin token not configured — go back and re-enter your credentials.', 'auth');
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
