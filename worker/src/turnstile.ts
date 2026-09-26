const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Checks a Turnstile token with Cloudflare. Each token is valid once, for
 * 5 minutes. Resolves false for a rejected token and throws when Turnstile
 * can't be reached, so the caller can tell a bot from an outage.
 */
export async function verifyTurnstile(secret: string, token: string, remoteIp?: string): Promise<boolean> {
  const res = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, response: token, ...(remoteIp && { remoteip: remoteIp }) }),
  });
  if (!res.ok) throw new Error(`siteverify returned ${res.status}`);
  const body = await res.json<SiteverifyResponse>();
  if (!body.success) console.log(JSON.stringify({ event: "turnstile_rejected", errors: body["error-codes"] ?? [] }));
  return body.success === true;
}
