import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "../dist/engine/intents.js";
import { rateFor, turnCost } from "../dist/engine/pricing.js";
import { checkRecipe, redact } from "../dist/engine/safety.js";
import { coreTokens, splitCommand, tokenize } from "../dist/engine/shell.js";
import { foldWorktree, normPath, relativeTo, resolvePath } from "../dist/util/paths.js";

const cls = (cmd) => classify(coreTokens(tokenize(cmd)));

test("splitCommand handles quotes, pipes and redirections", () => {
  const segs = splitCommand(`cd "my app" && npm test 2>&1 | tail -5; echo "a && b"`);
  assert.deepEqual(segs, [
    { text: `cd "my app"`, piped: false },
    { text: "npm test 2>&1", piped: false },
    { text: "tail -5", piped: true },
    { text: `echo "a && b"`, piped: false },
  ]);
});

test("coreTokens strips env vars and launchers", () => {
  assert.deepEqual(coreTokens(tokenize("CI=1 timeout 60 npx -y vitest run")), ["vitest", "run"]);
  assert.deepEqual(coreTokens(tokenize("python -m pytest -q")), ["pytest", "-q"]);
  assert.deepEqual(coreTokens(tokenize(".venv/Scripts/python.exe -m pytest")), ["pytest"]);
  assert.deepEqual(coreTokens(tokenize("uv run pytest tests/")), ["pytest", "tests/"]);
});

test("classify recognises common intents", () => {
  assert.equal(cls("npm test").intent, "test");
  assert.equal(cls("npm run test:e2e").intent, "test");
  assert.deepEqual(cls("pnpm build"), { intent: "build", signature: "pnpm run build", tool: "pnpm run build" });
  assert.equal(cls("npx tsc --noEmit -p .").intent, "typecheck");
  assert.equal(cls("npx tsc -b").intent, "build");
  assert.equal(cls("vite build").intent, "build");
  assert.equal(cls("vite").intent, "dev");
  assert.equal(cls("go test ./...").signature, "go test");
  assert.equal(cls("python manage.py migrate").intent, "migrate");
  assert.equal(cls("./scripts/test.sh --fast").intent, "test");
  assert.equal(cls("python scripts/train.py --epochs 3").intent, "script");
  assert.equal(cls("ruff format .").intent, "format");
  assert.equal(cls("ruff check .").intent, "lint");
  assert.equal(cls("npx wrangler deploy").intent, "deploy");
});

test("classify ignores one-off work", () => {
  assert.equal(cls("npm install lodash"), null);
  assert.equal(cls("git status"), null);
  assert.equal(cls("python -c 'print(1)'"), null);
});

test("checkRecipe blocks destructive and outward-facing commands", () => {
  assert.equal(checkRecipe("npm test", "test").ok, true);
  assert.equal(checkRecipe("rm -rf dist && npm run build", "build").ok, false);
  assert.equal(checkRecipe("git push --force origin main", "script").ok, false);
  assert.equal(checkRecipe("psql -c 'DROP TABLE users'", "script").ok, false);
  assert.equal(checkRecipe("API_KEY=abc123 npm test", "test").ok, false);
  assert.equal(checkRecipe("npx wrangler deploy", "deploy").ok, false);
  assert.equal(checkRecipe("docker run --rm app", "script").ok, true);
  assert.equal(checkRecipe("npm run seed:reset", "script").ok, false);
  assert.equal(checkRecipe("make clean", "build").ok, false);
  assert.equal(checkRecipe("uv run pytest tests/test_reset.py", "test").ok, true);
});

test("redact masks secrets but keeps the command readable", () => {
  assert.equal(redact("API_TOKEN=abc123secret npm run sync"), "API_TOKEN=*** npm run sync");
  assert.equal(redact("curl --token ghp_abcdefghijklmnopqrstuvwxyz0123 x"), "curl --token *** x");
  assert.equal(redact("npm test"), "npm test");
});

test("pricing matches Anthropic list prices", () => {
  assert.equal(rateFor("claude-opus-5-5").output, 20);
  assert.equal(rateFor("claude-sonnet-5-5").input, 2);
  assert.equal(rateFor("claude-haiku-4-5-20251001").input, 1);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 1_000_000 };
  // 1-hour cache writes cost 2x input: $4/MTok on Sonnet 5.5.
  assert.equal(turnCost({ model: "claude-sonnet-5-5", usage }), 4);
});

test("paths normalize across Windows and git-bash styles", () => {
  assert.equal(normPath("/d/repo/", true), "D:/repo");
  assert.equal(normPath("d:\\repo\\sub"), "D:/repo/sub");
  assert.equal(resolvePath("D:/repo", "../other"), "D:/other");
  assert.equal(resolvePath("D:/repo", "/d/repo/web"), "D:/repo/web");
  assert.equal(relativeTo("D:/Repo", "d:/repo/web"), "web");
  assert.equal(relativeTo("/home/a/repo", "/home/a/other"), null);
  assert.equal(foldWorktree("D:/repo/.claude/worktrees/feat-x/web"), "D:/repo/web");
});
