import { createPool, getWorld, getLatestGeneration, getMarket, getLeaderboard } from "@orbis/db";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import { WorldView } from "@/components/WorldView";
import { MarketPanel } from "@/components/MarketPanel";
import { PlayerDashboard } from "@/components/PlayerDashboard";
import { LeaderboardPanel } from "@/components/LeaderboardPanel";
import { ObjectiveRail } from "@/components/ObjectiveRail";
import { Coachmark } from "@/components/Coachmark";
import "./world.css";

export const dynamic = "force-dynamic";

const display = Fraunces({ subsets: ["latin"], weight: ["600"], style: ["italic"], display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export default async function WorldPage() {
  const pool = createPool();
  try {
    const cells = await getWorld(pool, "r0");
    const generation = await getLatestGeneration(pool);
    const market = await getMarket(pool, "ore");
    const leaderboard = await getLeaderboard(pool);
    return (
      <main className={`${mono.className} world-page`}>
        <div className="world-frame">
          <header className="world-header">
            <p className="world-eyebrow">Aurora DSQL · one ledger · one living world</p>
            <h1 className={`${display.className} world-title`}>Orbis Exchange</h1>
            <p className="world-sub">
              region r0 · {cells.length} cells · AI and humans trading on one consistent ledger
            </p>
          </header>
          <ObjectiveRail />
          <div className="panels">
            <section className="panel" aria-label="World">
              <h2 className="panel-h">The Living World</h2>
              <WorldView region="r0" initialCells={cells} initialGeneration={generation} />
            </section>
            <section className="panel" aria-label="Market">
              <h2 className="panel-h">The Global Market</h2>
              <PlayerDashboard />
              <MarketPanel initialCommodity="ore" initialMarket={market} />
            </section>
          </div>
          <LeaderboardPanel initial={leaderboard} />
          <footer className="world-foot">
            the living field and the order book are one ledger · brightness = abundance · reveal a commodity to see its cells
          </footer>
        </div>
        <Coachmark />
      </main>
    );
  } finally {
    await pool.end();
  }
}
