# Phase 0 Cloud Provisioning Runbook

Manual, user-approved steps to take Orbis Exchange Phase 0 from "green locally" to "live on Aurora DSQL + Vercel." These create **net-new** cloud resources only — no changes to any existing system. Run each section deliberately; stop and confirm before each AWS/Vercel mutation.

**Prerequisite:** all local tasks complete and green (monorepo, `@orbis/db`, `apps/web`, migrations DSQL-safe). Verify with `pnpm -r lint` and `pnpm --filter @orbis/db test`.

**Env vars used below** (set per the shell — bash `VAR=value cmd`, or PowerShell `$env:VAR='value'; cmd`):
`DB_MODE=dsql`, `DSQL_HOST=<cluster-id>.dsql.<region>.on.aws`, `DSQL_REGION=<region>`, plus AWS credentials via the standard provider chain.

---

## A. Verify DSQL region availability
- [ ] Confirm Aurora DSQL is offered in a low-cost region for this account (e.g. `us-east-1`). Record the chosen region. (DSQL is not in every region — check before assuming.)

## B. Create the DSQL cluster (single-region)
- [ ] Create the cluster: `aws dsql create-cluster --region <region>` (or via the console).
- [ ] Record the endpoint host: `<cluster-id>.dsql.<region>.on.aws`.
- [ ] Note: DSQL provides exactly one database named `postgres` per cluster — our `readDbEnv()` defaults `DSQL_DATABASE` to `postgres`, so leave it unset unless you created a schema-based separation.

## C. IAM for the auth-token flow
- [ ] Ensure the local/dev IAM identity can call `dsql:DbConnectAdmin` on the cluster (the `admin` DB user). Our pool mints the token via `DsqlSigner.getDbConnectAdminAuthToken()`.
- [ ] Ensure the SAME permission is available to the Vercel deployment. For Phase 0, the simplest path is an IAM access key pair set as Vercel env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`). Scope the key to `dsql:DbConnectAdmin` on this cluster only.

## D. Apply migrations to the live cluster
- [ ] `DB_MODE=dsql DSQL_HOST=<host> DSQL_REGION=<region> pnpm db:migrate`
- [ ] Expected: `applied 0001_init`, `applied 0002_indexes`, `applied 0003_invest`, `applied 0004_cell_listing`, `migrations complete`.
- [ ] The runner is DSQL-aware: it runs each DDL statement in its own auto-commit transaction (DSQL allows only 1 DDL per transaction and forbids DDL+DML mixing) and rewrites `CREATE INDEX` → `CREATE INDEX ASYNC`.
- [ ] **If a migration partially applies and then errors** (DSQL has no transactional DDL, so there is no rollback): reset and retry on the fresh cluster —
      connect with a psql client and run `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`, then re-run `pnpm db:migrate`.
- [ ] After apply, secondary indexes build asynchronously — give them a few seconds before heavy reads.

## E. Seed the live cluster
- [ ] `DB_MODE=dsql DSQL_HOST=<host> DSQL_REGION=<region> pnpm db:seed`
- [ ] Inserts 10 players (alice + bot-maker + 8 algorithmic agents) + 4 `market_state` rows + the 64×64 world grid (idempotent via `ON CONFLICT DO NOTHING`).

## F. Smoke-test the live cluster (the pre-deploy gate)
- [ ] `DB_MODE=dsql DSQL_HOST=<host> DSQL_REGION=<region> pnpm db:smoke`
- [ ] Expected: `smoke OK — migrations=[0001_init,0002_indexes,0003_invest,0004_cell_listing] players=10` (fresh cluster: 2 named players `alice`+`bot-maker` + 8 algorithmic agents from seed; local dev may show a higher count if extra players were added during development)

## G. Deploy apps/web to Vercel
- [ ] **Check for an existing Vercel project first** (`vercel ls` or `.vercel/project.json`) — do NOT create a duplicate.
- [ ] Project root: `apps/web`. Install command: `pnpm install` at the repo root. Build: `next build`.
- [ ] Set Vercel env vars (Production): `DB_MODE=dsql`, `DSQL_HOST`, `DSQL_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SESSION_SECRET` (a real random secret, not the dev placeholder).
- [ ] Deploy.
- [ ] Note: the app consumes the workspace `@orbis/db` (NodeNext `.js` imports) via a webpack `extensionAlias` in `next.config.ts`. The build uses webpack (no `--turbopack`); if Turbopack is ever enabled, add the Turbopack-equivalent resolver config.

## H. Verify the live spine
- [ ] `curl https://<deployment>/api/health` → `{"ok":true,"migrations":["0001_init","0002_indexes","0003_invest","0004_cell_listing"]}`
- [ ] Visit `https://<deployment>/` → leaderboard shows the 10 seeded players (agents tagged `(AI)`).
- [ ] This proves the full path: browser → Vercel route handler → DSQL over IAM auth → browser. **Phase 0's headline deliverable.**

## I. Cost guardrails (do this BEFORE leaving anything running)
- [ ] AWS Budgets: create a low monthly threshold alert on the account (so a runaway loop pages, not bills).
- [ ] Vercel: enable Spend Management with an auto-pause cap.
- [ ] Confirm single-region only (no multi-region cluster yet — that's a Phase 3 demo step).

---

## Migration authoring contract (carry into later phases)
The runtime statement splitter (`splitStatements` in `packages/db/src/migrate.ts`) assumes **DDL-only migrations with no `$$` PL/pgSQL bodies and no string literals containing `--` or `;`**. This holds for the Phase 0 schema. Before adding any DML/seed migrations with string literals, revisit the splitter (it strips `--` comment tails per line, which would corrupt a `--` inside a string literal).
