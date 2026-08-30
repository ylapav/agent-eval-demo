import "@/lib/env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db, rowsOf, DB_MODE, PGLITE_DIR } from "@/db";

/**
 * Ajaa drizzle/-hakemiston migraatiot valitulla ajurilla.
 *
 * Miksi tämä eikä `drizzle-kit migrate`: drizzle-kitin oma ajaja ei osaa
 * PGliteä samalla konfiguraatiolla kuin Neonia, ja pgvector-laajennus on
 * luotava ennen ensimmäistä `vector`-saraketta. Ilman sitä migraatio kaatuu
 * virheeseen `type "vector" does not exist`, joka ei kerro mitään syystä.
 *
 * Migraatiot ovat idempotentteja tämän kirjanpitotaulun kautta:
 * jokainen tiedosto ajetaan kerran ja kirjataan.
 */
async function main() {
  console.log(`ajuri: ${DB_MODE}${DB_MODE === "pglite" ? ` (${PGLITE_DIR})` : ""}`);

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const done = new Set(
    rowsOf<{ name: string }>(
      await db.execute(sql`SELECT name FROM _migrations;`),
    ).map((r) => r.name),
  );

  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const body = readFileSync(join(dir, f), "utf8");
    // Drizzle erottaa lauseet tällä vartijalla. Emme voi ajaa koko tiedostoa
    // yhtenä lauseena, koska osa ajureista sallii vain yhden per kutsu.
    for (const stmt of body.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await db.execute(sql.raw(s));
    }
    await db.execute(sql`INSERT INTO _migrations (name) VALUES (${f});`);
    console.log(`  + ${f}`);
    applied++;
  }

  console.log(applied ? `${applied} migraatiota ajettu` : "ei uusia migraatioita");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
