import { db } from "@/db";
import { chunks } from "@/db/schema";
import { cosineDistance, desc, gt, isNotNull, and, sql } from "drizzle-orm";
import { embedQuery, canEmbed, EMBED_MODEL, EMBED_PROVIDER, EMBED_DIMENSIONS } from "./embed";

export type Hit = {
  id: string;
  docId: string;
  docTitle: string;
  heading: string | null;
  content: string;
  score: number;
};

/**
 * Hakupolku valitaan avaimen mukaan.
 *
 * Katkelmien upotukset voi esilaskea (`npm run embed`), mutta KÄYTTÄJÄN
 * KYSELYN upotus vaatii API-kutsun joka kerta. Ilman avainta vektorihaku ei
 * siis toimi lainkaan, olivatpa katkelmat kuinka valmiiksi upotettuja
 * tahansa. Leksikaalinen polku on se, joka tekee lupauksesta "toimii ilman
 * API-avaimia" totta.
 *
 * Nämä kaksi eivät ole toistensa varmuuskopioita vaan hybridihaun
 * puolikkaat: vektorihaku löytää merkityksen ja pettää tuotenumeroilla,
 * leksikaalinen löytää tarkat termit ja pettää synonyymeillä. Yhdistäminen
 * on README:n jatkotöissä; tässä valitaan toinen kerrallaan.
 */
export type SearchMode = "vector" | "lexical";

export const SEARCH_MODE: SearchMode = canEmbed() ? "vector" : "lexical";

console.log(
  SEARCH_MODE === "vector"
    ? `[rag] mode=vector provider=${EMBED_PROVIDER} model=${EMBED_MODEL} dim=${EMBED_DIMENSIONS}`
    : "[rag] mode=lexical (ei OPENAI_API_KEY)",
);

/**
 * Osuvuuskynnys vektoripolulle. Alle tämän olevat katkelmat jätetään pois.
 *
 * Ilman kynnystä vektorihaku palauttaa aina k parasta, myös silloin kun
 * mikään ei liity kysymykseen. Malli saa silloin epäolennaista kontekstia
 * ja vastaa sen pohjalta — se on suoraan kieltäytymismittarin epäonnistuminen.
 * Tyhjä tulos on parempi kuin huono tulos, koska tyhjä saa mallin sanomaan
 * "en tiedä".
 *
 * Mitattu 2026-11-04, n=24 kyselyä (text-embedding-3-small, 512 ulott.),
 * paras osuma per kysely:
 *   pitäisi löytyä (groundedness.json, 14):  0,543–0,759
 *   ei saa löytyä  (refusal.json, 10):       0,403–0,534
 *   erotteluväli 0,534–0,543 (0,009)
 *
 * Arvo 0,35 on molempien jakaumien alapuolella, eli se ei karsi yhtään
 * kieltäytymiskysymysten osumaa. Sitä ei silti siirretty väliin: 0,009:n rako
 * on 24 kysymyksen testisetin ominaisuus eikä haun, ja kynnyksen asettaminen
 * siihen olisi ylisovittamista. Tulos sanoo, että pelkkä kosinisimilaarisuus
 * ei erota joukkoja luotettavasti; korjaus on haussa (hybridihaku,
 * pilkkominen), ei tässä luvussa. Sama perustelu: README, "Hakukynnys ja sen
 * kalibrointi". Kalibrointi: `npm run calibrate`.
 *
 * Jos jakaumat menevät päällekkäin, lukua EI säädetä: silloin mikään kynnys
 * ei erota niitä, ja korjaus on haussa eikä kynnyksessä.
 */
export const RELEVANCE_FLOOR_VECTOR = 0.35;

/**
 * Osuvuuskynnys leksikaaliselle polulle.
 *
 * Eri luku kuin vektoripolulla, koska ts_rank ei ole kosinisimilaarisuus.
 * Se ei ole normalisoitu välille 0–1 eikä vertailukelpoinen sen kanssa:
 * ts_rank painottaa osumien tiheyttä ja määrää, ja arvot jäävät tämän
 * kokoisessa korpuksessa suuruusluokkaan 0,01–0,08. Saman luvun käyttäminen
 * molemmissa hylkäisi leksikaalisella polulla käytännössä kaiken.
 *
 * ────────────────────────────────────────────────────────────────────────
 * MITATTU 2026-08-30, n=24 kyselyä (`npm run calibrate`).
 *
 * Tulos 1: jakaumat menevät päällekkäin eikä mikään kynnys erota niitä.
 *
 *   pitäisi löytyä (14 kyselyä)  0,017 – 0,076
 *   ei saa löytyä  (10 kyselyä)  0,015 – 0,038
 *
 * Tulos 2, mitattu katkelmatasolla erikseen: kynnys 0,01 on tässä
 * aineistossa käytännössä INERTTI hylkäyssuunnassa. Se ei karsi yhtäkään
 * kymmenestä kyselystä, joiden ei pitäisi löytää mitään — koko
 * "ei saa löytyä" -jakauma on kynnyksen yläpuolella. Ainoa mitattava
 * vaikutus on kolmen osuvan kyselyn katkelmamäärän pieneneminen; yksikään
 * ei tyhjene kokonaan.
 *
 * Luku on siis saantiin päin valittu eikä kalibroitu erotusraja, ja se
 * suojaa vähemmän kuin kynnys yleensä suojaa. Vaihtoehto olisi tarkkuus
 * (0,039 karsisi kaikki osumattomat mutta myös 8 osuvaa neljästätoista),
 * ja silloin demo kieltäytyisi vastaamasta useimpiin oikeisiin
 * kysymyksiin.
 *
 * Lukua EI ole viilattu testisetin väliin sopivaksi. Päällekkäisillä
 * jakaumilla se olisi ylisovittamista: luku näyttäisi kalibroidulta ilman
 * että se erottaa mitään.
 *
 * Tämä on koko repon vahvin empiirinen perustelu hybridihaulle, joka on
 * README:n jatkotöissä. Pelkkä leksikaalinen haku ei erottele tätä
 * aineistoa, eikä korjaus ole tässä luvussa.
 * ────────────────────────────────────────────────────────────────────────
 */
export const RELEVANCE_FLOOR_LEXICAL = 0.01;

/** Voimassa oleva kynnys. Kalibrointi ja raportointi lukevat tämän. */
export const RELEVANCE_FLOOR =
  SEARCH_MODE === "vector" ? RELEVANCE_FLOOR_VECTOR : RELEVANCE_FLOOR_LEXICAL;

/**
 * Tekstihakukonfiguraatio.
 *
 * `finnish` löytyy sekä PGliten WASM-buildista että tavallisesta
 * Postgresista — tarkistettu ajamalla `SELECT cfgname FROM pg_ts_config`.
 * Se on `simple`-konfiguraatiota parempi, koska suomessa haettava sana on
 * lähes aina eri taivutusmuodossa kuin tekstissä: "julkisivulevyt" ja
 * "julkisivulevy" saavat saman vartalon 'julkisivulevy', samoin "takuuta"
 * ja "takuu" vartalon 'taku'.
 *
 * Se ei kuitenkaan riitä, ja rajan tunteminen on tärkeämpää kuin voiton:
 * snowball ei osaa astevaihtelua, joten se HALKAISEE osan sanoista.
 * Mitattu 2026-08-30:
 *
 *   kattopelti      → 'kattopelt'
 *   kattopellit     → 'kattopel'      (eri vartalo!)
 *   toimitusaika    → 'toimitusaik'
 *   toimitusajat    → 'toimitusaj'    (eri vartalo!)
 *
 * Seuraus on mitattava eikä teoreettinen: kysely perusmuodossa
 * "kattopelti" osuu yhteen katkelmaan, kun "kattopellit" osuu yhdeksään.
 * Tietopohjan sanasto hajoaa kahtia juuri demon päätuotteen kohdalla.
 * Tämä on toinen puoli samasta johtopäätöksestä kuin kynnys alempana:
 * leksikaalinen haku yksin ei kanna tätä aineistoa, ja korjaus on
 * hybridihaku — vektorihaku ei välitä astevaihtelusta lainkaan.
 */
const TS_CONFIG = "finnish";

const NL = String.fromCharCode(10);

/** Katkelman haettava teksti. Otsikko mukaan, koska se kantaa merkityksen. */
const DOC = sql`(${chunks.docTitle} || ' ' || coalesce(${chunks.heading}, '') || ' ' || ${chunks.content})`;

const COLUMNS = {
  id: chunks.id,
  docId: chunks.docId,
  docTitle: chunks.docTitle,
  heading: chunks.heading,
  content: chunks.content,
};

/**
 * Kyselyn muunto tsquery-muotoon TypeScriptin puolella.
 *
 * Syy tehdä se täällä eikä SQL:ssä: to_tsquery on tiukka syntaksistaan ja
 * kaatuu käyttäjän vapaaseen tekstiin (kysymysmerkit, sulut, väliviivat).
 * plainto_tsquery ei kaadu mutta yhdistää sanat AND-operaattorilla, jolloin
 * "Kuinka pitkä takuu kattopelleillä on?" ei osuisi mihinkään: yhdenkään
 * katkelman ei tarvitse sisältää kaikkia sanoja.
 *
 * Tässä sanat poimitaan kirjaimiksi ja numeroiksi ja yhdistetään OR:lla.
 * Poiminta on samalla sanitointi: yksikään erikoismerkki ei pääse läpi.
 */
function queryWords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length > 1))];
}

/**
 * `ignoreFloor` on vain kalibrointia varten: kynnyksen mittaaminen kynnyksen
 * läpi olisi kehäpäätelmä, joka näyttäisi vain mitä nykyinen luku päästää
 * läpi eikä sitä mitä luvun pitäisi olla.
 */
export type SearchOptions = { ignoreFloor?: boolean };

/**
 * Varmistaa, että indeksi on laskettu samalla mallilla kuin kyselyt.
 *
 * Tämä on koko tiedoston tärkein tarkistus, ja syy on se virheluokka josta
 * repo muuten kertoo: jos upotusmalli vaihdetaan eikä `npm run index`
 * ajeta, vanhat vektorit jäävät vanhaan avaruuteen ja uudet kyselyt
 * tulevat uudesta. Dimensio täsmää, mikään ei kaadu, ja haku palauttaa
 * roskaa — hiljaisesti, ilman virhettä tai lokiriviä.
 *
 * Tarkistus tehdään kerran prosessia kohti ja tulos muistetaan: se on yksi
 * kysely, mutta hakupolulla sekin on liikaa jokaisella kutsulla.
 * Epäsuhta KAATAA haun eikä varoita, koska varoitus katoaa lokiin ja
 * väärät vastaukset jäävät.
 */
let indexChecked = false;

async function assertIndexMatchesModel(): Promise<void> {
  if (indexChecked) return;

  const rows = await db
    .selectDistinct({ model: chunks.embedModel })
    .from(chunks)
    .where(isNotNull(chunks.embedding));

  const mallit = rows.map((r) => r.model);

  // Tyhjä indeksi läpäisee triviaalisti, eikä sitä muisteta: jos tulos
  // välimuistitettaisiin, myöhemmin ilmestyvä väärällä mallilla laskettu
  // indeksi ei laukaisisi tarkistusta koskaan. Välimuistiin kelpaa vain
  // tulos, joka on oikeasti tarkistanut jotain.
  if (!mallit.length) return;

  const vieraat = mallit.filter((m) => m !== EMBED_MODEL);
  if (vieraat.length) {
    throw new Error(
      [
        "Indeksi on laskettu eri upotusmallilla kuin kyselyt.",
        `  indeksissä: ${mallit.map((m) => m ?? "(tuntematon)").join(", ")}`,
        `  koodi odottaa: ${EMBED_MODEL}`,
        "",
        "Dimensio täsmää, joten haku ei kaatuisi — se palauttaisi roskaa.",
        "Korjaus: aja `npm run index` uudelleen.",
      ].join(NL),
    );
  }

  indexChecked = true;
}

/** Vektorihaku. Vaatii sekä katkelmien että kyselyn upotukset. */
export async function searchChunksVector(
  query: string,
  k = 5,
  opts: SearchOptions = {},
): Promise<Hit[]> {
  await assertIndexMatchesModel();
  const vec = await embedQuery(query);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, vec)})`;

  return db
    .select({ ...COLUMNS, score: similarity })
    .from(chunks)
    // Upotus voi puuttua, jos indeksointi ajettiin ilman avainta ja ilman
    // esilaskettua tiedostoa. NULL ei saa osallistua etäisyyslaskentaan.
    .where(
      and(
        isNotNull(chunks.embedding),
        opts.ignoreFloor ? undefined : gt(similarity, RELEVANCE_FLOOR_VECTOR),
      ),
    )
    .orderBy(desc(similarity))
    .limit(k);
}

/**
 * Leksikaalinen haku Postgresin tekstihaulla. Ei vaadi API-avainta.
 *
 * Sama paluumuoto kuin vektorihaulla, jotta työkalukerros ei tiedä kummalla
 * polulla se on. Pisteet eivät ole vertailukelpoisia keskenään — siksi
 * kynnykset ovat erikseen.
 *
 * Indeksiä ei ole: 83 katkelmalla sekventiaalinen skannaus kestää
 * millisekunteja. Ensimmäinen asia jonka lisäisin korpuksen kasvaessa on
 * GIN-indeksi lausekkeelle to_tsvector('finnish', …).
 */
export async function searchChunksLexical(
  query: string,
  k = 5,
  opts: SearchOptions = {},
): Promise<Hit[]> {
  const terms = queryWords(query);
  if (!terms.length) return [];
  const q = terms.join(" | ");

  const rank = sql<number>`ts_rank(to_tsvector(${TS_CONFIG}, ${DOC}), to_tsquery(${TS_CONFIG}, ${q}))`;

  return db
    .select({ ...COLUMNS, score: rank })
    .from(chunks)
    .where(
      and(
        sql`to_tsvector(${TS_CONFIG}, ${DOC}) @@ to_tsquery(${TS_CONFIG}, ${q})`,
        opts.ignoreFloor ? undefined : gt(rank, RELEVANCE_FLOOR_LEXICAL),
      ),
    )
    .orderBy(desc(rank))
    .limit(k);
}

/** Työkalukerroksen käyttämä haku. Polku on valittu käynnistyksessä. */
export async function searchChunks(query: string, k = 5): Promise<Hit[]> {
  return SEARCH_MODE === "vector"
    ? searchChunksVector(query, k)
    : searchChunksLexical(query, k);
}
