// src/lib/api.test.ts
// Unit tests for ApiError, userMessage, withRetry, and apiGet error classification.
// Run: npx vitest run

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError,
  WorkerApiError,
  userMessage,
  withRetry,
  fetchHeartbeats,
  deleteMachine,
  formatMachineOs,
  osDisplayName,
} from './api';

// ─── ApiError ────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('sets kind and retryable=true for network', () => {
    const e = new ApiError('boom', 'network');
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('sets kind and retryable=true for server', () => {
    const e = new ApiError('boom', 'server', { status: 503 });
    expect(e.kind).toBe('server');
    expect(e.retryable).toBe(true);
    expect(e.status).toBe(503);
  });

  it('sets kind and retryable=true for timeout', () => {
    const e = new ApiError('timed out', 'timeout');
    expect(e.kind).toBe('timeout');
    expect(e.retryable).toBe(true);
  });

  it('sets kind and retryable=false for auth', () => {
    const e = new ApiError('unauthorized', 'auth', { status: 401 });
    expect(e.kind).toBe('auth');
    expect(e.retryable).toBe(false);
  });

  it('sets kind and retryable=false for unknown', () => {
    const e = new ApiError('wat', 'unknown', { status: 400 });
    expect(e.kind).toBe('unknown');
    expect(e.retryable).toBe(false);
  });

  it('propagates requestId', () => {
    const e = new ApiError('msg', 'server', { requestId: 'req-1' });
    expect(e.requestId).toBe('req-1');
  });
});

// ─── WorkerApiError backward-compat ──────────────────────────────────────────

describe('WorkerApiError', () => {
  it('maps 401 → auth', () => {
    const e = new WorkerApiError('no', 401);
    expect(e.kind).toBe('auth');
    expect(e.retryable).toBe(false);
  });

  it('maps 403 → auth', () => {
    const e = new WorkerApiError('no', 403);
    expect(e.kind).toBe('auth');
  });

  it('maps 429 → server (retryable)', () => {
    const e = new WorkerApiError('rate limited', 429);
    expect(e.kind).toBe('server');
    expect(e.retryable).toBe(true);
  });

  it('maps 500 → server (retryable)', () => {
    const e = new WorkerApiError('server error', 500);
    expect(e.kind).toBe('server');
    expect(e.retryable).toBe(true);
  });

  it('maps 400 → unknown (non-retryable)', () => {
    const e = new WorkerApiError('bad request', 400);
    expect(e.kind).toBe('unknown');
    expect(e.retryable).toBe(false);
  });
});

// ─── userMessage ─────────────────────────────────────────────────────────────

describe('userMessage', () => {
  it('returns network message for kind=network', () => {
    const msg = userMessage(new ApiError('raw', 'network'));
    expect(msg).toMatch(/network error/i);
    expect(msg).toMatch(/online/i);
  });

  it('returns auth message for kind=auth', () => {
    const msg = userMessage(new ApiError('raw', 'auth'));
    expect(msg).toMatch(/authentication failed/i);
    expect(msg).toMatch(/token/i);
  });

  it('returns server message with status for kind=server', () => {
    const msg = userMessage(new ApiError('raw', 'server', { status: 503 }));
    expect(msg).toMatch(/server error/i);
    expect(msg).toMatch(/503/);
  });

  it('returns timeout message for kind=timeout', () => {
    const msg = userMessage(new ApiError('raw', 'timeout'));
    expect(msg).toMatch(/timed out/i);
  });

  it('returns raw message for kind=unknown', () => {
    const msg = userMessage(new ApiError('Something weird', 'unknown'));
    expect(msg).toBe('Something weird');
  });

  it('appends requestId when present', () => {
    const msg = userMessage(new ApiError('fail', 'auth', { requestId: 'req-abc' }));
    expect(msg).toMatch(/req-abc/);
  });

  it('handles plain Error', () => {
    expect(userMessage(new Error('plain'))).toBe('plain');
  });

  it('handles non-Error string', () => {
    expect(userMessage('raw string')).toBe('raw string');
  });
});

// ─── withRetry ───────────────────────────────────────────────────────────────

describe('withRetry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withRetry(fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable ApiError up to maxRetries times', async () => {
    const err = new ApiError('network fail', 'network');
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');

    // Start the promise then advance timers concurrently
    const promise = withRetry(fn, 2, 100);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('stops retrying after maxRetries and rethrows', async () => {
    const err = new ApiError('server fail', 'server');
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn, 2, 100);
    // Pre-attach a .catch so the rejection is never briefly unhandled during timer advance
    const caught = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await caught).toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does NOT retry non-retryable ApiError (auth)', async () => {
    const err = new ApiError('auth fail', 'auth');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, 2, 100)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry non-ApiError errors', async () => {
    const err = new TypeError('unexpected');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, 2, 100)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('with maxRetries=0, tries exactly once and throws', async () => {
    const err = new ApiError('net', 'network');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, 0, 100)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff: 1st retry after baseDelay, 2nd after 2×baseDelay', async () => {
    const err = new ApiError('net', 'network');
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue('done');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const promise = withRetry(fn, 2, 1_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
    expect(delays).toContain(1_000); // attempt 0 → 1s
    expect(delays).toContain(2_000); // attempt 1 → 2s
  });
});

// ─── apiGet error classification (via fetch mock) ─────────────────────────────

describe('apiGet error classification', () => {
  // apiGet is not exported; we test it indirectly through the exported fetch wrappers.
  // We mock localStorage and fetch to isolate each error scenario.

  beforeEach(() => {
    // Stub localStorage
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'pi_worker_url' ? 'https://worker.example.com' : 'tok-secret',
    });
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('throws ApiError(kind=network) when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'network' && e.retryable,
    );
  });

  it('throws ApiError(kind=timeout) when AbortController fires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new DOMException('Aborted', 'AbortError'), {}),
    ));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'timeout',
    );
  });

  it('throws ApiError(kind=auth) for HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      headers: { get: () => null },
      text: async () => '{"error":"not authed"}',
    }));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'auth' && !e.retryable,
    );
  });

  it('throws ApiError(kind=auth) for HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      headers: { get: () => null },
      text: async () => '',
    }));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'auth',
    );
  });

  it('throws ApiError(kind=server, retryable) for HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error',
      headers: { get: () => null },
      text: async () => '{"error":"db down"}',
    }));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'server' && e.retryable,
    );
  });

  it('throws ApiError(kind=server, retryable) for HTTP 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { get: () => null },
      text: async () => '',
    }));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'server' && e.retryable,
    );
  });

  it('throws ApiError(kind=unknown, non-retryable) for HTTP 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, statusText: 'Bad Request',
      headers: { get: () => null },
      text: async () => '',
    }));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'unknown' && !e.retryable,
    );
  });

  it('propagates x-request-id from response headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: 'err',
      headers: { get: (h: string) => h === 'x-request-id' ? 'req-xyz' : null },
      text: async () => '',
    }));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.requestId === 'req-xyz',
    );
  });

  it('throws ApiError(kind=unknown) when response JSON is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => { throw new SyntaxError('Unexpected token'); },
    }));
    await expect(fetchHeartbeats()).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'unknown',
    );
  });
});


// ─── deleteMachine / apiDelete ──────────────────────────────────────────────

describe('deleteMachine', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'pi_worker_url' ? 'https://worker.example.com/' : 'tok-secret',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls fetch with DELETE method and correct URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteMachine('machine-123')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://worker.example.com/v1/machines/machine-123',
      expect.objectContaining({
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-secret' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns { ok: true } on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    }));

    await expect(deleteMachine('machine-123')).resolves.toEqual({ ok: true });
  });

  it('treats 404 as success and returns alreadyDeleted=true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: (h: string) => h === 'x-request-id' ? 'req-404' : null },
      text: async () => JSON.stringify({ error: 'machine not found' }),
    }));

    await expect(deleteMachine('gone-machine')).resolves.toEqual({
      ok: true,
      alreadyDeleted: true,
      requestId: 'req-404',
    });
  });

  it('throws ApiError(kind=auth) on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: 'unauthorized' }),
    }));

    await expect(deleteMachine('machine-123')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'auth' && e.status === 401,
    );
  });

  it('throws ApiError(kind=server) on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: 'db down' }),
    }));

    await expect(deleteMachine('machine-123')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'server' && e.status === 500,
    );
  });

  it('throws ApiError(kind=network) on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(deleteMachine('machine-123')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.kind === 'network',
    );
  });

  it('throws ApiError(kind=timeout) when AbortController fires', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));

    const promise = deleteMachine('slow-machine');
    const caught = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_001);
    const error = await caught;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('timeout');
  });

  it('encodes special characters in machineId via encodeURIComponent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const machineId = 'machine id/with?weird#chars%';
    await deleteMachine(machineId);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://worker.example.com/v1/machines/${encodeURIComponent(machineId)}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('osDisplayName / formatMachineOs', () => {
  it('maps Node platform to friendly labels', () => {
    expect(osDisplayName('darwin')).toBe('macOS');
    expect(osDisplayName('win32')).toBe('Windows');
    expect(osDisplayName('linux')).toBe('Linux');
  });

  it('joins enrollment fields with separators', () => {
    expect(
      formatMachineOs({ platform: 'darwin', arch: 'arm64', os_release: '23.4.0' }, null),
    ).toBe('macOS · 23.4.0 · arm64');
  });

  it('uses heartbeat arch when newer than D1 row', () => {
    expect(
      formatMachineOs({ platform: 'linux', arch: 'x64', os_release: '6.1' }, { platform: 'linux', arch: 'aarch64' }),
    ).toBe('Linux · 6.1 · aarch64');
  });

  it('returns em dash when empty', () => {
    expect(formatMachineOs(null, null)).toBe('—');
  });
});
