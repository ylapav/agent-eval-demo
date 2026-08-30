/**
 * Mallien hinnat ja kyvyt yhdessä paikassa.
 *
 * Hinnat ovat USD per miljoona tokenia. Ne ovat koodissa siksi, että
 * kustannusarvio lasketaan jokaisesta vuorosta ja kirjataan kantaan:
 * yksikkötalous mitataan tuotannosta eikä arvioida jälkikäteen laskusta.
 * Hinnasto muuttuu, joten tämä tiedosto vanhenee — se on tarkoituksella
 * yksi tiedosto, jotta vanhenemisen näkee ja korjaa yhdestä paikasta.
 *
 * Tarkistettu: 2026-08-28
 */
export type ModelSpec = {
  /** USD / 1M syötetokenia */
  input: number;
  /** USD / 1M vastaustokenia */
  output: number;
  /** Tukeeko output_config.effort -parametria. Haiku ei tue: 400. */
  effort: boolean;
  /** Tukeeko adaptiivista ajattelua. */
  thinking: boolean;
  /** Toimittaja. Evaluoinnin ajaja vaatii, että agentti ja arvioija eroavat. */
  provider: "anthropic" | "openai";
};

const A = "anthropic" as const;
const O = "openai" as const;

export const MODELS: Record<string, ModelSpec> = {
  // ── Anthropic: agentti ja vertailuagentti ───────────────────────────
  "claude-fable-5": { input: 10, output: 50, effort: true, thinking: true, provider: A },
  "claude-opus-5": { input: 5, output: 25, effort: true, thinking: true, provider: A },
  "claude-opus-4-8": { input: 5, output: 25, effort: true, thinking: true, provider: A },
  "claude-opus-4-7": { input: 5, output: 25, effort: true, thinking: true, provider: A },
  "claude-opus-4-6": { input: 5, output: 25, effort: true, thinking: true, provider: A },
  "claude-sonnet-5": { input: 2, output: 10, effort: true, thinking: true, provider: A },
  "claude-sonnet-4-6": { input: 3, output: 15, effort: true, thinking: true, provider: A },
  "claude-haiku-4-5": { input: 1, output: 5, effort: false, thinking: false, provider: A },
  // Päivämäärällinen muoto on eri avain kuin päivämäärätön. Ilman tätä
  // riviä MODEL_ID=claude-haiku-4-5-20251001 olisi tuntematon malli ja
  // kustannus kirjautuisi nollaksi — hiljaisesti.
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    effort: false,
    thinking: false,
    provider: A,
  },

  // ── OpenAI: arvioija ────────────────────────────────────────────────
  // Hinnasto tarkistettu developers.openai.com/api/docs/pricing 2026-08-30.
  // Arvioijaksi valittu halvin malli, joka läpäisee viiden käsin tehdyn
  // parin testin (scripts/judge-check.ts). Jos se erehtyy, seuraava askel
  // on gpt-4o-mini: arvioijan virhe on mittarin virhe.
  "gpt-5-nano": { input: 0.05, output: 0.4, effort: false, thinking: false, provider: O },
  "gpt-4o-mini": { input: 0.15, output: 0.6, effort: false, thinking: false, provider: O },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, effort: false, thinking: false, provider: O },
};

/**
 * Upotusmallin hinta, USD / 1M tokenia.
 * Tarkistettu developers.openai.com/api/docs/pricing 2026-08-30.
 */
export const EMBED_PRICE_PER_MTOK = 0.02;

/** Tuntematon malli: ei hinnastoa, ei arvausta. Nolla on väärä luku,
 *  mutta se on näkyvästi väärä. Keksitty hinta olisi näkymättömästi väärä. */
export const UNKNOWN_MODEL: ModelSpec = {
  input: 0,
  output: 0,
  effort: false,
  thinking: false,
  provider: "anthropic",
};

const varoitettu = new Set<string>();

/**
 * Tuntematon malli varoittaa kerran.
 *
 * Nolla on väkisin väärä hinta, mutta ilman varoitusta se on
 * NÄKYMÄTTÖMÄSTI väärä: kustannussarake näyttäisi nollaa eikä kukaan
 * kysyisi miksi. Tämä sattui kerran oikeasti — MODEL_ID sai
 * päivämäärällisen muodon, jota taulukossa ei ollut.
 */
export function specFor(id: string): ModelSpec {
  const spec = MODELS[id];
  if (spec) return spec;
  if (!varoitettu.has(id)) {
    varoitettu.add(id);
    console.warn(
      `[models] tuntematon malli "${id}" — kustannus kirjataan nollaksi. Lisää se lib/agent/models.ts:ään.`,
    );
  }
  return UNKNOWN_MODEL;
}

/** Välimuistin kertoimet suhteessa syötetokenin hintaan. */
export const CACHE_MULTIPLIER = { read: 0.1, write: 1.25 } as const;

export function estimateCostUsd(
  modelId: string,
  u: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  const s = specFor(modelId);
  return (
    (u.input / 1e6) * s.input +
    (u.output / 1e6) * s.output +
    (u.cacheRead / 1e6) * s.input * CACHE_MULTIPLIER.read +
    (u.cacheWrite / 1e6) * s.input * CACHE_MULTIPLIER.write
  );
}
