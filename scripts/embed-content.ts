import "@/lib/env";
import { writeFileSync } from "node:fs";
import {
  readCorpus,
  chunkKey,
  embeddableText,
  EMBEDDINGS_PATH,
  type EmbeddingsFile,
} from "@/lib/rag/chunker";
import { embedDocuments, EMBED_MODEL, EMBED_DIMENSIONS, canEmbed } from "@/lib/rag/embed";

/**
 * Laskee tietopohjan upotukset kerran ja kirjoittaa ne tiedostoon.
 *
 * Miksi tämä on olemassa: katkelmien upotukset voi laskea etukäteen, mutta
 * KÄYTTÄJÄN KYSELYN upotus vaatii API-kutsun joka kerta. Tämä tiedosto
 * ratkaisee siis vain puolet ongelmasta — se poistaa avaimen tarpeen
 * indeksoinnista, ei hausta. Toinen puoli on leksikaalinen hakupolku
 * (lib/rag/search.ts).
 *
 * Tiedosto on tarkoitettu versionhallintaan. Se on ~1 MB, ja se on hinta
 * siitä että tuore kloonaus indeksoi tietopohjan ilman verkkoyhteyttä.
 *
 * Tiedosto voi vanhentua, jos markdownia muokataan ajamatta tätä uudelleen.
 * Siksi jokaisella katkelmalla on sisällöstä laskettu tunniste: indeksoija
 * vertaa tunnisteita ja kertoo mitkä katkelmat ovat jääneet ilman upotusta.
 * Hiljainen vanhentuminen olisi juuri se virheluokka, jota tämä repo
 * muuten käsittelee.
 */
async function main() {
  if (!canEmbed()) {
    console.error(
      [
        "",
        "VOYAGE_API_KEY puuttuu, joten upotuksia ei voi laskea.",
        "",
        "Tämä komento on tarkoitettu ajettavaksi kerran avaimen kanssa, jotta",
        "content/embeddings.json syntyy ja muut voivat indeksoida ilman avainta.",
        "",
      ].join("\n"),
    );
    process.exit(2);
  }

  const { files, chunks } = readCorpus();
  console.log(`${files.length} dokumenttia, ${chunks.length} katkelmaa`);
  console.log(`upotusmalli: ${EMBED_MODEL} (${EMBED_DIMENSIONS}d)`);

  const vectors: Record<string, number[]> = {};
  const B = 32;
  for (let i = 0; i < chunks.length; i += B) {
    const batch = chunks.slice(i, i + B);
    const vecs = await embedDocuments(batch.map(embeddableText));
    batch.forEach((c, j) => {
      // Pyöristys kuudella desimaalilla. Kosinietäisyyteen se ei vaikuta
      // mitattavasti, mutta tiedostokoko putoaa noin kolmannekseen.
      vectors[chunkKey(c)] = vecs[j].map((x) => Number(x.toFixed(6)));
    });
    console.log(`  ${Math.min(i + B, chunks.length)}/${chunks.length}`);
  }

  const out: EmbeddingsFile = {
    model: EMBED_MODEL,
    dimensions: EMBED_DIMENSIONS,
    generatedAt: new Date().toISOString(),
    vectors,
  };

  writeFileSync(EMBEDDINGS_PATH, `${JSON.stringify(out)}\n`, "utf8");
  console.log(`kirjoitettu content/embeddings.json (${Object.keys(vectors).length} vektoria)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
