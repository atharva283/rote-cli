#!/usr/bin/env node
// Generates the synthetic Claude Code transcripts in examples/transcripts.
// They are sample data for the demo and for trying rote without your own
// history: three made-up projects whose agents keep rediscovering commands.
//
//   node scripts/sample-transcripts.mjs [outDir] [projectsBase]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Seeded PRNG so the sample data (and the demo) is identical on every run. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Steps: { prompt } | { bash, ok } | { read } | { edit } | { grep }
const read = (f) => ({ read: f });
const edit = (f) => ({ edit: f });
const bash = (cmd, ok = true) => ({ bash: cmd, ok });
const work = (...files) => files.flatMap((f) => [read(f), edit(f)]);

const PROJECTS = [
  {
    name: "acme-storefront",
    ext: "tsx",
    model: "claude-opus-5-5",
    sessions: [
      [{ prompt: "add a discount code field to checkout" }, ...work("apps/web/src/checkout/form.tsx"),
        read("package.json"), bash("npm test", false), read("apps/web/package.json"), bash("cd apps/web && npx vitest run"),
        ...work("apps/web/src/checkout/discount.ts"), bash("cd apps/web && npx vitest run")],
      [{ prompt: "fix the cart total rounding bug" }, ...work("apps/web/src/cart/total.ts"),
        bash("ls"), bash("npx vitest run", false), bash("cd apps/web && npx vitest", false), bash("cd apps/web && npx vitest run 2>&1 | tail -30"),
        read("tsconfig.json"), read("apps/web/tsconfig.json"), bash("npx tsc --noEmit -p apps/web")],
      [{ prompt: "why is the product page slow?" }, read("apps/web/src/product/page.tsx"), ...work("apps/web/src/product/gallery.tsx"),
        bash("npm run build")],
      [{ prompt: "write tests for the coupon parser" }, ...work("apps/web/src/coupons/parse.ts"), edit("apps/web/src/coupons/parse.test.ts"),
        read("package.json"), read("turbo.json"), bash("npm run test", false), bash("cd apps/web && npx vitest run"),
        read("apps/web/tsconfig.json"), bash("npx tsc --noEmit -p apps/web")],
      [{ prompt: "upgrade the date library" }, ...work("apps/web/src/lib/dates.ts", "apps/web/src/orders/list.tsx"),
        read("apps/web/package.json"), bash("cd apps/web && npx vitest run"), bash("npm run build")],
      [{ prompt: "the checkout e2e is flaky, look into it" }, read("apps/web/src/checkout/form.tsx"), ...work("apps/web/src/checkout/submit.ts"),
        bash("find . -name 'vitest.config.*' -not -path '*/node_modules/*'"), bash("npx vitest run", false), bash("cd apps/web && npx vitest run"),
        read("tsconfig.json"), bash("npx tsc --noEmit", false), bash("npx tsc --noEmit -p apps/web")],
      [{ prompt: "add a wishlist button" }, ...work("apps/web/src/product/wishlist.tsx", "apps/web/src/product/page.tsx"),
        bash("npm test", false), read("apps/web/vitest.config.ts"), bash("cd apps/web && npx vitest run"), bash("npm run build")],
    ],
  },
  {
    name: "billing-api",
    ext: "py",
    model: "claude-opus-5-5",
    sessions: [
      [{ prompt: "add proration to plan upgrades" }, ...work("app/billing/proration.py"),
        bash("pytest -q", false), bash("python -m pytest -q", false), read("pyproject.toml"), bash("uv run pytest -q"),
        ...work("app/billing/plans.py"), bash("uv run pytest -q")],
      [{ prompt: "invoices endpoint returns 500 for refunds" }, read("app/api/invoices.py"), ...work("app/billing/refunds.py"),
        read("README.md"), bash("uv run uvicorn app.main:app --reload --port 8000"),
        bash("pytest -q", false), read("pyproject.toml"), bash("uv run pytest -q")],
      [{ prompt: "add an index for invoice lookups" }, ...work("app/models/invoice.py"),
        bash("python -m pytest", false), bash("uv run pytest -q")],
      [{ prompt: "write tests for the tax calculator" }, ...work("app/billing/tax.py"), edit("tests/test_tax.py"),
        read("pyproject.toml"), read("setup.cfg"), bash("pytest tests/test_tax.py", false), bash("uv run pytest -q")],
      [{ prompt: "the webhook handler double-charges on retry" }, ...work("app/webhooks/stripe.py"),
        read("README.md"), read("Makefile"), bash("uv run uvicorn app.main:app --reload --port 8000"),
        bash("uv run pytest -q")],
    ],
  },
  {
    name: "edge-gateway",
    ext: "go",
    model: "claude-sonnet-5-5",
    sessions: [
      [{ prompt: "add rate limiting per API key" }, ...work("internal/ratelimit/limiter.go"), bash("go test ./..."),
        read("Makefile"), bash("make lint")],
      [{ prompt: "support HTTP/3" }, ...work("cmd/gateway/main.go", "internal/server/listen.go"), bash("go test ./..."), bash("go build ./...")],
      [{ prompt: "fix the header casing bug" }, ...work("internal/proxy/headers.go"), bash("go test ./..."),
        bash("golangci-lint run", false), read(".github/workflows/ci.yml"), bash("make lint")],
      [{ prompt: "add request tracing" }, ...work("internal/trace/span.go"), bash("go test ./..."), bash("make lint")],
    ],
  },
];

export function writeSampleTranscripts(outDir, projectsBase = "/home/dev") {
  const rand = mulberry32(2026);
  const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
  rmSync(outDir, { recursive: true, force: true });
  let clock = Date.parse("2026-09-01T09:00:00Z");

  for (const project of PROJECTS) {
    const root = path.posix.join(projectsBase.replace(/\\/g, "/"), project.name);
    const dir = path.join(outDir, root.replace(/[^A-Za-z0-9]/g, "-"));
    mkdirSync(dir, { recursive: true });

    project.sessions.forEach((story, si) => {
      // Real sessions spend most turns on ordinary code work; pad each story with some.
      const steps = story.flatMap((s) =>
        s.prompt
          ? [s, ...Array.from({ length: between(14, 26) }, (_, k) => (k % 3 ? edit : read)(`src/module_${k % 7}.${project.ext}`))]
          : [s],
      );
      clock += between(8, 40) * 3_600_000;
      // The first 8 characters are what `rote show` prints, so keep them unique.
      const sessionId = `${project.name.slice(0, 4)}${String(si).padStart(4, "0")}-0000-4000-8000-000000000000`;
      const lines = [];
      let context = between(18_000, 30_000);
      let n = 0;
      for (const step of steps) {
        clock += between(6, 45) * 1000;
        const timestamp = new Date(clock).toISOString();
        const common = { cwd: root, sessionId, timestamp, version: "2.1.300", gitBranch: "main" };
        if (step.prompt) {
          lines.push({ ...common, type: "user", message: { role: "user", content: step.prompt } });
          continue;
        }
        const id = `toolu_${sessionId.slice(0, 4)}${si}${n}`;
        const [name, input] = step.bash
          ? ["Bash", { command: step.bash, description: "Run command" }]
          : step.read
            ? ["Read", { file_path: `${root}/${step.read}` }]
            : ["Edit", { file_path: `${root}/${step.edit}`, old_string: "…", new_string: "…" }];
        const written = between(1_500, 7_000);
        lines.push({
          ...common,
          type: "assistant",
          message: {
            id: `msg_${sessionId.slice(0, 4)}${si}_${n++}`,
            model: project.model,
            role: "assistant",
            content: [{ type: "tool_use", id, name, input }],
            usage: {
              input_tokens: between(2, 12),
              cache_read_input_tokens: context,
              cache_creation_input_tokens: written,
              cache_creation: { ephemeral_1h_input_tokens: written, ephemeral_5m_input_tokens: 0 },
              output_tokens: between(120, 900),
            },
          },
        });
        context += written;
        const ok = step.ok !== false;
        lines.push({
          ...common,
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: id, is_error: !ok, content: ok ? "ok" : "Exit code 1" }],
          },
          toolUseResult: { stdout: "", stderr: "", interrupted: false },
        });
      }
      writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.resolve(process.argv[2] ?? path.join(here, "..", "examples", "transcripts"));
  writeSampleTranscripts(out, process.argv[3]);
  console.log(`wrote sample transcripts to ${out}`);
}
