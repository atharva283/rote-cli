import type { Intent, Session, ShellKind, ToolCall, Turn } from "../types.js";
import { foldWorktree, relativeTo, resolvePath } from "../util/paths.js";
import { CONFIG_FILE, TEST_PATH, classify, isDiscovery } from "./intents.js";
import { cdTarget, cleanSegment, coreTokens, isNoise, isSetup, splitCommand, tokenize } from "./shell.js";

/** One classified run of a build/test/... command. */
export interface Hit {
  /** `intent|workdir|signature`, unique within a project. */
  key: string;
  intent: Intent;
  signature: string;
  tool: string;
  /** Directory the command ran in, relative to the project root ("" for the root). */
  workdir: string;
  /** The cleaned command, including any env setup that preceded it. */
  recipe: string;
  shell: ShellKind;
  ok: boolean;
}

/**
 * The stretch of turns that ended in a working run: any exploration and
 * failed attempts right before it, plus the successful turn itself.
 */
export interface Episode {
  session: Session;
  hit: Hit;
  window: Turn[];
  /** Turns a learned skill would have made unnecessary (the window minus its final turn). */
  waste: Turn[];
  failedAttempts: number;
}

interface TurnInfo {
  /** The turn did real work (edits, unrelated commands), so exploration can't extend past it. */
  boundary: boolean;
  explore: boolean;
  ok: Hit[];
  failed: Hit[];
}

/** How far back an exploration window may reach. */
const MAX_WINDOW = 25;

export function findEpisodes(session: Session, root: string): { episodes: Episode[]; runs: Hit[] } {
  const turns = session.turns;
  const infos = turns.map((t) => inspectTurn(t, root));
  const episodes: Episode[] = [];
  const runs: Hit[] = [];

  for (let i = 0; i < turns.length; i++) {
    const info = infos[i]!;
    if (!info.ok.length) continue;
    runs.push(...info.ok);

    // Exploration is credited to the last successful command in the turn
    // (in `npm run build && npm test`, the test run is what the agent was after).
    const target = info.ok[info.ok.length - 1]!;
    let start = i;
    while (start > 0 && i - start < MAX_WINDOW && !turns[start]!.afterPrompt) {
      const prev = infos[start - 1]!;
      if (prev.boundary || prev.ok.length || prev.failed.some((h) => h.intent !== target.intent)) break;
      start--;
    }
    // Leading turns that neither explored nor tried anything aren't part of the story.
    while (start < i && !infos[start]!.explore && !infos[start]!.failed.length) start++;

    const window = turns.slice(start, i + 1);
    const failedAttempts = infos.slice(start, i).reduce((n, x) => n + x.failed.length, 0);
    for (const hit of info.ok) {
      const credited = hit === target;
      episodes.push({
        session,
        hit,
        window: credited ? window : [turns[i]!],
        waste: credited ? window.slice(0, -1) : [],
        failedAttempts: credited ? failedAttempts : 0,
      });
    }
  }
  return { episodes, runs };
}

function inspectTurn(turn: Turn, root: string): TurnInfo {
  const info: TurnInfo = { boundary: turn.calls.length === 0, explore: false, ok: [], failed: [] };
  // Agents read files in parallel batches. A batch that is mostly build/test
  // config is orientation; one that is mostly source code is real work.
  let configReads = 0;
  let otherReads = 0;
  for (const call of turn.calls) {
    switch (call.kind) {
      case "neutral":
        break;
      case "explore":
        info.explore = true;
        break;
      case "read":
      case "search": {
        const t = call.target ?? "";
        // Globbing for tests is looking for what to run; reading a test file is working on it.
        if (CONFIG_FILE.test(t) || (call.kind === "search" && TEST_PATH.test(t))) configReads++;
        else otherReads++;
        break;
      }
      case "shell":
        inspectShell(call, root, info);
        break;
      default:
        info.boundary = true;
    }
  }
  if (otherReads > configReads) info.boundary = true;
  else if (configReads) info.explore = true;
  return info;
}

function inspectShell(call: ToolCall, root: string, info: TurnInfo): void {
  const shell = call.shell ?? "bash";
  const joiner = shell === "bash" ? " && " : "; ";
  let dir = call.cwd;
  const setup: string[] = [];

  for (const seg of splitCommand(call.command ?? "", shell)) {
    if (seg.piped || seg.text.startsWith("#")) continue;
    const tokens = tokenize(seg.text);
    if (!tokens.length) continue;

    const cd = cdTarget(tokens);
    if (cd !== undefined) {
      if (cd) dir = resolvePath(dir, cd);
      continue;
    }
    if (isSetup(tokens, seg.text)) {
      setup.push(seg.text);
      continue;
    }
    if (isNoise(tokens)) continue;

    const core = coreTokens(tokens);
    const cls = classify(core);
    if (cls) {
      const folded = foldWorktree(dir);
      const workdir = relativeTo(root, folded) ?? folded;
      const hit: Hit = {
        key: `${cls.intent}|${workdir}|${cls.signature}`,
        ...cls,
        workdir,
        recipe: [...setup, cleanSegment(seg.text)].join(joiner),
        shell,
        ok: call.status === "ok",
      };
      if (call.status === "ok") info.ok.push(hit);
      else if (call.status === "error") info.failed.push(hit);
      else info.boundary = true;
    } else if (isDiscovery(core)) {
      info.explore = true;
    } else {
      info.boundary = true;
    }
  }
}
