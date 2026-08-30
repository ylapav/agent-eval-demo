import { callJudge, JUDGE_MODEL, JUDGE_PROVIDER } from "./judge-client";

export { JUDGE_MODEL, JUDGE_PROVIDER };

/**
 * Arvioija on eri TOIMITTAJA kuin agentti.
 *
 * Sama malli arvioisi omaa tyyliään, mutta ongelma ei rajoitu samaan
 * malliin: saman perheen mallit jakavat koulutusdatan ja tyylitaipumukset,
 * joten ne palkitsevat juuri niitä muotoiluja joita agentti tuottaa.
 * Toimittajaraja ei poista ongelmaa — molemmat on koulutettu osin samalla
 * julkisella verkkotekstillä — mutta pienentää sitä olennaisesti.
 *
 * Yhteys on lib/eval/judge-client.ts:ssä. Tämä tiedosto omistaa kehotteen
 * ja tulkinnan, eli mittarin määritelmän, eikä se saa muuttua toimittajan
 * mukana.
 */

const JUDGE_PROMPT = `Saat vastauksen ja joukon lähdekatkelmia.

Pilko vastaus tarkistettaviin väitteisiin. Väite on mikä tahansa lause, joka esittää tosiasian: luku, ehto, aika, ominaisuus, käytäntö. Kohteliaisuudet, kysymykset ja tarjoukset ("voin varata soiton") eivät ole väitteitä.

Merkitse jokainen väite:
- "tuettu" jos se seuraa katkelmista
- "ei_tuettu" jos se ei seuraa, myös silloin kun se on uskottava tai yleisesti tosi

Yleistieto ei riitä tueksi. Vain katkelmat riittävät.

Vastaa PELKKÄNÄ JSONina, ilman selitystä ja ilman koodimerkintöjä:
{"vaitteet":[{"teksti":"...","tuomio":"tuettu"|"ei_tuettu"}]}`;

export type GroundednessResult = {
  total: number;
  supported: number;
  score: number;
  unsupported: string[];
  /** Arvioija ei palauttanut kelvollista JSONia. Tulos ei ole mittaus. */
  judgeFailed: boolean;
};

/**
 * Arvioija ei näe kysymystä eikä sitä, mikä malli vastauksen tuotti.
 *
 * Syy: jos arvioija näkee kysymyksen, se alkaa arvioida vastaako teksti
 * kysymykseen — eli laatua. Se on eri mittari ja se on jo olemassa.
 * Tämä mittari kysyy vain yhtä asiaa: onko tämä väite katkelmissa.
 */
export async function scoreGroundedness(
  answer: string,
  chunks: string[],
): Promise<GroundednessResult> {
  const raw = (
    await callJudge(
      JUDGE_PROMPT,
      `LÄHDEKATKELMAT:\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")}\n\nVASTAUS:\n${answer}`,
    )
  )
    .replace(/```json|```/g, "")
    .trim();

  let parsed: { vaitteet: { teksti: string; tuomio: string }[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Arvioijan epäonnistuminen ei saa näyttää hyvältä tulokselta.
    //
    // score 0 hoitaa sen lähdeperusteisuudessa, mutta ei riitä yksin:
    // kieltäytymismittari päättelee keksimisen väitteiden määrästä, ja
    // total 0 näyttää siellä puhtaalta vastaukselta. Siksi epäonnistuminen
    // on oma lippunsa eikä pääteltävissä luvuista.
    return {
      total: 0,
      supported: 0,
      score: 0,
      unsupported: ["ARVIOIJA_EPAONNISTUI"],
      judgeFailed: true,
    };
  }

  const claims = parsed.vaitteet ?? [];
  const supported = claims.filter((c) => c.tuomio === "tuettu");
  const unsupported = claims
    .filter((c) => c.tuomio !== "tuettu")
    .map((c) => c.teksti);

  return {
    total: claims.length,
    supported: supported.length,
    // Ei väitteitä = ei väärää tietoa. Tämä on tarkoituksella 1, ei 0:
    // "voin varata soiton" on täysin kelvollinen vastaus.
    score: claims.length === 0 ? 1 : supported.length / claims.length,
    unsupported,
    judgeFailed: false,
  };
}
