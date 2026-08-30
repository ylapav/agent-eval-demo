import "./lib/env";
import { defineConfig } from "drizzle-kit";

/**
 * Vain `drizzle-kit generate` käyttää tätä: skeema → SQL-migraatio tiedostoon
 * drizzle/. Migraatioiden AJAMINEN on scripts/migrate.ts, koska se osaa
 * kolme ajuria ja luo pgvector-laajennuksen ennen ensimmäistä taulua.
 *
 * `drizzle-kit push` on tarkoituksella pois käytöstä: se vertaa skeemaa
 * elävään kantaan ja keksii diffin lennossa. Demossa se on kätevää ja
 * tuotannossa se on tapa pudottaa sarake vahingossa.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://localhost/placeholder" },
});
