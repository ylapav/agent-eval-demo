import "@/lib/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, cosineDistance, desc } from "drizzle-orm";
import { db } from "@/db";
import { chunks } from "@/db/schema";
import { embedQuery, EMBED_MODEL, EMBED_MODE } from "@/lib/rag/embed";
import { RELEVANCE_FLOOR } from "@/lib/rag/search";

/**
 * Osuvuuskynnyksen kalibrointi.
 *
 * RELEVANCE_FLOOR on ainoa luku hakukerroksessa, jota ei voi johtaa
 * mistään — se riippuu upotusmallista, kielestä ja tietopohjan koosta.
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

async function topScore(q: string): Promise<number> {
  const vec = await embedQuery(q);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, vec)})`;
  const rows = await db
    .select({ score: similarity })
    .from(chunks)
    .orderBy(desc(similarity))
    .limit(1);
  return rows[0]?.score ?? 0;
}

const bar = (v: number) => "█".repeat(Math.max(0, Math.round(v * 40)));

async function main() {
  console.log(`upotusmalli: ${EMBED_MODEL}`);
  if (EMBED_MODE === "local") {
    console.log(
      "HUOM: paikallinen tiivisteupotus ei ole semanttinen. Jakaumat eivät\n" +
        "      kerro mitään oikeasta hakulaadusta — aseta VOYAGE_API_KEY.\n",
    );
  }
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
