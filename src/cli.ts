#!/usr/bin/env node
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { runLearn } from "./commands/learn.js";
import { runShow } from "./commands/show.js";
import { runStats } from "./commands/stats.js";
import { c, setColor } from "./ui/ansi.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const HELP = `
  ${c.bold(c.orange("◆ rote"))} ${c.dim(`v${version}`)}  muscle memory for coding agents

  ${c.bold("Usage")}
    rote stats [project-path]        what your agent keeps paying to rediscover
    rote show <id>                   the sessions behind one pattern
    rote learn [id] [--dry-run]      compile patterns into one-call agent skills

  ${c.bold("Options")}
    --limit <n>          rows to show (default 10)
    --all                include patterns with no wasted turns
    --min <n>            minimum sessions for a pattern (default 2)
    --project <path>     restrict learn/show to one project
    --transcripts <dir>  read Claude Code transcripts from <dir> (default ~/.claude/projects)
    --dry-run            print skill files instead of writing them
    --force              overwrite skills that already exist
    --json               machine-readable stats
    --no-color           disable colors
    -v, --version
    -h, --help

  ${c.bold("Examples")}
    npx rote-cli stats               every project on this machine
    npx rote-cli stats .             just this project
    npx rote-cli learn 1 --dry-run   preview the skill for the top pattern
`;

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      limit: { type: "string" },
      all: { type: "boolean", default: false },
      min: { type: "string" },
      project: { type: "string" },
      transcripts: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values["no-color"] || values.json) setColor(false);
  if (values.version) return void console.log(version);

  const [command = "stats", arg] = positionals;
  if (values.help || command === "help") return void console.log(HELP);

  const scan = {
    transcripts: values.transcripts,
    minSessions: positiveInt(values.min, "--min") ?? 2,
  };

  switch (command) {
    case "stats":
      return runStats({
        ...scan,
        project: arg ?? values.project,
        limit: positiveInt(values.limit, "--limit") ?? 10,
        all: values.all,
        json: values.json,
      });
    case "show":
      if (!arg) throw new Error("Usage: rote show <id>");
      return runShow(arg, { ...scan, project: values.project });
    case "learn":
      return runLearn(arg, { ...scan, project: values.project, dryRun: values["dry-run"], force: values.force });
    default:
      throw new Error(`Unknown command "${command}". Run \`rote --help\`.`);
  }
}

function positiveInt(v: string | undefined, flag: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive whole number`);
  return n;
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`${c.red("rote:")} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
