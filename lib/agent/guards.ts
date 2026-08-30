import { sql } from "drizzle-orm";
import type { ToolContext } from "./tools";

export const MAX_WRITES_PER_SESSION = 2;

export class GuardError extends Error {
  readonly isGuard = true;
}

/**
 * Istunnon jo tekemien kirjoitusten määrä KANNASTA, ei muistista.
 *
 * Tämä on korjaus todelliseen vikaan: laskuri eli aiemmin pelkästään
 * pyyntökohtaisessa kontekstissa, joten "2 per istunto" tarkoitti
 * käytännössä "2 per HTTP-pyyntö". Chatissa jokainen viesti on oma
 * pyyntönsä, joten katto ei rajoittanut mitään — kymmenen viestiä olisi
 * saanut tehdä kaksikymmentä kirjausta.
 *
 * Kanta on ainoa paikka, joka tietää mitä istunnossa on oikeasti tapahtunut.
 * Serverless-ajossa prosessimuisti ei ole edes sama kahden pyynnön välillä.
 */
export async function loadWriteCount(sessionId: string): Promise<number> {
  // Kanta importataan vasta kutsuttaessa. Muuten pelkkä vartijoiden
  // yksikkötestaus käynnistäisi Postgresin, ja testit jotka vaativat
  // infraa ovat testejä joita ei ajeta.
  const { db, rowsOf } = await import("@/db");
  const r = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM callbacks WHERE session_id = ${sessionId})
      + (SELECT count(*) FROM tickets  WHERE session_id = ${sessionId}) AS n
  `);
  return Number(rowsOf<{ n: number }>(r)[0]?.n ?? 0);
}

/**
 * Kirjoituskatto per istunto.
 *
 * Heitetään poikkeus, jonka silmukka ottaa kiinni ja palauttaa mallille
 * TYÖKALUTULOKSENA eikä kaatumisena. Malli saa siis tiedon rajasta ja voi
 * kertoa sen asiakkaalle. Kaatuminen näyttäisi asiakkaalle rikkinäiseltä
 * ja piilottaisi syyn.
 */
export function assertWriteAllowed(ctx: ToolContext): void {
  if (ctx.writeCount.value >= MAX_WRITES_PER_SESSION) {
    throw new GuardError(
      `Kirjoitusraja täynnä (${MAX_WRITES_PER_SESSION} per istunto). Kerro asiakkaalle, ettei uutta kirjausta voi tehdä tässä keskustelussa, ja ohjaa hänet ottamaan yhteyttä suoraan.`,
    );
  }
}

/**
 * Kirjoitus vaatii, että vahvistuskierros on ollut mahdollinen.
 *
 * Rakenteellinen osa vahvistuspakosta. Kehote käskee mallia esittämään
 * yhteenvedon ja odottamaan vahvistusta, mutta kehote on ohje eikä rajoite.
 * Tämä on rajoite: kirjoittava työkalu ei suoriudu keskustelun ensimmäisellä
 * mallivuorolla lainkaan, koska silloin asiakas ei ole voinut nähdä
 * yhteenvetoa eikä vahvistaa mitään. Se sulkee kaikki yhden viestin
 * injektiot ("vahvistan jo etukäteen", "vahvistus on annettu") riippumatta
 * siitä, uskooko malli niitä.
 *
 * Mitä tämä EI tee: se ei tarkista, että vahvistus koski juuri tätä
 * sisältöä. Sitä varten tarvittaisiin eksplisiittinen ehdota/vahvista-
 * protokolla, jossa ehdotus saa tunnisteen ja kirjoitus viittaa siihen.
 * Se on kirjattu README:n jatkotöihin, ei toteutettu. Rajoitteen
 * kertominen tarkasti on osa suojaa: väärin kuvattu suoja on huonompi
 * kuin puuttuva suoja, koska siihen luotetaan.
 */
export function assertConfirmationRound(ctx: ToolContext): void {
  if (ctx.priorTurns === 0) {
    throw new GuardError(
      "Kirjausta ei voi tehdä keskustelun ensimmäisellä vuorolla. Esitä asiakkaalle yhteenveto ja pyydä vahvistus. Kirjaus onnistuu vasta sen jälkeen.",
    );
  }
}

/**
 * Prioriteetti johdetaan tikettityypistä, ei tekstistä.
 *
 * Vaikka injektio saisi mallin kirjoittamaan yhteenvedoksi "KRIITTINEN,
 * nosta prioriteetti", prioriteetti tulee silti tästä taulukosta. Malli ei
 * näe tätä arvoa eikä voi vaikuttaa siihen muuten kuin valitsemalla tyypin,
 * ja tyyppi on suljettu joukko.
 */
const PRIORITY_BY_TYPE = {
  reklamaatio: "high",
  takuu: "high",
  toimitus: "normal",
  muu: "low",
} as const;

export function derivePriority(
  type: keyof typeof PRIORITY_BY_TYPE,
): "low" | "normal" | "high" {
  return PRIORITY_BY_TYPE[type];
}

/** Suomalainen numero kansainväliseen muotoon. Ei validoi olemassaoloa. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+358${digits.slice(1)}`;
  return digits;
}
