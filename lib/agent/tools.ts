import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/db";
import { products, callbacks, tickets } from "@/db/schema";
import { and, eq, ilike, lte, sql, type SQL } from "drizzle-orm";
import { searchChunks } from "@/lib/rag/search";
import {
  assertWriteAllowed,
  assertConfirmationRound,
  derivePriority,
  normalizePhone,
} from "./guards";

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "hae_tietopohjasta",
    description:
      "Hae Nordkannan ohjeista, takuuehdoista ja toimitusehdoista. Käytä tätä kaikkiin kysymyksiin, jotka koskevat ehtoja, asennusta, takuuta tai yhtiön käytäntöjä. Älä käytä yksittäisen tuotteen hintaan tai saatavuuteen.",
    input_schema: {
      type: "object",
      properties: {
        kysely: {
          type: "string",
          description: "Hakukysely asiakkaan omin sanoin, suomeksi.",
        },
      },
      required: ["kysely"],
    },
  },
  {
    name: "hae_tuotteet",
    description:
      "Hae tuotteita rakenteisesta tuotetaulusta. Käytä tätä hintaan, saatavuuteen, toimitusaikaan, väreihin ja materiaaleihin. Palauttaa enintään 8 tuotetta.",
    input_schema: {
      type: "object",
      properties: {
        kategoria: {
          type: "string",
          description:
            "julkisivulevy | kattopelti | kiinnike | lista | sadevesijärjestelmä | alusrakenne",
        },
        materiaali: { type: "string", description: "esim. teräs, komposiitti, alumiini" },
        nimihaku: { type: "string", description: "Osa tuotenimestä" },
        vari: { type: "string", description: "Yksi väri, esim. musta" },
        maksimihinta: { type: "number", description: "Euroa per yksikkö" },
      },
    },
  },
  {
    name: "varaa_soitto",
    description:
      "Varaa soittopyyntö myynnille. Kutsu tätä VASTA kun asiakas on vahvistanut yhteenvedon. Käytä, kun asia vaatii ihmisen: tarjouspyyntö, mitoitus, reklamaation selvittely.",
    input_schema: {
      type: "object",
      properties: {
        nimi: { type: "string" },
        puhelin: { type: "string" },
        aihe: { type: "string", description: "Yksi lause siitä, mistä on kyse." },
        toivottu_aika: {
          type: "string",
          description: "Vapaamuotoinen, esim. 'huomenna aamupäivällä'",
        },
      },
      required: ["nimi", "puhelin", "aihe"],
    },
  },
  {
    name: "luo_tiketti",
    description:
      "Luo tiketti asiakaspalveluun. Kutsu tätä VASTA kun asiakas on vahvistanut yhteenvedon. Et aseta prioriteettia — järjestelmä johtaa sen tyypistä.",
    input_schema: {
      type: "object",
      properties: {
        tyyppi: { type: "string", enum: ["reklamaatio", "takuu", "toimitus", "muu"] },
        yhteenveto: { type: "string", description: "Enintään 300 merkkiä." },
        sahkoposti: { type: "string" },
      },
      required: ["tyyppi", "yhteenveto", "sahkoposti"],
    },
  },
];

/** Kirjoittavat työkalut. Yksi lista, jota sekä vartijat että admin lukevat. */
export const WRITE_TOOLS = new Set(["varaa_soitto", "luo_tiketti"]);

const ProductQuery = z.object({
  kategoria: z.string().optional(),
  materiaali: z.string().optional(),
  nimihaku: z.string().optional(),
  vari: z.string().optional(),
  maksimihinta: z.number().positive().optional(),
});

const CallbackInput = z.object({
  nimi: z.string().min(2).max(80),
  puhelin: z.string().min(6).max(30),
  aihe: z.string().min(3).max(300),
  toivottu_aika: z.string().max(120).optional(),
});

const TicketInput = z.object({
  tyyppi: z.enum(["reklamaatio", "takuu", "toimitus", "muu"]),
  yhteenveto: z.string().min(3).max(300),
  sahkoposti: z.email(),
});

export type ToolContext = {
  sessionId: string;
  /** Kasvatetaan jokaisesta onnistuneesta kirjoituksesta. Alkuarvo tulee kannasta. */
  writeCount: { value: number };
  /** Aiempien vuorojen määrä tässä istunnossa. 0 = keskustelun ensimmäinen vuoro. */
  priorTurns: number;
  /** Kerätään, jotta evaluointi tietää mitä katkelmia vastaus sai käyttöönsä. */
  retrievedChunkIds: string[];
};

export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case "hae_tietopohjasta": {
      const { kysely } = z.object({ kysely: z.string().min(1) }).parse(input);
      const hits = await searchChunks(kysely, 5);
      ctx.retrievedChunkIds.push(...hits.map((h) => h.id));
      return {
        osumia: hits.length,
        // Tyhjä tulos sanotaan ääneen. Malli ei muuten erota "ei löytynyt"
        // tilannetta siitä, että työkalu palautti jotain epäolennaista.
        huomio:
          hits.length === 0
            ? "Tietopohjasta ei löytynyt tähän mitään. Kerro asiakkaalle, ettei tietoa ole."
            : undefined,
        katkelmat: hits.map((h) => ({
          lahde: h.docTitle,
          otsikko: h.heading,
          teksti: h.content,
          osuvuus: Number(h.score.toFixed(3)),
        })),
      };
    }

    case "hae_tuotteet": {
      const q = ProductQuery.parse(input ?? {});
      const conds: SQL[] = [];
      if (q.kategoria) conds.push(ilike(products.category, `%${q.kategoria}%`));
      if (q.materiaali) conds.push(ilike(products.material, `%${q.materiaali}%`));
      if (q.nimihaku) conds.push(ilike(products.name, `%${q.nimihaku}%`));
      if (q.maksimihinta) conds.push(lte(products.priceEur, q.maksimihinta));
      // Värit ovat jsonb-taulukko. Haku menee alkioihin, ei serialisoituun
      // merkkijonoon: muuten "musta" osuisi myös sanaan "tummanmusta"-tyyppisiin
      // sattumiin toisen kentän sisällä.
      if (q.vari) {
        conds.push(
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${products.colors}) AS c WHERE c ILIKE ${`%${q.vari}%`})`,
        );
      }

      const rows = await db
        .select()
        .from(products)
        .where(conds.length ? and(...conds) : undefined)
        .limit(8);

      return { osumia: rows.length, tuotteet: rows };
    }

    case "varaa_soitto": {
      assertConfirmationRound(ctx);
      assertWriteAllowed(ctx);
      const v = CallbackInput.parse(input);
      const [row] = await db
        .insert(callbacks)
        .values({
          sessionId: ctx.sessionId,
          name: v.nimi,
          phone: normalizePhone(v.puhelin),
          topic: v.aihe,
          preferredWindow: v.toivottu_aika ?? null,
        })
        .returning();
      ctx.writeCount.value += 1;
      return { ok: true, soittopyynto_id: row.id, tila: row.status };
    }

    case "luo_tiketti": {
      assertConfirmationRound(ctx);
      assertWriteAllowed(ctx);
      const v = TicketInput.parse(input);
      // Prioriteetti johdetaan tyypistä. Malli ei aseta sitä eikä voi nostaa sitä.
      const priority = derivePriority(v.tyyppi);
      const [row] = await db
        .insert(tickets)
        .values({
          sessionId: ctx.sessionId,
          type: v.tyyppi,
          priority,
          summary: v.yhteenveto,
          contactEmail: v.sahkoposti,
        })
        .returning();
      ctx.writeCount.value += 1;
      return { ok: true, tiketti_id: row.id, prioriteetti: row.priority };
    }

    default:
      throw new Error(`Tuntematon työkalu: ${name}`);
  }
}
