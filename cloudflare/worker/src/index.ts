export interface Env {
  PI_SETUP_SECRETS: KVNamespace;
  PI_DB: D1Database;
  PI_RELAY: DurableObjectNamespace;
  PI_SETUP_BOOTSTRAP_TOKEN: string;
  PI_SETUP_ENROLLMENT_SIGNING_KEY: string;
  PI_SETUP_ALLOWED_ORIGIN?: string;
}

type SecretRecord = {
  name: string;
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: string;
  version: string;
  updatedAt: string;
  machineId?: string;
};

type EnrollmentRequest = {
  machineId: string;
  secretName: string;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
};

type SignedTokenPayload = {
  typ: 'enrollment' | 'bootstrap';
  jti: string;
  machineId: string;
  secretName: string;
  iat: number;
  exp: number;
};

type EnrollmentRecord = {
  machineId: string;
  secretName: string;
  issuedAt: string;
  expiresAt: string;
  enrolledAt?: string;
  bootstrapIssuedAt?: string;
  metadata?: Record<string, unknown>;
};

type FleetHeartbeat = {
  machineId: string;
  hostname: string;
  platform: string;
  release: string;
  uptimeSeconds: number;
  loadavg: number[];
  memory: {
    total: number;
    free: number;
    used: number;
  };
  cpuCount: number;
  arch: string;
  timestamp: string;
  receivedAt?: string;
  stale?: boolean;
};

type WebsocketTraceEvent = {
  machineId: string;
  connectionId?: string;
  direction: 'in' | 'out' | 'system';
  eventType: string;
  payloadSize?: number;
  status?: 'ok' | 'error';
  metadata?: Record<string, unknown>;
  timestamp?: string;
  requestId?: string;
};

type RequestContext = {
  requestId: string;
  origin: string;
  method: string;
  path: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_TRACE_LIST_LIMIT = 100;

function json(data: unknown, status = 200, origin = '*', requestId?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-request-id',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS'
  };
  if (requestId) headers['x-request-id'] = requestId;
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

async function readBody<T>(request: Request): Promise<T> {
  return await request.json() as T;
}

function isAdminAuth(auth: string | null, env: Env) {
  return auth === `Bearer ${env.PI_SETUP_BOOTSTRAP_TOKEN}`;
}

function b64urlEncode(input: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signingKey(secret: string) {
  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signToken(payload: SignedTokenPayload, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = b64urlEncode(JSON.stringify(header));
  const encodedPayload = b64urlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(unsigned));
  return `${unsigned}.${b64urlEncode(signature)}`;
}

async function verifyToken(token: string, secret: string): Promise<SignedTokenPayload | null> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(secret),
    b64urlDecode(encodedSignature),
    encoder.encode(unsigned)
  );
  if (!valid) return null;
  try {
    const payload = JSON.parse(decoder.decode(b64urlDecode(encodedPayload))) as SignedTokenPayload;
    if (!payload.typ || !payload.jti || !payload.machineId || !payload.secretName || !payload.iat || !payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearerToken(auth: string | null) {
  return auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isoFromSeconds(value: number) {
  return new Date(value * 1000).toISOString();
}

function randomId() {
  return crypto.randomUUID();
}

function isStaleHeartbeat(timestamp: string, staleAfterMs = 60000) {
  const seenAt = Date.parse(timestamp);
  if (Number.isNaN(seenAt)) return true;
  return Date.now() - seenAt > staleAfterMs;
}

function requestContext(request: Request, origin: string): RequestContext {
  const url = new URL(request.url);
  return {
    requestId: request.headers.get('x-request-id') || crypto.randomUUID(),
    origin,
    method: request.method,
    path: url.pathname,
  };
}

function log(level: 'info' | 'warn' | 'error', event: string, ctx: RequestContext, details: Record<string, unknown> = {}) {
  console[level](JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    requestId: ctx.requestId,
    method: ctx.method,
    path: ctx.path,
    ...details,
  }));
}

function response(ctx: RequestContext, payload: unknown, status = 200) {
  return json(payload, status, ctx.origin, ctx.requestId);
}

function unauthorized(ctx: RequestContext, error = 'unauthorized') {
  return response(ctx, { ok: false, error, requestId: ctx.requestId }, 401);
}

async function authorizeSecretRead(request: Request, env: Env, secretName: string, ctx: RequestContext) {
  const auth = request.headers.get('authorization');
  if (isAdminAuth(auth, env)) return { ok: true as const, machineId: null };

  const token = bearerToken(auth);
  if (!token) return { ok: false as const, response: unauthorized(ctx) };

  const payload = await verifyToken(token, env.PI_SETUP_ENROLLMENT_SIGNING_KEY);
  if (!payload || payload.typ !== 'bootstrap') {
    return { ok: false as const, response: unauthorized(ctx) };
  }
  if (payload.exp < nowSeconds()) {
    return { ok: false as const, response: response(ctx, { ok: false, error: 'bootstrap token expired', requestId: ctx.requestId }, 401) };
  }
  if (payload.secretName !== secretName) {
    return { ok: false as const, response: response(ctx, { ok: false, error: 'secret not allowed for token', requestId: ctx.requestId }, 403) };
  }
  return { ok: true as const, machineId: payload.machineId };
}

async function requireAdmin(request: Request, env: Env, ctx: RequestContext) {
  if (!isAdminAuth(request.headers.get('authorization'), env)) {
    log('warn', 'auth.unauthorized', ctx);
    return { ok: false as const, response: unauthorized(ctx) };
  }
  return { ok: true as const };
}

async function listJsonByPrefix<T>(env: Env, prefix: string, limit = MAX_TRACE_LIST_LIMIT): Promise<T[]> {
  const list = await env.PI_SETUP_SECRETS.list({ prefix, limit: Math.min(limit, MAX_TRACE_LIST_LIMIT) });
  const items = await Promise.all(list.keys.map(async (key) => await env.PI_SETUP_SECRETS.get(key.name, 'json') as T | null));
  return items.filter((value): value is T => Boolean(value));
}

function traceKey(timestamp: string) {
  return `ws-event:${timestamp}:${randomId()}`;
}

// ─── Durable Object: WebSocket relay ─────────────────────────────────────────
// Each machine gets its own DO instance keyed by machineId.
// The fleet daemon connects as 'agent'; dashboard connects as 'observer'.
export class PIRelayDurableObject {
  private sessions: Map<WebSocket, { role: 'agent' | 'observer' }> = new Map();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const url = new URL(request.url);
    const role = (url.searchParams.get('role') || 'observer') as 'agent' | 'observer';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    this.sessions.set(server, { role });

    // Send welcome frame to the new observer with current agent status
    if (role === 'observer') {
      const agentOnline = [...this.sessions.values()].some((s) => s.role === 'agent');
      server.send(JSON.stringify({ type: 'relay:welcome', agentOnline }));
    }
    // Notify observers when an agent connects
    if (role === 'agent') {
      this.broadcast({ type: 'relay:agent-connected' }, 'observer');
    }

    server.addEventListener('message', (event) => {
      // Agent messages are broadcast to observers and vice versa
      const target: 'agent' | 'observer' = role === 'agent' ? 'observer' : 'agent';
      this.broadcast(event.data, target);
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
      if (role === 'agent') {
        this.broadcast({ type: 'relay:agent-disconnected' }, 'observer');
      }
    });

    server.addEventListener('error', () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(data: unknown, targetRole: 'agent' | 'observer') {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const [ws, meta] of this.sessions) {
      if (meta.role === targetRole) {
        try { ws.send(payload); } catch { this.sessions.delete(ws); }
      }
    }
  }
}

// ─── D1 helpers ──────────────────────────────────────────────────────────────
async function upsertMachine(db: D1Database, machineId: string, fields: Record<string, unknown>) {
  const cols = ['machine_id', ...Object.keys(fields)];
  const vals = [machineId, ...Object.values(fields)];
  const placeholders = cols.map(() => '?').join(', ');
  const updates = Object.keys(fields).map((k) => `${k} = excluded.${k}`).join(', ');
  await db.prepare(
    `INSERT INTO machines (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(machine_id) DO UPDATE SET ${updates}, last_seen_at = excluded.last_seen_at`
  ).bind(...vals).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.PI_SETUP_ALLOWED_ORIGIN || '*';
    const ctx = requestContext(request, origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return response(ctx, { ok: true, requestId: ctx.requestId }, 200);
    }

    log('info', 'request.start', ctx);

    try {
      const auth = request.headers.get('authorization');

      if (request.method === 'POST' && url.pathname === '/v1/enrollment-tokens/issue') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const body = await readBody<EnrollmentRequest>(request);
        if (!body.machineId || !body.secretName) {
          return response(ctx, { ok: false, error: 'machineId and secretName are required', requestId: ctx.requestId }, 400);
        }
        const ttlSeconds = Math.min(Math.max(body.ttlSeconds || 600, 60), 3600);
        const issuedAt = nowSeconds();
        const exp = issuedAt + ttlSeconds;
        const jti = randomId();
        const payload: SignedTokenPayload = {
          typ: 'enrollment',
          jti,
          machineId: body.machineId,
          secretName: body.secretName,
          iat: issuedAt,
          exp,
        };
        const record: EnrollmentRecord = {
          machineId: body.machineId,
          secretName: body.secretName,
          issuedAt: isoFromSeconds(issuedAt),
          expiresAt: isoFromSeconds(exp),
          metadata: body.metadata,
        };
        await env.PI_SETUP_SECRETS.put(`enrollment:${jti}`, JSON.stringify(record), { expiration: exp });
        log('info', 'enrollment.token.issued', ctx, { machineId: body.machineId, secretName: body.secretName, ttlSeconds });
        return response(ctx, { ok: true, token: await signToken(payload, env.PI_SETUP_ENROLLMENT_SIGNING_KEY), expiresAt: record.expiresAt, machineId: body.machineId, secretName: body.secretName, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'POST' && url.pathname === '/v1/machines/enroll') {
        const token = bearerToken(auth);
        if (!token) return unauthorized(ctx);
        const payload = await verifyToken(token, env.PI_SETUP_ENROLLMENT_SIGNING_KEY);
        if (!payload || payload.typ !== 'enrollment') {
          return response(ctx, { ok: false, error: 'invalid enrollment token', requestId: ctx.requestId }, 401);
        }
        if (payload.exp < nowSeconds()) {
          return response(ctx, { ok: false, error: 'enrollment token expired', requestId: ctx.requestId }, 401);
        }
        const recordKey = `enrollment:${payload.jti}`;
        const stored = await env.PI_SETUP_SECRETS.get(recordKey, 'json') as EnrollmentRecord | null;
        if (!stored) return response(ctx, { ok: false, error: 'enrollment token not found or expired', requestId: ctx.requestId }, 404);
        if (stored.enrolledAt) return response(ctx, { ok: false, error: 'enrollment token already used', requestId: ctx.requestId }, 409);

        const bootstrapIssuedAt = nowSeconds();
        const bootstrapExp = bootstrapIssuedAt + 300;
        const bootstrapPayload: SignedTokenPayload = {
          typ: 'bootstrap',
          jti: randomId(),
          machineId: payload.machineId,
          secretName: payload.secretName,
          iat: bootstrapIssuedAt,
          exp: bootstrapExp,
        };
        const enrollmentMetadata = await readBody<Record<string, unknown>>(request).catch(() => ({}));
        await env.PI_SETUP_SECRETS.put(recordKey, JSON.stringify({
          ...stored,
          enrolledAt: new Date().toISOString(),
          bootstrapIssuedAt: isoFromSeconds(bootstrapIssuedAt),
          metadata: { ...(stored.metadata || {}), ...(enrollmentMetadata || {}) },
        }), { expiration: payload.exp });
        await env.PI_SETUP_SECRETS.put(`machine:${payload.machineId}`, JSON.stringify({
          machineId: payload.machineId,
          secretName: payload.secretName,
          enrolledAt: new Date().toISOString(),
          metadata: enrollmentMetadata || {},
        }));
        if (env.PI_DB) {
          const meta = enrollmentMetadata || {};
          const hostname =
            typeof meta.hostname === 'string' && meta.hostname.trim() ? meta.hostname.trim() : payload.machineId;
          const enrolledAt = new Date().toISOString();
          await upsertMachine(env.PI_DB, payload.machineId, {
            hostname,
            platform: typeof meta.platform === 'string' ? meta.platform : null,
            arch: typeof meta.arch === 'string' ? meta.arch : null,
            enrolled_at: enrolledAt,
            last_seen_at: enrolledAt,
            status: 'enrolled',
          });
        }
        log('info', 'machine.enrolled', ctx, { machineId: payload.machineId, secretName: payload.secretName });
        return response(ctx, { ok: true, machineId: payload.machineId, secretName: payload.secretName, bootstrapToken: await signToken(bootstrapPayload, env.PI_SETUP_ENROLLMENT_SIGNING_KEY), bootstrapExpiresAt: isoFromSeconds(bootstrapExp), requestId: ctx.requestId }, 200);
      }

      if (request.method === 'POST' && url.pathname === '/v1/secrets/upsert') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const body = await readBody<SecretRecord>(request);
        if (!body.name || !body.ciphertext || !body.iv || !body.tag) {
          return response(ctx, { ok: false, error: 'name, ciphertext, iv, and tag are required', requestId: ctx.requestId }, 400);
        }
        const record: SecretRecord = {
          ...body,
          algorithm: body.algorithm || 'AES-GCM',
          version: body.version || '1',
          updatedAt: new Date().toISOString(),
        };
        await env.PI_SETUP_SECRETS.put(`secret:${record.name}`, JSON.stringify(record));
        log('info', 'secret.upserted', ctx, { secretName: record.name, machineId: record.machineId ?? null });
        return response(ctx, { ok: true, stored: record.name, updatedAt: record.updatedAt, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'POST' && url.pathname === '/v1/fleet/heartbeat') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const body = await readBody<FleetHeartbeat>(request);
        if (!body.machineId || !body.hostname || !body.timestamp) {
          return response(ctx, { ok: false, error: 'machineId, hostname, and timestamp are required', requestId: ctx.requestId }, 400);
        }
        const heartbeat: FleetHeartbeat = {
          ...body,
          receivedAt: new Date().toISOString(),
          stale: isStaleHeartbeat(body.timestamp),
        };
        await env.PI_SETUP_SECRETS.put(`fleet:${heartbeat.machineId}`, JSON.stringify(heartbeat));
        log('info', 'fleet.heartbeat.received', ctx, { machineId: heartbeat.machineId, hostname: heartbeat.hostname, stale: heartbeat.stale });
        return response(ctx, { ok: true, machineId: heartbeat.machineId, receivedAt: heartbeat.receivedAt, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'GET' && url.pathname === '/v1/fleet/heartbeats') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const heartbeats = await listJsonByPrefix<FleetHeartbeat>(env, 'fleet:');
        const items = heartbeats.map((value) => ({ ...value, stale: isStaleHeartbeat(value.timestamp) }))
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return response(ctx, { ok: true, count: items.length, heartbeats: items, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'POST' && url.pathname === '/v1/observability/websocket-events') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const body = await readBody<WebsocketTraceEvent>(request);
        if (!body.machineId || !body.eventType || !body.direction) {
          return response(ctx, { ok: false, error: 'machineId, eventType, and direction are required', requestId: ctx.requestId }, 400);
        }
        const event: WebsocketTraceEvent = {
          ...body,
          timestamp: body.timestamp || new Date().toISOString(),
          requestId: ctx.requestId,
        };
        await env.PI_SETUP_SECRETS.put(traceKey(event.timestamp), JSON.stringify(event));
        log('info', 'websocket.event.recorded', ctx, {
          machineId: event.machineId,
          connectionId: event.connectionId ?? null,
          direction: event.direction,
          eventType: event.eventType,
          status: event.status ?? null,
          payloadSize: event.payloadSize ?? null,
        });
        return response(ctx, { ok: true, recordedAt: event.timestamp, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'GET' && url.pathname === '/v1/observability/websocket-events') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const machineId = url.searchParams.get('machineId');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '25'), 1), MAX_TRACE_LIST_LIMIT);
        const events = await listJsonByPrefix<WebsocketTraceEvent>(env, 'ws-event:', limit);
        const filtered = events
          .filter((event) => !machineId || event.machineId === machineId)
          .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
          .slice(0, limit);
        return response(ctx, { ok: true, count: filtered.length, events: filtered, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'GET' && url.pathname === '/v1/diagnostics') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const [secretsList, enrollmentsList, machinesList, fleetList, websocketList] = await Promise.all([
          env.PI_SETUP_SECRETS.list({ prefix: 'secret:' }),
          env.PI_SETUP_SECRETS.list({ prefix: 'enrollment:' }),
          env.PI_SETUP_SECRETS.list({ prefix: 'machine:' }),
          env.PI_SETUP_SECRETS.list({ prefix: 'fleet:' }),
          env.PI_SETUP_SECRETS.list({ prefix: 'ws-event:', limit: MAX_TRACE_LIST_LIMIT }),
        ]);

        const latestHeartbeats = (await listJsonByPrefix<FleetHeartbeat>(env, 'fleet:', 10))
          .map((value) => ({ ...value, stale: isStaleHeartbeat(value.timestamp) }))
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        const latestWebsocketEvents = (await listJsonByPrefix<WebsocketTraceEvent>(env, 'ws-event:', 20))
          .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

        return response(ctx, {
          ok: true,
          requestId: ctx.requestId,
          diagnostics: {
            counts: {
              secrets: secretsList.keys.length,
              enrollments: enrollmentsList.keys.length,
              machines: machinesList.keys.length,
              fleetHeartbeats: fleetList.keys.length,
              websocketEvents: websocketList.keys.length,
            },
            auth: {
              allowedOrigin: origin,
              bootstrapTokenConfigured: Boolean(env.PI_SETUP_BOOTSTRAP_TOKEN),
              enrollmentSigningKeyConfigured: Boolean(env.PI_SETUP_ENROLLMENT_SIGNING_KEY),
            },
            fleet: {
              staleCount: latestHeartbeats.filter((item) => item.stale).length,
              latestHeartbeats,
            },
            websocket: {
              latestEvents: latestWebsocketEvents,
            },
          },
        }, 200);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/v1/secrets/')) {
        const name = decodeURIComponent(url.pathname.replace('/v1/secrets/', ''));
        const authz = await authorizeSecretRead(request, env, name, ctx);
        if (!authz.ok) return authz.response;
        const data = await env.PI_SETUP_SECRETS.get(`secret:${name}`);
        if (!data) return response(ctx, { ok: false, error: 'not found', requestId: ctx.requestId }, 404);
        log('info', 'secret.read', ctx, { secretName: name, machineId: authz.machineId });
        return response(ctx, { ok: true, machineId: authz.machineId, secret: JSON.parse(data), requestId: ctx.requestId }, 200);
      }

      if (request.method === 'GET' && url.pathname === '/v1/secrets') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const list = await env.PI_SETUP_SECRETS.list({ prefix: 'secret:' });
        return response(ctx, { ok: true, keys: list.keys.map((key) => key.name.replace(/^secret:/, '')), requestId: ctx.requestId }, 200);
      }

      // ── WebSocket relay (Durable Object) ─────────────────────────────────
      if (url.pathname.startsWith('/v1/relay/')) {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;
        if (request.headers.get('Upgrade') !== 'websocket') {
          return response(ctx, { ok: false, error: 'Expected WebSocket upgrade', requestId: ctx.requestId }, 426);
        }
        const machineId = decodeURIComponent(url.pathname.replace('/v1/relay/', '').split('/')[0]);
        if (!machineId) return response(ctx, { ok: false, error: 'machineId required', requestId: ctx.requestId }, 400);
        const id = env.PI_RELAY.idFromName(machineId);
        const stub = env.PI_RELAY.get(id);
        return stub.fetch(request);
      }

      // ── Sessions (D1) ────────────────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/v1/sessions') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;
        const body = await readBody<{
          sessionId: string; machineId: string; cwd?: string; model?: string; provider?: string;
          startedAt: string; endedAt?: string; status?: string; messageCount?: number;
        }>(request);
        if (!body.sessionId || !body.machineId || !body.startedAt) {
          return response(ctx, { ok: false, error: 'sessionId, machineId, and startedAt are required', requestId: ctx.requestId }, 400);
        }
        if (env.PI_DB) {
          await upsertMachine(env.PI_DB, body.machineId, { last_seen_at: new Date().toISOString() });
          await env.PI_DB.prepare(
            `INSERT INTO sessions (session_id,machine_id,cwd,model,provider,started_at,ended_at,status,message_count)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT(session_id) DO UPDATE SET
               ended_at=excluded.ended_at, status=excluded.status, message_count=excluded.message_count`
          ).bind(body.sessionId, body.machineId, body.cwd ?? null, body.model ?? null, body.provider ?? null,
            body.startedAt, body.endedAt ?? null, body.status ?? 'active', body.messageCount ?? 0).run();
        }
        log('info', 'session.upserted', ctx, { sessionId: body.sessionId, machineId: body.machineId });
        return response(ctx, { ok: true, sessionId: body.sessionId, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'GET' && url.pathname === '/v1/sessions') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;
        const machineId = url.searchParams.get('machineId');
        const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200);
        if (!env.PI_DB) return response(ctx, { ok: false, error: 'D1 not configured', requestId: ctx.requestId }, 503);
        const rows = machineId
          ? await env.PI_DB.prepare('SELECT * FROM sessions WHERE machine_id=? ORDER BY started_at DESC LIMIT ?').bind(machineId, limit).all()
          : await env.PI_DB.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').bind(limit).all();
        return response(ctx, { ok: true, count: rows.results.length, sessions: rows.results, requestId: ctx.requestId }, 200);
      }

      // ── Usage metrics (D1) ───────────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/v1/usage') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;
        const body = await readBody<{
          machineId: string; sessionId?: string; model?: string; provider?: string;
          inputTokens?: number; outputTokens?: number; costUsd?: number;
        }>(request);
        if (!body.machineId) return response(ctx, { ok: false, error: 'machineId required', requestId: ctx.requestId }, 400);
        if (env.PI_DB) {
          await upsertMachine(env.PI_DB, body.machineId, { last_seen_at: new Date().toISOString() });
          await env.PI_DB.prepare(
            `INSERT INTO usage_metrics (id,machine_id,session_id,model,provider,input_tokens,output_tokens,cost_usd,recorded_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
          ).bind(randomId(), body.machineId, body.sessionId ?? null, body.model ?? null, body.provider ?? null,
            body.inputTokens ?? 0, body.outputTokens ?? 0, body.costUsd ?? 0, new Date().toISOString()).run();
        }
        return response(ctx, { ok: true, requestId: ctx.requestId }, 200);
      }

      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;
        const machineId = url.searchParams.get('machineId');
        const limit = Math.min(Number(url.searchParams.get('limit') || '100'), 500);
        if (!env.PI_DB) return response(ctx, { ok: false, error: 'D1 not configured', requestId: ctx.requestId }, 503);
        const rows = machineId
          ? await env.PI_DB.prepare('SELECT * FROM usage_metrics WHERE machine_id=? ORDER BY recorded_at DESC LIMIT ?').bind(machineId, limit).all()
          : await env.PI_DB.prepare('SELECT * FROM usage_metrics ORDER BY recorded_at DESC LIMIT ?').bind(limit).all();
        return response(ctx, { ok: true, count: rows.results.length, metrics: rows.results, requestId: ctx.requestId }, 200);
      }

      // ── Machines (D1) ────────────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/v1/machines') {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;
        if (!env.PI_DB) return response(ctx, { ok: false, error: 'D1 not configured', requestId: ctx.requestId }, 503);
        const rows = await env.PI_DB.prepare('SELECT * FROM machines ORDER BY last_seen_at DESC').all();
        return response(ctx, { ok: true, count: rows.results.length, machines: rows.results, requestId: ctx.requestId }, 200);
      }

      // ── Delete machine (cascade) ─────────────────────────────────────────
      if (request.method === 'DELETE' && url.pathname.startsWith('/v1/machines/')) {
        const admin = await requireAdmin(request, env, ctx);
        if (!admin.ok) return admin.response;

        const machineId = decodeURIComponent(url.pathname.slice('/v1/machines/'.length));
        // Reject paths with extra segments (e.g. /v1/machines/foo/bar)
        if (!machineId || machineId.includes('/')) return response(ctx, { ok: false, error: 'machineId required', requestId: ctx.requestId }, 400);

        if (!env.PI_DB) return response(ctx, { ok: false, error: 'D1 not configured', requestId: ctx.requestId }, 503);

        // Verify machine exists before touching child rows (prevents partial deletes on phantom IDs)
        const existing = await env.PI_DB.prepare('SELECT machine_id FROM machines WHERE machine_id = ?').bind(machineId).first();
        if (!existing) return response(ctx, { ok: false, error: 'machine not found', requestId: ctx.requestId }, 404);

        // Cascade: delete dependents first, then the parent row
        await env.PI_DB.prepare('DELETE FROM usage_metrics WHERE machine_id = ?').bind(machineId).run();
        await env.PI_DB.prepare('DELETE FROM sessions WHERE machine_id = ?').bind(machineId).run();
        await env.PI_DB.prepare('DELETE FROM machines WHERE machine_id = ?').bind(machineId).run();

        // Clean up KV heartbeat and enrollment record
        await Promise.all([
          env.PI_SETUP_SECRETS.delete(`fleet:${machineId}`),
          env.PI_SETUP_SECRETS.delete(`machine:${machineId}`),
        ]);

        log('info', 'machine.deleted', ctx, { machineId });
        return response(ctx, { ok: true, machineId, requestId: ctx.requestId }, 200);
      }

      return response(ctx, { ok: false, error: 'not found', requestId: ctx.requestId }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'request.failed', ctx, { error: message });
      return response(ctx, { ok: false, error: 'internal error', requestId: ctx.requestId }, 500);
    }
  }
};
