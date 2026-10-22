import os from "node:os";
import path from "node:path";

const DRIVE = /^[A-Za-z]:/;

/**
 * Normalizes a path to forward slashes, an uppercase drive letter and no
 * trailing slash. For Windows paths, git-bash forms like `/d/repo` become `D:/repo`.
 */
export function normPath(p: string, windows = DRIVE.test(p)): string {
  let s = p.trim().replace(/\\/g, "/");
  if (s.startsWith("~")) s = os.homedir().replace(/\\/g, "/") + s.slice(1);
  if (windows) {
    const m = /^\/([A-Za-z])(?=\/|$)/.exec(s);
    if (m) s = `${m[1]}:${s.slice(2) || "/"}`;
  }
  if (DRIVE.test(s)) s = s[0]!.toUpperCase() + s.slice(1);
  s = path.posix.normalize(s);
  if (s.length > 1 && s.endsWith("/") && !/^[A-Z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

export function isAbsolute(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\") || p.startsWith("~") || DRIVE.test(p);
}

/** Resolves `target` against `base`, returning a normalized path. */
export function resolvePath(base: string, target: string): string {
  const windows = DRIVE.test(base);
  return isAbsolute(target) ? normPath(target, windows) : normPath(`${base}/${target}`, windows);
}

/** `""` when `p` is `root`, the sub-path when `p` is inside `root`, otherwise `null`. */
export function relativeTo(root: string, p: string): string | null {
  const fold = DRIVE.test(root) ? (s: string) => s.toLowerCase() : (s: string) => s;
  const r = fold(root);
  const q = fold(p);
  if (q === r) return "";
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return q.startsWith(prefix) ? p.slice(prefix.length) : null;
}

/** Folds `<repo>/.claude/worktrees/<name>/...` back onto `<repo>/...`. */
export function foldWorktree(p: string): string {
  return p.replace(/\/\.claude\/worktrees\/[^/]+(?=\/|$)/, "");
}
