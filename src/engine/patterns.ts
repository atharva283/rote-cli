import { existsSync } from "node:fs";
import path from "node:path";
import type { ISkillEmitter, Intent, ProjectRef, Session, ShellKind, SkillSpec } from "../types.js";
import { type Episode, type Hit, findEpisodes } from "./episodes.js";
import { INTENT_LABEL } from "./intents.js";
import { turnCost, turnTokens } from "./pricing.js";

/** A command the agent ran successfully in several sessions, with what it cost to get there each time. */
export interface Pattern {
  /** Rank in the default listing, 1-based. Assigned by `rankPatterns`. */
  id: number;
  slug: string;
  project: ProjectRef;
  intent: Intent;
  signature: string;
  tool: string;
  workdir: string;
  shell: ShellKind;
  /** The most common working form of the command. */
  recipe: string;
  sessions: number;
  runs: number;
  /** Episodes that needed exploration or failed attempts before the working run. */
  rediscoveries: number;
  /** Average turns per session up to and including the first working run. */
  avgTurns: number;
  wasteTurns: number;
  wasteTokens: number;
  wasteUSD: number;
  wasteMs: number;
  firstSeen: number;
  lastSeen: number;
  learned: boolean;
  episodes: Episode[];
}

interface Group {
  sample: Hit;
  runs: number;
  recipes: Map<string, number>;
  episodes: Episode[];
  turnsBySession: Map<string, number>;
}

export function buildPatterns(project: ProjectRef, sessions: readonly Session[], skills: ISkillEmitter): Pattern[] {
  const groups = new Map<string, Group>();
  const group = (hit: Hit) => {
    let g = groups.get(hit.key);
    if (!g) {
      g = { sample: hit, runs: 0, recipes: new Map(), episodes: [], turnsBySession: new Map() };
      groups.set(hit.key, g);
    }
    return g;
  };

  for (const session of sessions) {
    const { episodes, runs } = findEpisodes(session, project.root);
    for (const hit of runs) {
      const g = group(hit);
      g.runs++;
      g.recipes.set(hit.recipe, (g.recipes.get(hit.recipe) ?? 0) + 1);
    }
    for (const ep of episodes) {
      const g = group(ep.hit);
      g.episodes.push(ep);
      // Episodes arrive in order, so the first one per session is how long it took to get going.
      if (!g.turnsBySession.has(session.id)) g.turnsBySession.set(session.id, ep.window.length);
    }
  }

  const taken = new Set<string>();
  const patterns: Pattern[] = [];
  for (const g of groups.values()) {
    const { sample, episodes } = g;
    let wasteTurns = 0;
    let wasteTokens = 0;
    let wasteUSD = 0;
    let wasteMs = 0;
    let rediscoveries = 0;
    for (const ep of episodes) {
      if (!ep.waste.length) continue;
      rediscoveries++;
      wasteTurns += ep.waste.length;
      for (const t of ep.waste) {
        wasteTokens += turnTokens(t);
        wasteUSD += turnCost(t);
      }
      wasteMs += Math.max(0, ep.window.at(-1)!.timestamp - ep.window[0]!.timestamp);
    }
    const perSession = [...g.turnsBySession.values()];
    const stamps = episodes.map((e) => e.window.at(-1)!.timestamp).filter((n) => n > 0);
    const slug = uniqueSlug(makeSlug(sample.intent, sample.tool, sample.workdir), taken);
    patterns.push({
      id: 0,
      slug,
      project,
      intent: sample.intent,
      signature: sample.signature,
      tool: sample.tool,
      workdir: sample.workdir,
      shell: sample.shell,
      recipe: mostCommon(g.recipes),
      sessions: g.turnsBySession.size,
      runs: g.runs,
      rediscoveries,
      avgTurns: perSession.reduce((a, b) => a + b, 0) / Math.max(1, perSession.length),
      wasteTurns,
      wasteTokens,
      wasteUSD,
      wasteMs,
      firstSeen: Math.min(...stamps),
      lastSeen: Math.max(...stamps),
      learned: existsSync(path.join(project.root, skills.dir, slug, "SKILL.md")),
      episodes,
    });
  }
  return patterns;
}

/** Sorts by money wasted, keeps patterns seen in at least `minSessions` sessions, and numbers them. */
export function rankPatterns(patterns: Pattern[], minSessions: number): Pattern[] {
  const ranked = patterns
    .filter((p) => p.sessions >= minSessions)
    .sort((a, b) => b.wasteUSD - a.wasteUSD || b.sessions - a.sessions || b.runs - a.runs);
  ranked.forEach((p, i) => (p.id = i + 1));
  return ranked;
}

export function patternLabel(p: Pattern): string {
  return INTENT_LABEL[p.intent];
}

export function toSkillSpec(p: Pattern): SkillSpec {
  const where = p.workdir ? ` in ${p.workdir}/` : "";
  return {
    slug: p.slug,
    title: `${INTENT_LABEL[p.intent]} (${p.tool})`,
    description:
      `${describeIntent(p.intent)} for this project (\`${p.recipe}\`${where}). ` +
      `Use this instead of reading package.json, configs or docs to work out the command: ` +
      `it is the verified command from ${p.sessions} past sessions.`,
    intent: p.intent,
    tool: p.tool,
    workdir: p.workdir,
    recipe: p.recipe,
    shell: p.shell,
    sessions: p.sessions,
    runs: p.runs,
    lastSeen: p.lastSeen,
  };
}

function describeIntent(intent: Intent): string {
  switch (intent) {
    case "test": return "Run the test suite";
    case "build": return "Build the project";
    case "typecheck": return "Type-check the project";
    case "lint": return "Lint the project";
    case "format": return "Format the code";
    case "install": return "Install dependencies";
    case "dev": return "Start the dev server";
    case "migrate": return "Run database migrations";
    case "deploy": return "Deploy the project";
    case "script": return "Run this project script";
  }
}

const SLUG_PREFIX: Record<Intent, string> = {
  test: "test",
  build: "build",
  typecheck: "typecheck",
  lint: "lint",
  format: "format",
  install: "install",
  dev: "dev",
  migrate: "migrate",
  script: "run",
  deploy: "deploy",
};

function makeSlug(intent: Intent, tool: string, workdir: string): string {
  const toolWords = tool
    .replace(/\.(py|m?js|cjs|ts|mts|sh|bash|ps1|rb|php|pl|r)\b/gi, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && w !== "run");
  const dirWord = workdir && !workdir.includes(":") && !workdir.startsWith("/") ? [workdir.split("/").pop()!] : [];
  const words: string[] = [];
  for (const w of [SLUG_PREFIX[intent], ...toolWords, ...dirWord]) {
    const lw = w.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (lw && !words.includes(lw)) words.push(lw);
  }
  return words.join("-").slice(0, 48).replace(/-$/, "");
}

function uniqueSlug(slug: string, taken: Set<string>): string {
  let s = slug;
  for (let n = 2; taken.has(s); n++) s = `${slug}-${n}`;
  taken.add(s);
  return s;
}

function mostCommon(counts: Map<string, number>): string {
  let best = "";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}
