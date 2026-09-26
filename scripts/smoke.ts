// Checks that a deployed Worker answers: /api/health is up and /api/decide
// turns away a request without a session. CI runs it after every deploy.
//
//   pnpm smoke [baseUrl]   (default https://drive.mrza.ch)
//
// A new version takes a few seconds to reach every Cloudflare location, so
// failed checks are retried for up to a minute before the script gives up.
import type { DecideRequest } from "../shared/types.ts";

const base = process.argv[2] ?? "https://drive.mrza.ch";
const ATTEMPTS = 12;
const DELAY_MS = 5000;

const decideBody: DecideRequest = { caption: "a traffic cone", zone: "own_lane" };

const checks: { name: string; expect: number; run: () => Promise<Response> }[] = [
  { name: "GET /api/health", expect: 200, run: () => fetch(`${base}/api/health`) },
  {
    name: "POST /api/decide without a session",
    expect: 401,
    run: () =>
      fetch(`${base}/api/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decideBody),
      }),
  },
];

let failed = false;
for (const check of checks) {
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await check.run();
      await res.body?.cancel();
      if (res.status === check.expect) {
        last = "";
        break;
      }
      last = `got ${res.status}`;
    } catch (err) {
      last = String(err);
    }
    console.log(`${check.name}: ${last}, expected ${check.expect} (attempt ${attempt}/${ATTEMPTS})`);
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  if (last) {
    console.error(`FAIL ${check.name}: ${last}, expected ${check.expect}`);
    failed = true;
  } else {
    console.log(`ok   ${check.name}`);
  }
}
if (failed) process.exit(1);
