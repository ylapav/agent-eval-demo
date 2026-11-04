import "@/lib/env";
import { scoreGroundedness, JUDGE_MODEL, JUDGE_PROVIDER } from "@/lib/eval/groundedness";
import { requireModel, UnknownModelError } from "@/lib/agent/models";

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

const KATKELMA_VARASTOINTI = [
  "Nippua siirretään nostoliinoilla, ei ketjuilla eikä haarukoilla suoraan pintaa vasten. Nippu nostetaan vähintään kahdesta pisteestä, jos pituus ylittää 4 metriä.",
  "Tuotteet säilytetään irti maasta vähintään 100 millimetrin korkeudella ja kallistettuna niin, että vesi valuu pois nipun välistä.",
  "Suojamuovi poistetaan viikon kuluessa toimituksesta. Muovin alle tiivistyvä kosteus aiheuttaa valkoruostetta, joka on pysyvä pintavika eikä kuulu takuun piiriin. Tämä on yleisin työmaalla syntyvä vaurio.",
  "Enimmäissäilytysaika työmaalla ennen asennusta on kolme kuukautta.",
  "Nippu peitetään hengittävällä suojapeitteellä. Umpinaista muovia ei saa käyttää peitteenä samasta syystä kuin suojamuovi poistetaan.",
  "Osassa tuotteita on pinnalla kuljetussuojakalvo. Kalvo poistetaan välittömästi asennuksen jälkeen. Auringossa kalvon liima kovettuu kiinni pintaan noin kuukaudessa, minkä jälkeen sitä ei saa pois vahingoittamatta pinnoitetta.",
  "Levyjä nostetaan pystyasennossa, ei vedetä nipun päältä. Vetäminen naarmuttaa alla olevan levyn pinnan. Naarmu on asennusvaurio.",
].join(" ");

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
  // Kieltolauseet. Ensimmäinen oikea ajo paljasti, että arvioija muotoili
  // kieltävän väitteen myöntäväksi ("ei myy" → "myy") ja tuomitsi sen
  // sitten tukemattomaksi. Virhe on systemaattinen ja yhteen suuntaan:
  // se nostaa keksimislukua ja laskee lähdeperusteisuutta juuri niissä
  // vastauksissa, joissa agentti rajaa oikein. Tapaukset 1–5 eivät sisältäneet
  // yhtään kieltolausetta, joten tarkistus ei voinut huomata sitä.
  {
    nimi: "6. tuettu kieltolause",
    vastaus: "Nordkanta ei myy aurinkopaneeleita.",
    katkelmat: ["Nordkanta ei myy aurinkopaneeleita."],
    odotus: (r) => r.total > 0 && r.unsupported.length === 0,
    selite: "kieltävä väite on katkelmassa sellaisenaan — polariteetti pitää säilyttää",
  },
  {
    nimi: "7. käänteinen kieltolause",
    vastaus: "Takuu lasketaan asennuspäivästä.",
    katkelmat: ["Takuu lasketaan toimituspäivästä, ei asennuspäivästä."],
    odotus: (r) => r.unsupported.length > 0,
    selite: "katkelma kieltää juuri sen mitä vastaus väittää",
  },
  // Tapaukset 6–7 ovat yhden lauseen mittaisia, ja gpt-4.1-mini läpäisi ne —
  // mutta käänsi ajossa 1 seitsemän kieltoa gr-10:n luettelomuotoisessa
  // vastauksessa. Tämä tapaus on se vastaus. Alku sanatarkasti ajon 1
  // eval-results.json:sta (tallennettu 300 merkkiä); loppuosan luettelo on
  // rekonstruoitu niistä seitsemästä väitteestä, jotka arvioija käänsi, koska
  // ajaja ei tallentanut koko vastausta. Katkelma on dokumentti
  // content/varastointi-tyomaalla.md ilman otsikkotietoja.
  {
    nimi: "8. luettelo, useita kieltoja (ajo 1, gr-10)",
    vastaus: [
      'Varastointi työmaalla "Varastointi työmaalla" -dokumentin mukaan:',
      "",
      "**Sijoittelu:**",
      "- Tuotteet irti maasta vähintään 100 mm korkeudella",
      "- Kallistettuna niin, että vesi valuu pois nipun välistä",
      "",
      "**Suojaus:**",
      "- Suojamuovi poistetaan viikon kuluessa toimituksesta (muovin alla tiivistyvä kosteus aiheuttaa valkoruostetta, joka ei kuulu takuun piiriin)",
      "- Peitteenä hengittävä suojapeite, ei umpinaista muovia",
      "- Suojakalvo poistetaan heti asennuksen jälkeen — auringossa liima kovettuu noin kuukaudessa, eikä kalvoa sen jälkeen saa pois vahingoittamatta pinnoitetta",
      "",
      "**Käsittely:**",
      "- Nippu siirretään nostoliinoilla, ei ketjuilla eikä haarukoilla suoraan pintaa vasten",
      "- Levyt nostetaan pystyasennossa, ei vedetä nipun päältä",
    ].join(String.fromCharCode(10)),
    katkelmat: [KATKELMA_VARASTOINTI],
    odotus: (r) => r.total > 0 && r.unsupported.length === 0,
    selite: "jokainen kielto ja rajaus on katkelmassa — yksikään ei saa kääntyä myöntäväksi",
  },
];

async function main() {
  // Tuntematon malli kieltäytyy ennen avaintarkistusta: virheellinen
  // asetus kerrotaan ensin, eikä toimittajaa arvata.
  try {
    requireModel(JUDGE_MODEL);
  } catch (e) {
    if (!(e instanceof UnknownModelError)) throw e;
    console.error(`Arvioijaa ei testata: ${e.message}`);
    process.exit(2);
  }

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
