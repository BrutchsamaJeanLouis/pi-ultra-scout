// ── Disk Logger ────────────────────────────────────────────────────
// Append-only log for the ultrawork extension. Writes to a file on disk
// so behaviour can be inspected after the fact (pi extension console output
// is not reliably visible).
//
// Log location: ~/.pi/agent/extensions/ultrawork.log
// Override with env var: ULW_LOG_FILE=/path/to/file.log

import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export const ULW_LOG_FILE: string =
  process.env.ULW_LOG_FILE ??
  join(homedir(), ".pi", "agent", "extensions", "ultrawork.log");

let dirReady = false;

/**
 * Append a single line to the ultrawork log.
 * Never throws — logging must not crash the extension.
 */
export function ulwLog(tag: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] [${tag}] ${message}\n`;
    if (!dirReady) {
      mkdirSync(dirname(ULW_LOG_FILE), { recursive: true });
      dirReady = true;
    }
    appendFileSync(ULW_LOG_FILE, line, "utf-8");
  } catch {
    // ignore — logging is best-effort
  }
}

/**
 * Log a session boundary marker so multiple sessions in one file are separable.
 */
export function ulwLogSessionStart(sessionId?: string): void {
  ulwLog(
    "SESSION",
    `════════════════════════════════════════════════════════════\n` +
      `  ULTRAWORK SESSION ${sessionId ? `(id=${sessionId})` : ""}\n` +
      `  log file: ${ULW_LOG_FILE}\n` +
      `════════════════════════════════════════════════════════════`
  );
}
