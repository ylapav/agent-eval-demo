import "@/lib/env";
import { db } from "@/db";
import { products } from "@/db/schema";

/**
 * Tuotetaulun siemendata.
 *
 * Tämä data on tarkoituksella eri paikassa kuin content/*.md. Tuotetiedot
 * ovat rakenteisia ja niitä haetaan suodattamalla; ehdot ja ohjeet ovat
 * tekstiä ja niitä haetaan semanttisesti. Vektorihaku tuotenumerolla on
 * huono idea, ja SQL-haku takuuehdon merkityksestä on mahdoton.
 *
 * Takuuvuodet vastaavat content/takuuehdot.md:tä. Jos muutat toista,
 * muuta molemmat — ristiriita tietopohjan ja tuotetaulun välillä näkyy
 * lähdeperusteisuusmittarissa vasta sattumanvaraisesti, sen mukaan
 * kumpaa työkalua malli sattui käyttämään.
 *
 * leadTimeDays on tuotteen valmistus- tai saatavuusaika. Kuljetusaika
 * tulee sen päälle ja on content/toimitusehdot.md:ssä alueittain.
 */
const ROWS: (typeof products.$inferInsert)[] = [
  // ── Julkisivulevyt ────────────────────────────────────────────────────
  {
    id: "NK-JL-100",
    name: "Nordkanta Klassikko julkisivulevy",
    category: "julkisivulevy",
    material: "teräs",
    colors: ["musta", "grafiitti", "valkoinen", "punaruskea"],
    priceEur: 48.5,
    unit: "m2",
    leadTimeDays: 10,
    warrantyYears: 15,
    inStock: "yes",
  },
  {
    id: "NK-JL-110",
    name: "Nordkanta Klassikko Plus julkisivulevy",
    category: "julkisivulevy",
    material: "teräs",
    colors: ["musta", "hopea", "grafiitti"],
    priceEur: 55.0,
    unit: "m2",
    leadTimeDays: 14,
    warrantyYears: 15,
    inStock: "yes",
  },
  {
    id: "NK-JL-200",
    name: "Nordkanta Sävy julkisivulevy",
    category: "julkisivulevy",
    material: "teräs",
    colors: ["RAL-sävy tilauksesta"],
    priceEur: 62.0,
    unit: "m2",
    leadTimeDays: 21,
    warrantyYears: 15,
    inStock: "order",
  },
  {
    id: "NK-JL-300",
    name: "Nordkanta Komposiitti julkisivulevy",
    category: "julkisivulevy",
    material: "komposiitti",
    colors: ["musta", "harmaa", "tammi"],
    priceEur: 79.0,
    unit: "m2",
    leadTimeDays: 28,
    warrantyYears: 15,
    inStock: "order",
  },
  {
    id: "NK-JL-400",
    name: "Nordkanta Perforoitu julkisivulevy",
    category: "julkisivulevy",
    material: "teräs",
    colors: ["musta", "hopea"],
    priceEur: 94.0,
    unit: "m2",
    leadTimeDays: 35,
    warrantyYears: 15,
    inStock: "order",
  },

  // ── Kattopellit ───────────────────────────────────────────────────────
  {
    id: "NK-KP-100",
    name: "Nordkanta Konesaumakate",
    category: "kattopelti",
    material: "teräs",
    colors: ["musta", "tiilenpunainen", "tummanvihreä"],
    priceEur: 34.9,
    unit: "m2",
    leadTimeDays: 14,
    warrantyYears: 20,
    inStock: "yes",
  },
  {
    id: "NK-KP-200",
    name: "Nordkanta Profiilipelti PP20",
    category: "kattopelti",
    material: "teräs",
    colors: ["musta", "tiilenpunainen", "grafiitti", "valkoinen"],
    priceEur: 22.4,
    unit: "m2",
    leadTimeDays: 7,
    warrantyYears: 20,
    inStock: "yes",
  },
  {
    id: "NK-KP-300",
    name: "Nordkanta Tiilikuvio TK40",
    category: "kattopelti",
    material: "teräs",
    colors: ["tiilenpunainen", "musta", "ruskea"],
    priceEur: 27.8,
    unit: "m2",
    leadTimeDays: 10,
    warrantyYears: 20,
    inStock: "yes",
  },

  // ── Kiinnikkeet ───────────────────────────────────────────────────────
  {
    id: "NK-KI-010",
    name: "Nordkanta-julkisivuruuvi 4,8 x 38 mm",
    category: "kiinnike",
    material: "ruostumaton teräs",
    colors: ["sinkitty", "musta", "grafiitti"],
    priceEur: 0.42,
    unit: "kpl",
    leadTimeDays: 3,
    warrantyYears: 5,
    inStock: "yes",
  },
  {
    id: "NK-KI-020",
    name: "Nordkanta-kattoruuvi 4,8 x 35 mm tiivistealuslevyllä",
    category: "kiinnike",
    material: "ruostumaton teräs",
    colors: ["musta", "tiilenpunainen", "sinkitty"],
    priceEur: 0.38,
    unit: "kpl",
    leadTimeDays: 3,
    warrantyYears: 5,
    inStock: "yes",
  },

  // ── Listat ────────────────────────────────────────────────────────────
  {
    id: "NK-LI-010",
    name: "Nordkanta-nurkkalista",
    category: "lista",
    material: "teräs",
    colors: ["musta", "valkoinen", "grafiitti"],
    priceEur: 14.2,
    unit: "m",
    leadTimeDays: 7,
    warrantyYears: 5,
    inStock: "yes",
  },
  {
    id: "NK-LI-020",
    name: "Nordkanta-räystäslista",
    category: "lista",
    material: "teräs",
    colors: ["musta", "tiilenpunainen"],
    priceEur: 11.6,
    unit: "m",
    leadTimeDays: 7,
    warrantyYears: 5,
    inStock: "yes",
  },

  // ── Sadevesijärjestelmä ───────────────────────────────────────────────
  {
    id: "NK-SV-010",
    name: "Nordkanta-syöksytorvi 90 mm",
    category: "sadevesijärjestelmä",
    material: "teräs",
    colors: ["musta", "valkoinen", "ruskea"],
    priceEur: 26.0,
    unit: "m",
    leadTimeDays: 10,
    warrantyYears: 10,
    inStock: "yes",
  },
  {
    id: "NK-SV-020",
    name: "Nordkanta-kouru 125 mm",
    category: "sadevesijärjestelmä",
    material: "teräs",
    colors: ["musta", "valkoinen", "ruskea"],
    priceEur: 21.5,
    unit: "m",
    leadTimeDays: 10,
    warrantyYears: 10,
    inStock: "yes",
  },

  // ── Alusrakenne ───────────────────────────────────────────────────────
  {
    id: "NK-AL-010",
    name: "Nordkanta-koolauslista 22 x 100 mm",
    category: "alusrakenne",
    material: "kuusi",
    colors: ["käsittelemätön"],
    priceEur: 3.9,
    unit: "m",
    leadTimeDays: 5,
    // Puutavaralla ei ole tuotetakuuta. null on eri asia kuin 0 vuotta,
    // ja kumpikin on eri asia kuin "emme tiedä".
    warrantyYears: null,
    inStock: "yes",
  },
  {
    id: "NK-AL-020",
    name: "Nordkanta-tuuletusprofiili ALU",
    category: "alusrakenne",
    material: "alumiini",
    colors: ["luonnonvärinen"],
    priceEur: 8.4,
    unit: "m",
    leadTimeDays: 12,
    warrantyYears: 10,
    inStock: "order",
  },
];

async function main() {
  await db.delete(products);
  await db.insert(products).values(ROWS);
  console.log(`${ROWS.length} tuotetta kirjoitettu`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
