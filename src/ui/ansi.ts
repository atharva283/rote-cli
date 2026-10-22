let enabled =
  !process.env.NO_COLOR &&
  (Boolean(process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") || Boolean(process.stdout.isTTY));

export function setColor(on: boolean): void {
  enabled = on;
}

const wrap = (open: string, close: string) => (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export const c = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  magenta: wrap("35", "39"),
  cyan: wrap("36", "39"),
  gray: wrap("90", "39"),
  orange: wrap("38;5;208", "39"),
};

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function width(s: string): number {
  return [...stripAnsi(s)].length;
}

/** Shortens plain text to `max` characters with an ellipsis. */
export function truncate(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  return max <= 1 ? chars.slice(0, max).join("") : `${chars.slice(0, max - 1).join("")}…`;
}

export function pad(s: string, w: number, align: "left" | "right" = "left"): string {
  const gap = " ".repeat(Math.max(0, w - width(s)));
  return align === "left" ? s + gap : gap + s;
}

export function terminalWidth(): number {
  return Math.max(60, Math.min(process.stdout.columns || Number(process.env.COLUMNS) || 100, 140));
}
