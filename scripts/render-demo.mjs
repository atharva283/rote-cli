#!/usr/bin/env node
// Renders assets/demo.svg: an animated terminal recording of `rote stats` and
// `rote learn 1`, run for real against the sample transcripts. No screen
// recorder needed, and GitHub renders the animation inline.
//
//   npm run build && node scripts/render-demo.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSampleTranscripts } from "./sample-transcripts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const COLUMNS = 112;

// Catppuccin Mocha
const THEME = {
  bg: "#1e1e2e",
  bar: "#181825",
  fg: "#cdd6f4",
  prompt: "#a6e3a1",
  31: "#f38ba8",
  32: "#a6e3a1",
  33: "#f9e2af",
  35: "#cba6f7",
  36: "#89dceb",
  90: "#7f849c",
  "38;5;208": "#fab387",
};
const FONT_SIZE = 14;
const LINE = 20;
const CHAR = 8.45;
const PAD_X = 20;
const TOP = 48;

function capture(args, cwd, transcripts) {
  return execFileSync(process.execPath, [path.join(repo, "dist", "cli.js"), ...args, "--transcripts", transcripts], {
    cwd,
    env: { ...process.env, FORCE_COLOR: "1", COLUMNS: String(COLUMNS), NO_COLOR: "" },
    encoding: "utf8",
  })
    .replace(/in \d+\.\d+s/, "in 0.04s") // keep the demo byte-for-byte stable
    .replace(/\n+$/, "")
    .split("\n");
}

/** Splits a line with ANSI escapes into styled runs. */
function parseAnsi(line) {
  const runs = [];
  const state = { bold: false, dim: false, fg: null };
  let last = 0;
  const re = /\x1b\[([0-9;]*)m/g;
  const push = (text) => text && runs.push({ text, ...state });
  for (let m; (m = re.exec(line)); ) {
    push(line.slice(last, m.index));
    last = re.lastIndex;
    const code = m[1];
    if (code === "1") state.bold = true;
    else if (code === "2") state.dim = true;
    else if (code === "22") state.bold = state.dim = false;
    else if (code === "39") state.fg = null;
    else if (THEME[code]) state.fg = code;
  }
  push(line.slice(last));
  return runs;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function lineSvg(runs, row, cls) {
  if (!runs.length) return "";
  const spans = runs
    .map((r) => {
      const attrs = [];
      if (r.fg) attrs.push(`fill="${THEME[r.fg]}"`);
      if (r.bold) attrs.push(`font-weight="700"`);
      if (r.dim) attrs.push(`fill-opacity="0.6"`);
      return `<tspan ${attrs.join(" ")}>${esc(r.text)}</tspan>`;
    })
    .join("");
  return `<text class="${cls}" x="${PAD_X}" y="${TOP + row * LINE}">${spans}</text>`;
}

function main() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "rote-demo-"));
  try {
    const transcripts = path.join(tmp, "transcripts");
    writeSampleTranscripts(transcripts, path.join(tmp, "home"));
    const stats = capture(["stats"], tmp, transcripts);
    const learn = capture(["learn", "1"], tmp, transcripts);
    const runner = ".claude/skills/test-vitest-web/run.sh";
    const runnerText = readFileSync(path.join(tmp, "home", "acme-storefront", runner), "utf8").trimEnd().split("\n");
    // Each scene is a fresh screen with one or more commands typed into it.
    const scenes = [
      { steps: [{ command: "npx rote-cli stats", output: stats }], hold: 5.5 },
      {
        steps: [
          { command: "npx rote-cli learn 1", output: [...learn, ""] },
          { command: `cat ${runner}`, output: runnerText },
        ],
        hold: 5,
      },
    ];

    // Timeline: type a command, "run" it, reveal its output; hold; clear the screen.
    const elements = [];
    let t = 0.6;
    for (const scene of scenes) {
      const sceneElements = [];
      let row = 0;
      for (const step of scene.steps) {
        sceneElements.push({ kind: "prompt", at: t, row });
        [...step.command].forEach((ch, col) => sceneElements.push({ kind: "char", ch, col, row, at: t + col * 0.055 }));
        t += step.command.length * 0.055 + 0.45;
        row++;
        step.output.forEach((line, i) => sceneElements.push({ kind: "line", line, row: row + i, at: t + 0.3 + i * 0.03 }));
        t += 0.3 + step.output.length * 0.03 + 0.6;
        row += step.output.length;
      }
      t += scene.hold;
      for (const el of sceneElements) elements.push({ ...el, end: t });
      scene.rows = row;
    }
    const total = t;
    const rows = Math.max(...scenes.map((s) => s.rows));
    const width = Math.round(PAD_X * 2 + COLUMNS * CHAR);
    const height = TOP + (rows - 1) * LINE + 22;

    const pct = (s) => ((s / total) * 100).toFixed(3);
    const css = [];
    const body = [];
    elements.forEach((el, i) => {
      css.push(
        `@keyframes k${i}{0%{opacity:0}${pct(el.at)}%{opacity:1}${pct(Math.min(el.end, total - 0.001))}%{opacity:0}100%{opacity:0}}` +
          `.e${i}{opacity:0;animation:k${i} ${total.toFixed(2)}s steps(1,end) infinite}`,
      );
      const y = TOP + el.row * LINE;
      if (el.kind === "prompt") {
        body.push(`<text class="e${i}" x="${PAD_X}" y="${y}" fill="${THEME.prompt}" font-weight="700">$</text>`);
      } else if (el.kind === "char") {
        body.push(`<text class="e${i}" x="${(PAD_X + (el.col + 2) * CHAR).toFixed(1)}" y="${y}">${esc(el.ch)}</text>`);
      } else {
        body.push(lineSvg(parseAnsi(el.line), el.row, `e${i}`));
      }
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="rote stats lists commands the agent keeps rediscovering, then rote learn 1 writes a skill">
<style>
text{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:${FONT_SIZE}px;fill:${THEME.fg};white-space:pre}
${css.join("\n")}
</style>
<rect width="${width}" height="${height}" rx="10" fill="${THEME.bg}"/>
<rect width="${width}" height="30" rx="10" fill="${THEME.bar}"/><rect y="20" width="${width}" height="10" fill="${THEME.bar}"/>
<circle cx="20" cy="15" r="6" fill="#f38ba8"/><circle cx="40" cy="15" r="6" fill="#f9e2af"/><circle cx="60" cy="15" r="6" fill="#a6e3a1"/>
<text x="${width / 2}" y="20" text-anchor="middle" font-size="12" fill="#7f849c">rote · sample data</text>
<g xml:space="preserve">
${body.join("\n")}
</g>
</svg>
`;
    const out = path.join(repo, "assets", "demo.svg");
    writeFileSync(out, svg);
    console.log(`wrote ${path.relative(repo, out)} (${(svg.length / 1024).toFixed(0)} KB, ${total.toFixed(1)}s loop)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main();
