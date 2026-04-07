import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the repo root from this extension's location (../../.. from .pi/extensions/) */
function repoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function envRuntimePath(): string {
  return path.join(repoRoot(), ".env.runtime");
}

function requiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function secretName(): string {
  return (
    process.env.PI_SETUP_SECRET_NAME ??
    `pi-secrets-${process.env.PI_SETUP_MACHINE_ID ?? hostname()}`
  );
}

/**
 * Encrypt plaintext with AES-256-GCM, identical to scripts/secrets-encrypt-upload.mjs.
 */
function encrypt(plaintext: string, passphrase: string) {
  const key = createHash("sha256").update(passphrase).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    algorithm: "AES-256-GCM" as const,
    version: "1" as const,
  };
}

/**
 * Read .env.runtime, encrypt it, and POST to the worker's /v1/secrets/upsert.
 * Throws on any failure.
 */
async function syncCredentials(): Promise<string> {
  const workerUrl = requiredEnv("PI_SETUP_WORKER_URL").replace(/\/$/, "");
  const token = requiredEnv("PI_SETUP_BOOTSTRAP_TOKEN");
  const passphrase = requiredEnv("PI_SETUP_MASTER_KEY");
  const name = secretName();

  const plaintext = await readFile(envRuntimePath(), "utf8");
  const encrypted = encrypt(plaintext, passphrase);

  const res = await fetch(`${workerUrl}/v1/secrets/upsert`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, ...encrypted }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // -- File watcher state ---------------------------------------------------
  let watcherTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMtimeMs = 0;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const DEBOUNCE_MS = 3_000;

  function isAutoSyncEnabled(): boolean {
    return process.env.PI_AUTO_SYNC === "1";
  }

  /**
   * Debounced auto-sync triggered by file change detection.
   * Logs errors but never throws (non-blocking).
   */
  function scheduleAutoSync() {
    if (watcherTimer) clearTimeout(watcherTimer);
    watcherTimer = setTimeout(async () => {
      watcherTimer = null;
      try {
        const name = await syncCredentials();
        console.log(`[auto-sync] Credentials synced as "${name}" (file change)`);
      } catch (err: any) {
        console.error(`[auto-sync] Auto-sync failed: ${err.message}`);
      }
    }, DEBOUNCE_MS);
  }

  /**
   * Start polling .env.runtime for mtime changes.
   * Using stat-based polling rather than fs.watch for cross-platform reliability.
   */
  async function startWatcher() {
    try {
      const s = await stat(envRuntimePath());
      lastMtimeMs = s.mtimeMs;
    } catch {
      // File may not exist yet — that's fine, we'll pick it up later.
    }

    pollInterval = setInterval(async () => {
      try {
        const s = await stat(envRuntimePath());
        if (s.mtimeMs !== lastMtimeMs) {
          lastMtimeMs = s.mtimeMs;
          scheduleAutoSync();
        }
      } catch {
        // File removed or inaccessible — ignore.
      }
    }, 2_000);
  }

  function stopWatcher() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (watcherTimer) {
      clearTimeout(watcherTimer);
      watcherTimer = null;
    }
  }

  // -- /login command -------------------------------------------------------

  pi.registerCommand("login", {
    description: "Encrypt and push credentials to KV for fleet sync",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Encrypting and uploading credentials…", "info");
      try {
        const name = await syncCredentials();
        ctx.ui.notify(
          `Credentials synced as "${name}" ✓`,
          "success",
        );
      } catch (err: any) {
        ctx.ui.notify(`Sync failed: ${err.message}`, "error");
      }
    },
  });

  // -- Lifecycle hooks ------------------------------------------------------

  pi.on("session_start", async () => {
    if (!isAutoSyncEnabled()) return;

    // Non-blocking initial sync
    syncCredentials()
      .then((name) =>
        console.log(`[auto-sync] Initial sync complete as "${name}"`),
      )
      .catch((err: any) =>
        console.error(`[auto-sync] Initial sync failed: ${err.message}`),
      );

    // Start watching .env.runtime for changes
    await startWatcher();
  });

  pi.on("session_shutdown", async () => {
    stopWatcher();
  });
}
