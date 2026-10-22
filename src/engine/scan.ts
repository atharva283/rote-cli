import { performance } from "node:perf_hooks";
import { allAdapters } from "../adapters/index.js";
import type { ITranscriptAdapter, ProjectRef } from "../types.js";
import { relativeTo, resolvePath } from "../util/paths.js";
import { type Pattern, buildPatterns, rankPatterns } from "./patterns.js";
import { turnCost, turnTokens } from "./pricing.js";

export interface ScanOptions {
  /** Only scan projects at, inside, or containing this path. */
  project?: string;
  /** Override the transcripts directory (mainly for tests). */
  transcripts?: string;
  minSessions?: number;
}

export interface ScanResult {
  agents: string[];
  projects: ProjectRef[];
  sessions: number;
  turns: number;
  totalUSD: number;
  totalTokens: number;
  /** Ranked patterns seen in at least `minSessions` sessions. */
  patterns: Pattern[];
  elapsedMs: number;
}

export async function scan(opts: ScanOptions = {}): Promise<ScanResult> {
  const started = performance.now();
  const adapters: ITranscriptAdapter[] = [];
  for (const a of allAdapters({ transcripts: opts.transcripts })) if (await a.detect()) adapters.push(a);

  const perAdapter = await Promise.all(
    adapters.map(async (adapter) => {
      let projects = await adapter.listProjects();
      if (opts.project) {
        const target = resolvePath(process.cwd().replace(/\\/g, "/"), opts.project);
        projects = projects.filter((p) => relativeTo(p.root, target) !== null || relativeTo(target, p.root) !== null);
      }
      return Promise.all(
        projects.map(async (project) => {
          const sessions = await adapter.loadSessions(project);
          return { project, sessions, patterns: buildPatterns(project, sessions, adapter.skills) };
        }),
      );
    }),
  );

  const loaded = perAdapter.flat();
  let turns = 0;
  let totalUSD = 0;
  let totalTokens = 0;
  for (const { sessions } of loaded) {
    for (const s of sessions) {
      turns += s.turns.length;
      for (const t of s.turns) {
        totalUSD += turnCost(t);
        totalTokens += turnTokens(t);
      }
    }
  }

  return {
    agents: adapters.map((a) => a.displayName),
    projects: loaded.map((l) => l.project),
    sessions: loaded.reduce((n, l) => n + l.sessions.length, 0),
    turns,
    totalUSD,
    totalTokens,
    patterns: rankPatterns(
      loaded.flatMap((l) => l.patterns),
      opts.minSessions ?? 2,
    ),
    elapsedMs: performance.now() - started,
  };
}

/** Finds a pattern by its rank (`3`) or slug (`test-vitest`), preferring the project you're in. */
export function findPattern(patterns: readonly Pattern[], id: string): Pattern {
  if (/^\d+$/.test(id)) {
    const p = patterns.find((x) => x.id === Number(id));
    if (!p) throw new Error(`No pattern #${id}. Run \`rote stats\` to see the list.`);
    return p;
  }
  const matches = patterns.filter((p) => p.slug === id.toLowerCase());
  if (!matches.length) throw new Error(`No pattern named "${id}". Run \`rote stats\` to see the list.`);
  if (matches.length === 1) return matches[0]!;
  const cwd = process.cwd().replace(/\\/g, "/");
  const here = matches.find((p) => relativeTo(p.project.root, resolvePath(cwd, ".")) !== null);
  if (here) return here;
  throw new Error(
    `"${id}" exists in several projects (${matches.map((p) => p.project.name).join(", ")}). ` +
      `Use its number from \`rote stats\`, or run this inside the project.`,
  );
}
