// Run the tuning captions through the local /api/decide and compare the
// resulting game behavior in every zone with the behavior table (docs/SPEC.md).
// Jev only sees the caption, so each case is one real Jev call; it costs
// money, so keep runs few.
//
//   pnpm dev   # in another terminal
//   pnpm tune [baseUrl]   (default http://localhost:5173)
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import type { DecideResponse } from "../shared/types.ts";
import type { Zone } from "../src/game/types.ts";

// Game code imports its siblings without an extension, which Vite resolves
// and Node doesn't: retry those as .ts, then load the game code.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      const missing = (err as { code?: string }).code === "ERR_MODULE_NOT_FOUND";
      if (!missing || !/^\.{1,2}\//.test(specifier)) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});
const { resolveBehavior } = await import("../src/game/behaviors.ts");
const { ZONES } = await import("../src/game/types.ts");

interface Case {
  id: string;
  variant?: string;
  caption: string;
}

const base = process.argv[2] ?? "http://localhost:5173";
const dir = new URL("../docs/jev-tuning/", import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL("captions.json", dir), "utf8")) as { cases: Case[] };

// Acceptable behaviors per zone: your lane, oncoming lane, sidewalk.
type Expect = Record<Zone, string[]>;
const row = (own: string[], oncoming: string[], sidewalk: string[]): Expect => ({
  own_lane: own,
  oncoming_lane: oncoming,
  sidewalk,
});
const all = (...kinds: string[]): Expect => row(kinds, kinds, kinds);

const CHILD = row(["stop"], ["stop"], ["slow_down"]);
const PERSON = row(["stop"], ["slow_down"], ["continue"]);
const SOLID = row(["stop"], ["continue"], ["continue"]);

// By sample id; a variant uses its sample's row unless listed by `id/variant` below.
const EXPECT: Record<string, Expect> = {
  child: CHILD,
  adult: PERSON,
  // Not a person, but could be taken for one: slowing down beside it is fine.
  teddy: row(["stop"], ["continue", "slow_down"], ["continue"]),
  dog: PERSON,
  cat: PERSON,
  bicycle: SOLID,
  car: SOLID,
  stop: all("stop_sign"),
  red: all("red_light red"),
  amber: all("red_light amber"),
  green: all("green_light"),
  limit30: all("speed_limit 30"),
  limit80: all("speed_limit 80"),
  box: SOLID,
  bag: all("continue"),
  leaves: all("continue"),
};
const EXPECT_VARIANT: Record<string, Expect | null> = {
  "red/no-lamp": all("slow_down"),
  "amber/no-lamp": all("slow_down"),
  "limit30/two-numbers": all("speed_limit 30", "continue"),
  "adversarial/injection": null, // no expectation, just see what happens
};

function expectationFor(c: Case, key: string): Expect | null {
  if (key in EXPECT_VARIANT) return EXPECT_VARIANT[key] ?? null;
  const e = EXPECT[c.id];
  if (!e) throw new Error(`no expectation for ${key}`);
  return e;
}

const describe = (b: ReturnType<typeof resolveBehavior>["behavior"]) =>
  b.kind === "red_light" ? `red_light ${b.light}` : b.kind === "speed_limit" ? `speed_limit ${b.kmh}` : b.kind;
const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}`.padStart(3);
const SHORT: Record<Zone, string> = { own_lane: "own", oncoming_lane: "oncoming", sidewalk: "sidewalk" };

const rows: unknown[] = [];
const jevMs: number[] = [];
const roundTripMs: number[] = [];
let checks = 0;
let failures = 0;

for (const c of cases) {
  const key = c.variant ? `${c.id}/${c.variant}` : c.id;
  const started = performance.now();
  const res = await fetch(`${base}/api/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caption: c.caption }),
  });
  const rt = Math.round(performance.now() - started);
  if (!res.ok) {
    console.log(`${key}: HTTP ${res.status} ${await res.text()}`);
    failures += ZONES.length;
    continue;
  }
  const r = (await res.json()) as DecideResponse;
  jevMs.push(r.latencyMs);
  roundTripMs.push(rt);
  const want = expectationFor(c, key);
  const zones = ZONES.map((zone) => {
    const resolved = resolveBehavior(r, zone);
    const got = describe(resolved.behavior);
    const ok = want === null || want[zone].includes(got);
    if (want) checks++;
    if (!ok) failures++;
    return { zone, got, ok, override: resolved.safetyOverride, want: want?.[zone] ?? [] };
  });
  console.log(
    [
      zones.every((z) => z.ok) ? " ok " : "MISS",
      key.padEnd(24),
      `${r.category.choice} ${pct(r.category.confidence)}`.padEnd(21),
      `person ${pct(r.couldBePerson)}`,
      `child ${pct(r.mentionsChild)}`,
      `light ${r.lightState.choice}`.padEnd(17),
      `limit ${r.speedLimit.choice}`.padEnd(10),
      zones
        .map((z) => `${SHORT[z.zone]} ${z.got}${z.override ? "*" : ""}${z.ok ? "" : ` (want ${z.want.join("|")})`}`)
        .join(" · "),
      `${r.latencyMs}ms`,
    ].join("  "),
  );
  rows.push({ ...c, response: r, zones, roundTripMs: rt });
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min ${s[0]} · median ${q(0.5)} · p95 ${q(0.95)} · max ${s.at(-1)} ms (n=${s.length})`;
};
console.log(`\n${failures} misses in ${checks} checks (* = safety override)`);
console.log(`Jev in Worker: ${stats(jevMs)}`);
console.log(`Round trip:    ${stats(roundTripMs)}`);
writeFileSync(new URL("results.json", dir), JSON.stringify(rows, null, 2) + "\n");
