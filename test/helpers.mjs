import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Every synthetic turn reads 100k cached tokens and writes 200: $0.02202 on Sonnet 5.5. */
export const TURN_USD = (100_000 * 0.2 + 200 * 10 + 10 * 2) / 1e6;

/**
 * Writes Claude Code-style transcripts for one project. Each session is a list of steps:
 *   { prompt: "..." }                     a human message
 *   { bash: "cmd", ok: true|false }       a Bash call and its result
 *   { read: "path" } / { edit: "path" }   file tools
 */
export function makeProject(sessions) {
  const base = mkdtempSync(path.join(os.tmpdir(), "rote-test-"));
  const root = path.join(base, "shop");
  const transcripts = path.join(base, "projects");
  const projectDir = path.join(transcripts, root.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(root, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  let clock = Date.parse("2026-10-01T10:00:00Z");
  sessions.forEach((steps, si) => {
    const sessionId = `00000000-0000-0000-0000-00000000000${si}`;
    const lines = [];
    let n = 0;
    for (const step of steps) {
      clock += 30_000;
      const timestamp = new Date(clock).toISOString();
      if (step.prompt) {
        lines.push({ type: "user", message: { role: "user", content: step.prompt }, cwd: root, sessionId, timestamp });
        continue;
      }
      const id = `toolu_${si}_${n}`;
      const msgId = `msg_${si}_${n++}`;
      const [name, input] = step.bash
        ? ["Bash", { command: step.bash }]
        : step.read
          ? ["Read", { file_path: path.join(root, step.read) }]
          : ["Edit", { file_path: path.join(root, step.edit), old_string: "a", new_string: "b" }];
      lines.push({
        type: "assistant",
        cwd: root,
        sessionId,
        timestamp,
        message: {
          id: msgId,
          model: "claude-sonnet-5-5",
          role: "assistant",
          content: [{ type: "tool_use", id, name, input }],
          usage: { input_tokens: 10, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0, output_tokens: 200 },
        },
      });
      const ok = step.ok !== false;
      lines.push({
        type: "user",
        cwd: root,
        sessionId,
        timestamp,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: !ok, content: ok ? "done" : "Exit code 1" }] },
        toolUseResult: { stdout: "", stderr: "", interrupted: false },
      });
    }
    writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  });
  return { root, transcripts };
}
