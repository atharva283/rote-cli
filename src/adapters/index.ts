import type { ITranscriptAdapter } from "../types.js";
import { ClaudeCodeAdapter } from "./claude-code.js";

export interface AdapterOptions {
  /** Override the Claude Code projects directory (defaults to ~/.claude/projects). */
  transcripts?: string;
}

/** Every supported agent. New adapters (Aider, Cursor, Codex, ...) go here. */
export function allAdapters(opts: AdapterOptions = {}): ITranscriptAdapter[] {
  return [new ClaudeCodeAdapter(opts.transcripts)];
}
