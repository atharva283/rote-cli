export function usd(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function int(n: number): string {
  return n.toLocaleString("en-US");
}

export function date(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString().slice(0, 10) : "----------";
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${int(n)} ${n === 1 ? word : many}`;
}

/** A horizontal bar of `cells` width filled to `fraction`, using eighth-blocks for precision. */
export function bar(fraction: number, cells: number): string {
  const eighths = Math.round(Math.max(0, Math.min(1, fraction)) * cells * 8);
  const full = Math.floor(eighths / 8);
  const rest = eighths % 8;
  return "█".repeat(full) + (rest ? "▏▎▍▌▋▊▉"[rest - 1] : "");
}
