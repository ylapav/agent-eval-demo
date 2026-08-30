import { db } from "@/db";
import { chunks } from "@/db/schema";
import { cosineDistance, desc, gt, sql } from "drizzle-orm";
import { embedQuery } from "./embed";

export type Hit = {
  id: string;
  docId: string;
  docTitle: string;
  heading: string | null;
  content: string;
  score: number;
};

/**
 * Osuvuuskynnys. Alle tämän olevat katkelmat jätetään pois kokonaan.
 *
 * Ilman kynnystä vektorihaku palauttaa aina k parasta, myös silloin kun
 * mikään ei liity kysymykseen. Malli saa silloin epäolennaista kontekstia
 * ja vastaa sen pohjalta — se on suoraan kieltäytymismittarin epäonnistuminen.
 * Tyhjä tulos on parempi kuin huono tulos, koska tyhjä tulos saa mallin
 * sanomaan "en tiedä".
 *
 * ────────────────────────────────────────────────────────────────────────
 * TÄMÄ LUKU ON ARVATTU, EI MITATTU.
 *
 * Sitä ei ole kalibroitu voyage-3-lite-upotuksilla, koska kalibrointiajoa
 * ei ole tehty. Se on lähtöarvaus, joka on siinä siksi, että jokin kynnys
 * on parempi kuin ei kynnystä — ei siksi, että 0,35 olisi oikea luku.
 *
 * Kalibrointi: `npm run calibrate`. Se ajaa groundedness.json- ja
 * refusal.json-kyselyt pelkkänä hakuna ilman mallikutsuja ja tulostaa
 * parhaan osuman jakauman kummallekin joukolle. Kynnys kuuluu niiden
 * väliin. Kun luku on mitattu, korvaa tämä lohko muodolla
 *   "mitattu <pvm>, n=<kyselyä>, erotteluväli x,xx–y,yy"
 * ja siirrä muutos omaan committiinsa perusteluineen.
 *
 * Jos jakaumat menevät päällekkäin, lukua EI säädetä: silloin mikään
 * kynnys ei erota niitä, ja korjaus on haussa (hybridihaku, pilkkominen).
 * Kynnyksen viilaaminen päällekkäisillä jakaumilla on ylisovittamista
 * testisettiin.
 * ────────────────────────────────────────────────────────────────────────
 */
export const RELEVANCE_FLOOR = 0.35;

export async function searchChunks(query: string, k = 5): Promise<Hit[]> {
  const vec = await embedQuery(query);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, vec)})`;

  const rows = await db
    .select({
      id: chunks.id,
      docId: chunks.docId,
      docTitle: chunks.docTitle,
      heading: chunks.heading,
      content: chunks.content,
      score: similarity,
    })
    .from(chunks)
    .where(gt(similarity, RELEVANCE_FLOOR))
    .orderBy(desc(similarity))
    .limit(k);

  return rows;
}
