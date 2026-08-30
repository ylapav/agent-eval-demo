/**
 * Ainoa paikka, joka tietää mitä upotusmallia käytetään.
 *
 * Vaihto toiseen tarjoajaan koskee tätä tiedostoa. Skeeman dimensio pysyy
 * 512:na, koska OpenAI:n upotusmallit tukevat `dimensions`-parametria:
 * vektori katkaistaan palvelinpuolella ja normalisoidaan uudelleen.
 *
 * Tässä ei ole varamallia. Aiemmin oli: ilman avainta upotukset korvattiin
 * paikallisella tiivistefunktiolla, jotta putki toimisi offline. Se poistui,
 * koska sama tarve hoituu rehellisemmin kahdella muulla tavalla —
 * esilasketut upotukset (`npm run embed`, content/embeddings.json) ja
 * leksikaalinen hakupolku (lib/rag/search.ts). Kumpikaan ei teeskentele
 * olevansa semanttinen malli.
 */
export const EMBED_PROVIDER = "openai";
export const EMBED_MODEL = "text-embedding-3-small";

/**
 * 512 eikä mallin oletus 1536.
 *
 * OpenAI:n v3-mallit on koulutettu Matryoshka-esityksellä, joten lyhennetty
 * vektori säilyttää valtaosan erottelukyvystään. 83 katkelmalle 1536
 * ulottuvuutta on hukkaa: se kolminkertaistaa indeksin koon ja
 * content/embeddings.json:in ilman mitattavaa hyötyä.
 *
 * Jos muutat tätä, muuta myös db/schema.ts:n vector(512) ja aja
 * `npm run index` uudelleen.
 */
export const EMBED_DIMENSIONS = 512;

/** Onko elävä upotuskutsu mahdollinen. Kyselyn upotus vaatii aina avaimen. */
export const canEmbed = () => Boolean(process.env.OPENAI_API_KEY);

type OpenAIEmbeddingResponse = {
  data: { embedding: number[]; index: number }[];
};

/**
 * Yksi kutsu upotusrajapintaan.
 *
 * Dokumentti ja kysely upotetaan täsmälleen samalla tavalla — OpenAI:lla ei
 * ole Voyagen `input_type`-parametria, joka erotteli ne. Se on yksi
 * mahdollinen laadun lähde vähemmän ja yksi virheen lähde vähemmän: väärä
 * input_type on hiljainen virhe, joka näkyy vain huonoina osumina.
 */
async function callOpenAI(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY puuttuu, joten upotusta ei voi laskea. Kyselyn upotus vaatii avaimen aina — esilasketut upotukset kattavat vain katkelmat. Ilman avainta haku käyttää leksikaalista polkua (lib/rag/search.ts).",
    );
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
      dimensions: EMBED_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as OpenAIEmbeddingResponse;

  // Järjestetään index-kentän mukaan. Rajapinta ei lupaa palauttaa
  // vektoreita samassa järjestyksessä kuin syötteet, ja väärä järjestys
  // liittäisi jokaisen upotuksen väärään katkelmaan — mikä ei kaadu
  // mihinkään vaan näkyy pelkästään käsittämättöminä hakutuloksina.
  const out = json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  if (out.length !== texts.length) {
    throw new Error(
      `Pyydettiin ${texts.length} upotusta, saatiin ${out.length}. Erä ja vastaus eivät vastaa toisiaan.`,
    );
  }

  // Dimensio tarkistetaan joka kutsulla. Halpa tarkistus, estää hiljaisen
  // epäsuhdan indeksin ja kyselyn välillä — se on virheluokka, joka ei näy
  // missään lokissa vaan pelkästään huonoina vastauksina.
  for (const v of out) {
    if (v.length !== EMBED_DIMENSIONS) {
      throw new Error(
        `Odotettiin ${EMBED_DIMENSIONS} ulottuvuutta, saatiin ${v.length}. Skeema ja upotusmalli ovat eri linjassa.`,
      );
    }
  }

  return out;
}

export const embedDocuments = (texts: string[]) => callOpenAI(texts);
export const embedQuery = async (text: string) => (await callOpenAI([text]))[0];
