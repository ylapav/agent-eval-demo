import Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { turns, type ToolCallLog } from "@/db/schema";
import { SYSTEM_PROMPT, PROMPT_HASH, wrapToolResult } from "./prompt";
import { TOOL_DEFS, runTool, type ToolContext } from "./tools";
import { GuardError, loadWriteCount, loadReadCount } from "./guards";
import { estimateCostUsd, specFor } from "./models";

const anthropic = new Anthropic();

/**
 * Yksi rivi käynnistyksessä, kun avain puuttuu.
 *
 * Ilman tätä ensimmäinen chat-viesti palauttaa "Tekninen häiriö. Yritä
 * hetken kuluttua uudelleen." eikä syy näy missään konsolissa — vain
 * turns.error-sarakkeessa kannassa. Käyttäjää kehotetaan yrittämään
 * uudelleen tilanteessa, joka ei korjaannu koskaan itsestään. Haku ja
 * tietokanta loggaavat oman tilansa samalla tavalla.
 */
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("[agent] ANTHROPIC_API_KEY puuttuu — agentti ei vastaa");
}

export const MODEL_ID = process.env.MODEL_ID ?? "claude-opus-5";
export const EFFORT = (process.env.EFFORT ?? "medium") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const MAX_ITERATIONS = 6;
const MAX_TOKENS = 8000;

/**
 * Montako aiempaa vuoroa ladataan historiaksi.
 *
 * Ei koko istuntoa: pitkä keskustelu kasvattaisi syötettä rajatta ja
 * kustannus karkaisi hiljaa. Raja on tässä eikä kehotteessa, koska
 * kehote ei voi rajoittaa sitä mitä sille syötetään.
 */
const HISTORY_TURNS = 10;

export type AgentResult = {
  text: string;
  toolCalls: ToolCallLog[];
  retrievedChunkIds: string[];
  turnId: string;
  costUsd: number;
  latencyMs: number;
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/**
 * Historia rakennetaan turns-taulusta, ei selaimen lähettämästä tilasta.
 *
 * Selain saisi muuten päättää, mitä agentti "muistaa". Koska
 * kirjoitusvartijat nojaavat aiempien vuorojen määrään, se tarkoittaisi
 * että asiakas voi itse väittää vahvistuskierroksen tapahtuneen.
 * Palvelin on ainoa paikka, joka tietää mitä istunnossa oikeasti tapahtui.
 */
async function loadHistory(sessionId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select({ user: turns.userMessage, assistant: turns.assistantMessage })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(desc(turns.createdAt))
    .limit(HISTORY_TURNS);

  return rows
    .reverse()
    .flatMap((r): Anthropic.MessageParam[] =>
      r.assistant
        ? [
            { role: "user", content: r.user },
            { role: "assistant", content: r.assistant },
          ]
        : [],
    );
}

export async function runAgent(opts: {
  sessionId: string;
  source: "chat" | "webhook" | "eval";
  userMessage: string;
  /** Eksplisiittinen historia. Evaluointi käyttää tätä; chat ja webhook
   *  jättävät pois, jolloin historia luetaan kannasta. */
  history?: Anthropic.MessageParam[];
  /** Evaluointi ohittaa lokituksen, kun se ei halua saastuttaa dataa. */
  persist?: boolean;
}): Promise<AgentResult> {
  const started = Date.now();
  const history = opts.history ?? (await loadHistory(opts.sessionId));

  const ctx: ToolContext = {
    sessionId: opts.sessionId,
    // Katto luetaan kannasta, ei nollasta: muuten "2 per istunto" olisi
    // käytännössä "2 per HTTP-pyyntö".
    writeCount: { value: await loadWriteCount(opts.sessionId) },
    priorTurns: history.filter((m) => m.role === "user").length,
    // Selvittelyn määrä luetaan kannasta samasta syystä kuin kirjoituskatto:
    // vain kanta tietää mitä istunnossa on aiemmin oikeasti tapahtunut.
    priorReads: await loadReadCount(opts.sessionId),
    retrievedChunkIds: [],
  };

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: opts.userMessage },
  ];

  const spec = specFor(MODEL_ID);
  const toolLog: ToolCallLog[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let finalText = "";
  let stopReason: string | null = null;
  let error: string | null = null;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await anthropic.messages.create({
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        // Järjestelmäkehote ja työkalut ovat muuttumattomia, joten
        // välimuistiraja tähän kohtaan kattaa molemmat (renderöintijärjestys
        // on tools → system → messages). Toteutuuko välimuisti oikeasti,
        // näkyy cache_read_tokens-sarakkeesta: lyhyt prefiksi voi jäädä
        // mallin minimin alle, jolloin se ei tallennu eikä siitä tule
        // virhettä. Siksi se mitataan eikä oleteta.
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: TOOL_DEFS,
        ...(spec.thinking ? { thinking: { type: "adaptive" as const } } : {}),
        ...(spec.effort ? { output_config: { effort: EFFORT } } : {}),
        messages,
      });

      usage.input += res.usage.input_tokens;
      usage.output += res.usage.output_tokens;
      usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
      stopReason = res.stop_reason;

      // Kieltäytyminen on onnistunut kutsu, ei virhe. Se ei saa näyttää
      // tekniseltä häiriöltä: syy on eri ja korjaus on eri.
      if (res.stop_reason === "refusal") {
        finalText =
          "En voi käsitellä tätä pyyntöä. Jos asia liittyy tilaukseen tai reklamaatioon, kerro se omin sanoin, niin ohjaan sen eteenpäin.";
        break;
      }

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        finalText = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        break;
      }

      // Koko content palautetaan sellaisenaan, myös ajattelublokit.
      // Niiden pudottaminen kesken vuoron rikkoo työkalukutsujen ketjun.
      messages.push({ role: "assistant", content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const t0 = Date.now();
        try {
          const out = await runTool(use.name, use.input, ctx);
          toolLog.push({
            name: use.name,
            input: use.input,
            output: out,
            ok: true,
            ms: Date.now() - t0,
          });
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: wrapToolResult(out),
          });
        } catch (e) {
          // Vartija- ja validointivirheet palautetaan mallille
          // TYÖKALUTULOKSENA eikä kaatumisena. Malli voi kertoa syyn
          // asiakkaalle. Vain odottamattomat virheet kaatavat silmukan.
          const msg =
            e instanceof GuardError
              ? e.message
              : e instanceof Error
                ? `Työkalu epäonnistui: ${e.message}`
                : "Työkalu epäonnistui.";
          toolLog.push({
            name: use.name,
            input: use.input,
            output: { error: msg },
            ok: false,
            ms: Date.now() - t0,
          });
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: wrapToolResult({ virhe: msg }),
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: results });
    }

    if (!finalText) {
      finalText =
        "En saanut asiaa ratkaistua tässä keskustelussa. Voin varata soittopyynnön, jos haluat.";
      error = error ?? "max_iterations";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    // Konfiguraatiovirhe erotellaan ohimenevästä häiriöstä. "Yritä hetken
    // kuluttua uudelleen" on väärä ohje tilanteessa, joka ei korjaannu
    // ilman ympäristömuuttujaa.
    finalText =
      e instanceof Anthropic.AuthenticationError || !process.env.ANTHROPIC_API_KEY
        ? "Agenttia ei ole konfiguroitu: ANTHROPIC_API_KEY puuttuu tai on virheellinen. Tämä on ylläpidon asia, ei sinun."
        : "Tekninen häiriö. Yritä hetken kuluttua uudelleen.";
  }

  const costUsd = estimateCostUsd(MODEL_ID, usage);
  const latencyMs = Date.now() - started;

  let turnId = "";
  if (opts.persist !== false) {
    const [row] = await db
      .insert(turns)
      .values({
        sessionId: opts.sessionId,
        source: opts.source,
        userMessage: opts.userMessage,
        assistantMessage: finalText,
        toolCalls: toolLog,
        retrievedChunkIds: ctx.retrievedChunkIds,
        modelId: MODEL_ID,
        promptHash: PROMPT_HASH,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        costEstimateUsd: costUsd,
        latencyMs,
        stopReason,
        error,
      })
      .returning({ id: turns.id });
    turnId = row.id;
  }

  return {
    text: finalText,
    toolCalls: toolLog,
    retrievedChunkIds: ctx.retrievedChunkIds,
    turnId,
    costUsd,
    latencyMs,
    stopReason,
    usage,
  };
}
