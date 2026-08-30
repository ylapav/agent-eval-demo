import "@/lib/env";
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Yksi tietokantayhteys, kolme ajuria.
 *
 * Ajuri valitaan DATABASE_URL:n muodosta, ei erillisestä lipusta. Lippu ja URL
 * voivat mennä eri linjaan, ja silloin sovellus kirjoittaa hiljaa väärään
 * kantaan. URL on ainoa totuus.
 *
 *   ei URL:ia / pglite:…   → PGlite (Postgres WASM-muodossa, hakemistona .data/pg)
 *   *.neon.tech            → Neon serverless (HTTP)
 *   muu postgres://        → tavallinen Postgres (postgres.js)
 *
 * PGlite on mukana siksi, että demon pitää käynnistyä ilman Dockeria ja ilman
 * pilvitiliä. Se on oikea Postgres oikealla pgvectorilla ja HNSW-indeksillä,
 * ei muistinvarainen jäljitelmä. Hakukerros on siis bitilleen sama kaikissa
 * moodeissa — jos se olisi eri, evaluointi mittaisi eri järjestelmää kuin
 * se joka menee tuotantoon.
 */
export type DbMode = "pglite" | "neon" | "postgres";

const HYVAKSYTYT =
  'tyhjä (PGlite hakemistoon .data/pg) | "pglite:<hakemisto>" | "pglite:memory://" | "postgres://…" | "postgresql://…"';

type Resolved = {
  mode: DbMode;
  /** Lokiin kelpaava tunniste: isäntänimi tai hakemisto. Ei koskaan tunnuksia. */
  label: string;
  /** PGliten kohde: hakemisto tai "memory://". */
  pgliteTarget: string;
};

/**
 * DATABASE_URL → ajuri, tai poikkeus.
 *
 * Aiemmin tuntematon muoto putosi hiljaa postgres-haaraan. Se on täsmälleen
 * se virheluokka, jota tämä repo muuten käsittelee: väärä valinta ilman
 * virhettä, oire vasta myöhemmin ja väärässä paikassa. Kirjoitusvirhe
 * Neonin osoitteessa olisi tarkoittanut yhteysyritystä väärään paikkaan
 * ja virheilmoitusta, joka puhuu verkosta eikä konfiguraatiosta.
 *
 * Tuntematon muoto kaataa käynnistyksen. Se on ainoa hetki, jolloin
 * korjaaminen on halpaa.
 */
function resolveUrl(raw: string | undefined): Resolved {
  const url = raw?.trim();

  if (!url) return { mode: "pglite", label: ".data/pg", pgliteTarget: ".data/pg" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Arvoa ei toisteta virheeseen: väärin kirjoitettukin URL voi sisältää
    // salasanan, ja virheilmoitukset päätyvät lokeihin ja tikettijärjestelmiin.
    throw new Error(
      `DATABASE_URL ei ole kelvollinen URL. Arvoa ei tulosteta, koska se voi sisältää tunnuksia. Hyväksytyt muodot: ${HYVAKSYTYT}`,
    );
  }

  if (parsed.protocol === "pglite:") {
    const target = url.slice("pglite:".length) || ".data/pg";
    const memory = target === "memory://" || target === "memory:";
    return {
      mode: "pglite",
      label: memory ? "in-memory" : target,
      pgliteTarget: memory ? "memory://" : target,
    };
  }

  if (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") {
    if (!parsed.hostname) {
      throw new Error(
        `DATABASE_URL:sta puuttuu isäntänimi. Hyväksytyt muodot: ${HYVAKSYTYT}`,
      );
    }
    // Neon tunnistetaan isäntänimen loppuliitteestä, ei osajonosta:
    // "evil.neon.tech.example.com" ei ole Neon.
    const neonHost = /(^|\.)neon\.tech$/i.test(parsed.hostname);
    return {
      mode: neonHost ? "neon" : "postgres",
      label: parsed.hostname,
      pgliteTarget: ".data/pg",
    };
  }

  throw new Error(
    `DATABASE_URL:n protokolla "${parsed.protocol}" ei ole tuettu. Hyväksytyt muodot: ${HYVAKSYTYT}`,
  );
}

const resolved = resolveUrl(process.env.DATABASE_URL);

export const DB_MODE: DbMode = resolved.mode;

/** PGliten datahakemisto. Poista se, jos haluat aloittaa puhtaalta pöydältä. */
export const PGLITE_DIR = resolved.pgliteTarget;

/**
 * Yksi rivi käynnistyksessä. Ilman sitä ainoa tapa tietää mihin kantaan
 * sovellus puhuu on päätellä se ympäristömuuttujasta, jota ei näe ajon
 * aikana. Isäntänimi riittää tunnistamiseen; käyttäjätunnus, salasana ja
 * kyselyparametrit eivät kuulu lokiin.
 */
console.log(`[db] driver=${resolved.mode} url=${resolved.label}`);

function build() {
  if (DB_MODE === "neon") return drizzleNeon(neon(process.env.DATABASE_URL!), { schema });
  if (DB_MODE === "postgres")
    return drizzlePostgres(postgres(process.env.DATABASE_URL!, { max: 1 }), { schema });
  // PGliten oma mkdir ei ole rekursiivinen: se olettaa että .data on jo
  // olemassa ja kaatuu muuten ENOENTiin, joka näyttää laajennusvirheeltä.
  if (PGLITE_DIR !== "memory://") mkdirSync(PGLITE_DIR, { recursive: true });
  return drizzlePglite(new PGlite(PGLITE_DIR, { extensions: { vector } }), { schema });
}

/**
 * Kolme ajuria tuottavat kolme eri tyyppiä, joiden unioni ei ole
 * käyttökelpoinen: jokainen kutsu vaatisi kaventamisen. Kyselynrakennus
 * (select/insert/update/delete) on kaikissa sama, joten tyyppi kiinnitetään
 * yhteen ja ero hoidetaan siellä missä se oikeasti on — execute()-tuloksen
 * muodossa, johon on alla oma apufunktionsa.
 *
 * Mitä tämä maksaa: transaktiot eivät ole käytettävissä neon-http-ajurilla,
 * vaikka tyyppi lupaa ne. Tässä sovelluksessa niitä ei käytetä. Jos niitä
 * joskus tarvitaan, tämä rivi on paikka jossa se pitää ratkaista.
 */
type Database = ReturnType<typeof drizzlePglite<typeof schema>>;

let instance: Database | null = null;

const connect = (): Database => (instance ??= build() as unknown as Database);

/**
 * Yhteys muodostetaan vasta ensimmäisellä käytöllä, ei moduulia ladattaessa.
 *
 * Ilman tätä pelkkä `import { db }` käynnistää Postgresin. Next lataa
 * moduuligraafin myös rakennusvaiheessa sivujen keräämistä varten, jolloin
 * PGliten WASM käynnistyi ja kaatui kesken buildin ("RuntimeError: Aborted").
 * Build meni silti läpi, mikä on pahin muoto: virhe joka näkyy lokissa
 * mutta ei estä julkaisua.
 *
 * Sama laiskuus auttaa serverless-ajossa: kylmäkäynnistys ei maksa
 * yhteydenmuodostusta, jos pyyntö ei koske kantaa.
 */
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const real = connect() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/**
 * execute() palauttaa eri muodon eri ajurilla: postgres.js antaa taulukon,
 * Neon ja PGlite antavat objektin jossa on rows. Ero on hiljainen —
 * väärä oletus tuottaa undefinedin eikä virhettä — joten se kanavoidaan
 * yhden funktion läpi.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = (result as { rows?: T[] }).rows;
  return r ?? [];
}
