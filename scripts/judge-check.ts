import "@/lib/env";
import { scoreGroundedness, JUDGE_MODEL, JUDGE_PROVIDER } from "@/lib/eval/groundedness";

/**
 * Tarkistaa arvioijan ennen kuin sillä mitataan mitään.
 *
 * Arvioijaksi on valittu halvin malli, joka selviää tehtävästä. "Halvin
 * joka selviää" on väite, ja tämä skripti on sen todiste: viisi käsin
 * tehtyä vastaus–katkelma-paria, joissa oikea tuomio tiedetään etukäteen.
 *
 * Miksi tämä on olemassa: arvioijan virhe ei näy mittarissa virheenä vaan
 * lukuna. Liian pieni malli, joka luulee yleistietoa katkelman tueksi,
 * nostaa lähdeperusteisuutta juuri siellä missä agentti on väärässä — ja
 * tulos näyttää paremmalta kuin järjestelmä on. Se on pahin mahdollinen
 * vinouma tässä repossa.
 *
 * Odotukset on muotoiltu kestämään väitteiden pilkkomisen vaihtelua: ei
 * väitetä montako väitettä mallin pitäisi löytää, vaan mitä sen pitää
 * tuomita tukemattomaksi.
 */
type Pari = {
  nimi: string;
  vastaus: string;
  katkelmat: string[];
  /** Mitä oikean arvioijan on pakko todeta. */
  odotus: (r: { total: number; supported: number; unsupported: string[] }) => boolean;
  selite: string;
};

const KATKELMA_TAKUU =
  "Julkisivulevyillä takuu on 15 vuotta ostopäivästä. Kattopelleillä takuu on 20 vuotta. Kiinnikkeillä ja listoilla takuu on 5 vuotta. Takuuaika lasketaan laskun päiväyksestä, ei asennuspäivästä.";

const KATKELMA_TOIMITUS =
  "Pohjois-Suomi (Oulu, Kajaani, Rovaniemi): 4 arkipäivää. Alle 1 000 euron tilauksissa rahti on 89 euroa.";

const PARIT: Pari[] = [
  {
    nimi: "1. täysin tuettu",
    vastaus:
      "Kattopelleillä takuu on 20 vuotta. Takuuaika lasketaan laskun päiväyksestä.",
    katkelmat: [KATKELMA_TAKUU],
    odotus: (r) => r.total > 0 && r.unsupported.length === 0,
    selite: "jokainen väite löytyy katkelmasta sanatarkasti",
  },
  {
    nimi: "2. keksitty luku",
    vastaus: "Kattopelleillä takuu on 25 vuotta ostopäivästä.",
    katkelmat: [KATKELMA_TAKUU],
    odotus: (r) => r.unsupported.length > 0,
    selite: "katkelmassa lukee 20 vuotta, vastauksessa 25",
  },
  {
    nimi: "3. yleisesti tosi mutta ei katkelmassa",
    vastaus:
      "Kattopelleillä takuu on 20 vuotta. Teräs on kierrätettävää materiaalia ja sitä käytetään laajasti rakentamisessa.",
    katkelmat: [KATKELMA_TAKUU],
    odotus: (r) => r.unsupported.length > 0,
    selite: "toinen väite on tosi maailmassa mutta ei katkelmissa — yleistieto ei riitä",
  },
  {
    nimi: "4. ei väitteitä",
    vastaus:
      "Tästä minulla ei ole tietoa. Voin varata soittopyynnön, jos haluat — tarvitsen nimen ja puhelinnumeron.",
    katkelmat: [],
    odotus: (r) => r.total === 0,
    selite: "kieltäytyminen ja tarjous eivät ole tosiasiaväitteitä",
  },
  {
    nimi: "5. sekoitus",
    vastaus:
      "Toimitus Ouluun kestää 4 arkipäivää. Rahti on 89 euroa alle 1 000 euron tilauksissa. Toimitamme myös Ruotsiin kahdessa päivässä.",
    katkelmat: [KATKELMA_TOIMITUS],
    odotus: (r) => r.supported > 0 && r.unsupported.length > 0,
    selite: "kaksi tuettua väitettä ja yksi keksitty",
  },
];

async function main() {
  if (!process.env.OPENAI_API_KEY && JUDGE_PROVIDER === "openai") {
    console.error("OPENAI_API_KEY puuttuu, joten arvioijaa ei voi testata.");
    process.exit(2);
  }

  console.log(`arvioija: ${JUDGE_MODEL} (${JUDGE_PROVIDER})\n`);

  let virheita = 0;
  for (const p of PARIT) {
    const r = await scoreGroundedness(p.vastaus, p.katkelmat);
    const ok = !r.judgeFailed && p.odotus(r);
    if (!ok) virheita++;
    console.log(
      `${ok ? "OK    " : "VIRHE "} ${p.nimi}  (${r.supported}/${r.total} tuettu${r.judgeFailed ? ", ARVIOIJA HAJOSI" : ""})`,
    );
    console.log(`       ${p.selite}`);
    if (!ok && r.unsupported.length) {
      console.log(`       tukemattomat: ${r.unsupported.join(" | ").slice(0, 160)}`);
    }
  }

  console.log("");
  if (virheita) {
    console.error(
      [
        `${virheita}/${PARIT.length} paria meni väärin.`,
        "",
        "Arvioijan virhe on mittarin virhe: se ei näy lukuna joka on väärässä,",
        "vaan lukuna joka näyttää oikealta. Vaihda isompaan malliin",
        "(JUDGE_MODEL=gpt-4o-mini) ja aja tämä uudelleen ennen sarjan ajoa.",
        "",
      ].join(String.fromCharCode(10)),
    );
    process.exit(1);
  }

  console.log(`${PARIT.length}/${PARIT.length} oikein. Arvioija kelpaa mittaamiseen.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
