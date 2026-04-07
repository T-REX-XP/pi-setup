/**
 * Load PI_SETUP_* variables from a dotenv-style file (default: .env.runtime).
 * Only keys matching /^PI_SETUP_[A-Z0-9_]+$/ are applied — other lines stay for app use only.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PI_SETUP_KEY = /^PI_SETUP_[A-Z0-9_]+$/;
export const RUNTIME_ENV_MARKER = '# --- pi-setup machine enrollment (fleet daemon; do not commit) ---';

/** @param {string} text */
export function parseDotenv(text) {
  const out = {};
  for (let line of text.split(/\r?\n/)) {
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;
    let rest = line;
    if (line.startsWith('export ')) rest = line.slice(7).trim();
    const eq = rest.indexOf('=');
    if (eq < 1) continue;
    const key = rest.slice(0, eq).trim();
    let val = rest.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
    }
    out[key] = val;
  }
  return out;
}

/**
 * @param {{ cwd?: string, root?: string | null, explicit?: string | undefined }} o
 * @returns {string} Path to use (may not exist yet)
 */
export function resolvePiEnvFilePath({
  cwd = process.cwd(),
  root = null,
  explicit = process.env.PI_SETUP_ENV_FILE,
} = {}) {
  if (explicit) return path.resolve(cwd, explicit);
  const a = path.join(cwd, '.env.runtime');
  if (existsSync(a)) return a;
  if (root) {
    const b = path.join(root, '.env.runtime');
    if (existsSync(b)) return b;
  }
  return a;
}

/**
 * @param {string} filePath
 * @param {{ override?: boolean }} [opts]
 */
export async function loadPiEnvFile(filePath, { override = false } = {}) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return { path: filePath, loaded: false, keys: [] };
  }
  const parsed = parseDotenv(text);
  const keys = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (!PI_SETUP_KEY.test(k)) continue;
    if (!override && process.env[k]) continue;
    process.env[k] = v;
    keys.push(k);
  }
  return { path: filePath, loaded: true, keys };
}

/**
 * @param {string | null | undefined} repoRoot
 */
export async function loadPiEnvFileAtStart(repoRoot) {
  const p = resolvePiEnvFilePath({ cwd: process.cwd(), root: repoRoot });
  return loadPiEnvFile(p, { override: false });
}

/**
 * Same as loadPiEnvFile but synchronous (for fleet-daemon and early bootstrap).
 * @param {string} filePath
 * @param {{ override?: boolean }} [opts]
 */
export function loadPiEnvFileSync(filePath, { override = false } = {}) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return { path: filePath, loaded: false, keys: [] };
  }
  const parsed = parseDotenv(text);
  const keys = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (!PI_SETUP_KEY.test(k)) continue;
    if (!override && process.env[k]) continue;
    process.env[k] = v;
    keys.push(k);
  }
  return { path: filePath, loaded: true, keys };
}

/** @param {string} val */
function dotenvEscape(val) {
  if (/[\n\r#]/.test(val) || /^\s|\s$/.test(val)) {
    return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }
  if (/['\s]/.test(val)) return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return val;
}

/** Strip a previous enrollment footer from decrypted secret text. */
export function stripEnrollmentFooter(secretPlaintext) {
  const idx = secretPlaintext.indexOf('\n# --- pi-setup machine enrollment');
  if (idx >= 0) return secretPlaintext.slice(0, idx).trimEnd();
  return secretPlaintext.trimEnd();
}

/**
 * Write decrypted secret plus fleet vars (no enrollment JWT / master key).
 * @param {string} outFile
 * @param {{ secretPlaintext: string, workerUrl: string, bootstrapToken: string, machineId: string }} p
 */
export async function writeEnrolledRuntimeFile(outFile, { secretPlaintext, workerUrl, bootstrapToken, machineId }) {
  const body = stripEnrollmentFooter(secretPlaintext);
  const footer =
    `\n\n${RUNTIME_ENV_MARKER}\n` +
    `PI_SETUP_WORKER_URL=${dotenvEscape(workerUrl)}\n` +
    `PI_SETUP_BOOTSTRAP_TOKEN=${dotenvEscape(bootstrapToken)}\n` +
    `PI_SETUP_MACHINE_ID=${dotenvEscape(machineId)}\n`;
  await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
  await writeFile(outFile, `${body}${footer}`, 'utf8');
}
