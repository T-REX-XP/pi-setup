/**
 * session-bridge — REQ-EXT-002
 *
 * Captures session events and enriches the pi-native JSONL session file with
 * entries the fleet daemon specifically consumes:
 *
 *   { type: "usage",       inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd }
 *   { type: "session_end", timestamp }
 *
 * Pi already writes { type: "message" }, { type: "model_change" }, etc.
 * The daemon (scripts/fleet-daemon.mjs → pushSessions) reads all of the above
 * from ~/.pi/agent/sessions/<encoded-cwd>/<date>_<uuid>.jsonl.
 *
 * The bridge also writes a lightweight active-session summary to
 * .pi/runtime/session-bridge-active.json so fleetctl / dashboard can see
 * the live session without waiting for the next daemon heartbeat scan.
 *
 * Zero npm dependencies — only node:fs/promises, node:path, node:os.
 */

import { appendFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Resolve repo root: extension lives at <repo>/.pi/extensions/session-bridge.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const RUNTIME_DIR = join(REPO_ROOT, ".pi", "runtime");
const ACTIVE_SUMMARY_FILE = join(RUNTIME_DIR, "session-bridge-active.json");

// ── Write queue: prevent concurrent appends from interleaving lines ──────────
let _writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(filePath: string, line: string): void {
  _writeQueue = _writeQueue.then(async () => {
    try {
      await appendFile(filePath, line + "\n", "utf8");
    } catch {
      // Session file may not exist yet or may have moved — non-fatal
    }
  });
}

export default function (pi: ExtensionAPI) {
  let sessionFile: string | null = null;
  let sessionId: string | null = null;
  let model: string | null = null;
  let provider: string | null = null;
  let startedAt: string = new Date().toISOString();

  // Cumulative usage across all agent_end events this session
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let promptCount = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function ensureRuntimeDir() {
    try {
      await mkdir(RUNTIME_DIR, { recursive: true });
    } catch { /* already exists */ }
  }

  async function writeSummary(status: "active" | "ended") {
    try {
      await ensureRuntimeDir();
      const summary = {
        sessionId,
        sessionFile,
        model,
        provider,
        startedAt,
        updatedAt: new Date().toISOString(),
        status,
        promptCount,
        totalInput,
        totalOutput,
        totalCacheRead,
        totalCacheWrite,
        totalCost,
        cwd: process.cwd(),
        tmuxSession: process.env.PI_TMUX_SESSION ?? null,
        machineId: process.env.PI_SETUP_MACHINE_ID ?? homedir().split("/").pop() ?? null,
      };
      await writeFile(ACTIVE_SUMMARY_FILE, JSON.stringify(summary, null, 2) + "\n", "utf8");
    } catch { /* non-fatal */ }
  }

  // ── session_start ────────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    startedAt = new Date().toISOString();
    totalInput = 0;
    totalOutput = 0;
    totalCacheRead = 0;
    totalCacheWrite = 0;
    totalCost = 0;
    promptCount = 0;

    // Resolve session file path and session ID
    const sf = ctx.sessionManager.getSessionFile();
    if (sf) {
      sessionFile = sf;
      // Filename: <ISO>_<UUID>.jsonl  →  sessionId = everything after first underscore
      const base = sf.split("/").at(-1)?.replace(/\.jsonl$/, "") ?? "";
      sessionId = base.includes("_") ? base.slice(base.indexOf("_") + 1) : base;
    } else {
      sessionFile = null;
      sessionId = crypto.randomUUID();
    }

    await writeSummary("active");
  });

  // ── message_end: extract usage from assistant messages ─────────────────────
  pi.on("message_end", async (event, _ctx) => {
    const msg = (event as { message?: { role?: string; usage?: unknown; api?: string; provider?: string; model?: string } }).message;
    if (!msg || msg.role !== "assistant") return;

    // Track model/provider for the summary
    if (msg.provider) provider = msg.provider;
    if (msg.model)    model    = msg.model;
    if (msg.api)      provider = provider ?? msg.api;

    // Extract usage (pi embeds it in assistant message: message.usage.input/output/...)
    type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number; input?: number } };
    const usage = msg.usage as Usage | undefined;
    if (!usage) return;

    const inp       = usage.input     ?? 0;
    const out       = usage.output    ?? 0;
    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite= usage.cacheWrite?? 0;
    const costTotal = usage.cost?.total ?? usage.cost?.input ?? 0;

    if (inp === 0 && out === 0) return; // nothing to record

    // Append a usage event so the daemon's pushSessions() can aggregate it
    if (sessionFile) {
      const usageEntry = JSON.stringify({
        type: "usage",
        timestamp: new Date().toISOString(),
        inputTokens: inp,
        outputTokens: out,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: costTotal,
        model,
        provider,
      });
      enqueueWrite(sessionFile, usageEntry);
    }

    // Accumulate session totals
    totalInput     += inp;
    totalOutput    += out;
    totalCacheRead += cacheRead;
    totalCacheWrite+= cacheWrite;
    totalCost      += costTotal;
  });

  // ── agent_end: count prompts, refresh summary ──────────────────────────────
  pi.on("agent_end", async (_event, _ctx) => {
    promptCount++;
    await writeSummary("active");
  });

  // ── session_shutdown: write session_end marker ────────────────────────────
  pi.on("session_shutdown", async (_event, _ctx) => {
    if (sessionFile) {
      const endEntry = JSON.stringify({
        type: "session_end",
        timestamp: new Date().toISOString(),
        sessionId,
        promptCount,
        totalInput,
        totalOutput,
        totalCacheRead,
        totalCacheWrite,
        totalCost,
      });
      enqueueWrite(sessionFile, endEntry);
      // Flush: wait for the queue to drain before process exits
      await _writeQueue;
    }

    await writeSummary("ended");
  });
}
