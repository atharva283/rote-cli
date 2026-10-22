import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CallStatus,
  ISkillEmitter,
  ITranscriptAdapter,
  ProjectRef,
  Session,
  SkillFile,
  SkillSpec,
  ToolCall,
  Turn,
  Usage,
} from "../types.js";
import { foldWorktree, normPath } from "../util/paths.js";
import { mapLimit } from "../util/pool.js";

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

export class ClaudeCodeAdapter implements ITranscriptAdapter {
  readonly id = "claude-code";
  readonly displayName = "Claude Code";
  readonly skills = claudeSkillEmitter;
  readonly projectsDir: string;

  constructor(projectsDir = path.join(claudeHome(), "projects")) {
    this.projectsDir = projectsDir;
  }

  async detect(): Promise<boolean> {
    try {
      return (await fs.stat(this.projectsDir)).isDirectory();
    } catch {
      return false;
    }
  }

  async listProjects(): Promise<ProjectRef[]> {
    const entries = await fs.readdir(this.projectsDir, { withFileTypes: true });
    const projects = await Promise.all(
      entries.filter((e) => e.isDirectory()).map((e) => this.readProject(e.name)),
    );
    return projects.filter((p): p is ProjectRef => p !== null);
  }

  async loadSessions(project: ProjectRef): Promise<Session[]> {
    return mapLimit(project.files, 16, async (file) => parseClaudeTranscript(await fs.readFile(file, "utf8"), file));
  }

  private async readProject(key: string): Promise<ProjectRef | null> {
    const dir = path.join(this.projectsDir, key);
    const files = await listSessionFiles(dir);
    if (!files.length) return null;
    const mains = files.filter((f) => !isSubagentFile(f));
    const cwds = (await Promise.all((mains.length ? mains : files).slice(0, 8).map(firstCwd))).filter(
      (c): c is string => Boolean(c),
    );
    // Sessions may start in a worktree or subfolder; the shortest path is the checkout itself.
    const root = cwds.map(foldWorktree).sort((a, b) => a.length - b.length)[0] ?? key;
    return { agent: this.id, key, root, name: path.posix.basename(root) || root, files };
  }
}

/** `<project>/<session>.jsonl` plus subagent transcripts in `<project>/<session>/subagents/*.jsonl`. */
async function listSessionFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".jsonl")) {
      files.push(path.join(dir, e.name));
    } else if (e.isDirectory()) {
      const sub = path.join(dir, e.name, "subagents");
      try {
        for (const f of await fs.readdir(sub)) if (f.endsWith(".jsonl")) files.push(path.join(sub, f));
      } catch {
        // no subagents for this session
      }
    }
  }
  return files;
}

function isSubagentFile(file: string): boolean {
  return /[/\\]subagents[/\\]/.test(file);
}

/** Reads just enough of a transcript to find the directory the session ran in. */
async function firstCwd(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString("utf8", 0, bytesRead));
    return m ? normPath(JSON.parse(`"${m[1]}"`) as string) : null;
  } finally {
    await handle.close();
  }
}

const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

/**
 * Parses a Claude Code session transcript. Claude Code writes one JSON record
 * per line; a single API response is often split across several `assistant`
 * records that share `message.id`, so turns are keyed by that id.
 */
export function parseClaudeTranscript(text: string, file: string): Session {
  const turns: Turn[] = [];
  const byId = new Map<string, Turn>();
  const calls = new Map<string, ToolCall>();
  let afterPrompt = true;
  let reportedCostUSD: number | undefined;

  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf("\n", pos);
    if (end === -1) end = text.length;
    const line = text.slice(pos, end);
    pos = end + 1;
    // Cheap pre-filter: most lines (attachments, snapshots, metadata) are irrelevant.
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes('"type":"cost-state"')) {
      continue;
    }
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec.type === "assistant") {
      const msg = rec.message;
      if (!msg?.id || msg.model === "<synthetic>") continue;
      let turn = byId.get(msg.id);
      if (!turn) {
        turn = {
          id: msg.id,
          model: String(msg.model ?? ""),
          timestamp: Date.parse(rec.timestamp) || 0,
          usage: ZERO_USAGE,
          calls: [],
          afterPrompt,
        };
        afterPrompt = false;
        byId.set(msg.id, turn);
        turns.push(turn);
      }
      if (msg.usage) turn.usage = readUsage(msg.usage);
      const cwd = normPath(String(rec.cwd ?? ""));
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block?.type !== "tool_use") continue;
        const call = toToolCall(block, cwd);
        turn.calls.push(call);
        calls.set(call.id, call);
      }
    } else if (rec.type === "user") {
      const content = rec.message?.content;
      if (rec.isMeta || rec.isCompactSummary) continue;
      if (typeof content === "string") {
        afterPrompt = true;
        continue;
      }
      if (!Array.isArray(content)) continue;
      let sawResult = false;
      for (const block of content) {
        if (block?.type !== "tool_result") continue;
        sawResult = true;
        const call = calls.get(block.tool_use_id);
        if (call) call.status = resultStatus(block, content.length === 1 ? rec.toolUseResult : undefined);
      }
      if (!sawResult) afterPrompt = true;
    } else if (rec.type === "cost-state" && typeof rec.totalCostUSD === "number") {
      reportedCostUSD = rec.totalCostUSD;
    }
  }

  return {
    id: path.basename(file, ".jsonl"),
    file,
    isSubagent: isSubagentFile(file),
    turns,
    reportedCostUSD,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function readUsage(u: any): Usage {
  const write1h = num(u.cache_creation?.ephemeral_1h_input_tokens);
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite5m: Math.max(0, num(u.cache_creation_input_tokens) - write1h),
    cacheWrite1h: write1h,
  };
}

function resultStatus(block: any, extra: any): CallStatus {
  if (block.is_error) {
    const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
    // A permission denial says nothing about whether the command was right.
    return /doesn't want to proceed|was rejected|permission to use|denied/i.test(text.slice(0, 400)) ? "unknown" : "error";
  }
  if (extra && typeof extra === "object") {
    if (extra.interrupted) return "error";
    if (extra.timedOutAfterMs) return "unknown";
  }
  return "ok";
}

const NEUTRAL_TOOLS = new Set(["TodoWrite", "TodoRead", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList"]);

function toToolCall(block: any, cwd: string): ToolCall {
  const name = String(block.name ?? "");
  const input = block.input ?? {};
  const base = { id: String(block.id), name, cwd, status: "unknown" as CallStatus };
  switch (name) {
    case "Bash":
      return { ...base, kind: "shell", shell: "bash", command: String(input.command ?? "") };
    case "PowerShell":
      return { ...base, kind: "shell", shell: "powershell", command: String(input.command ?? "") };
    case "Read":
    case "NotebookRead":
      return { ...base, kind: "read", target: String(input.file_path ?? input.notebook_path ?? "") };
    case "Glob":
      return { ...base, kind: "search", target: String(input.pattern ?? "") };
    case "Grep":
      return { ...base, kind: "search", target: String(input.glob ?? input.path ?? "") };
    case "LS":
      return { ...base, kind: "explore", target: String(input.path ?? "") };
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return { ...base, kind: "edit", target: String(input.file_path ?? input.notebook_path ?? "") };
    default:
      return { ...base, kind: NEUTRAL_TOOLS.has(name) ? "neutral" : "other" };
  }
}

/** Writes learned commands as Claude Code skills: `.claude/skills/<slug>/SKILL.md` plus a runner script. */
export const claudeSkillEmitter: ISkillEmitter = {
  dir: ".claude/skills",
  render(spec: SkillSpec): SkillFile[] {
    const dir = `.claude/skills/${spec.slug}`;
    const ps = spec.shell === "powershell";
    const script = ps ? "run.ps1" : "run.sh";
    const invoke = ps ? `powershell -NoProfile -File ${dir}/${script}` : `bash ${dir}/${script}`;
    const where = spec.workdir ? `\`${spec.workdir}/\`` : "the project root";
    const learnedOn = spec.lastSeen > 0 ? new Date(spec.lastSeen).toISOString().slice(0, 10) : "unknown";
    const dev = spec.intent === "dev";

    const skill = `---
name: ${spec.slug}
description: ${spec.description.replace(/\n/g, " ")}
---

# ${spec.title}

This is the command that worked in ${spec.sessions} past sessions (${spec.runs} successful runs, last on ${learnedOn}). Run it directly. You don't need to explore the project first.

\`\`\`${ps ? "powershell" : "bash"}
${invoke}            # run as-is
${invoke} <args>     # extra arguments are passed through
\`\`\`
${dev ? "\nThis starts a long-running process, so run it in the background.\n" : ""}
It runs this command from ${where}:

\`\`\`${ps ? "powershell" : "bash"}
${spec.recipe}
\`\`\`

If it fails because the project setup changed, fix the setup and re-learn the skill with \`npx rote-cli learn ${spec.slug} --force\`.

<!-- Generated by rote (https://github.com/atharva283/rote-cli). Edit freely. -->
`;

    const header = `Learned by rote from ${spec.sessions} sessions. Re-learn: npx rote-cli learn ${spec.slug} --force`;
    const runner = ps
      ? `# ${header}
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\\..\\..${spec.workdir ? "\\" + spec.workdir.replace(/\//g, "\\") : ""}')
${spec.recipe} @args
`
      : `#!/usr/bin/env bash
# ${header}
set -euo pipefail
cd "$(dirname "\${BASH_SOURCE[0]}")/../../..${spec.workdir ? "/" + spec.workdir : ""}"
${spec.recipe} "$@"
`;

    return [
      { path: `${dir}/SKILL.md`, content: skill },
      { path: `${dir}/${script}`, content: runner, executable: true },
    ];
  },
};
