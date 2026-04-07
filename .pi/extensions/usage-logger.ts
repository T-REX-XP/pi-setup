/**
 * usage-logger extension (REQ-EXT-005)
 *
 * Logs every model API call to `.pi/runtime/usage.jsonl` for token/cost analytics.
 * On session shutdown, pushes aggregated totals to the fleet worker `/v1/usage`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Types ──────────────────────────────────────────────────────────────────────

interface UsageEntry {
  ts: string;
  sessionId: string | null;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  contextTokens: number;
  cwd: string;
}

interface MessageUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

interface AssistantMessage {
  role: string;
  usage?: MessageUsage;
  model?: string;
}

// ── State ──────────────────────────────────────────────────────────────────────

let sessionId: string | null = null;
let logFilePath: string | null = null;

// Running totals for the session-end push
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCostUsd = 0;
let lastModel: string | null = null;
let lastProvider: string | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractSessionId(sessionFile: string | undefined | null): string | null {
  if (!sessionFile) return null;
  const base = path.basename(sessionFile, path.extname(sessionFile));
  // Session files are typically named like `session_<id>` or just `<id>`
  const idx = base.lastIndexOf("_");
  return idx !== -1 ? base.slice(idx + 1) : base;
}

async function ensureLogFile(cwd: string): Promise<string> {
  if (logFilePath) return logFilePath;
  const dir = path.join(cwd, ".pi", "runtime");
  await fs.mkdir(dir, { recursive: true });
  logFilePath = path.join(dir, "usage.jsonl");
  return logFilePath;
}

async function appendEntry(entry: UsageEntry): Promise<void> {
  const filePath = await ensureLogFile(entry.cwd);
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(filePath, line, "utf-8");
}

function findAssistantUsage(messages: unknown[]): { usage: MessageUsage; model?: string } | null {
  // Walk backwards — the last assistant message with usage is the one we want
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as AssistantMessage;
    if (msg && msg.role === "assistant" && msg.usage) {
      return { usage: msg.usage, model: msg.model };
    }
  }
  return null;
}

async function pushToFleet(): Promise<void> {
  const workerUrl = process.env.PI_SETUP_WORKER_URL;
  const token = process.env.PI_SETUP_BOOTSTRAP_TOKEN;
  const machineId = process.env.PI_SETUP_MACHINE_ID;

  if (!workerUrl || !token || !machineId) return;
  if (totalInputTokens === 0 && totalOutputTokens === 0 && totalCostUsd === 0) return;

  const url = `${workerUrl.replace(/\/+$/, "")}/v1/usage`;
  const body = JSON.stringify({
    machineId,
    sessionId,
    model: lastModel,
    provider: lastProvider,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    costUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000, // 6 decimal places
  });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      console.error(`[usage-logger] Fleet push failed: ${resp.status} ${resp.statusText}`);
    }
  } catch (err) {
    console.error(`[usage-logger] Fleet push error: ${(err as Error).message}`);
  }
}

// ── Extension entry point ──────────────────────────────────────────────────────

export default function usageLogger(pi: ExtensionAPI) {
  // Capture session ID on startup
  pi.on("session_start", async (event, ctx) => {
    const sessionFile =
      typeof ctx.sessionManager?.getSessionFile === "function"
        ? ctx.sessionManager.getSessionFile()
        : undefined;
    sessionId = extractSessionId(sessionFile as string | undefined);

    // Reset accumulators
    totalInputTokens = 0;
    totalOutputTokens = 0;
    totalCostUsd = 0;
    lastModel = null;
    lastProvider = null;
    logFilePath = null;
  });

  // Log usage after each agent turn
  pi.on("agent_end", async (event, ctx) => {
    const messages: unknown[] = (event as any).messages;
    if (!messages || !Array.isArray(messages)) return;

    const found = findAssistantUsage(messages);
    if (!found) return;

    const { usage, model: msgModel } = found;
    const inputTokens = usage.input ?? 0;
    const outputTokens = usage.output ?? 0;
    const cacheReadTokens = usage.cacheRead ?? 0;
    const cacheWriteTokens = usage.cacheWrite ?? 0;
    const costUsd = usage.cost ?? 0;

    // Context-level info
    let contextTokens = 0;
    let model: string | null = msgModel ?? null;
    let provider: string | null = null;

    try {
      const ctxUsage = ctx.getContextUsage?.();
      if (ctxUsage) {
        contextTokens = ctxUsage.tokens ?? 0;
        if (!model) model = ctxUsage.model ?? null;
        provider = ctxUsage.provider ?? null;
      }
    } catch {
      // getContextUsage may not be available in all contexts
    }

    // Update accumulators
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCostUsd += costUsd;
    if (model) lastModel = model;
    if (provider) lastProvider = provider;

    const entry: UsageEntry = {
      ts: new Date().toISOString(),
      sessionId,
      model,
      provider,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      contextTokens,
      cwd: process.cwd(),
    };

    try {
      await appendEntry(entry);
    } catch (err) {
      console.error(`[usage-logger] Failed to write usage entry: ${(err as Error).message}`);
    }
  });

  // Push aggregated usage to fleet worker on shutdown
  pi.on("session_shutdown", async (_event, _ctx) => {
    await pushToFleet();
  });
}
