/**
 * Tallennettujen ajojen tiedostomuoto.
 *
 * Tällä moduulilla ei ole yhtään importtia, ja se on tarkoituksellista:
 * sekä nauhoitusskripti (joka kutsuu mallia) että /demo-reitti (joka ei saa
 * kutsua) lukevat saman sopimuksen. Jos tyypit asuisivat lib/agent/loop.ts:ssä,
 * /demo vetäisi Anthropic-SDK:n mukaansa pelkän tyyppi-importin takia — ja
 * tyyppi-importti muuttuu ajonaikaiseksi importiksi yhdellä huolimattomalla
 * muokkauksella. tests/demo-cost.test.ts pitää tästä huolta.
 */

export type DemoAnnotationType =
  | "injection_blocked"
  | "guard_blocked"
  | "write_ok"
  | "refusal_ok"
  | "retrieval";

export type DemoAnnotation = {
  type: DemoAnnotationType;
  text: string;
};

export type DemoToolCall = {
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  ms: number;
};

export type DemoTurn = {
  user: string;
  toolCalls: DemoToolCall[];
  assistant: string;
  meta: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  annotation?: DemoAnnotation;
};

export type DemoConversation = {
  id: string;
  label: string;
  why: string;
  turns: DemoTurn[];
};

export type DemoRuns = {
  recordedAt: string;
  modelId: string;
  promptHash: string;
  searchMode: string;
  note: string;
  conversations: DemoConversation[];
};

/** Kirjoittavat työkalut. Annotaatioiden tarkistus tarvitsee tämän. */
export const DEMO_WRITE_TOOLS = ["varaa_soitto", "luo_tiketti"];

/** Lukevat työkalut. */
export const DEMO_READ_TOOLS = ["hae_tietopohjasta", "hae_tuotteet"];

/** Yksi rivi /demo-sivun yläreunaan. Sama teksti myös tiedoston juuressa. */
export const DEMO_NOTE =
  "Tallennettuja ajoja. Jokainen vastaus, työkalukutsu ja katkelma on todellinen tuotos. Aja itse: npm install && npm run setup && npm run dev";
