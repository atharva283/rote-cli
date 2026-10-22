<div align="center">

# ◆ rote · The Guide

**Everything you need to use `rote-cli`, from your first command to your first learned skill.**

[What rote is](#-what-rote-is) ·
[Quickstart](#-quickstart) ·
[Key ideas](#-key-ideas) ·
[Commands](#-command-reference) ·
[Your first 5 minutes](#-your-first-5-minutes) ·
[Skills](#-what-a-learned-skill-looks-like) ·
[Safety](#-safety-rules) ·
[FAQ](#-faq) ·
[Troubleshooting](#-troubleshooting)

</div>

---

## ◆ What rote is

Coding agents like Claude Code start every session with no memory of the last one. So when
you ask one to "run the tests", it often works out the answer again from scratch:

```
read package.json → try npm test → ✗ fails → read apps/web/package.json → cd apps/web && npx vitest run → ✓
```

That's four turns, and **you pay for each of them**. Each turn re-sends the whole conversation
to the model, so a short detour on a big project costs real tokens. The next session goes
through the same steps again.

**rote** fixes this in two steps:

1. **It measures.** It reads the session logs your agent already saves on your computer and
   finds commands that eventually worked in several sessions. For each one, it adds up what
   the agent spent exploring and retrying before it got there.
2. **It remembers.** It turns the command that worked into a small **skill**, a Markdown note
   plus a script inside your project. Next time, the agent runs it in one step, with no
   exploring.

> [!IMPORTANT]
> **rote is 100% local.** It reads log files on your disk and prints results to your terminal.
> It makes **no network calls**, needs **no API key**, has **no account or telemetry**, and
> works **offline**. It never runs the commands it finds.

What rote is *not*:

- It doesn't call any AI model. It's a plain parser and calculator.
- It doesn't change how your agent works. It adds skill files, which the agent can use or ignore.
- It doesn't guess. Every number links back to real turns you can inspect with [`rote show`](#rote-show).

---

## ◆ Quickstart

### Requirements

| Requirement | Details |
| --- | --- |
| **Node.js** | Version **18.17 or newer**. Check with `node --version`. |
| **An agent with saved transcripts** | **Claude Code** today. Other agents are [planned](#which-agents-are-supported). |
| **Operating system** | macOS, Linux, or Windows (Claude Code sessions using bash or PowerShell). |
| **API keys / accounts** | **None.** |

### Run it without installing

```bash
npx rote-cli stats
```

`npx` downloads rote into a temporary cache and runs it. Nothing is installed globally.

### Or install it globally

```bash
npm install -g rote-cli
rote stats
```

A global install gives you the shorter `rote` command. Every example in this guide works both
ways: `rote stats` and `npx rote-cli stats` do the same thing.

> [!TIP]
> Running `rote` with no command is the same as `rote stats`.

### Where rote looks for transcripts

rote reads **Claude Code** session transcripts. You don't need to configure anything.

| Platform | Default location |
| --- | --- |
| macOS / Linux | `~/.claude/projects/` |
| Windows | `%USERPROFILE%\.claude\projects\` |

Claude Code saves one folder per project and one `.jsonl` file per session. rote also reads
subagent transcripts (`<session>/subagents/*.jsonl`).

To look somewhere else, use either of these:

- set `CLAUDE_CONFIG_DIR`, the same variable Claude Code uses (rote reads `$CLAUDE_CONFIG_DIR/projects`)
- pass `--transcripts <dir>` to any command

### No history yet? Use the sample data

The repository includes synthetic transcripts for three made-up projects, so you can try every
command right away:

```bash
git clone https://github.com/atharva283/rote-cli && cd rote-cli
npm install && npm run build
node dist/cli.js stats --transcripts examples/transcripts
```

> [!NOTE]
> **All sample output in this guide comes from those sample transcripts**, so your numbers will
> be different. The sample data is made up and only shows how rote works.

---

## ◆ Key ideas

Five terms come up throughout the guide:

| Term | Meaning |
| --- | --- |
| **Pattern** | A command your agent got working in **2 or more sessions** of the same project, like `cd apps/web && npx vitest run`. The 2-session minimum can be changed with `--min`. |
| **Rediscovery** | A time when the agent explored (listing folders, reading `package.json`, running `--help`) or retried failed attempts **right before** that command worked. |
| **Waste** | The cost of every turn in a rediscovery **except the last, working one**. Even with a skill, the agent still needs one turn to run it. |
| **Recipe** | The cleaned-up command rote would save: the most common working form, with noise like `2>&1` or `\| tail -20` removed. |
| **Skill** | What `rote learn` writes: `.claude/skills/<slug>/SKILL.md` plus a `run.sh` (or `run.ps1`). |

### Numbers vs. slugs

Every pattern has two names. You can use either one with `show` and `learn`:

| Name | Example | Stable? |
| --- | --- | --- |
| **Number** | `1`, `2`, `3` | **No.** It's the pattern's position in the list you're looking at, and the list changes as your history grows and with the scope (all projects vs. one). |
| **Slug** | `test-vitest-web` | **Yes.** It's built from what the command does, which tool it uses and its folder. It also becomes the skill's folder name. |

> [!WARNING]
> The same pattern can have **different numbers** in `rote stats` (every project) and
> `rote stats .` (one project). In the sample data, `pytest` is `#2` across all projects but
> `#1` inside `billing-api`. Use the **slug** in scripts and docs.

---

## ◆ Command reference

| Command | What it does | Writes files? |
| --- | --- | --- |
| [`rote stats`](#rote-stats) | Lists the commands your agent keeps rediscovering, and what that costs | No |
| [`rote show`](#rote-show) | Shows the evidence behind one pattern, turn by turn | No |
| [`rote learn`](#rote-learn) | Turns patterns into skills your agent can run in one step | Yes, only in `.claude/skills/` |
| [`rote help`](#rote-help) | Prints usage | No |

---

### `rote stats`

**Purpose:** Scans your transcripts and ranks the commands your agent paid to work out again
and again, most expensive first.

```
rote stats [project-path] [--limit <n>] [--all] [--min <n>] [--json] [--transcripts <dir>]
```

#### Examples

```bash
# Beginner: every project on this machine
rote stats

# Just the project you're in
rote stats .

# A specific project, or a parent folder (includes every project under it)
rote stats ~/code/acme-storefront
rote stats ~/code

# Show more rows, including commands the agent always got right first time
rote stats --limit 25 --all

# Only count patterns seen in 3+ sessions
rote stats --min 3

# Machine-readable output for scripts and dashboards
rote stats --json > rote-report.json
```

#### Sample output

```
  ◆ rote  muscle memory for coding agents
  Scanned 16 Claude Code sessions · 418 turns · 3 projects in 0.03s

     #  PATTERN                               PROJECT            SEEN  AVG TURNS   TOKENS     WASTED
     1  Run tests   vitest run · apps/web/    acme-storefront      6×        3.3     1.8M      $0.93
     2  Run tests   pytest                    billing-api          5×        2.8     1.1M      $0.60
     3  Type-check  tsc                       acme-storefront      3×        2.7     711k      $0.35
     4  Dev server  uvicorn                   billing-api          2×        2.5     322k      $0.15
     5  Lint        make lint                 edge-gateway         3×        2.0     330k      $0.12

  ────────────────────────────────────────────────────────────────────────────────────────────────
  $2.15  spent figuring out commands your agent had already gotten working before
         17 rediscoveries · 4.3M tokens · 15m of agent time · 9.4% of $22.99 total agent spend

  → rote learn 1   teach it once; next time it takes one call and no exploring
  → rote show 1    see the sessions behind a pattern

  Costs are API-equivalent at list prices. Waste only counts turns spent exploring or retrying
  right before a command worked, so the real number is likely higher.
```

#### Reading the table

| Column | Meaning |
| --- | --- |
| `#` | The pattern's number in this list. A green **`✓`** (e.g. `1✓`) means you've already learned it. |
| `PATTERN` | What the command is for (*Run tests*, *Build*, *Type-check*, *Lint*, *Format*, *Install deps*, *Dev server*, *DB migrate*, *Run script*, *Deploy*), the tool it uses, and the subfolder it runs in, if any. |
| `PROJECT` | The project the sessions belong to. |
| `SEEN` | How many sessions ran this command successfully. |
| `AVG TURNS` | Average turns per session up to and including the first working run. `1.0` means the agent got it right immediately. |
| `TOKENS` | Tokens spent on wasted turns. |
| `WASTED` | What those wasted turns cost, at API list prices. Wider terminals also show a bar chart. |

The summary line adds everything up: total waste, number of rediscoveries, agent time spent,
and the share of your total agent spend.

#### Options

| Option | Default | What it does |
| --- | --- | --- |
| `[project-path]` | *(all projects)* | Only scan projects at, inside, or under this path. `.` means the current folder. (`--project <path>` does the same.) |
| `--limit <n>` | `10` | Show at most `n` rows. A `… N more` line tells you if rows were hidden. |
| `--all` | off | Also list patterns with **no** waste (the agent got them right first time). |
| `--min <n>` | `2` | Minimum number of sessions before a command counts as a pattern. `--min 1` includes one-off commands. |
| `--json` | off | Print JSON instead of a table (colors are turned off). |
| `--transcripts <dir>` | `~/.claude/projects` | Read transcripts from another folder. |
| `--no-color` | off | Plain text output. |

<details>
<summary><b>JSON output format</b> (click to expand)</summary>

`--json` includes **every** pattern that passes `--min`, including zero-waste ones; it ignores
`--limit` and `--all`. Secrets in recipes are masked (`API_TOKEN=***`).

```json
{
  "agents": ["Claude Code"],
  "sessions": 16,
  "turns": 418,
  "projects": [{ "name": "acme-storefront", "root": "/home/dev/acme-storefront", "agent": "claude-code" }],
  "totalUSD": 22.99,
  "totalTokens": 35225600,
  "wastedUSD": 2.15,
  "elapsedMs": 34,
  "patterns": [
    {
      "id": 1,
      "slug": "test-vitest-web",
      "project": "acme-storefront",
      "projectRoot": "/home/dev/acme-storefront",
      "intent": "test",
      "tool": "vitest run",
      "workdir": "apps/web",
      "recipe": "npx vitest run",
      "sessions": 6,
      "runs": 7,
      "rediscoveries": 6,
      "avgTurns": 3.33,
      "wasteTurns": 14,
      "wasteTokens": 1834362,
      "wasteUSD": 0.9305,
      "wasteMs": 379000,
      "firstSeen": "2026-09-02T03:11:44.000Z",
      "lastSeen": "2026-09-08T01:34:36.000Z",
      "learned": false
    }
  ]
}
```

`intent` is one of `test`, `build`, `typecheck`, `lint`, `format`, `install`, `dev`, `migrate`,
`script`, `deploy`.

</details>

#### When to use it

- **First time with rote.** See where your agent's money goes.
- **After a busy week.** Check whether new patterns showed up.
- **Before onboarding a teammate.** The top rows are exactly the commands a newcomer (human or
  agent) would have to work out.
- **In a script or CI job.** Use `--json` to track waste over time.

---

### `rote show`

**Purpose:** Shows exactly which sessions and turns rote counted for one pattern, so you can
check the numbers yourself.

```
rote show <id> [--project <path>] [--min <n>] [--transcripts <dir>]
```

`<id>` is a pattern **number** from `rote stats` or its **slug**.

#### Examples

```bash
# Beginner: the top pattern from `rote stats`
rote show 1

# By slug (stays the same even as rankings change)
rote show test-vitest-web

# Number taken from a project-scoped list (`rote stats ~/code/billing-api`)
rote show 1 --project ~/code/billing-api
```

#### Sample output

```
  #1 Run tests  vitest run  acme-storefront · apps/web/
  6 sessions · 7 successful runs · 6 rediscoveries · $0.93 wasted · slug test-vitest-web

  2026-09-05  acme0003  4 turns  $0.26
     · Read package.json
     · Read turbo.json
     ✗ npm run test
     ✓ cd apps/web && npx vitest run

  2026-09-02  acme0000  4 turns  $0.20
     · Read package.json
     ✗ npm test
     · Read apps/web/package.json
     ✓ cd apps/web && npx vitest run

  2026-09-02  acme0001  4 turns  $0.16
     ✓ ls
     ✗ npx vitest run
     ✗ cd apps/web && npx vitest
     ✓ cd apps/web && npx vitest run 2>&1 | tail -30
  …

  Recipe (runs in apps/web/)
     npx vitest run

  → rote learn 1  writes .claude/skills/test-vitest-web/
```

#### Reading the output

| Element | Meaning |
| --- | --- |
| Header | The pattern, project, totals, and **slug**. |
| `2026-09-05  acme0003  4 turns  $0.26` | One rediscovery: its date, the first 8 characters of the session ID, how many turns it took, and the cost of the wasted ones. `(subagent)` marks a subagent session. |
| `✓` / `✗` / `?` | A shell command that succeeded, failed, or has an unknown result (timed out or blocked by a permission prompt). |
| `·` | A non-shell step, like reading a file. |
| `Recipe` | The command that `learn` would save, and the folder it runs in. |
| Last line | Either the `learn` command to run, or `✗ Not learnable: <reason>` if the [safety rules](#-safety-rules) block it. |

Rediscoveries are sorted by cost, and the 8 most expensive are shown. If the agent always got
the command right first time, rote says so.

#### When to use it

- **Before learning a pattern.** Check that the recipe is really what you want saved.
- **When a number looks wrong.** See exactly which turns were counted.
- **To spot problems in your docs.** If agents keep reading `README.md` and still failing, your
  README is probably missing the command.

---

### `rote learn`

**Purpose:** Turns patterns into **skills**, so your agent runs the working command right away
instead of exploring.

```
rote learn [id] [--dry-run] [--force] [--project <path>] [--min <n>] [--transcripts <dir>]
```

| Form | What it learns |
| --- | --- |
| `rote learn <id>` | One pattern, by number (from the `rote stats` list) or slug. |
| `rote learn` | **Every** safe pattern in the **current project**, including ones with zero waste. Skips patterns that are already learned. |
| `rote learn --project <path>` | Every safe pattern in that project. |

#### Examples

```bash
# Beginner: preview first, then write
rote learn 1 --dry-run
rote learn 1

# By slug
rote learn test-vitest-web

# Learn everything for the project you're in
cd ~/code/billing-api && rote learn

# Rebuild a skill after your setup changed (e.g. you switched from npm to pnpm)
rote learn test-vitest-web --force
```

#### Sample output

**Preview** (`--dry-run` prints every file and writes nothing):

```
  #2 Run tests pytest billing-api
     would write .claude/skills/test-pytest/SKILL.md
     │ ---
     │ name: test-pytest
     │ description: Run the test suite for this project (`uv run pytest -q`). Use this instead of reading package.json, configs or docs to work out the command: it is the verified command from 5 past sessions.
     │ ---
     │ …
     would write .claude/skills/test-pytest/run.sh
     │ #!/usr/bin/env bash
     │ # Learned by rote from 5 sessions. Re-learn: npx rote-cli learn test-pytest --force
     │ set -euo pipefail
     │ cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
     │ uv run pytest -q "$@"
     │
     saves about $0.12 and 1.8 turns per session

  Dry run: nothing was written.
```

**Learning it:**

```
  #2 Run tests pytest billing-api
     ✓ wrote .claude/skills/test-pytest/SKILL.md
     ✓ wrote .claude/skills/test-pytest/run.sh
     saves about $0.12 and 1.8 turns per session

  ✓ Learned 1 skill. Claude Code picks them up in new sessions.
```

**Running it again** (rote never overwrites without `--force`):

```
  #2 Run tests pytest billing-api
     • already learned (.claude/skills/test-pytest, use --force to overwrite)
```

**Blocked by the safety rules** (secrets are masked in the output):

```
  #1 Run script npm run seed:reset shop
     ✗ skipped recipe runs a reset/clean script: npm run seed:reset

  #2 Deploy wrangler deploy shop
     ✗ skipped recipe deploys to an outside service: npx wrangler deploy

  #3 Run script npm run sync shop
     ✗ skipped recipe contains what looks like a secret: API_TOKEN=*** npm run sync

  Nothing was written.
```

#### Options

| Option | What it does |
| --- | --- |
| `[id]` | Pattern number or slug. Leave it out to learn every safe pattern in the current project. |
| `--dry-run` | Print the files rote would write, without writing anything. |
| `--force` | Overwrite a skill that already exists. |
| `--project <path>` | Which project to use. With an `id`, numbers then refer to that project's list. |
| `--min <n>` | Minimum sessions for a pattern (default `2`). |
| `--transcripts <dir>` | Read transcripts from another folder. |

> [!NOTE]
> Skills are written into the **project the sessions came from**, the folder recorded in the
> transcripts, not the folder you run `rote` from. Worktrees under `.claude/worktrees/` are
> mapped back to the main checkout.

#### When to use it

- **Right after `rote stats`** shows a pattern with real waste.
- **When you set up a new repo for agents.** Plain `rote learn` saves all its known commands at once.
- **After changing your toolchain.** Use `--force` to replace outdated recipes.

---

### `rote help`

Prints usage. `--version` prints the version number.

```bash
rote --help        # or: rote -h, rote help
rote --version     # or: rote -v
```

```
  ◆ rote v0.1.0  muscle memory for coding agents

  Usage
    rote stats [project-path]        what your agent keeps paying to rediscover
    rote show <id>                   the sessions behind one pattern
    rote learn [id] [--dry-run]      compile patterns into one-call agent skills
  …
```

---

### All options at a glance

| Option | `stats` | `show` | `learn` | Notes |
| --- | :---: | :---: | :---: | --- |
| `[project-path]` | ✅ | | | Positional. Same as `--project`. |
| `--project <path>` | ✅ | ✅ | ✅ | Limit to one project (or every project under a folder). |
| `--limit <n>` | ✅ | | | Rows to show. Default `10`. |
| `--all` | ✅ | | | Include zero-waste patterns. |
| `--min <n>` | ✅ | ✅ | ✅ | Sessions needed to count as a pattern. Default `2`. **Changes numbering.** |
| `--json` | ✅ | | | Machine-readable output. |
| `--dry-run` | | | ✅ | Preview without writing. |
| `--force` | | | ✅ | Overwrite existing skills. |
| `--transcripts <dir>` | ✅ | ✅ | ✅ | Custom transcript folder. |
| `--no-color` | ✅ | ✅ | ✅ | Plain output. |
| `-h`, `--help` | ✅ | ✅ | ✅ | Usage. |
| `-v`, `--version` | ✅ | ✅ | ✅ | Version number. |

> [!TIP]
> Numbers depend on the scope and on `--min`. If you ran `rote stats . --min 3`, pass the same
> scope and `--min 3` to `show` and `learn`, or use the slug.

### Environment variables

| Variable | Effect |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Where Claude Code keeps its data. rote reads `$CLAUDE_CONFIG_DIR/projects`. |
| `NO_COLOR` | Any value turns colors off ([no-color.org](https://no-color.org)). |
| `FORCE_COLOR` | Keep colors on when the output isn't a terminal (e.g. piping to `less -R`). |
| `COLUMNS` | Table width when the output isn't a terminal. |

### Exit codes and errors

rote exits with **`0`** on success, including when it finds nothing, and with **`1`** on errors.
Errors are a single line starting with `rote:`.

| Message | Cause | Fix |
| --- | --- | --- |
| `No pattern #99. Run rote stats to see the list.` | That number isn't in the current list. | Re-run `rote stats` with the same scope/`--min`, or use the slug. |
| `No pattern named "x".` | Unknown slug. | Copy the slug from `rote show <n>`. |
| `"test-npm" exists in several projects (…)` | Two projects have a pattern with the same slug. | Run the command inside the project, or use the number. |
| `No transcripts for this directory…` | `rote learn` with no id, outside any project rote knows. | `cd` into the project, pass `--project`, or give an id. |
| `Usage: rote show <id>` | `show` needs an id. | `rote show 1` |
| `--limit must be a positive whole number` | Bad value for `--limit`/`--min`. | Use `1`, `2`, `3`, … |
| `Unknown command "x"` | Typo. | `rote --help` |

---

## ◆ Your first 5 minutes

A walkthrough on the sample data. With your own history, just leave out `--transcripts`.

### Step 1: Find the waste with `stats`

```bash
rote stats
```

```
     #  PATTERN                               PROJECT            SEEN  AVG TURNS   TOKENS     WASTED
     1  Run tests   vitest run · apps/web/    acme-storefront      6×        3.3     1.8M      $0.93
     2  Run tests   pytest                    billing-api          5×        2.8     1.1M      $0.60
     …
  $2.15  spent figuring out commands your agent had already gotten working before
```

Pattern #1 stands out. In 6 sessions, the agent needed **3.3 turns on average** to get the
`acme-storefront` tests running, when 1 turn should be enough.

Check the evidence before you act on it:

```bash
rote show 1
```

```
  2026-09-02  acme0000  4 turns  $0.20
     · Read package.json
     ✗ npm test
     · Read apps/web/package.json
     ✓ cd apps/web && npx vitest run
```

That confirms it: the agent keeps trying `npm test` at the repo root, but the tests live in
`apps/web/` and run with `npx vitest run`.

### Step 2: Learn it with `learn`

Preview first, then write:

```bash
rote learn 1 --dry-run
rote learn 1
```

```
  #1 Run tests vitest run acme-storefront
     ✓ wrote .claude/skills/test-vitest-web/SKILL.md
     ✓ wrote .claude/skills/test-vitest-web/run.sh
     saves about $0.16 and 2.3 turns per session

  ✓ Learned 1 skill. Claude Code picks them up in new sessions.
```

### Step 3: Check it, then let your agent use it

**1. Run the script yourself.** It should do exactly what the agent would do:

```bash
cd ~/code/acme-storefront
bash .claude/skills/test-vitest-web/run.sh                     # runs: cd apps/web && npx vitest run
bash .claude/skills/test-vitest-web/run.sh src/cart.test.ts    # extra arguments are passed through
```

**2. Start a new agent session.** Claude Code loads skills from `.claude/skills/` when a session
starts, and the skill's description tells the agent to use it instead of exploring. Ask
*"run the tests"*. The agent should now go straight to the skill, in one turn with no
exploring.

**3. Confirm it in `stats`.** Learned patterns get a green `✓`:

```
     #  PATTERN                               PROJECT            SEEN  AVG TURNS   TOKENS     WASTED
    1✓  Run tests   vitest run · apps/web/    acme-storefront      6×        3.3     1.8M      $0.93
```

> [!NOTE]
> The totals include sessions from **before** you learned the skill, so the number doesn't
> drop to zero. Use `rote show <id>` later to confirm that no new rediscoveries appear after
> that date.

**4. Commit the skill**, so every teammate's agent gets it too:

```bash
git add .claude/skills/test-vitest-web && git commit -m "chore: add learned test skill"
```

---

## ◆ What a learned skill looks like

```
<your-project>/
└── .claude/
    └── skills/
        └── test-vitest-web/
            ├── SKILL.md   ← tells the agent what this does and when to use it
            └── run.sh     ← the working command (run.ps1 for PowerShell sessions)
```

**`SKILL.md`**

```markdown
---
name: test-vitest-web
description: Run the test suite for this project (`npx vitest run` in apps/web/). Use this instead of reading package.json, configs or docs to work out the command: it is the verified command from 6 past sessions.
---

# Run tests (vitest run)

This is the command that worked in 6 past sessions (7 successful runs, last on 2026-09-08). Run it directly. You don't need to explore the project first.
…
```

**`run.sh`**

```bash
#!/usr/bin/env bash
# Learned by rote from 6 sessions. Re-learn: npx rote-cli learn test-vitest-web --force
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
npx vitest run "$@"
```

- The script always moves to the right folder first, so it works no matter where it's called from.
- Any extra arguments (`"$@"`) are passed to the command, so the agent can run one test file.
- If the sessions used **PowerShell**, rote writes `run.ps1` instead, and `SKILL.md` calls it
  with `powershell -NoProfile -File`.
- Dev-server skills include a note telling the agent to run them in the background.

> [!TIP]
> Skills are plain text, so edit them freely. Add a note about flaky tests or environment
> variables, and the agent will read it. To remove a skill, delete its folder.

---

## ◆ Safety rules

`rote learn` decides what is safe to save. Recipes are checked **before** anything is written:

| Rule | Examples | What happens |
| --- | --- | --- |
| Destructive steps are **filtered out** of a compound command | `rm -rf dist && npm run build` → `npm run build` | Only the safe part is saved. |
| Destructive commands | `rm`, `del`, `Remove-Item`, `git push`, `git reset --hard`, `--force`, `DROP TABLE`, `DELETE FROM`, `sudo`, `kill`, `chmod -R`, `curl … \| sh` | **Refused** |
| Reset / clean scripts | `npm run seed:reset`, `make clean`, `db:drop`, `migrate:fresh` | **Refused** |
| Deploys and publishes | `wrangler deploy`, `vercel`, `terraform apply`, `npm publish`, `docker push` | **Refused** (they affect things outside your machine) |
| Secrets | `API_TOKEN=…`, `sk-…`, `ghp_…`, `--password …` | **Refused**, and masked as `***` in all output |

What rote **never** does:

- run any command it finds (it only reads logs and writes text files)
- write outside `<project>/.claude/skills/<slug>/`
- overwrite an existing skill unless you pass `--force`
- touch your source code, config, or git history

---

## ◆ How the numbers are calculated

- **Cost per turn** uses the token counts recorded in each transcript (input, output, cache
  reads, and 5-minute and 1-hour cache writes), priced at **Anthropic API list prices** for
  the model each turn used. On sessions that weren't resumed, this matches Claude Code's own
  cost record to the cent.
- **A rediscovery window** starts at the first turn that only looked around (directory
  listings, reading build config such as `package.json`, `pyproject.toml`, `Makefile` or CI
  files, `--help`) or retried a failed command of the same kind. It ends at the turn where the
  command worked.
- **Real work ends the window.** Editing a file, reading source code, a new message from you,
  or an unrelated command all stop it. So *test fails → you fix the code → test passes*
  counts as zero waste, because that's normal development.
- **The numbers are a floor.** These rules deliberately undercount. Use `rote show` to inspect
  any of them.

---

## ◆ FAQ

### Does rote send any of my data to the internet?

**No.** rote has no network code: no API calls, no telemetry, no update checks. It reads files
on your disk and prints to your terminal. It works with Wi-Fi off. (`npx` itself contacts the
npm registry to download rote the first time; after a global install, nothing does.)

### Do I need an API key or an account?

**No.** rote doesn't call any AI model. The dollar amounts come from token counts already in
your transcripts.

### Will rote change my project files without asking?

**No.** `stats` and `show` only read. `learn` only writes when you run it, only into
`<project>/.claude/skills/<slug>/`, and never overwrites an existing skill without `--force`.
Use `--dry-run` to see every file first. rote never runs your commands and never touches your
source code or git history.

### Which agents are supported?

| Agent | Reads transcripts | Writes skills |
| --- | :---: | --- |
| **Claude Code** | ✅ | `.claude/skills/` |
| Codex CLI | planned | planned |
| Aider | planned | `CONVENTIONS.md` |
| Cursor | planned | `.cursor/rules/` |

Support for other agents goes through one interface, `ITranscriptAdapter` in
[`src/types.ts`](src/types.ts). Contributions are welcome.

### I have no session history yet. How can I try it?

Use the [sample data](#no-history-yet-use-the-sample-data):

```bash
node dist/cli.js stats --transcripts examples/transcripts
```

On your own machine, patterns appear once the agent has done the same task in **2 or more
sessions** of a project. Use `--min 1` to see commands from a single session.

### I'm on a Claude subscription. Am I really paying these dollars?

Not directly. The figures are **API-equivalent** costs: what those tokens would cost at API
list prices. On a subscription, the same waste uses up your usage limits faster instead.

### My total is tiny. Is something broken?

Probably not, and that's good news. A small number means your agent mostly gets commands
right first time, often because your `CLAUDE.md` or README already documents them. Check
`rote stats --all` to see every repeated command, including the ones with zero waste.

### Why does a pattern show `$0.00`?

The agent ran that command successfully in several sessions without exploring first. These
are hidden by default; `--all` shows them. They can still be learned. A skill makes the
command explicit, which protects you if the setup gets more complex later.

### What happens when my setup changes (new package manager, moved folders)?

The skill's command will start failing, and the agent will notice and explore again. Run
`rote learn <slug> --force` once the new command has worked in a session or two, or just edit
`run.sh` by hand.

### Can I commit the skills to git?

Yes, and you should. Then every teammate's agent gets them. They're short text files.

### Does it work with monorepos and git worktrees?

Yes. rote tracks which subfolder each command ran in (`apps/web/`), and skills move there
before running. Sessions in Claude Code worktrees (`.claude/worktrees/<name>`) are mapped back
to the main project.

### Does it work on Windows?

Yes, with both bash (Git Bash) and PowerShell sessions. Paths like `D:\repo`, `d:/repo` and
`/d/repo` are all handled.

### How do I uninstall it?

```bash
npm uninstall -g rote-cli     # if you installed it globally
```

To remove learned skills, delete their folders under `.claude/skills/`.

---

## ◆ Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `No transcripts found` | No Claude Code history at the default location. | Check `~/.claude/projects/` exists, or set `CLAUDE_CONFIG_DIR` / `--transcripts`. |
| `No agent sessions found for this directory` | You ran `rote stats .` somewhere Claude Code hasn't been used. | Run `rote stats` with no path to see all projects. |
| `No repeated rediscoveries yet` | Your agent got everything right first time, or each task only happened once. | Try `rote stats --all` or `--min 1`. |
| `learn 3` learned a different pattern than you expected | The numbers came from a different scope or `--min`. | Use the slug, e.g. `rote learn test-vitest-web`. |
| Table looks cramped | Narrow terminal. | Widen the window. The bar chart appears at 112+ columns. |
| Colors look broken in logs | ANSI codes in a non-terminal. | Add `--no-color` or set `NO_COLOR=1`. |

---

<div align="center">

**◆ rote**: teach it once, and the agent doesn't have to work it out again.

[README](README.md) · [Report an issue](https://github.com/atharva283/rote-cli/issues) · MIT © Atharva

</div>
