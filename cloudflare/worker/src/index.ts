export interface Env {
  PI_SETUP_SECRETS: KVNamespace;
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

const encoder = new TextEncoder();

function json(data: unknown, status = 200, origin = '*') {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS'
    }
  });
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
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(encodedPayload))) as SignedTokenPayload;
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

async function authorizeSecretRead(request: Request, env: Env, secretName: string) {
  const auth = request.headers.get('authorization');
  if (isAdminAuth(auth, env)) return { ok: true as const, machineId: null };

  const token = bearerToken(auth);
  if (!token) return { ok: false as const, response: json({ ok: false, error: 'unauthorized' }, 401, env.PI_SETUP_ALLOWED_ORIGIN || '*') };

  const payload = await verifyToken(token, env.PI_SETUP_ENROLLMENT_SIGNING_KEY);
  if (!payload || payload.typ !== 'bootstrap') {
    return { ok: false as const, response: json({ ok: false, error: 'unauthorized' }, 401, env.PI_SETUP_ALLOWED_ORIGIN || '*') };
  }
  if (payload.exp < nowSeconds()) {
    return { ok: false as const, response: json({ ok: false, error: 'bootstrap token expired' }, 401, env.PI_SETUP_ALLOWED_ORIGIN || '*') };
  }
  if (payload.secretName !== secretName) {
    return { ok: false as const, response: json({ ok: false, error: 'secret not allowed for token' }, 403, env.PI_SETUP_ALLOWED_ORIGIN || '*') };
  }
  return { ok: true as const, machineId: payload.machineId };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.PI_SETUP_ALLOWED_ORIGIN || '*';
    if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin);

    const url = new URL(request.url);
    const auth = request.headers.get('authorization');

    if (request.method === 'POST' && url.pathname === '/v1/enrollment-tokens/issue') {
      if (!isAdminAuth(auth, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401, origin);
      }
      const body = await readBody<EnrollmentRequest>(request);
      if (!body.machineId || !body.secretName) {
        return json({ ok: false, error: 'machineId and secretName are required' }, 400, origin);
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
      return json({ ok: true, token: await signToken(payload, env.PI_SETUP_ENROLLMENT_SIGNING_KEY), expiresAt: record.expiresAt, machineId: body.machineId, secretName: body.secretName }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/v1/machines/enroll') {
      const token = bearerToken(auth);
      if (!token) return json({ ok: false, error: 'unauthorized' }, 401, origin);
      const payload = await verifyToken(token, env.PI_SETUP_ENROLLMENT_SIGNING_KEY);
      if (!payload || payload.typ !== 'enrollment') {
        return json({ ok: false, error: 'invalid enrollment token' }, 401, origin);
      }
      if (payload.exp < nowSeconds()) {
        return json({ ok: false, error: 'enrollment token expired' }, 401, origin);
      }
      const recordKey = `enrollment:${payload.jti}`;
      const stored = await env.PI_SETUP_SECRETS.get(recordKey, 'json') as EnrollmentRecord | null;
      if (!stored) return json({ ok: false, error: 'enrollment token not found or expired' }, 404, origin);
      if (stored.enrolledAt) return json({ ok: false, error: 'enrollment token already used' }, 409, origin);

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
      return json({ ok: true, machineId: payload.machineId, secretName: payload.secretName, bootstrapToken: await signToken(bootstrapPayload, env.PI_SETUP_ENROLLMENT_SIGNING_KEY), bootstrapExpiresAt: isoFromSeconds(bootstrapExp) }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/v1/secrets/upsert') {
      if (!isAdminAuth(auth, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401, origin);
      }
      const body = await readBody<SecretRecord>(request);
      if (!body.name || !body.ciphertext || !body.iv || !body.tag) {
        return json({ ok: false, error: 'name, ciphertext, iv, and tag are required' }, 400, origin);
      }
      const record: SecretRecord = {
        ...body,
        algorithm: body.algorithm || 'AES-GCM',
        version: body.version || '1',
        updatedAt: new Date().toISOString(),
      };
      await env.PI_SETUP_SECRETS.put(`secret:${record.name}`, JSON.stringify(record));
      return json({ ok: true, stored: record.name, updatedAt: record.updatedAt }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/v1/secrets/')) {
      const name = decodeURIComponent(url.pathname.replace('/v1/secrets/', ''));
      const authz = await authorizeSecretRead(request, env, name);
      if (!authz.ok) return authz.response;
      const data = await env.PI_SETUP_SECRETS.get(`secret:${name}`);
      if (!data) return json({ ok: false, error: 'not found' }, 404, origin);
      return json({ ok: true, machineId: authz.machineId, secret: JSON.parse(data) }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/v1/secrets') {
      if (!isAdminAuth(auth, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401, origin);
      }
      const list = await env.PI_SETUP_SECRETS.list({ prefix: 'secret:' });
      return json({ ok: true, keys: list.keys.map((key) => key.name.replace(/^secret:/, '')) }, 200, origin);
    }

    return json({ ok: false, error: 'not found' }, 404, origin);
  }
};
