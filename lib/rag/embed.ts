import { createHash } from "node:crypto";

/**
 * Ainoa paikka, joka tietää mitä upotusmallia käytetään.
 *
 * Vaihto toiseen tarjoajaan koskee tätä tiedostoa ja skeeman dimensiota.
 * Jos vaihdat mallia etkä aja indeksointia uudelleen, haku palauttaa hiljaa
 * roskaa: dimensio täsmää mutta vektoriavaruus ei ole sama. Ei virhettä,
 * ei lokiriviä, huonot tulokset.
 */

export const EMBED_DIMENSIONS = 512;

/**
 * Ilman VOYAGE_API_KEY:tä käytetään paikallista tiivistepohjaista upotusta.
 *
 * Se ei ole malli. Se on determinististä kohinaa, jolla voi tarkistaa että
 * putki toimii — skeema, indeksointi, pgvector, HNSW, hakukynnys ja
 * työkalukutsu — ilman yhtään API-avainta. Haun LAATU on sillä olematon.
 *
 * Siksi lib/eval/run.ts kieltäytyy ajamasta tässä tilassa. Vihreä mittari,
 * joka on tuotettu valeupotuksella, on huonompi kuin mittari jota ei ole:
 * mittaamaton järjestelmä tiedetään mittaamattomaksi, mutta väärin mitattuun
 * luotetaan.
 */
export const EMBED_MODE: "voyage" | "local" = process.env.VOYAGE_API_KEY
  ? "voyage"
  : "local";

export const EMBED_MODEL = EMBED_MODE === "voyage" ? "voyage-3-lite" : "local-hash-dev";

type VoyageResponse = { data: { embedding: number[] }[] };

async function callVoyage(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
      input_type: inputType,
      output_dimension: EMBED_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as VoyageResponse;
  return json.data.map((d) => d.embedding);
}

/**
 * Sanatason tiivistys satunnaisprojektioon. Samat sanat → sama vektori,
 * joten osumat ovat toistettavia ja sanaston päällekkäisyys näkyy
 * kosinietäisyydessä. Semantiikkaa siinä ei ole lainkaan.
 */
function localEmbed(text: string): number[] {
  const vec = new Float64Array(EMBED_DIMENSIONS);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const w of words) {
    const h = createHash("sha256").update(w).digest();
    for (let i = 0; i < 8; i++) {
      const idx = h.readUInt16BE(i * 2) % EMBED_DIMENSIONS;
      vec[idx] += h[16 + i] % 2 === 0 ? 1 : -1;
    }
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

async function embed(texts: string[], inputType: "document" | "query") {
  const out =
    EMBED_MODE === "voyage" ? await callVoyage(texts, inputType) : texts.map(localEmbed);

  // Dimensio tarkistetaan joka kutsulla. Halpa tarkistus, estää hiljaisen
  // epäsuhdan indeksin ja kyselyn välillä — se on virheluokka, joka ei
  // näy missään lokissa vaan pelkästään huonoina vastauksina.
  for (const v of out) {
    if (v.length !== EMBED_DIMENSIONS) {
      throw new Error(
        `Odotettiin ${EMBED_DIMENSIONS} ulottuvuutta, saatiin ${v.length}. Skeema ja upotusmalli ovat eri linjassa.`,
      );
    }
  }
  return out;
}

export const embedDocuments = (texts: string[]) => embed(texts, "document");
export const embedQuery = async (text: string) => (await embed([text], "query"))[0];
