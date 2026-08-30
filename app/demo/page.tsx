import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { DEMO_NOTE, type DemoRuns } from "@/lib/demo/types";
import Viewer from "./viewer";

/**
 * Tallennettujen ajojen toisto. Nolla mallikutsua.
 *
 * Tämä reitti lukee demo-runs.json:in eikä tuo lib/agent/loop.ts:ää,
 * Anthropic-SDK:ta eikä tietokantaa. Se ei ole tyylikysymys vaan
 * kustannuslupaus: repo on julkinen ja linkitetty portfolioon, joten
 * kävijä ei saa aiheuttaa API-kutsuja. tests/demo-cost.test.ts kävelee
 * tämän tiedoston riippuvuuspuun läpi ja kaatuu, jos joku tuo myöhemmin
 * apufunktion loop.ts:stä.
 */
export const metadata: Metadata = {
  title: "Nordkanta — tallennetut ajot",
  description: "Neljä todellista keskustelua työkalukutsuineen ja katkelmineen.",
};

const RUNS = join(process.cwd(), "demo-runs.json");

export default function DemoPage() {
  if (!existsSync(RUNS)) {
    return (
      <div className="wrap">
        <header className="site">
          <h1>Tallennetut ajot</h1>
          <span className="sub">
            <a href="/">chat</a>
          </span>
        </header>
        <p className="notice">
          Tallennetta ei ole. Tiedosto <span className="mono">demo-runs.json</span> syntyy
          komennolla <span className="mono">npm run record</span>, joka ajaa
          keskustelut <span className="mono">demo-scripts.json</span>:ista oikealla
          mallilla ja vaatii <span className="mono">ANTHROPIC_API_KEY</span>:n.
        </p>
        <p className="hint">
          Käsin kirjoitettua varatilaa ei ole tarkoituksella: tallenteen on oltava
          todellinen tuotos, tai koko sivu on valhe.
        </p>
      </div>
    );
  }

  const runs = JSON.parse(readFileSync(RUNS, "utf8")) as DemoRuns;

  return (
    <div className="wrap wrap--wide">
      <header className="site">
        <h1>Tallennetut ajot</h1>
        <span className="sub">
          <a href="/">chat</a> · malli <span className="mono">{runs.modelId}</span> ·
          kehote <span className="mono">{runs.promptHash}</span> · haku{" "}
          <span className="mono">{runs.searchMode}</span> ·{" "}
          {runs.recordedAt.slice(0, 10)}
        </span>
      </header>

      <p className="notice">{runs.note || DEMO_NOTE}</p>

      <Viewer conversations={runs.conversations} />
    </div>
  );
}
