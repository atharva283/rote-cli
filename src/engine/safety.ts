import type { Intent } from "../types.js";

export interface SafetyVerdict {
  ok: boolean;
  reasons: string[];
}

const DESTRUCTIVE: ReadonlyArray<[RegExp, string]> = [
  [/(^|[\s;&|(])(rm|rmdir|rd|del|erase|unlink|shred)\s/i, "deletes files"],
  [/\bRemove-Item\b/i, "deletes files"],
  [/\bgit\s+(push|reset\s+--hard|clean|checkout\s+--|restore|rebase|branch\s+-D|stash\s+(drop|clear)|filter-branch)/i, "rewrites or publishes git history"],
  [/(^|\s)--force(-with-lease)?\b|(^|\s)-f\s+.*\bpush\b|\bpush\s+(.*\s)?-f\b/i, "forces a destructive operation"],
  [/\b(drop|truncate)\s+(table|database|schema)\b|\bdelete\s+from\b/i, "destroys database data"],
  [/\b(migrate\s+reset|db:drop|db:reset|migrate:fresh|flushall|flushdb)\b/i, "resets a database"],
  // Project scripts and make targets named like `seed:reset` or `clean` usually wipe something.
  [
    /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?|make\s+|just\s+|task\s+)[\w:.-]*(?:reset|drop|destroy|nuke|purge|wipe|teardown|clean)\b/i,
    "runs a reset/clean script",
  ],
  [/\b(sudo|doas|runas)\b/i, "needs elevated privileges"],
  [/\b(mkfs|diskpart|shutdown|reboot)\b|\bdd\s+if=|\bformat\s+[a-z]:/i, "touches disks or the system"],
  [/\b(kill|pkill|killall|taskkill|Stop-Process)\b/i, "kills processes"],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression)\b/i, "pipes a download into a shell"],
  [/\bchmod\s+-R\b|\bchown\b/i, "changes file ownership or permissions"],
  [/\b(npm|pnpm|yarn|bun)\s+publish\b|\bdocker\s+push\b|\btwine\s+upload\b|\bcargo\s+publish\b/i, "publishes a package"],
  [/\bdocker\s+(system|volume|image|container)\s+prune\b/i, "prunes docker data"],
];

const SECRETS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/,
  /\b[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY)[A-Z0-9_]*=\S+/i,
  /--(token|password|api-key|secret)[= ]\S+/i,
];

/** Masks anything that looks like a secret, for printing recipes to the terminal or JSON. */
export function redact(text: string): string {
  return SECRETS.reduce(
    (s, re) =>
      s.replace(new RegExp(re.source, `${re.flags.replace("g", "")}g`), (m) => {
        const cut = m.search(/[= ]/);
        return cut > 0 ? `${m.slice(0, cut + 1)}***` : "***";
      }),
    text,
  );
}

/** Decides whether a recipe is safe to hand to an agent as a one-call skill. */
export function checkRecipe(recipe: string, intent: Intent): SafetyVerdict {
  const reasons = new Set<string>();
  for (const [re, why] of DESTRUCTIVE) if (re.test(recipe)) reasons.add(why);
  if (SECRETS.some((re) => re.test(recipe))) reasons.add("contains what looks like a secret");
  if (intent === "deploy") reasons.add("deploys to an outside service");
  return { ok: reasons.size === 0, reasons: [...reasons] };
}
