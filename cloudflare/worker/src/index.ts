export interface Env {
  PI_SETUP_SECRETS: KVNamespace;
  PI_SETUP_BOOTSTRAP_TOKEN: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.PI_SETUP_ALLOWED_ORIGIN || '*';
    if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin);

    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${env.PI_SETUP_BOOTSTRAP_TOKEN}`) {
      return json({ ok: false, error: 'unauthorized' }, 401, origin);
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/secrets/upsert') {
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
      const data = await env.PI_SETUP_SECRETS.get(`secret:${name}`);
      if (!data) return json({ ok: false, error: 'not found' }, 404, origin);
      return json({ ok: true, secret: JSON.parse(data) }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/v1/secrets') {
      const list = await env.PI_SETUP_SECRETS.list({ prefix: 'secret:' });
      return json({ ok: true, keys: list.keys.map((key) => key.name.replace(/^secret:/, '')) }, 200, origin);
    }

    return json({ ok: false, error: 'not found' }, 404, origin);
  }
};
