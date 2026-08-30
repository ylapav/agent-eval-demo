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
};

export const MODELS: Record<string, ModelSpec> = {
  "claude-fable-5": { input: 10, output: 50, effort: true, thinking: true },
  "claude-opus-5": { input: 5, output: 25, effort: true, thinking: true },
  "claude-opus-4-8": { input: 5, output: 25, effort: true, thinking: true },
  "claude-opus-4-7": { input: 5, output: 25, effort: true, thinking: true },
  "claude-opus-4-6": { input: 5, output: 25, effort: true, thinking: true },
  "claude-sonnet-5": { input: 2, output: 10, effort: true, thinking: true },
  "claude-sonnet-4-6": { input: 3, output: 15, effort: true, thinking: true },
  "claude-haiku-4-5": { input: 1, output: 5, effort: false, thinking: false },
};

/** Tuntematon malli: ei hinnastoa, ei arvausta. Nolla on väärä luku,
 *  mutta se on näkyvästi väärä. Keksitty hinta olisi näkymättömästi väärä. */
export const UNKNOWN_MODEL: ModelSpec = {
  input: 0,
  output: 0,
  effort: false,
  thinking: false,
};

export const specFor = (id: string): ModelSpec => MODELS[id] ?? UNKNOWN_MODEL;

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
