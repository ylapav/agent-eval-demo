import "@/lib/env";
import { existsSync, readFileSync } from "node:fs";
import { db } from "@/db";
import { chunks as chunksTable } from "@/db/schema";
import {
  readCorpus,
  chunkKey,
  embeddableText,
  EMBEDDINGS_PATH,
  type Chunk,
  type EmbeddingsFile,
} from "./chunker";
import { embedDocuments, canEmbed, EMBED_MODEL } from "./embed";

/**
 * Indeksoi content/*.md kantaan. Kolme tapaa hankkia upotukset:
 *
 *   1. VOYAGE_API_KEY asetettu   → lasketaan nyt (tuorein, maksaa)
 *   2. content/embeddings.json   → luetaan tiedostosta (ilmainen, offline)
 *   3. ei kumpaakaan             → katkelmat ilman upotuksia
 *
 * Kolmas ei ole vika vaan tuettu tila: haku toimii silloin leksikaalisesti
 * (lib/rag/search.ts). Katkelmat on silti indeksoitava, koska leksikaalinen
 * haku lukee samaa taulua. Upotussarake on siksi nullable — "ei upotusta"
 * on todellinen tila, ja nollavektori olisi valhe joka tuottaisi
 * kosinietäisyyksiä jotka näyttävät luvuilta.
 */
type Mode = "voyage" | "esilaskettu" | "ei-upotuksia";

function resolveMode(): { mode: Mode; file: EmbeddingsFile | null } {
  if (canEmbed()) return { mode: "voyage", file: null };

  if (existsSync(EMBEDDINGS_PATH)) {
    const file = JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf8")) as EmbeddingsFile;
    return { mode: "esilaskettu", file };
  }

  return { mode: "ei-upotuksia", file: null };
}

function report(mode: Mode, file: EmbeddingsFile | null, missing: Chunk[], total: number) {
  switch (mode) {
    case "voyage":
      console.log(`upotukset: lasketaan nyt (${EMBED_MODEL})`);
      break;
    case "esilaskettu":
      console.log(
        `upotukset: content/embeddings.json (${file!.model}, laskettu ${file!.generatedAt.slice(0, 10)})`,
      );
      if (missing.length) {
        console.warn(
          [
            "",
            `VAROITUS: ${missing.length}/${total} katkelmaa ilman upotusta.`,
            "Tietopohjaa on muokattu sen jälkeen kun upotukset laskettiin, joten",
            "nämä katkelmat eivät löydy vektorihaulla:",
            ...missing.slice(0, 8).map((c) => `  - ${c.docId} / ${c.heading ?? "(ei otsikkoa)"}`),
            missing.length > 8 ? `  … ja ${missing.length - 8} muuta` : "",
            "",
            "Korjaus: aja `npm run embed` avaimen kanssa.",
            "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      break;
    case "ei-upotuksia":
      console.log(
        [
          "upotukset: EI YHTÄÄN",
          "",
          "VOYAGE_API_KEY puuttuu eikä content/embeddings.json ole olemassa.",
          "Katkelmat indeksoidaan ilman upotuksia, ja haku toimii leksikaalisesti",
          "(Postgresin tekstihaku, suomen stemmer). Tämä on tuettu tila eikä virhe:",
          "demo vastaa kysymyksiin, mutta semanttista hakua ei ole.",
          "",
          "Vektorihaku käyttöön kahdella tavalla:",
          "  - aseta VOYAGE_API_KEY ja aja `npm run index` uudelleen, tai",
          "  - hanki content/embeddings.json (`npm run embed` avaimen kanssa).",
          "",
        ].join("\n"),
      );
      break;
  }
}

async function main() {
  const { files, chunks } = readCorpus();
  const { mode, file } = resolveMode();

  const missing =
    mode === "esilaskettu" ? chunks.filter((c) => !file!.vectors[chunkKey(c)]) : [];

  console.log(`${files.length} dokumenttia, ${chunks.length} katkelmaa`);
  report(mode, file, missing, chunks.length);

  await db.delete(chunksTable);

  const B = 32;
  for (let i = 0; i < chunks.length; i += B) {
    const batch = chunks.slice(i, i + B);

    let vectors: (number[] | null)[];
    if (mode === "voyage") {
      vectors = await embedDocuments(batch.map(embeddableText));
    } else if (mode === "esilaskettu") {
      vectors = batch.map((c) => file!.vectors[chunkKey(c)] ?? null);
    } else {
      vectors = batch.map(() => null);
    }

    await db
      .insert(chunksTable)
      .values(batch.map((c, j) => ({ ...c, embedding: vectors[j] })));
    console.log(`  ${Math.min(i + B, chunks.length)}/${chunks.length}`);
  }

  console.log("valmis");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
