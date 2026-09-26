// Run the tuning captions through the local /api/decide and compare the
// resulting game behavior with the behavior table (docs/SPEC.md).
// Each case is one real Jev call, so this costs money; keep runs few.
//
//   pnpm dev   # in another terminal
//   node scripts/tune-policy.ts [baseUrl]   (default http://localhost:5173)
import { readFileSync, writeFileSync } from "node:fs";
import type { DecideResponse, Zone } from "../shared/types.ts";
import { resolveBehavior } from "../src/game/behaviors.ts";

interface Case {
  id: string;
  variant?: string;
  caption: string;
}

const base = process.argv[2] ?? "http://localhost:5173";
const dir = new URL("../docs/jev-tuning/", import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL("captions.json", dir), "utf8")) as { cases: Case[] };

// Acceptable behaviors per sample and zone. Signs and lights apply in both zones.
const both = (...kinds: string[]) => ({ road: kinds, sidewalk: kinds });
const EXPECT: Record<string, Record<Zone, string[]>> = {
  child: { road: ["stop"], sidewalk: ["continue"] },
  adult: { road: ["stop"], sidewalk: ["continue"] },
  teddy: { road: ["stop"], sidewalk: ["continue"] },
  dog: { road: ["stop"], sidewalk: ["continue", "slow_down"] },
  cat: { road: ["stop"], sidewalk: ["continue", "slow_down"] },
  bicycle: { road: ["stop"], sidewalk: ["continue"] },
  car: { road: ["stop"], sidewalk: ["continue"] },
  stop: both("stop_sign"),
  red: both("red_light red"),
  amber: both("red_light amber"),
  green: both("green_light"),
  limit30: both("speed_limit 30"),
  limit80: both("speed_limit 80"),
  box: { road: ["slow_down", "stop"], sidewalk: ["continue"] },
  bag: both("continue"),
  leaves: both("continue"),
};
const EXPECT_VARIANT: Record<string, string[]> = {
  "no-lamp": ["slow_down"],
  paper: ["continue"],
  "two-numbers": ["speed_limit 30", "continue"],
  injection: [], // no expectation, just see what happens
};

const describe = (b: ReturnType<typeof resolveBehavior>["behavior"]) =>
  b.kind === "red_light" ? `red_light ${b.light}` : b.kind === "speed_limit" ? `speed_limit ${b.kmh}` : b.kind;
const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}`.padStart(3);

const rows: unknown[] = [];
const jevMs: number[] = [];
const roundTripMs: number[] = [];
let failures = 0;

for (const c of cases) {
  const zones: Zone[] = c.variant ? ["road"] : ["road", "sidewalk"];
  for (const zone of zones) {
    const started = performance.now();
    const res = await fetch(`${base}/api/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caption: c.caption, zone, distance: "far", speedKmh: 50 }),
    });
    const rt = Math.round(performance.now() - started);
    if (!res.ok) {
      console.log(`${c.id} ${zone}: HTTP ${res.status} ${await res.text()}`);
      failures++;
      continue;
    }
    const r = (await res.json()) as DecideResponse;
    jevMs.push(r.latencyMs);
    roundTripMs.push(rt);
    const resolved = resolveBehavior(r, zone);
    const got = describe(resolved.behavior);
    const want = c.variant ? EXPECT_VARIANT[c.variant]! : EXPECT[c.id]![zone];
    const ok = want.length === 0 || want.includes(got);
    if (!ok) failures++;
    const a = r.action.probabilities;
    console.log(
      [
        ok ? " ok " : "MISS",
        `${c.id}${c.variant ? `/${c.variant}` : ""}`.padEnd(20),
        zone.padEnd(8),
        `${r.category.choice} ${pct(r.category.confidence)}`.padEnd(22),
        `c${pct(a.continue)} s${pct(a.slow_down)} x${pct(a.stop)}`,
        `light ${r.lightState.choice} ${pct(r.lightState.confidence)}`.padEnd(22),
        `limit ${r.speedLimit.choice}`.padEnd(11),
        `person ${pct(r.couldBePerson)}`,
        `→ ${got}${resolved.safetyOverride ? " (override)" : ""}`.padEnd(24),
        want.length ? `want ${want.join("|")}` : "",
        `${r.latencyMs}ms`,
      ].join("  "),
    );
    rows.push({ ...c, zone, response: r, behavior: got, override: resolved.safetyOverride, ok, roundTripMs: rt });
  }
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min ${s[0]} · median ${q(0.5)} · p95 ${q(0.95)} · max ${s.at(-1)} ms (n=${s.length})`;
};
console.log(`\n${failures} misses`);
console.log(`Jev in Worker: ${stats(jevMs)}`);
console.log(`Round trip:    ${stats(roundTripMs)}`);
writeFileSync(new URL("results.json", dir), JSON.stringify(rows, null, 2) + "\n");
