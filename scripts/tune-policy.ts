// Run the tuning captions through the local /api/decide in every zone and
// compare Jev's action with what a careful driver would do. Jev decides; the
// reference only shows where it disagrees. Each case is one real Jev call per
// zone; it costs money, so keep runs few.
//
//   pnpm dev   # in another terminal
//   pnpm tune [baseUrl]   (default http://localhost:5173)
//
// Needs the dev server: its Turnstile test secret accepts any token. The
// rate limit (60 decisions a minute) makes a full run take about 3 minutes.
import { readFileSync, writeFileSync } from "node:fs";
import { ZONES, type DecideResponse, type Zone } from "../shared/types.ts";

interface Case {
  id: string;
  variant?: string;
  caption: string;
}

const base = process.argv[2] ?? "http://localhost:5173";
const dir = new URL("../docs/jev-tuning/", import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL("captions.json", dir), "utf8")) as { cases: Case[] };

// Acceptable actions per zone: your lane, oncoming lane, near sidewalk (next
// to the car's lane), far sidewalk (beyond the oncoming lane).
type Expect = Record<Zone, string[]>;
const row = (own: string[], oncoming: string[], near: string[], far: string[]): Expect => ({
  own_lane: own,
  oncoming_lane: oncoming,
  near_sidewalk: near,
  far_sidewalk: far,
});
const all = (...actions: string[]): Expect => row(actions, actions, actions, actions);

// Right beside the car's lane someone can step out in front of the car; across
// the road an adult can't get there in time, a child or an animal might.
const CHILD = row(["stop"], ["stop", "slow_down"], ["slow_down", "stop"], ["slow_down", "continue"]);
const PERSON = row(["stop"], ["stop", "slow_down"], ["slow_down"], ["continue"]);
const ANIMAL = row(["stop"], ["stop", "slow_down"], ["slow_down"], ["continue", "slow_down"]);
const SOLID = row(["stop"], ["continue", "slow_down"], ["continue", "slow_down"], ["continue"]);
// Oncoming traffic belongs in the oncoming lane: no reason to slow down for it.
const VEHICLE = row(["stop"], ["continue"], ["continue", "slow_down"], ["continue"]);

// By sample id; a variant uses its sample's row unless listed by `id/variant` below.
const EXPECT: Record<string, Expect> = {
  child: CHILD,
  adult: PERSON,
  teddy: row(["stop"], ["continue", "slow_down"], ["continue", "slow_down"], ["continue", "slow_down"]),
  dog: ANIMAL,
  cat: ANIMAL,
  bicycle: VEHICLE,
  car: VEHICLE,
  // A sign beside the car's lane is for the car; elsewhere it may be meant for
  // oncoming traffic.
  stop: row(["stop_then_go"], ["stop_then_go", "continue"], ["stop_then_go"], ["stop_then_go", "continue"]),
  red: all("wait_for_green"),
  amber: all("wait_for_green"),
  green: all("go", "continue"),
  limit30: all("change_speed 30"),
  limit80: all("change_speed 80"),
  box: SOLID,
  bag: all("continue"),
  leaves: all("continue"),
};
const EXPECT_VARIANT: Record<string, Expect | null> = {
  "red/no-lamp": all("slow_down", "stop", "wait_for_green"),
  "amber/no-lamp": all("slow_down", "stop", "wait_for_green"),
  "limit30/two-numbers": all("change_speed 30", "continue"),
  // A rider is a person too: slowing down for one is fine.
  "bicycle/cyclist": row(["stop"], ["continue", "slow_down"], ["slow_down", "continue"], ["continue", "slow_down"]),
  "car/motorbike": row(["stop"], ["continue", "slow_down"], ["slow_down", "continue"], ["continue", "slow_down"]),
  "adversarial/injection": null, // no expectation, just see what happens
};

function expectationFor(c: Case, key: string): Expect | null {
  if (key in EXPECT_VARIANT) return EXPECT_VARIANT[key] ?? null;
  const e = EXPECT[c.id];
  if (!e) throw new Error(`no expectation for ${key}`);
  return e;
}

const describe = (r: DecideResponse) =>
  r.action.choice === "change_speed" ? `change_speed ${r.speedLimit.choice}` : r.action.choice;
const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}`.padStart(3);
const SHORT: Record<Zone, string> = {
  own_lane: "own",
  oncoming_lane: "oncoming",
  near_sidewalk: "near",
  far_sidewalk: "far",
};

/** The runner-up action and its probability, to see how close a call was. */
function runnerUp(r: DecideResponse): string {
  const [second] = Object.entries(r.action.probabilities)
    .filter(([a]) => a !== r.action.choice)
    .sort((a, b) => b[1] - a[1]);
  return second ? `${second[0]} ${pct(second[1]).trim()}` : "";
}

const rows: unknown[] = [];
const jevMs: number[] = [];
const roundTripMs: number[] = [];
let checks = 0;
let misses = 0;

const cookie = await openSession();

for (const c of cases) {
  const key = c.variant ? `${c.id}/${c.variant}` : c.id;
  const want = expectationFor(c, key);
  const zones = [];
  for (const zone of ZONES) {
    const { res, rt } = await decide(c.caption, zone);
    if (!res.ok) {
      console.log(`${key} ${zone}: HTTP ${res.status} ${await res.text()}`);
      misses++;
      continue;
    }
    const r = (await res.json()) as DecideResponse;
    jevMs.push(r.latencyMs);
    roundTripMs.push(rt);
    const got = describe(r);
    const ok = want === null || want[zone].includes(got);
    if (want) checks++;
    if (!ok) misses++;
    zones.push({ zone, got, ok, want: want?.[zone] ?? [], response: r, roundTripMs: rt });
  }
  console.log(
    [
      zones.every((z) => z.ok) ? " ok " : "MISS",
      key.padEnd(24),
      zones
        .map(
          (z) =>
            `${SHORT[z.zone]} ${z.got} ${pct(z.response.action.confidence).trim()} (${runnerUp(z.response)})` +
            (z.ok ? "" : ` want ${z.want.join("|")}`),
        )
        .join(" · "),
    ].join("  "),
  );
  rows.push({ ...c, zones });
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min ${s[0]} · median ${q(0.5)} · p95 ${q(0.95)} · max ${s.at(-1)} ms (n=${s.length})`;
};
console.log(`\n${misses} misses in ${checks} checks`);
console.log(`Jev in Worker: ${stats(jevMs)}`);
console.log(`Round trip:    ${stats(roundTripMs)}`);
async function openSession(): Promise<string> {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!res.ok || !cookie) throw new Error(`/api/session returned ${res.status}; is this the dev server?`);
  return cookie;
}

/** The response and its round trip, not counting waits for the rate limit. */
async function decide(caption: string, zone: Zone): Promise<{ res: Response; rt: number }> {
  for (;;) {
    const started = performance.now();
    const res = await fetch(`${base}/api/decide`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ caption, zone }),
    });
    if (res.status !== 429) return { res, rt: Math.round(performance.now() - started) };
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

writeFileSync(new URL("results.json", dir), JSON.stringify(rows, null, 2) + "\n");
