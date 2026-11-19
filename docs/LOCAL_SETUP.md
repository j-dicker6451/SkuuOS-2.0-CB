# Local setup (Carbon AGPL import in Cursor)

This tree is an **AGPLv3-only** import of [crbnos/carbon](https://github.com/crbnos/carbon). Enterprise sources under `packages/ee/` and files matching `*.ee.*` were excluded; see [NOTICE.md](../NOTICE.md) for the upstream commit and stub list.

## Prerequisites

| Requirement | Notes |
| ----------- | ----- |
| **Node.js** | `>= 24.22.1` (see root `.nvmrc`) |
| **pnpm** | `10.33.4` via Corepack (`corepack enable`) |
| **Docker** | Engine + Compose v2 for the local stack (Postgres, Auth, Storage, Realtime, Inngest, Redis, mail catcher) |
| **Git** | Optional: `source ./setup.sh` adds the `crbn` CLI to your shell |

Rust (`cargo`) is only needed if you work on the optional `assembler` geometry service (see upstream README).

## 1. Open in Cursor

1. Clone or open this repository in Cursor.
2. Use the workspace root (where `package.json` and `pnpm-workspace.yaml` live).
3. Install the [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) extension if you want format-on-save like upstream.

## 2. Install dependencies

```bash
corepack enable
pnpm install
```

`postinstall` builds some workspace packages. On constrained CI/agents, `CI=1` skips MCP code generation (same as upstream).

If install fails on native addons (`sharp`, `esbuild`, etc.), ensure a supported Linux x64 environment with build tools, or retry on your host machine with Docker available.

## 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` for local URLs and feature flags. **Do not commit secrets.** Common variables (names only — see upstream docs for values):

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` / Supabase-style URLs | Postgres and API endpoints (set by `crbn up` / Docker stack) |
| `SESSION_SECRET` | Session signing (`openssl rand -hex 32`) |
| `CARBON_EDITION` | Typically `community` for this import |
| `BOT_PROTECTION` | Use `none` for local login without Turnstile |
| `INNGEST_*` | Local Inngest dev server |
| `REDIS_URL` | Job/cache coordination |
| `STRIPE_*`, `POSTHOG_*`, AI provider keys | Optional integrations |

Full reference: [Carbon environment variables](https://docs.carbon.ms/docs/platform/self-hosting/environment-variables).

## 4. Run the stack

From the repo root (upstream quick path):

```bash
pnpm dev
```

This runs `crbn up --no-portless`, which starts Docker services, migrates the database, and launches apps.

| Surface | Default URL |
| ------- | ------------- |
| ERP | http://localhost:3000 |
| MES | http://localhost:3001 |
| API (PostgREST) | http://localhost:54321 |

**Sign-in:** dev seed user `test@carbon.ms` (magic link bypass in local dev). Seed a demo company:

```bash
pnpm db:seed:dev -- --email test@carbon.ms --dataset satellite
```

### Optional: `crbn` CLI and worktrees

```bash
source ./setup.sh   # once per shell
crbn up
crbn status
crbn down
```

## 5. Useful commands

```bash
pnpm lint
pnpm test
pnpm exec turbo run typecheck --filter=erp
pnpm db:migrate
pnpm generate:types
```

## 6. AGPL import limitations

- **Enterprise features are absent:** integrations, workflows engine, indirect rates UI, approvals UI, and other `*.ee.*` surfaces are stubs or unavailable.
- **Regenerating stubs:** after changing exclusion rules, run `python3 scripts/generate-oss-stubs.py`.
- **Workflow catalog scripts** (`check:workflow-catalog`, `generate:workflow-catalog`) are intentionally no-ops here because they require upstream `packages/ee` sources.

## 7. Troubleshooting

| Issue | What to try |
| ----- | ----------- |
| Docker not running | Start Docker; `crbn up` needs the daemon |
| Port conflicts | `crbn status` or change ports in `.env` / worktree config |
| Node version mismatch | `nvm use` (reads `.nvmrc`) or install Node 24.22+ |
| Install OOM | Set `NODE_OPTIONS=--max-old-space-size=8192` for `pnpm install` |

For build status on this import branch, see the pull request description (install/typecheck may be partial in agent environments without full Docker).