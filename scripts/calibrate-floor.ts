import "@/lib/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  searchChunksVector,
  searchChunksLexical,
  SEARCH_MODE,
  RELEVANCE_FLOOR,
} from "@/lib/rag/search";
import { EMBED_MODEL } from "@/lib/rag/embed";

/**
 * Osuvuuskynnyksen kalibrointi.
 *
 * Kynnys on ainoa luku hakukerroksessa, jota ei voi johtaa mistään — se
 * riippuu hakutavasta, upotusmallista, kielestä ja tietopohjan koosta.
 * Siksi kumpikin polku kalibroidaan erikseen: skripti mittaa sen polun,
 * joka on käytössä (VOYAGE_API_KEY asetettu → vektori, muuten leksikaalinen),
 * ja ts_rank-pisteet eivät ole vertailukelpoisia kosinisimilaarisuuden kanssa.
 * Väärin asetettuna se rikkoo kaksi mittaria eri suuntiin: liian matala
 * kynnys päästää epäolennaista kontekstia läpi ja nostaa keksimistä,
 * liian korkea tyhjentää tulokset ja pudottaa lähdeperusteisuuden.
 *
 * Tämä skripti ajaa molemmat evaluointisetit pelkkänä hakuna — ilman
 * mallia, ilman kustannusta — ja näyttää parhaan osuman jakauman:
 *
 *   PITÄISI LÖYTYÄ    groundedness.json  → korkeita pisteitä
 *   EI SAA LÖYTYÄ     refusal.json       → matalia pisteitä
 *
 * Kynnys kuuluu näiden väliin. Jos jakaumat menevät päällekkäin, mikään
 * kynnys ei erota niitä, ja ongelma on haussa eikä kynnyksessä —
 * silloin korjaus on hybridihaku tai parempi pilkkominen, ei luvun
 * säätäminen. Kynnyksen viilaaminen päällekkäisillä jakaumilla on
 * ylisovittamista testisettiin.
 */
const read = (f: string): { id: string; viesti: string }[] =>
  JSON.parse(readFileSync(join(process.cwd(), "eval-sets", f), "utf8")).filter(
    (c: { viesti?: string }) => c.viesti,
  );

/**
 * Paras osuma ILMAN kynnystä.
 *
 * Kynnyksen kanssa mittaus olisi kehäpäätelmä: se näyttäisi vain sen, mitä
 * nykyinen kynnys päästää läpi, eikä sitä mitä kynnykseksi pitäisi asettaa.
 */
async function topScore(q: string): Promise<number> {
  const hits =
    SEARCH_MODE === "vector"
      ? await searchChunksVector(q, 1, { ignoreFloor: true })
      : await searchChunksLexical(q, 1, { ignoreFloor: true });
  return hits[0]?.score ?? 0;
}

/** Palkin skaala on eri poluilla, koska pisteiden suuruusluokka on eri. */
const bar = (v: number) =>
  "█".repeat(Math.max(0, Math.round(v * (SEARCH_MODE === "vector" ? 40 : 400))));

async function main() {
  console.log(
    SEARCH_MODE === "vector"
      ? `hakupolku: vektori (${EMBED_MODEL})`
      : "hakupolku: leksikaalinen (Postgresin tekstihaku, suomen stemmer)",
  );
  console.log(`nykyinen kynnys: ${RELEVANCE_FLOOR}\n`);

  const groups: { nimi: string; tiedosto: string; pisteet: number[] }[] = [
    { nimi: "PITÄISI LÖYTYÄ", tiedosto: "groundedness.json", pisteet: [] },
    { nimi: "EI SAA LÖYTYÄ", tiedosto: "refusal.json", pisteet: [] },
  ];

  for (const g of groups) {
    console.log(`── ${g.nimi} (${g.tiedosto})`);
    for (const c of read(g.tiedosto)) {
      const s = await topScore(c.viesti);
      g.pisteet.push(s);
      console.log(`  ${s.toFixed(3)} ${bar(s).padEnd(40)} ${c.id}`);
    }
    console.log("");
  }

  const [hit, miss] = groups;
  const minHit = Math.min(...hit.pisteet);
  const maxMiss = Math.max(...miss.pisteet);

  console.log("── yhteenveto");
  console.log(`  matalin osuma joka PITÄISI löytyä: ${minHit.toFixed(3)}`);
  console.log(`  korkein osuma joka EI SAA löytyä:  ${maxMiss.toFixed(3)}`);

  if (minHit > maxMiss) {
    const ehdotus = (minHit + maxMiss) / 2;
    console.log(`\n  Jakaumat erottuvat. Kynnys välillä ${maxMiss.toFixed(3)}–${minHit.toFixed(3)}.`);
    console.log(`  Keskikohta: ${ehdotus.toFixed(3)}  (nyt ${RELEVANCE_FLOOR})`);
    if (RELEVANCE_FLOOR <= maxMiss) {
      console.log("  → Nykyinen kynnys on LIIAN MATALA: epäolennaista pääsee läpi.");
    } else if (RELEVANCE_FLOOR >= minHit) {
      console.log("  → Nykyinen kynnys on LIIAN KORKEA: osuvia tuloksia karsiutuu.");
    } else {
      console.log("  → Nykyinen kynnys erottaa jakaumat.");
    }
  } else {
    console.log("\n  Jakaumat menevät päällekkäin: mikään kynnys ei erota niitä.");
    console.log("  Korjaus on haussa (hybridihaku, pilkkominen), ei tässä luvussa.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
