import { chmod, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { allAdapters } from "../adapters/index.js";
import { type Pattern, patternLabel, toSkillSpec } from "../engine/patterns.js";
import { checkRecipe } from "../engine/safety.js";
import { type ScanOptions, findPattern, scan } from "../engine/scan.js";
import { c } from "../ui/ansi.js";
import * as f from "../ui/format.js";

export interface LearnOptions extends ScanOptions {
  dryRun: boolean;
  force: boolean;
}

/**
 * Compiles patterns into agent skills. With an id, learns that one pattern;
 * without, learns every safe pattern in the current project (or --project).
 */
export async function runLearn(id: string | undefined, opts: LearnOptions): Promise<void> {
  const scope = id ? opts : { ...opts, project: opts.project ?? "." };
  const { patterns, projects } = await scan(scope);
  if (!id && !projects.length) {
    throw new Error("No transcripts for this directory. Run inside a project, pass --project <path>, or give a pattern id.");
  }
  const targets = id ? [findPattern(patterns, id)] : patterns;
  if (!targets.length) {
    console.log(c.dim("\n  Nothing to learn here yet: no command has worked in 2+ sessions.\n"));
    return;
  }

  const emitters = new Map(allAdapters(opts).map((a) => [a.id, a.skills]));
  let written = 0;
  console.log("");
  for (const p of targets) {
    const verdict = checkRecipe(p.recipe, p.intent);
    const head = `  ${c.bold(`#${p.id} ${patternLabel(p)}`)} ${c.dim(p.tool)} ${c.cyan(p.project.name)}`;
    if (!verdict.ok) {
      console.log(`${head}\n     ${c.red("✗ skipped")} ${c.dim(`recipe ${verdict.reasons.join(", ")}: ${p.recipe}`)}\n`);
      continue;
    }
    const emitter = emitters.get(p.project.agent);
    if (!emitter) continue;

    const files = emitter.render(toSkillSpec(p));
    const skillDir = path.join(p.project.root, emitter.dir, p.slug);
    if (existsSync(skillDir) && !opts.force && !opts.dryRun) {
      console.log(`${head}\n     ${c.yellow("• already learned")} ${c.dim(`(${rel(p, skillDir)}, use --force to overwrite)`)}\n`);
      continue;
    }

    console.log(head);
    for (const file of files) {
      const abs = path.join(p.project.root, file.path);
      if (opts.dryRun) {
        console.log(`     ${c.cyan("would write")} ${file.path}`);
        console.log(c.dim(file.content.replace(/^/gm, "     │ ")));
      } else {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, file.content.replace(/\r?\n/g, "\n"));
        if (file.executable && process.platform !== "win32") await chmod(abs, 0o755);
        console.log(`     ${c.green("✓ wrote")} ${file.path}`);
      }
    }
    if (!opts.dryRun) written++;
    console.log(
      // A skill call still takes one turn, so the saving is everything before it.
      c.dim(
        `     saves about ${f.usd(p.wasteUSD / Math.max(1, p.sessions))} and ` +
          `${Math.max(0, p.avgTurns - 1).toFixed(1)} turns per session`,
      ),
    );
    console.log("");
  }

  if (opts.dryRun) console.log(c.dim("  Dry run: nothing was written.\n"));
  else if (written) {
    console.log(`  ${c.green("✓")} Learned ${f.plural(written, "skill")}. Claude Code picks them up in new sessions.\n`);
  }
}

function rel(p: Pattern, abs: string): string {
  return path.relative(p.project.root, abs).replace(/\\/g, "/");
}
