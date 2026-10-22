import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runLearn } from "../dist/commands/learn.js";
import { scan } from "../dist/engine/scan.js";
import { TURN_USD, makeProject } from "./helpers.mjs";

// Three sessions run the same vitest suite. Two of them burn turns figuring it out first.
const sessions = [
  [
    { prompt: "run the tests" },
    { read: "package.json" },
    { bash: "npm test", ok: false },
    { bash: "cd web && npx vitest run", ok: true },
    { bash: "rm -rf web/dist && npm run build", ok: true },
    { bash: "npx wrangler deploy", ok: true },
  ],
  [
    { prompt: "check tests pass" },
    { bash: "ls" },
    { bash: "cd web && npx vitest run 2>&1 | tail -20", ok: true },
    { bash: "rm -rf web/dist && npm run build", ok: true },
    { bash: "npx wrangler deploy", ok: true },
  ],
  [
    { prompt: "add a feature" },
    { edit: "web/src/a.ts" },
    { bash: "cd web && npx vitest run", ok: false }, // a genuinely failing test...
    { edit: "web/src/a.ts" }, // ...fixed in code, so this is not rediscovery
    { bash: "cd web && npx vitest run", ok: true },
  ],
];

test("scan finds the rediscovered pattern and prices the waste", async () => {
  const { transcripts } = makeProject(sessions);
  const result = await scan({ transcripts });
  assert.equal(result.sessions, 3);

  const vitest = result.patterns.find((p) => p.tool === "vitest run");
  assert.ok(vitest, "vitest pattern found");
  assert.equal(vitest.id, 1);
  assert.equal(vitest.slug, "test-vitest-web");
  assert.equal(vitest.workdir, "web");
  assert.equal(vitest.recipe, "npx vitest run");
  assert.equal(vitest.sessions, 3);
  assert.equal(vitest.runs, 3);
  assert.equal(vitest.rediscoveries, 2);
  // Session 1 wasted the package.json read and the failed `npm test`; session 2 wasted the `ls`.
  assert.equal(vitest.wasteTurns, 3);
  assert.ok(Math.abs(vitest.wasteUSD - 3 * TURN_USD) < 1e-9);
  // Sessions took 3, 2 and 1 turns to get the first working run.
  assert.equal(vitest.avgTurns, 2);
});

test("learn writes a skill and refuses destructive recipes", async () => {
  const { root, transcripts } = makeProject(sessions);
  const log = console.log;
  console.log = () => {};
  try {
    await runLearn(undefined, { transcripts, project: root, dryRun: false, force: false, minSessions: 2 });
  } finally {
    console.log = log;
  }

  const dir = path.join(root, ".claude", "skills", "test-vitest-web");
  const skill = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: test-vitest-web\ndescription: Run the test suite/);
  assert.match(readFileSync(path.join(dir, "run.sh"), "utf8"), /cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/\.\.\/\.\.\/web"\nnpx vitest run "\$@"/);

  // The `rm -rf` that preceded the build is filtered out of the learned recipe.
  const buildScript = readFileSync(path.join(root, ".claude", "skills", "build-npm", "run.sh"), "utf8");
  assert.match(buildScript, /\nnpm run build "\$@"\n$/);
  assert.doesNotMatch(buildScript, /\brm\b/);

  // Deploys are outward-facing, so they never become skills.
  assert.equal(existsSync(path.join(root, ".claude", "skills", "deploy-wrangler")), false);
});
