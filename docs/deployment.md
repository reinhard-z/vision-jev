# Deployment

[← README](../README.md)

Pushing directly to `main` deploys to https://drive.mrza.ch; no PR is required. The `deploy` job in [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs after the checks pass: it builds, runs `wrangler deploy` (tagged with the commit), then smoke-checks the live site with `pnpm smoke`. Each endpoint gets up to a minute of retries: GET `/api/health` must answer 200, and POST `/api/decide` with valid JSON and no cookie must answer 401. A failed smoke check fails the job; it does not automatically roll back. Deploys run one at a time and a running one is never cancelled. GitHub keeps only the newest pending run when several pushes arrive during a run.

### One-time setup

The Custom Domain route for `drive.mrza.ch` is already in `wrangler.jsonc`. Both Worker secrets are already set in Cloudflare; leave them there. For a fresh Worker only, set them with these commands (they never go to GitHub):

```sh
pnpm wrangler secret put TURNSTILE_SECRET_KEY   # from the Turnstile widget for drive.mrza.ch
pnpm wrangler secret put SESSION_SECRET   # any random string, e.g. openssl rand -hex 32
```

[`secrets.required`](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets) in `wrangler.jsonc` lists both names, so CI generates the same types without `.dev.vars`, and a deploy fails if one is missing. Changing `SESSION_SECRET` logs everyone out; the page opens a new session on its own.

Cloudflare, an API token for GitHub: My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, limited to this account and the `mrza.ch` zone.

GitHub, Settings → Environments → New environment `production`:

- Deployment branches: selected branches, `main` only.
- Environment secret `CLOUDFLARE_API_TOKEN`: the token above.
- Environment variable `CLOUDFLARE_ACCOUNT_ID`: from `pnpm wrangler whoami`.

Leave required reviewers and wait timers disabled for automatic deployment. Use GitHub Actions as the deployment trigger; disable any separate Cloudflare Workers Builds Git integration to avoid duplicate deploys.

`pnpm deploy` still deploys from your machine, with your own `wrangler login`.

### Remote previews

```sh
pnpm preview:remote
```

This builds the current working tree, then runs `wrangler versions upload --preview-alias preview`. Wrangler reads Vite's redirected config at `dist/jev_driver/wrangler.json`, uploads the Worker and assets, and prints the version URL and the stable alias `https://preview-jev-driver.<account-subdomain>.workers.dev`. It does not send production traffic to the uploaded version. The next preview upload moves the alias to that version.

[`preview_urls: true`](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) enables these public URLs. The account needs a Workers subdomain configured in Cloudflare. Authenticate locally with `pnpm wrangler login`, or use `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Version URLs share the Worker's resources and secrets; they are not isolated environments.

The Turnstile widget currently allows only `drive.mrza.ch`. The page loads on a preview URL, but the challenge fails and decisions cannot run until that hostname is added to the widget's allowed domains. The preview command does not change the widget. Allowing the stable alias hostname would cover future uploads using that alias; individual version URLs have different hostnames.

### Rolling back

```sh
pnpm wrangler deployments list   # the 10 most recent deployments, with version IDs
pnpm wrangler rollback --message "why"   # back to the previous version
pnpm wrangler rollback <version-id> --message "why"   # or to a given one (last 100)
```

[`wrangler rollback`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback) immediately sends production traffic to the selected version. Follow any confirmation prompts from your installed Wrangler. Bound resources and their data are not rolled back; review any warning about changed secrets. Run `pnpm smoke` afterward. The next push to `main` deploys again, so revert the bad commit before pushing.
