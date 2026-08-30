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
import { embedDocuments, canEmbed, EMBED_MODEL, EMBED_DIMENSIONS } from "./embed";

/**
 * Indeksoi content/*.md kantaan. Kolme tapaa hankkia upotukset:
 *
 *   1. OPENAI_API_KEY asetettu   → lasketaan nyt (tuorein, maksaa)
 *   2. content/embeddings.json   → luetaan tiedostosta (ilmainen, offline)
 *   3. ei kumpaakaan             → katkelmat ilman upotuksia
 *
 * Kolmas ei ole vika vaan tuettu tila: haku toimii silloin leksikaalisesti
 * (lib/rag/search.ts). Katkelmat on silti indeksoitava, koska leksikaalinen
 * haku lukee samaa taulua. Upotussarake on siksi nullable — "ei upotusta"
 * on todellinen tila, ja nollavektori olisi valhe joka tuottaisi
 * kosinietäisyyksiä jotka näyttävät luvuilta.
 */
const NL = String.fromCharCode(10);

type Mode = "voyage" | "esilaskettu" | "ei-upotuksia";

/**
 * Tarkistaa esilasketun tiedoston muodon. Palauttaa syyn tai null.
 *
 * Sama periaate kuin embed.ts:n dimensiotarkistuksessa: väärä vektori on
 * hiljainen virhe, joka näkyy vain huonoina hakutuloksina. Erona se, että
 * tämä polku on nimenomaan se, joka ajetaan ILMAN avainta — eli se jota
 * kukaan ei ole tarkistamassa.
 */
function validate(): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf8"));
  } catch (e) {
    return `ei ole kelvollista JSONia: ${e instanceof Error ? e.message : String(e)}`;
  }

  const f = raw as Partial<EmbeddingsFile>;
  if (!f || typeof f !== "object") return "ei ole objekti";
  if (typeof f.model !== "string") return "kentta 'model' puuttuu";
  if (f.dimensions !== EMBED_DIMENSIONS)
    return `dimensio on ${f.dimensions}, odotettiin ${EMBED_DIMENSIONS}`;
  if (f.model !== EMBED_MODEL)
    return `laskettu mallilla ${f.model}, koodi odottaa mallia ${EMBED_MODEL}`;
  if (!f.vectors || typeof f.vectors !== "object") return "kentta 'vectors' puuttuu";

  const eka = Object.values(f.vectors)[0];
  if (eka !== undefined && (!Array.isArray(eka) || eka.length !== EMBED_DIMENSIONS))
    return `vektorin pituus on ${Array.isArray(eka) ? eka.length : "tuntematon"}, odotettiin ${EMBED_DIMENSIONS}`;

  return null;
}

function resolveMode(): { mode: Mode; file: EmbeddingsFile | null } {
  if (canEmbed()) return { mode: "voyage", file: null };

  if (existsSync(EMBEDDINGS_PATH)) {
    // Tiedosto validoidaan ennen käyttöä. Pelkkä olemassaolo ei riitä:
    // keskeytynyt `npm run embed` jättää juuri tällaisen puolikkaan
    // tiedoston, ja ilman tarkistusta se kaatoi koko `npm run setup`:n
    // selittämättömään TypeErroriin. Repon kärkilupaus on että setup
    // toimii ilman avaimia, joten se ei saa hajota siihen.
    const ongelma = validate();
    if (ongelma) {
      console.warn(
        [
          "",
          `VAROITUS: content/embeddings.json ei kelpaa (${ongelma}).`,
          "Indeksoidaan ilman upotuksia ja haku käyttää leksikaalista polkua.",
          "Korjaus: aja `npm run embed` uudelleen avaimen kanssa.",
          "",
        ].join(NL),
      );
      return { mode: "ei-upotuksia", file: null };
    }
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
          "OPENAI_API_KEY puuttuu eikä content/embeddings.json ole olemassa.",
          "Katkelmat indeksoidaan ilman upotuksia, ja haku toimii leksikaalisesti",
          "(Postgresin tekstihaku, suomen stemmer). Tämä on tuettu tila eikä virhe:",
          "demo vastaa kysymyksiin, mutta semanttista hakua ei ole.",
          "",
          "Vektorihaku käyttöön kahdella tavalla:",
          "  - aseta OPENAI_API_KEY ja aja `npm run index` uudelleen, tai",
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

    await db.insert(chunksTable).values(
      batch.map((c, j) => ({
        ...c,
        embedding: vectors[j],
        // Malli kirjataan riville, jotta epäsuhta indeksin ja kyselyn
        // välillä on havaittavissa. NULL = ei upotusta.
        embedModel: vectors[j] ? EMBED_MODEL : null,
      })),
    );
    console.log(`  ${Math.min(i + B, chunks.length)}/${chunks.length}`);
  }

  console.log("valmis");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
