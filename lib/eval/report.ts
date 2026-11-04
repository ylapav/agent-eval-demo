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

/**
 * Mitä haulle tapahtui yhdessä kieltäytymistapauksessa.
 *
 * - ei_kutsuttu: agentti ei kutsunut hakutyökalua lainkaan
 * - tyhja:       agentti haki, ja kynnys karsi kaikki osumat
 * - osumia:      agentti haki ja sai katkelmia
 */
export type HakuTila = "ei_kutsuttu" | "tyhja" | "osumia";

export function hakuTila(hakuKutsuttu: boolean, katkelmia: number): HakuTila {
  if (!hakuKutsuttu) return "ei_kutsuttu";
  return katkelmia === 0 ? "tyhja" : "osumia";
}

/**
 * Kieltäytymissarjan huomautus.
 *
 * Aiempi versio päätteli nollasta katkelmasta, että "hakukynnys palautti
 * tyhjän tuloksen, kuten pitääkin". Ensimmäisessä oikeassa ajossa nolla
 * johtui siitä, ettei agentti hakenut lainkaan — ja kalibroinnin mukaan haku
 * olisi palauttanut osumia kynnyksen yläpuolelta. Huomautus kehui kynnystä
 * asiasta, jota kynnys ei tehnyt. Nämä kolme ovat eri syitä ja eri
 * korjauksia, joten ne raportoidaan erikseen.
 */
export function refusalHuomio(tilat: HakuTila[]): string {
  const n = (t: HakuTila) => tilat.filter((x) => x === t).length;
  return [
    `${tilat.length} tapausta:`,
    `${n("ei_kutsuttu")} agentti ei kutsunut hakua,`,
    `${n("tyhja")} haku palautti tyhjän kynnyksen takia,`,
    `${n("osumia")} haku palautti katkelmia.`,
  ].join(" ");
}

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
