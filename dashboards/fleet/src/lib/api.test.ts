// src/lib/api.test.ts
// Unit tests for ApiError, userMessage, withRetry, and apiGet error classification.
// Run: npx vitest run

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, WorkerApiError, userMessage, withRetry, fetchHeartbeats } from './api';

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
