import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';

// ---------------------------------------------------------------------------
// REQ-EXT-003  –  Notification Ping
//
// Fires cross-platform alerts when the agent finishes and awaits user input:
//   • OS-native notification (macOS osascript, terminal OSC sequences)
//   • Custom sound packs via afplay / paplay / aplay
//   • Terminal tab-title update
// ---------------------------------------------------------------------------

const THROTTLE_MS = 3_000;
let lastPingAt = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function env(key: string): string {
  return process.env[key] ?? '';
}

function isDisabled(): boolean {
  return env('PI_NOTIFY') === '0';
}

function isSoundDisabled(): boolean {
  return env('PI_NOTIFY_SOUND') === '0';
}

/** Truncate to at most `n` characters, adding "…" when trimmed. */
function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1) + '…';
}

/** Fire-and-forget exec – ignores errors so a missing binary never crashes. */
function spawn(cmd: string, args: string[]): void {
  try {
    const child = execFile(cmd, args, { timeout: 10_000 }, () => {});
    child.unref();
  } catch {
    // binary not found or spawn failure – skip silently
  }
}

// ── Sound ──────────────────────────────────────────────────────────────────

const SOUND_EXTENSIONS = ['.wav', '.mp3', '.ogg'];

function findSoundFile(): string | null {
  const soundsDir = join(process.cwd(), '.pi', 'sounds');
  for (const ext of SOUND_EXTENSIONS) {
    const candidate = join(soundsDir, `ping${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function playSound(): void {
  if (isSoundDisabled()) return;

  const file = findSoundFile();
  if (!file) return;

  const os = platform();
  if (os === 'darwin') {
    spawn('afplay', [file]);
  } else if (os === 'linux') {
    // paplay (PulseAudio) is the most common; fall back to aplay (ALSA)
    if (file.endsWith('.wav')) {
      spawn('paplay', [file]);
    } else {
      // paplay handles wav/ogg/flac; aplay only handles wav
      spawn('paplay', [file]);
    }
  }
  // Windows: skip sound (no reliable cross-env CLI player)
}

// ── OS Notification ────────────────────────────────────────────────────────

function notifyMacOS(title: string, body: string): void {
  const termProgram = env('TERM_PROGRAM'); // e.g. "WezTerm", "iTerm.app", "vscode"
  const activateClause = termProgram
    ? ` activate application "${termProgram}"`
    : '';

  // osascript -e 'display notification "body" with title "title"'
  const script =
    `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}` +
    '\n' +
    `-- click-to-focus hint for the terminal` +
    (activateClause ? `\ntell application "System Events" to${activateClause}` : '');

  spawn('osascript', ['-e', script]);
}

function notifyTerminalOSC(title: string, body: string): void {
  const termProgram = env('TERM_PROGRAM').toLowerCase();

  if (termProgram === 'kitty') {
    // OSC 99 for Kitty
    process.stdout.write(`\x1b]99;i=1:d=0;${title}: ${body}\x1b\\`);
  } else {
    // OSC 777 for WezTerm, iTerm2, Ghostty, rxvt-unicode
    process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
  }
}

function sendNotification(body: string): void {
  const title = 'pi';
  const os = platform();

  if (os === 'darwin') {
    notifyMacOS(title, body);
  }

  // Terminal OSC notifications work on all platforms when the terminal
  // supports them – fire unconditionally as a lightweight fallback/extra.
  notifyTerminalOSC(title, body);
}

// ── Terminal Tab Title ─────────────────────────────────────────────────────

function setTabTitle(text: string): void {
  // OSC 0 – set window/tab title (xterm-compatible, supported everywhere)
  process.stdout.write(`\x1b]0;${text}\x07`);
}

// ── Extension Entry Point ──────────────────────────────────────────────────

export default function register(pi: {
  on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) => void;
}) {
  pi.on('agent_end', async (event: unknown) => {
    // ── Opt-out check ──────────────────────────────────────────────────
    if (isDisabled()) return;

    // ── Throttle ───────────────────────────────────────────────────────
    const now = Date.now();
    if (now - lastPingAt < THROTTLE_MS) return;
    lastPingAt = now;

    // ── Extract body text from event (best-effort) ─────────────────────
    let body = 'Ready for input';
    try {
      const ev = event as Record<string, unknown>;
      if (typeof ev.message === 'string' && ev.message.length > 0) {
        body = truncate(ev.message, 80);
      } else if (
        typeof ev.lastAssistantMessage === 'string' &&
        ev.lastAssistantMessage.length > 0
      ) {
        body = truncate(ev.lastAssistantMessage, 80);
      }
    } catch {
      // keep default body
    }

    // ── Fire in parallel (all are non-blocking) ────────────────────────
    setTabTitle('pi: ready');
    sendNotification(body);
    playSound();
  });
}
