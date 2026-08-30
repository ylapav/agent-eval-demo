import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /**
   * Työtilan juuri kiinnitetään tähän hakemistoon.
   *
   * Next päättelee juuren lähimmästä lockfilesta ylöspäin. Jos käyttäjän
   * kotihakemistossa sattuu olemaan package-lock.json, juureksi valikoituu
   * koko kotihakemisto — ja tiedostojäljitys joko varoittaa tai pakkaa
   * mukaan mitä sattuu. Vercel-julkaisussa se on ero toimivan ja
   * turvottuneen paketin välillä.
   */
  outputFileTracingRoot: here,
  turbopack: { root: here },

  /**
   * PGlite ja sen pgvector-laajennus ovat WASM-paketteja, jotka lataavat
   * .wasm- ja .tar.gz-tiedostonsa ajonaikaisesti tiedostojärjestelmästä.
   *
   * Bundlattuna niiden tiedostonimiin lisätään sisältötiiviste, jolloin
   * lataus epäonnistuu virheeseen "Extension bundle not found" — eikä
   * kaada rakennusta vaan pudottaa vektorityypin hiljaa pois. Molemmat
   * paketit on siis pidettävä ulkoisina.
   *
   * Vercel-ajossa näitä ei käytetä lainkaan (DATABASE_URL osoittaa
   * Neoniin), mutta ne ovat riippuvuuspuussa, joten sääntö tarvitaan
   * myös siellä.
   */
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
};

export default nextConfig;
