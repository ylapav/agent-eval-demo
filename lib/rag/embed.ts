/**
 * Ainoa paikka, joka tietää mitä upotusmallia käytetään.
 *
 * Vaihto toiseen tarjoajaan koskee tätä tiedostoa ja skeeman dimensiota.
 * Jos vaihdat mallia etkä aja indeksointia uudelleen, haku palauttaa hiljaa
 * roskaa: dimensio täsmää mutta vektoriavaruus ei ole sama. Ei virhettä,
 * ei lokiriviä, huonot tulokset.
 *
 * Tässä ei ole varamallia. Aiemmin oli: ilman avainta upotukset korvattiin
 * paikallisella tiivistefunktiolla, jotta putki toimisi offline. Se poistui,
 * koska sama tarve hoituu rehellisemmin kahdella muulla tavalla —
 * esilasketut upotukset (`npm run embed`, content/embeddings.json) ja
 * leksikaalinen hakupolku (lib/rag/search.ts). Kumpikaan ei teeskentele
 * olevansa semanttinen malli.
 */
export const EMBED_MODEL = "voyage-3-lite";
export const EMBED_DIMENSIONS = 512;

/** Onko elävä upotuskutsu mahdollinen. Kyselyn upotus vaatii aina avaimen. */
export const canEmbed = () => Boolean(process.env.VOYAGE_API_KEY);

type VoyageResponse = { data: { embedding: number[] }[] };

async function callVoyage(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error(
      "VOYAGE_API_KEY puuttuu, joten upotusta ei voi laskea. Kyselyn upotus vaatii avaimen aina — esilasketut upotukset kattavat vain katkelmat. Ilman avainta haku käyttää leksikaalista polkua (lib/rag/search.ts).",
    );
  }

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
  const out = json.data.map((d) => d.embedding);

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

export const embedDocuments = (texts: string[]) => callVoyage(texts, "document");
export const embedQuery = async (text: string) =>
  (await callVoyage([text], "query"))[0];
