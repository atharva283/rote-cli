<div align="center">

# ◆ rote

**Muscle memory for coding agents.**

How many times have you paid your agent to figure out how to run your tests?<br>
Rote finds out, then teaches it once so the next time costs nothing.

<!-- TODO: 5-second demo GIF. Record with `vhs assets/demo.tape` -> assets/demo.gif -->
<img src="assets/demo.gif" alt="rote stats finding rediscovered commands, then rote learn writing a skill" width="760">

```bash
npx rote-cli stats
```

100% local · zero config · zero dependencies · no API key · reads your transcripts in under a second

</div>

---

## The problem

Every new agent session starts from zero. Before your agent can run your tests, it reads
`package.json`, tries `npm test`, finds out the suite lives in `web/`, tries `npx vitest`
(watch mode, hangs), and finally lands on `cd web && npx vitest run`.

Next session, it does the same thing again, **and you pay for every one of those turns.**
Each turn re-reads the whole context window, so a "quick" three-turn detour on a large
project can cost more than the work you actually asked for.

## What rote does

**1. `rote stats`: see what your agent keeps rediscovering.**

Rote reads the session transcripts your agent already keeps on disk
(`~/.claude/projects/` for Claude Code). It finds commands that worked in several sessions,
and measures what each session spent exploring and retrying before it got there.

```
  ◆ rote  muscle memory for coding agents
  Scanned 54 Claude Code sessions · 2,791 turns · 8 projects in 0.54s

     #  PATTERN                                     PROJECT          SEEN  AVG TURNS   TOKENS   WASTED
     1  Dev server  wrangler dev · review-system/   beach-website      3×        1.7     1.2M    $0.25
     2  Run tests   npm test · review-system/       beach-website      4×        1.0     607k    $0.13
```

<!-- TODO: replace with a screenshot from a heavy user's machine before launch -->

**2. `rote show <id>`: see the evidence.** Every number comes from a real session. Rote
shows you which turns it counted:

```
  2026-09-02  agent-a9  2 turns  $0.02  (subagent)
     · Read review-system/wrangler.toml
     · Read review-system/package.json
     ✓ cd review-system && npx wrangler dev --local --persist-to .wrangler/state --port 8787
```

**3. `rote learn <id>`: compile it into a skill.** Rote writes a
[Claude Code skill](https://code.claude.com/docs/en/skills) with the command that worked:

```
.claude/skills/dev-wrangler-review-system/
├── SKILL.md    # tells the agent: "this is the verified command, don't explore"
└── run.sh      # cd review-system && npx wrangler dev --local ... "$@"
```

Next session, the agent sees the skill, runs it in one call, and skips the exploring.

## Before and after

<!-- TODO: measure on a real repo for launch: same prompt, fresh session, with and without the skill -->

|                         | Without rote | With a learned skill |
| ----------------------- | ------------ | -------------------- |
| Turns to a working run  | _TBD_        | 1                    |
| Tokens                  | _TBD_        | _TBD_                |
| API-equivalent cost     | _TBD_        | _TBD_                |

## Install

```bash
npx rote-cli stats           # run without installing
npm i -g rote-cli            # or install the `rote` command
```

Requires Node 18.17+. Works on macOS, Linux and Windows (bash and PowerShell sessions).

## Commands

```
rote stats [project-path]      what your agent keeps paying to rediscover
rote show <id>                 the sessions behind one pattern
rote learn [id] [--dry-run]    compile patterns into one-call agent skills
```

| Option                | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `--limit <n>`         | rows to show (default 10)                                       |
| `--all`               | include patterns the agent always got right first time          |
| `--min <n>`           | minimum sessions before something counts as a pattern (default 2) |
| `--project <path>`    | restrict `learn`/`show` to one project                          |
| `--transcripts <dir>` | read transcripts from somewhere other than `~/.claude/projects` |
| `--dry-run`           | print skill files instead of writing them                       |
| `--force`             | overwrite skills that already exist                             |
| `--json`              | machine-readable output                                         |

`rote learn` with no id learns every safe pattern in the current project.

## How it counts

Rote errs on the side of **under-counting**. These rules are deliberately strict, so the
number it shows is a floor:

- **A turn** is one model API call. Its cost is the actual token usage recorded in the
  transcript (input, output, cache reads, and 5-minute and 1-hour cache writes), priced at
  Anthropic list prices. On sessions that weren't resumed, this matches Claude Code's own
  recorded cost to the cent.
- **A rediscovery** is the run of turns right before a command succeeded, where the agent was
  only looking around: listing directories, reading `package.json`/`pyproject.toml`/CI
  config, running `--help`, or retrying the same kind of command after it failed.
- **Real work is never counted.** If the agent edited a file, read source code, or ran
  an unrelated command, the window stops there. A test that fails, gets fixed, then passes
  counts as zero waste, because that's TDD, not rediscovery.
- **Waste** is every turn in that window except the final working one, since a skill call
  still takes one turn.
- **Subscription users:** dollar figures are what the same tokens would cost on the API.

## Safety

`rote learn` only writes files inside your project's `.claude/skills/`. It never runs
anything. Recipes are filtered before they become skills:

- Destructive steps are stripped, or the pattern is refused: `rm`, `git push`,
  `reset --hard`, `--force`, `DROP TABLE`, `sudo`, `kill`, `curl | sh`, and more.
- Deploys and publishes (`wrangler deploy`, `npm publish`, `terraform apply`, ...) are never
  learned.
- Recipes that contain anything that looks like a secret (API keys, tokens, `PASSWORD=`) are
  refused.

Use `--dry-run` to read every file before it's written. Skills are plain Markdown and a
shell script, so they're easy to review and commit.

## Privacy

Rote makes no network calls, collects no telemetry, and never sends your transcripts anywhere.
It reads files on your disk and prints a table.

## Supported agents

| Agent       | Transcripts | Skills                 |
| ----------- | ----------- | ---------------------- |
| Claude Code | ✅          | `.claude/skills/`      |
| Codex CLI   | planned     | planned                |
| Aider       | planned     | `CONVENTIONS.md`       |
| Cursor      | planned     | `.cursor/rules/`       |

Adding an agent means implementing one interface, `ITranscriptAdapter` in
[`src/types.ts`](src/types.ts). See [`src/adapters/claude-code.ts`](src/adapters/claude-code.ts)
for the reference implementation. PRs welcome.

## Development

```bash
git clone https://github.com/atharva283/rote-cli && cd rote-cli
npm install
npm test                     # builds, then runs the test suite
node dist/cli.js stats       # run against your own transcripts
```

## License

MIT © Atharva
