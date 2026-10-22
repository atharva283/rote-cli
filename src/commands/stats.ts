import { patternLabel, type Pattern } from "../engine/patterns.js";
import { type ScanOptions, type ScanResult, scan } from "../engine/scan.js";
import { c, pad, terminalWidth, truncate, width } from "../ui/ansi.js";
import * as f from "../ui/format.js";

export interface StatsOptions extends ScanOptions {
  limit: number;
  all: boolean;
  json: boolean;
}

export async function runStats(opts: StatsOptions): Promise<void> {
  const result = await scan(opts);
  if (opts.json) {
    console.log(JSON.stringify(toJson(result), null, 2));
    return;
  }
  console.log(renderStats(result, opts));
}

export function renderStats(r: ScanResult, opts: Pick<StatsOptions, "limit" | "all" | "project">): string {
  const out: string[] = [""];
  out.push(`  ${c.bold(c.orange("◆ rote"))}  ${c.dim("muscle memory for coding agents")}`);
  out.push(
    c.dim(
      `  Scanned ${f.plural(r.sessions, `${r.agents.join(" + ") || "agent"} session`)} · ` +
        `${f.plural(r.turns, "turn")} · ${f.plural(r.projects.length, "project")} in ${(r.elapsedMs / 1000).toFixed(2)}s`,
    ),
  );
  out.push("");

  if (!r.sessions && opts.project) {
    const where = opts.project === "." ? "this directory" : opts.project;
    out.push(`  No agent sessions found for ${c.bold(where)}. Run ${c.bold("rote stats")} to scan every project.`);
    out.push("");
    return out.join("\n");
  }
  if (!r.sessions) {
    out.push(`  No transcripts found. Rote reads Claude Code sessions from ${c.bold("~/.claude/projects")}.`);
    out.push(c.dim("  Use Claude Code for a while, then run this again (or pass --transcripts <dir>)."));
    out.push("");
    return out.join("\n");
  }

  const shown = r.patterns.filter((p) => opts.all || p.wasteUSD > 0);
  if (!shown.length) {
    out.push("  No repeated rediscoveries yet. Your agent either knew the commands or you haven't run");
    out.push(`  the same task in 2+ sessions. ${c.dim("Try `rote stats --all` to see every repeated command.")}`);
    out.push("");
    return out.join("\n");
  }

  out.push(...renderTable(shown.slice(0, opts.limit)));
  if (shown.length > opts.limit) out.push(c.dim(`  … ${shown.length - opts.limit} more (use --limit ${shown.length})`));

  const waste = r.patterns.reduce(
    (acc, p) => ({
      usd: acc.usd + p.wasteUSD,
      tokens: acc.tokens + p.wasteTokens,
      ms: acc.ms + p.wasteMs,
      count: acc.count + p.rediscoveries,
    }),
    { usd: 0, tokens: 0, ms: 0, count: 0 },
  );
  const share = r.totalUSD > 0 ? (waste.usd / r.totalUSD) * 100 : 0;
  const top = shown[0]!;

  out.push("");
  out.push(c.dim(`  ${"─".repeat(Math.min(terminalWidth() - 4, 96))}`));
  out.push(
    `  ${c.bold(c.red(f.usd(waste.usd)))}  ${c.bold("spent figuring out commands your agent had already gotten working before")}`,
  );
  out.push(
    c.dim(
      `  ${" ".repeat(f.usd(waste.usd).length)}  ${f.plural(waste.count, "rediscovery", "rediscoveries")} · ` +
        `${f.tokens(waste.tokens)} tokens · ${f.duration(waste.ms)} of agent time · ` +
        `${share.toFixed(1)}% of ${f.usd(r.totalUSD)} total agent spend`,
    ),
  );
  out.push("");
  out.push(`  ${c.cyan("→")} ${c.bold(`rote learn ${top.id}`)}   ${c.dim("teach it once; next time it takes one call and no exploring")}`);
  out.push(`  ${c.cyan("→")} ${c.bold(`rote show ${top.id}`)}    ${c.dim("see the sessions behind a pattern")}`);
  out.push("");
  out.push(c.dim("  Costs are API-equivalent at list prices. Waste only counts turns spent exploring or retrying"));
  out.push(c.dim("  right before a command worked, so the real number is likely higher."));
  out.push("");
  return out.join("\n");
}

function renderTable(rows: Pattern[]): string[] {
  const term = terminalWidth();
  const showBar = term >= 112;
  const fixed = { id: 4, seen: 5, turns: 9, tokens: 7, cost: 9, bar: showBar ? 12 : 0 };
  const gaps = 2 * (showBar ? 7 : 6) + 2;
  const flex = Math.max(36, term - gaps - Object.values(fixed).reduce((a, b) => a + b, 0));
  const projectW = Math.min(20, Math.max(10, Math.round(flex * 0.3)));
  const patternW = flex - projectW;
  const maxCost = Math.max(...rows.map((p) => p.wasteUSD), 0.0001);

  const cells = (cols: string[]) => `  ${cols.join("  ")}`.trimEnd();
  const lines = [
    c.dim(
      cells([
        pad("#", fixed.id, "right"),
        pad("PATTERN", patternW),
        pad("PROJECT", projectW),
        pad("SEEN", fixed.seen, "right"),
        pad("AVG TURNS", fixed.turns, "right"),
        pad("TOKENS", fixed.tokens, "right"),
        pad("WASTED", fixed.cost, "right"),
        ...(showBar ? [""] : []),
      ]),
    ),
  ];

  for (const p of rows) {
    const label = pad(patternLabel(p), 12);
    const detail = p.workdir ? `${p.tool} · ${p.workdir}/` : p.tool;
    const pattern = `${c.bold(label)}${c.dim(truncate(detail, Math.max(4, patternW - width(label))))}`;
    const id = p.learned ? c.green(`${p.id}✓`) : String(p.id);
    lines.push(
      cells([
        pad(id, fixed.id, "right"),
        pad(pattern, patternW),
        pad(c.cyan(truncate(p.project.name, projectW)), projectW),
        pad(`${p.sessions}×`, fixed.seen, "right"),
        pad(p.avgTurns.toFixed(1), fixed.turns, "right"),
        pad(f.tokens(p.wasteTokens), fixed.tokens, "right"),
        pad(c.bold(p.wasteUSD > 0 ? c.yellow(f.usd(p.wasteUSD)) : c.dim(f.usd(0))), fixed.cost, "right"),
        ...(showBar ? [c.orange(f.bar(p.wasteUSD / maxCost, fixed.bar))] : []),
      ]),
    );
  }
  return lines;
}

function toJson(r: ScanResult) {
  return {
    agents: r.agents,
    sessions: r.sessions,
    turns: r.turns,
    projects: r.projects.map((p) => ({ name: p.name, root: p.root, agent: p.agent })),
    totalUSD: r.totalUSD,
    totalTokens: r.totalTokens,
    wastedUSD: r.patterns.reduce((n, p) => n + p.wasteUSD, 0),
    elapsedMs: Math.round(r.elapsedMs),
    patterns: r.patterns.map((p) => ({
      id: p.id,
      slug: p.slug,
      project: p.project.name,
      projectRoot: p.project.root,
      intent: p.intent,
      tool: p.tool,
      workdir: p.workdir,
      recipe: p.recipe,
      sessions: p.sessions,
      runs: p.runs,
      rediscoveries: p.rediscoveries,
      avgTurns: Number(p.avgTurns.toFixed(2)),
      wasteTurns: p.wasteTurns,
      wasteTokens: p.wasteTokens,
      wasteUSD: Number(p.wasteUSD.toFixed(4)),
      wasteMs: p.wasteMs,
      firstSeen: new Date(p.firstSeen).toISOString(),
      lastSeen: new Date(p.lastSeen).toISOString(),
      learned: p.learned,
    })),
  };
}
