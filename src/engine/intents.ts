import type { Intent } from "../types.js";

export interface Classified {
  intent: Intent;
  /** Canonical grouping key, e.g. `vitest run` or `npm run build`. */
  signature: string;
  /** Short display name, e.g. `vitest run` or `npm test`. */
  tool: string;
}

export const INTENT_LABEL: Record<Intent, string> = {
  test: "Run tests",
  build: "Build",
  typecheck: "Type-check",
  lint: "Lint",
  format: "Format",
  install: "Install deps",
  dev: "Dev server",
  migrate: "DB migrate",
  script: "Run script",
  deploy: "Deploy",
};

const END = "(?=\\s|$)";
const rule = (intent: Intent, body: string): [Intent, RegExp] => [intent, new RegExp(`^(?:${body})${END}`, "i")];

// Order matters: the first match wins, so specific forms come before general ones.
const RULES: ReadonlyArray<[Intent, RegExp]> = [
  rule("typecheck", "tsc(?=.*\\s--noEmit)|vue-tsc|svelte-check|mypy|pyright|basedpyright|cargo check|go vet|flow check"),
  rule(
    "test",
    "vitest(?: run)?|jest|mocha|ava|tap|karma start|cypress run|playwright test|pytest|py\\.test|unittest|nose2|tox|nox|" +
      "rspec|phpunit|deno test|bun test|go test|cargo (?:test|nextest run)|dotnet test|swift test|mix test|ctest|" +
      "gradlew? test|mvn(?: -\\S+)* test",
  ),
  rule("format", "prettier(?=.*\\s--write)|ruff format|black|isort|gofmt|go fmt|cargo fmt|biome format|dprint fmt"),
  rule(
    "lint",
    "eslint|oxlint|biome (?:lint|check|ci)|ruff check|ruff(?! format)|flake8|pylint|golangci-lint(?: run)?|cargo clippy|" +
      "rubocop|stylelint|shellcheck|markdownlint|prettier(?=.*\\s(?:--check|-c)(?:\\s|$))",
  ),
  rule(
    "install",
    "npm ci|pip3? install(?= -r| -e| \\.)|uv sync|uv pip install(?= -r| -e)|poetry install|pipenv install|pdm install|" +
      "bundle install|go mod (?:download|tidy)|cargo fetch|composer install",
  ),
  rule(
    "migrate",
    "prisma (?:migrate \\w+|generate|db push)|drizzle-kit \\w+|alembic upgrade|knex migrate:\\w+|sequelize db:migrate|" +
      "rails db:migrate|wrangler d1 migrations apply|supabase (?:db|migration) \\w+",
  ),
  rule(
    "deploy",
    "wrangler (?:deploy|publish|pages deploy)|vercel|netlify deploy|firebase deploy|fly(?:ctl)? deploy|railway up|" +
      "gcloud (?:app|run) deploy|serverless deploy|sls deploy|cdk deploy|terraform apply|pulumi up|kubectl apply|" +
      "helm (?:install|upgrade)|gh-pages",
  ),
  rule(
    "build",
    "tsc|vite build|next build|nuxt (?:build|generate)|astro build|webpack|rollup|esbuild|tsup|parcel build|" +
      "turbo (?:run )?build|nx (?:run )?build|cargo build|go build|cmake --build|dotnet build|docker build|" +
      "docker[ -]compose build|gradlew? (?:build|assemble)|mvn(?: -\\S+)* (?:package|compile|install|verify)|hugo|" +
      "jekyll build|build|pyinstaller|wasm-pack build",
  ),
  rule(
    "dev",
    "vite(?: dev| serve| preview)?|next (?:dev|start)|nuxt dev|astro (?:dev|preview)|wrangler (?:pages )?dev|uvicorn|" +
      "gunicorn|flask run|fastapi (?:dev|run)|rails (?:s|server)|hugo server|streamlit run|docker[ -]compose up|" +
      "http\\.server|http-server|serve",
  ),
];

const PACKAGE_MANAGERS = /^(npm|pnpm|yarn|bun)$/;
const PM_BUILTINS = new Set([
  "add", "remove", "rm", "uninstall", "why", "outdated", "init", "create", "pack", "link", "unlink", "config", "cache",
  "audit", "update", "upgrade", "up", "version", "view", "info", "ls", "list", "help", "login", "logout", "whoami",
  "global", "dedupe", "prune", "patch", "store", "import", "set", "get", "exec", "dlx", "x", "run", "run-script",
]);
const SCRIPT_FILE = /\.(py|m?js|cjs|ts|mts|sh|bash|ps1|rb|php|pl|r)$/i;
const INTERPRETERS = /^(python[\d.]*|py|node|tsx|ts-node|bun|deno|bash|sh|zsh|pwsh|powershell|rscript|ruby|php|perl)$/i;

/** Classifies a launcher-stripped command (see `coreTokens`). */
export function classify(core: readonly string[]): Classified | null {
  const p = core[0];
  if (!p) return null;
  if (PACKAGE_MANAGERS.test(p)) return classifyPackageManager(core);
  if (/^(make|just|task)$/.test(p)) {
    const target = core.slice(1).find((t) => !t.startsWith("-") && !t.includes("="));
    const signature = target ? `${p} ${target}` : p;
    return { intent: target ? scriptIntent(target) : "build", signature, tool: signature };
  }
  const line = core.join(" ");
  for (const [intent, re] of RULES) {
    const m = re.exec(line);
    if (m) return { intent, signature: m[0], tool: m[0] };
  }
  return classifyScript(core);
}

function classifyPackageManager(core: readonly string[]): Classified | null {
  const pm = core[0]!;
  const a1 = core[1];
  if (!a1) return pm === "yarn" ? { intent: "install", signature: "yarn install", tool: "yarn" } : null;
  if (/^(install|i|ci)$/.test(a1)) {
    // Installing named packages changes the project; only the bare form is a repeatable recipe.
    if (core.slice(2).some((t) => !t.startsWith("-"))) return null;
    const sig = `${pm} ${a1 === "ci" ? "ci" : "install"}`;
    return { intent: "install", signature: sig, tool: sig };
  }
  if (a1 === "publish") return { intent: "deploy", signature: `${pm} publish`, tool: `${pm} publish` };

  let script: string | undefined;
  if (a1 === "run" || a1 === "run-script") script = core[2];
  else if (/^(test|t|tst)$/.test(a1)) script = "test";
  else if (/^(start|stop|restart)$/.test(a1)) script = a1;
  else if (pm !== "npm" && !PM_BUILTINS.has(a1) && !a1.startsWith("-")) script = a1;
  if (!script || script.startsWith("-")) return null;

  const builtin = script === "test" || script === "start";
  return {
    intent: scriptIntent(script),
    signature: `${pm} run ${script}`,
    tool: builtin ? `${pm} ${script}` : `${pm} run ${script}`,
  };
}

function classifyScript(core: readonly string[]): Classified | null {
  const p = core[0]!;
  let file: string | undefined;
  let rest: readonly string[] = [];
  if (INTERPRETERS.test(p)) {
    const args = core[1] === "run" && /^(deno|bun)$/.test(p) ? core.slice(2) : core.slice(1);
    const i = args.findIndex((t) => !t.startsWith("-"));
    file = args[i];
    rest = args.slice(i + 1);
  } else if (SCRIPT_FILE.test(p) && /[/.]/.test(p)) {
    file = p;
    rest = core.slice(1);
  }
  if (!file || !SCRIPT_FILE.test(file)) return null;

  const rel = file.replace(/\\/g, "/").replace(/^\.\//, "");
  const base = rel.split("/").pop()!;
  const signature = INTERPRETERS.test(p) ? `${p} ${rel}` : rel;
  if (base === "manage.py") {
    const sub = rest[0] ?? "";
    const intent: Intent =
      sub === "runserver" ? "dev" : /^(migrate|makemigrations)$/.test(sub) ? "migrate" : sub === "test" ? "test" : "script";
    return { intent, signature: `${signature} ${sub}`.trim(), tool: `manage.py ${sub}`.trim() };
  }
  return { intent: scriptIntent(base.replace(SCRIPT_FILE, "")), signature, tool: base };
}

/** Maps a script or target name (`test:e2e`, `build`, `typecheck`) to an intent. */
export function scriptIntent(name: string): Intent {
  const n = name.toLowerCase();
  if (/^(typecheck|type-check|check-types|types|tsc)\b|^check:types/.test(n)) return "typecheck";
  if (/^(tests?|spec|e2e|vitest|jest|pytest)\b|(^|[:_-])tests?\b/.test(n)) return "test";
  if (/^lint/.test(n)) return "lint";
  if (/^(format|fmt|prettier)/.test(n)) return "format";
  if (/^(build|compile|bundle|dist)/.test(n)) return "build";
  if (/^(dev|start|serve|preview|watch)/.test(n)) return "dev";
  if (/^(migrate|db[:_-])/.test(n)) return "migrate";
  if (/^(deploy|release|publish)/.test(n)) return "deploy";
  return "script";
}

/** Build/test configuration and docs an agent reads to work out how to run things. */
export const CONFIG_FILE =
  /(^|[/\\])(package\.json|pnpm-workspace\.yaml|tsconfig[^/\\]*\.json|jsconfig\.json|deno\.jsonc?|bunfig\.toml|(vite|vitest|jest|playwright|cypress|webpack|rollup|next|nuxt|astro|svelte|turbo|nx|wrangler|karma|babel|eslint|prettier)[^/\\]*\.(c|m)?(js|ts|json|jsonc|toml|ya?ml)|\.eslintrc[^/\\]*|\.prettierrc[^/\\]*|pyproject\.toml|setup\.(py|cfg)|tox\.ini|pytest\.ini|noxfile\.py|conftest\.py|requirements[^/\\]*\.txt|Pipfile|Makefile|makefile|GNUmakefile|[Jj]ustfile|Taskfile\.ya?ml|Cargo\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|Dockerfile|(docker-)?compose[^/\\]*\.ya?ml|README(\.md)?|CONTRIBUTING\.md|CLAUDE\.md|AGENTS\.md|\.nvmrc|\.node-version|\.python-version|\.tool-versions|\.env\.example)$|\.github[/\\]workflows/i;

/** Paths and globs that point at tests, which agents search for before running them. */
export const TEST_PATH = /\.(test|spec)\.|(^|[/\\*])(tests?|__tests__|spec|e2e)([/\\*]|$)|conftest\.py|_test\.(go|py)$/i;

const ALWAYS_DISCOVERY =
  /^(ls|ll|la|dir|tree|pwd|which|where|whereis|realpath|find|fd|Get-ChildItem|gci|Get-Location|Test-Path|Get-Command|gcm)$/i;
// Reading or searching file contents is only orientation when the file is build/test config;
// grepping source or test files is the agent working on the code.
const FILE_READERS = /^(cat|type|head|tail|less|more|bat|jq|grep|rg|Get-Content|gc|Select-String|sls)$/i;

/** True for commands that look around rather than do work (listings, `--help`, reading config). */
export function isDiscovery(core: readonly string[]): boolean {
  const p = core[0];
  if (!p) return false;
  if (ALWAYS_DISCOVERY.test(p)) return true;
  if (core.includes("--help") || core.includes("--version")) return true;
  if (core.length === 2 && /^-(v|V|h)$/.test(core[1]!)) return true;
  if (PACKAGE_MANAGERS.test(p) && ((core[1] === "run" && core.length === 2) || /^(ls|list|config)$/.test(core[1] ?? ""))) {
    return true;
  }
  if (/^pip3?$/.test(p) && /^(list|show|freeze)$/.test(core[1] ?? "")) return true;
  if (FILE_READERS.test(p)) return core.slice(1).some((t) => CONFIG_FILE.test(t));
  return false;
}
