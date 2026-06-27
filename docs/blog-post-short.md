# I stopped trying to prove "global scale" and let the database guarantee it

*Orbis Exchange, built for the H0 "Hack the Zero Stack" hackathon - Vercel + AWS Databases, hero database Amazon Aurora DSQL.*

**#H0Hackathon** - Built for Devpost's *H0: Hack the Zero Stack with Vercel and AWS Databases*.

---

Most "global app" demos prove scale with a load-test graph - which only says the system was *fast once*, not *correct under contention*. So I made a different bet: prove global scale with an **invariant**, not a benchmark.

The invariant is the one every transactional system lives or dies on:

> Balances never go negative. Inventory is never oversold. No reconciliation pass, ever.

Make that *true by construction* - visible on screen as humans and bots hammer the same ledger - and it says more than any RPS number. The database that made it natural was **Amazon Aurora DSQL**: PostgreSQL-compatible, strongly consistent, active-active across regions.

## What I built

A single living world with one global market: a 64x64 grid evolves every 3 seconds by cellular-automaton rules so scarcity is *emergent*, every commodity has one order book, and each fill settles as one short, strongly-consistent transaction. You auto-join as a guest, no login. Algorithmic agents trade the same order path you do, at zero inference cost, on one leaderboard. Next.js on Vercel, an off-Vercel heartbeat worker, one DSQL cluster as the source of truth.

## Settlement is one conditional write

In Postgres you stop two buyers spending the same credits with a pessimistic lock: `SELECT ... FOR UPDATE`, check in app code, then update. DSQL has no `FOR UPDATE` - it's **optimistic**. That's not a missing feature; you move the check *into the write*:

```sql
UPDATE players
   SET credits = credits - :cost
 WHERE id = :buyer
   AND credits >= :cost;     -- the invariant, asserted by the database
```

Read the affected-row count: **one row** means it held; **zero** means someone moved first, so the matching loop retries once. The same guard protects inventory. Money is `BIGINT`; all money math runs in SQL.

So "no double-spend, no oversell" isn't something my app *hopes* it enforced across a lock - it's something the **database guarantees** on each write, under strong consistency, with agents and humans crossing the same book.

## What I learned

I stopped trying to *prove* global scale and started *guaranteeing* it. Once the database owns "no double-spend, no oversell," a whole category of code - distributed locks, reconciliation passes, the bookkeeping that double-checks the bookkeeping - simply never got written. "Global scale" reads far more credibly as a **consistency story** - one correct ledger, reachable from any region - than as a throughput graph. That was the bet, and I think it paid off.

---

*Orbis Exchange - built solo for the **#H0Hackathon** (H0: Hack the Zero Stack). Live: https://orbis-exchange.vercel.app - Code: https://github.com/sgharlow/orbis-exchange*
