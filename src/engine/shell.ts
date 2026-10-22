import type { ShellKind } from "../types.js";

export interface Segment {
  text: string;
  /** True when the segment reads the previous segment's output (`a | b` makes `b` piped). */
  piped: boolean;
}

/**
 * Splits a command line into simple commands on `&&`, `||`, `;`, `|`, `&` and
 * newlines, respecting quotes. Good enough for the one-liners agents write;
 * heredocs come out as noise segments, which the engine treats as real work.
 */
export function splitCommand(cmd: string, shell: ShellKind = "bash"): Segment[] {
  const escape = shell === "bash" ? "\\" : "`";
  const out: Segment[] = [];
  let cur = "";
  let quote: string | null = null;
  let piped = false;
  const flush = (nextPiped: boolean) => {
    const text = cur.trim();
    if (text) out.push({ text, piped });
    cur = "";
    piped = nextPiped;
  };

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    const nx = cmd[i + 1] ?? "";
    if (quote) {
      cur += ch;
      if (ch === escape && quote === '"' && i + 1 < cmd.length) {
        cur += nx;
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === escape && i + 1 < cmd.length) {
      cur += nx === "\n" ? " " : ch + nx;
      i++;
      continue;
    }
    if ((ch === "&" && nx === "&") || (ch === "|" && nx === "|")) {
      flush(false);
      i++;
    } else if (ch === ";" || ch === "\n" || ch === "\r") {
      flush(false);
    } else if (ch === "|") {
      flush(true);
    } else if (ch === "&" && (/[0-9>]$/.test(cur) || nx === ">")) {
      cur += ch; // redirection such as 2>&1 or &>file
    } else if (ch === "&") {
      flush(false); // background job
    } else {
      cur += ch;
    }
  }
  flush(false);
  return out;
}

/** Splits a simple command into words, removing quotes. */
export function tokenize(segment: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let quoted = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
    } else if (/\s/.test(ch)) {
      if (cur || quoted) out.push(cur);
      cur = "";
      quoted = false;
    } else {
      cur += ch;
    }
  }
  if (cur || quoted) out.push(cur);
  return out;
}

const LAUNCHERS = new Set(["npx", "bunx", "time", "command", "exec", "env", "nohup", "call", "&"]);

/**
 * Strips env assignments and launchers (`timeout 60`, `npx`, `uv run`,
 * `python -m`, ...) so that `CI=1 npx vitest run` and `vitest run` look alike.
 */
export function coreTokens(tokens: readonly string[]): string[] {
  const t = tokens.slice();
  const dropFlags = () => {
    while (t[0]?.startsWith("-")) t.shift();
  };
  while (t.length) {
    const a = t[0]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) {
      t.shift();
    } else if (a === "timeout" || a === "gtimeout") {
      t.shift();
      dropFlags();
      if (/^\d/.test(t[0] ?? "")) t.shift();
    } else if (LAUNCHERS.has(a)) {
      t.shift();
      dropFlags();
    } else if (/^(npm|pnpm|yarn)$/.test(a) && /^(exec|dlx|x)$/.test(t[1] ?? "")) {
      t.splice(0, 2);
      dropFlags();
    } else if (/^(uv|poetry|pipenv|pdm|hatch|rye)$/.test(a) && t[1] === "run") {
      t.splice(0, 2);
    } else if (/^(python[\d.]*|py)$/i.test(programName(a)) && t[1] === "-m") {
      t.splice(0, 2);
    } else {
      break;
    }
  }
  if (t.length) t[0] = programName(t[0]!);
  return t;
}

/** `node_modules/.bin/vitest` -> `vitest`, `C:\Python311\python.exe` -> `python`; scripts keep their path. */
export function programName(token: string): string {
  const s = token.replace(/\\/g, "/");
  const bin = /(?:^|\/)(?:node_modules\/\.bin|\.?venv\/(?:bin|Scripts)|bin|Scripts)\/([^/]+)$/.exec(s);
  if (bin) return bin[1]!.replace(/\.(exe|cmd|bat)$/i, "");
  if (/\.(exe|cmd|bat)$/i.test(s)) return s.split("/").pop()!.replace(/\.(exe|cmd|bat)$/i, "");
  return s;
}

const CD_COMMANDS = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);

/** The directory a `cd`-like command moves to; `null` if unknown, `undefined` if not a cd. */
export function cdTarget(tokens: readonly string[]): string | null | undefined {
  if (!CD_COMMANDS.has(tokens[0]?.toLowerCase() ?? "")) return undefined;
  const args = tokens.slice(1).filter((t) => !/^-|^\/d$/i.test(t));
  return args[0] ?? null;
}

/** Commands that prepare the environment and belong in a learned recipe. */
export function isSetup(tokens: readonly string[], text: string): boolean {
  const p = tokens[0] ?? "";
  if (/^(export|source|\.|nvm|fnm|conda|pyenv|workon)$/.test(p)) return true;
  if (text.startsWith("$env:")) return true;
  if (/activate(\.(bat|ps1|fish|csh))?$/i.test(p)) return true;
  return tokens.length > 0 && tokens.every((t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
}

/** Commands that do nothing meaningful on their own (separators, sleeps). */
export function isNoise(tokens: readonly string[]): boolean {
  return /^(echo|printf|sleep|true|false|clear|cls|set|date|:|Write-Host|Write-Output|Start-Sleep)$/i.test(tokens[0] ?? "");
}

/** Removes noise the agent added for its own benefit, like `2>&1` or a `timeout 120` prefix. */
export function cleanSegment(text: string): string {
  return text
    .replace(/\s+2>&1(?=\s|$)/g, "")
    .replace(/^g?timeout\s+(?:-\S+\s+)*\d+[smh]?\s+/, "")
    .trim();
}
