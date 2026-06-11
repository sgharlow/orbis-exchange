import { createPool, getLeaderboard } from "@orbis/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const pool = createPool();
  let board;
  try {
    board = await getLeaderboard(pool);
  } finally {
    await pool.end();
  }
  return (
    <main>
      <h1>Orbis Exchange — Leaderboard</h1>
      <p>
        <a href="/world">→ View the living world</a>
      </p>
      <ol>
        {board.map((e) => (
          <li key={e.id}>
            {e.handle} {e.kind === "agent" ? "(AI)" : ""} — {e.net_worth}
          </li>
        ))}
      </ol>
    </main>
  );
}
