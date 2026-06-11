import { createPool, getWorld, getLatestGeneration } from "@orbis/db";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import { WorldView } from "@/components/WorldView";
import "./world.css";

export const dynamic = "force-dynamic";

const display = Fraunces({ subsets: ["latin"], weight: ["600"], style: ["italic"], display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export default async function WorldPage() {
  const pool = createPool();
  try {
    const cells = await getWorld(pool, "r0");
    const generation = await getLatestGeneration(pool);
    return (
      <main className={`${mono.className} world-page`}>
        <div className="world-frame">
          <header className="world-header">
            <p className="world-eyebrow">Aurora DSQL · one ledger · one living world</p>
            <h1 className={`${display.className} world-title`}>Orbis Exchange</h1>
            <p className="world-sub">
              region r0 · {cells.length} cells · resource density evolving by cellular automaton
            </p>
          </header>
          <WorldView region="r0" initialCells={cells} initialGeneration={generation} />
          <footer className="world-foot">
            brightness = abundance · depleted regions fade · the field re-reads the ledger every 3s
          </footer>
        </div>
      </main>
    );
  } finally {
    await pool.end();
  }
}
