/** What a shell command was for. */
export type Intent =
  | "test"
  | "build"
  | "typecheck"
  | "lint"
  | "format"
  | "install"
  | "dev"
  | "migrate"
  | "script"
  | "deploy";

export type ShellKind = "bash" | "powershell";

/**
 * How a tool call relates to "figuring out how to run something":
 * - shell: a command line, classified further by the engine
 * - read/search: a file read or search, exploratory only when it targets build/test config
 * - explore: always exploratory (directory listings)
 * - edit: changes code, so it ends any exploration window
 * - neutral: bookkeeping that neither starts nor ends a window (todo lists, tool lookup)
 * - other: anything else, which ends the window
 */
export type ToolKind = "shell" | "read" | "search" | "explore" | "edit" | "neutral" | "other";

export type CallStatus = "ok" | "error" | "unknown";

export interface ToolCall {
  id: string;
  name: string;
  kind: ToolKind;
  shell?: ShellKind;
  command?: string;
  /** File path or glob, for read/search calls. */
  target?: string;
  /** Normalized working directory the call ran in. */
  cwd: string;
  status: CallStatus;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/** One model API call: a single step of the agent loop. */
export interface Turn {
  id: string;
  model: string;
  timestamp: number;
  usage: Usage;
  calls: ToolCall[];
  /** True when a human prompt came right before this turn. */
  afterPrompt: boolean;
}

export interface Session {
  id: string;
  file: string;
  isSubagent: boolean;
  turns: Turn[];
  /** Total cost the agent itself recorded for the session, when available. */
  reportedCostUSD?: number;
}

export interface ProjectRef {
  agent: string;
  /** Adapter-specific identifier (for Claude Code, the folder name under ~/.claude/projects). */
  key: string;
  /** Normalized absolute path of the project on disk. */
  root: string;
  name: string;
  files: string[];
}

/** Everything needed to write a learned command as an agent skill. */
export interface SkillSpec {
  slug: string;
  title: string;
  description: string;
  intent: Intent;
  tool: string;
  workdir: string;
  recipe: string;
  shell: ShellKind;
  sessions: number;
  runs: number;
  lastSeen: number;
}

export interface SkillFile {
  /** Path relative to the project root. */
  path: string;
  content: string;
  executable?: boolean;
}

export interface ISkillEmitter {
  /** Directory, relative to the project root, holding one folder per skill. */
  readonly dir: string;
  render(spec: SkillSpec): SkillFile[];
}

/**
 * Reads one coding agent's local session transcripts. Adding support for another
 * agent (Aider, Cursor, Codex, ...) means implementing this interface and
 * registering it in adapters/index.ts.
 */
export interface ITranscriptAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly skills: ISkillEmitter;
  /** True when this agent has transcripts on this machine. */
  detect(): Promise<boolean>;
  listProjects(): Promise<ProjectRef[]>;
  loadSessions(project: ProjectRef): Promise<Session[]>;
}
