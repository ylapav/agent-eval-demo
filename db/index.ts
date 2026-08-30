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

const url = process.env.DATABASE_URL?.trim();

export const DB_MODE: DbMode =
  !url || url.startsWith("pglite:")
    ? "pglite"
    : /\.neon\.tech(:|\/|$)/.test(url)
      ? "neon"
      : "postgres";

/** PGliten datahakemisto. Poista se, jos haluat aloittaa puhtaalta pöydältä. */
export const PGLITE_DIR =
  url?.startsWith("pglite:") ? url.slice("pglite:".length) || ".data/pg" : ".data/pg";

function build() {
  if (DB_MODE === "neon") return drizzleNeon(neon(url!), { schema });
  if (DB_MODE === "postgres") return drizzlePostgres(postgres(url!, { max: 1 }), { schema });
  // PGliten oma mkdir ei ole rekursiivinen: se olettaa että .data on jo
  // olemassa ja kaatuu muuten ENOENTiin, joka näyttää laajennusvirheeltä.
  mkdirSync(PGLITE_DIR, { recursive: true });
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
