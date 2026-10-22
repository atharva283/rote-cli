import type { Turn } from "../types.js";

/** USD per million tokens. Cache writes cost 1.25x (5-minute TTL) or 2x (1-hour TTL) the input rate. */
export interface Rate {
  input: number;
  output: number;
  cacheRead: number;
}

// Anthropic first-party list prices, checked October 2026. Most specific pattern first.
const RATES: ReadonlyArray<[RegExp, Rate]> = [
  [/(fable|mythos)-5-1/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-(5|4-[5-9])/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/opus/, { input: 15, output: 75, cacheRead: 1.5 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet/, { input: 3, output: 15, cacheRead: 0.3 }],
  [/haiku-5-5/, { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  [/haiku-4-5/, { input: 1, output: 5, cacheRead: 0.1 }],
  [/haiku/, { input: 0.8, output: 4, cacheRead: 0.08 }],
];
const DEFAULT_RATE: Rate = { input: 2, output: 10, cacheRead: 0.2 };

const cache = new Map<string, Rate>();

export function rateFor(model: string): Rate {
  let rate = cache.get(model);
  if (!rate) {
    rate = RATES.find(([re]) => re.test(model))?.[1] ?? DEFAULT_RATE;
    cache.set(model, rate);
  }
  return rate;
}

/** API-equivalent cost of one turn at list prices. */
export function turnCost(turn: Turn): number {
  const r = rateFor(turn.model);
  const u = turn.usage;
  return (
    (u.input * r.input +
      u.output * r.output +
      u.cacheRead * r.cacheRead +
      u.cacheWrite5m * r.input * 1.25 +
      u.cacheWrite1h * r.input * 2) /
    1e6
  );
}

export function turnTokens(turn: Turn): number {
  const u = turn.usage;
  return u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}
