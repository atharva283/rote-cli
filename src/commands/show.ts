import { patternLabel } from "../engine/patterns.js";
import { turnCost } from "../engine/pricing.js";
import { checkRecipe } from "../engine/safety.js";
import { type ScanOptions, findPattern, scan } from "../engine/scan.js";
import type { ToolCall } from "../types.js";
import { c, terminalWidth, truncate } from "../ui/ansi.js";
import * as f from "../ui/format.js";

const MAX_EPISODES = 8;

/** Prints the evidence behind one pattern: the sessions where the agent rediscovered it. */
export async function runShow(id: string, opts: ScanOptions): Promise<void> {
  const { patterns } = await scan(opts);
  const p = findPattern(patterns, id);
  const lineW = terminalWidth() - 12;
  const out: string[] = [""];

  out.push(`  ${c.bold(`#${p.id} ${patternLabel(p)}`)}  ${c.dim(p.tool)}  ${c.cyan(p.project.name)}${p.workdir ? c.dim(` · ${p.workdir}/`) : ""}`);
  out.push(
    c.dim(
      `  ${f.plural(p.sessions, "session")} · ${f.plural(p.runs, "successful run")} · ` +
        `${f.plural(p.rediscoveries, "rediscovery", "rediscoveries")} · ${f.usd(p.wasteUSD)} wasted · slug ${p.slug}`,
    ),
  );
  out.push("");

  const episodes = p.episodes
    .filter((e) => e.waste.length)
    .map((e) => ({ e, cost: e.waste.reduce((n, t) => n + turnCost(t), 0) }))
    .sort((a, b) => b.cost - a.cost);

  if (!episodes.length) out.push(c.dim("  The agent got this right first time in every session."));
  for (const { e, cost } of episodes.slice(0, MAX_EPISODES)) {
    out.push(
      `  ${f.date(e.window[0]!.timestamp)}  ${c.dim(e.session.id.slice(0, 8))}  ` +
        `${f.plural(e.window.length, "turn")}  ${c.yellow(f.usd(cost))}${e.session.isSubagent ? c.dim("  (subagent)") : ""}`,
    );
    for (const turn of e.window) {
      for (const call of turn.calls) {
        const text = describeCall(call);
        if (text) out.push(`     ${statusMark(call)} ${truncate(text, lineW)}`);
      }
    }
    out.push("");
  }
  if (episodes.length > MAX_EPISODES) out.push(c.dim(`  … ${episodes.length - MAX_EPISODES} more`), "");

  const verdict = checkRecipe(p.recipe, p.intent);
  out.push(`  ${c.bold("Recipe")}${p.workdir ? c.dim(` (runs in ${p.workdir}/)`) : ""}`);
  out.push(`     ${p.recipe}`);
  out.push("");
  out.push(
    verdict.ok
      ? `  ${c.cyan("→")} ${c.bold(`rote learn ${p.id}`)}  ${c.dim(`writes .claude/skills/${p.slug}/`)}`
      : `  ${c.red("✗")} Not learnable: ${verdict.reasons.join(", ")}`,
  );
  out.push("");
  console.log(out.join("\n"));
}

function describeCall(call: ToolCall): string {
  switch (call.kind) {
    case "shell":
      return (call.command ?? "").replace(/\s*\n\s*/g, " ⏎ ");
    case "neutral":
      return "";
    default:
      return `${call.name}${call.target ? ` ${call.target.replace(/\\/g, "/").split("/").slice(-2).join("/")}` : ""}`;
  }
}

function statusMark(call: ToolCall): string {
  if (call.kind !== "shell") return c.dim("·");
  return call.status === "ok" ? c.green("✓") : call.status === "error" ? c.red("✗") : c.dim("?");
}
