import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  truncateTail,
  formatSize,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";

const extension: ExtensionFactory = (pi) => {
  const maxLines = parseInt(process.env.PI_COMPRESSOR_MAX_LINES ?? "", 10) || DEFAULT_MAX_LINES;
  const maxBytes = parseInt(process.env.PI_COMPRESSOR_MAX_BYTES ?? "", 10) || DEFAULT_MAX_BYTES;

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify(
      `context-compressor active (max ${maxLines} lines / ${formatSize(maxBytes)})`,
      "info",
    );
  });

  pi.on("tool_result", (event, _ctx) => {
    // Never touch error results — they're usually short diagnostics
    if (event.isError) return;

    // Collect all text content and measure total size
    const textParts = event.content.filter(
      (c): c is { type: "text"; text: string } => c.type === "text",
    );
    if (textParts.length === 0) return;

    const combined = textParts.map((p) => p.text).join("\n");
    const totalLines = combined.split("\n").length;
    const totalBytes = Buffer.byteLength(combined, "utf-8");

    // Skip if already under thresholds
    if (totalLines <= maxLines && totalBytes <= maxBytes) return;

    // Pick truncation strategy based on tool name:
    //  - bash: keep the tail (errors/results are at the end)
    //  - read: keep the head (file content starts at the top)
    //  - everything else: keep the head
    const truncate = event.toolName === "bash" ? truncateTail : truncateHead;
    const result = truncate(combined, { maxLines, maxBytes });

    if (!result.truncated) return;

    // Build a human-readable notice
    const notice =
      `\n[Truncated: showing ${result.outputLines} of ${result.totalLines} lines ` +
      `(${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}). ` +
      `Use offset/limit params or read the file directly to see more.]`;

    return {
      content: [{ type: "text" as const, text: result.content + notice }],
    };
  });
};

export default extension;
