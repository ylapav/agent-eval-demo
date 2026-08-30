import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SuiteResult } from "./run";

export type RunMeta = {
  modelId: string;
  effort: string;
  judgeModel: string;
  embedModel: string;
  promptHash: string;
  ajettu: string;
};

const START = "<!-- EVAL:ALKU -->";
const END = "<!-- EVAL:LOPPU -->";

/**
 * Kirjoittaa tulostaulukon README:hen merkkien väliin.
 *
 * Miksi automaattisesti: käsin täytetty tulostaulukko on käsin valittu
 * tulostaulukko. Kun luvut kopioidaan terminaalista, alitus jää helposti
 * kopioimatta — ei valehtelemisen takia vaan siksi, että sen kirjoittaminen
 * tuntuu keskeneräiseltä. Tämä funktio kirjoittaa mitä ajo antoi, myös
 * alitukset, ja merkitsee ne selvästi.
 *
 * Jos merkkejä ei löydy README:stä, funktio ei tee mitään eikä kaadu:
 * evaluoinnin tulos on tärkeämpi kuin sen muotoilu.
 */
export function writeReadmeResults(meta: RunMeta, results: SuiteResult[]): void {
  const path = join(process.cwd(), "README.md");

  let readme: string;
  try {
    readme = readFileSync(path, "utf8");
  } catch {
    return;
  }

  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a === -1 || b === -1 || b < a) return;

  const fmt = (r: SuiteResult, n: number) =>
    r.yksikko === "lukumäärä" ? String(n) : `${(n * 100).toFixed(1)} %`;

  const cmp = (r: SuiteResult) => (r.lowerIsBetter ? "≤" : "≥");

  const rows = results.map((r) => {
    const passed = r.lowerIsBetter ? r.score <= r.threshold : r.score >= r.threshold;
    return `| ${r.otsikko} | ${cmp(r)} ${fmt(r, r.threshold)} | **${fmt(r, r.score)}** | ${passed ? "täyttyy" : "**ALITUS**"} |`;
  });

  const huomiot = results
    .filter((r) => r.huomio)
    .map((r) => `- ${r.otsikko}: ${r.huomio}`);

  const pvm = new Date(meta.ajettu).toISOString().slice(0, 10);

  const block = [
    START,
    "",
    "| Mittari | Kynnys | Tulos | Tila |",
    "|---|---|---|---|",
    ...rows,
    "",
    ...(huomiot.length ? [...huomiot, ""] : []),
    `Ajettu ${pvm}. Malli \`${meta.modelId}\` (effort ${meta.effort}), arvioija \`${meta.judgeModel}\`, upotus \`${meta.embedModel}\`, kehotteen hash \`${meta.promptHash}\`.`,
    "",
    "Taulukon kirjoittaa `npm run eval` (`lib/eval/report.ts`). Sitä ei täytetä käsin,",
    "koska käsin täytetty tulostaulukko on käsin valittu tulostaulukko.",
    "Tapauskohtaiset tulokset ovat tiedostossa `eval-results.json`.",
    "",
    END,
  ].join("\n");

  writeFileSync(path, readme.slice(0, a) + block + readme.slice(b + END.length), "utf8");
}
