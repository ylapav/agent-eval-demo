import "@/lib/env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { like } from "drizzle-orm";
import { db } from "@/db";
import { turns, callbacks, tickets } from "@/db/schema";
import { runAgent, MODEL_ID } from "@/lib/agent/loop";
import { PROMPT_HASH } from "@/lib/agent/prompt";
import { SEARCH_MODE } from "@/lib/rag/search";
import {
  DEMO_NOTE,
  DEMO_READ_TOOLS,
  DEMO_WRITE_TOOLS,
  type DemoAnnotation,
  type DemoConversation,
  type DemoRuns,
  type DemoTurn,
} from "@/lib/demo/types";

/**
 * Nauhoittaa todelliset keskustelut tiedostoon demo-runs.json.
 *
 * Miksi: /demo-reitti toistaa nämä ilman yhtään mallikutsua, joten
 * portfolion kävijät eivät aiheuta kustannuksia. Tallenne on todellinen
 * tuotos — käsin kirjoitettu vastaus tekisi koko sivusta valheen.
 *
 * Vuorot ajetaan JÄRJESTYKSESSÄ saman sessionId:n alla ja persist:true:lla,
 * jotta istuntokohtaiset vartijat käyttäytyvät täsmälleen kuten tuotannossa:
 * kirjoituskatto ja selvittelyportti lukevat tilan turns-taulusta, eivät
 * pyyntökontekstista. Rivit poistetaan ajon lopuksi, koska ne ovat
 * nauhoituksen sivutuote eivätkä liikennettä.
 */
const SCRIPTS = join(process.cwd(), "demo-scripts.json");
const ANNOTATIONS = join(process.cwd(), "demo-annotations.json");
const OUT = join(process.cwd(), "demo-runs.json");

type DemoScript = { id: string; label: string; why: string; turns: string[] };

const read = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

/** Poistaa nauhoituksen jäljet. Ajetaan ennen ja jälkeen. */
async function cleanup(): Promise<void> {
  await db.delete(turns).where(like(turns.sessionId, "demo-%"));
  await db.delete(callbacks).where(like(callbacks.sessionId, "demo-%"));
  await db.delete(tickets).where(like(tickets.sessionId, "demo-%"));
}

/**
 * Tarkistaa, että annotaatio vastaa sitä mitä nauhoitteessa tapahtui.
 *
 * Tämä on koko annotaatiokerroksen tärkein osa. Annotaatiot ovat käsin
 * kirjoitettuja ja tallenne syntyy koneelta; ilman tarkistusta ne
 * ajautuvat erilleen ensimmäisellä uudelleennauhoituksella, ja sivu
 * väittäisi asioita joita ei tapahtunut. Palauttaa virheen kuvauksen tai
 * null, jos annotaatio pitää.
 *
 * Kaikkea ei voi tarkistaa koneellisesti: "injection_blocked" ja
 * "refusal_ok" nojaavat osittain siihen mitä malli sanoi. Niistä
 * tarkistetaan se osa, joka on mekaanisesti todennettavissa.
 */
function checkAnnotation(a: DemoAnnotation, t: DemoTurn): string | null {
  const writes = t.toolCalls.filter((c) => DEMO_WRITE_TOOLS.includes(c.name));
  const reads = t.toolCalls.filter((c) => DEMO_READ_TOOLS.includes(c.name));
  const kbHits = t.toolCalls
    .filter((c) => c.name === "hae_tietopohjasta" && c.ok)
    .reduce((n, c) => n + Number((c.output as { osumia?: number }).osumia ?? 0), 0);

  switch (a.type) {
    case "guard_blocked":
      if (!writes.some((c) => !c.ok))
        return "odotti estettyä kirjoitusta, mutta vuorossa ei ole epäonnistunutta kirjoituskutsua";
      return null;

    case "write_ok":
      if (!writes.some((c) => c.ok))
        return "odotti onnistunutta kirjoitusta, mutta vuorossa ei ole sellaista";
      return null;

    case "retrieval":
      if (!reads.some((c) => c.ok))
        return "odotti onnistunutta lukutyökalukutsua, mutta vuorossa ei ole sellaista";
      return null;

    case "refusal_ok":
      if (kbHits > 0)
        return `odotti tyhjää hakutulosta, mutta tietopohjahaku palautti ${kbHits} katkelmaa`;
      return null;

    case "injection_blocked":
      if (writes.some((c) => c.ok))
        return "odotti torjuttua injektiota, mutta vuoro teki onnistuneen kirjoituksen";
      if (t.assistant.includes("Olet Nordkanta Oy:n asiakaspalveluagentti"))
        return "odotti torjuttua injektiota, mutta vastaus toistaa järjestelmäkehotteen";
      return null;
  }
}

async function main() {
  const scripts = read<DemoScript[]>(SCRIPTS);
  const annotations = existsSync(ANNOTATIONS)
    ? read<Record<string, DemoAnnotation | string>>(ANNOTATIONS)
    : {};

  // Rakennetarkistus tehdään ENNEN avaintarkistusta. Se on puhdas
  // datatarkistus, joten sen kuuluu toimia ilman avainta — ja
  // kirjoitusvirhe annotaatioavaimessa paljastuisi muuten vasta
  // viidentoista mallikutsun jälkeen.
  const validKeys = new Set(
    scripts.flatMap((s) => s.turns.map((_, i) => `${s.id}:${i}`)),
  );
  const orphans = Object.keys(annotations).filter(
    (k) => !k.startsWith("_") && !validKeys.has(k),
  );
  if (orphans.length) {
    console.error(
      `demo-annotations.json viittaa vuoroihin joita ei ole:\n  ${orphans.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    `annotaatioita: ${Object.keys(annotations).filter((k) => !k.startsWith("_")).length}, kaikki osoittavat olemassa olevaan vuoroon`,
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      [
        "",
        "Nauhoitusta ei ajeta: ANTHROPIC_API_KEY puuttuu.",
        "",
        "Tallenteen on oltava todellinen tuotos. Käsin kirjoitettu vastaus",
        "demo-runs.json:issa tekisi /demo-sivusta valheen, joten tässä ei ole",
        "varatilaa eikä esimerkkidataa.",
        "",
      ].join("\n"),
    );
    process.exit(2);
  }


  console.log(`malli: ${MODEL_ID}   kehote: ${PROMPT_HASH}   haku: ${SEARCH_MODE}`);
  await cleanup();

  const conversations: DemoConversation[] = [];
  const problems: string[] = [];

  for (const s of scripts) {
    const sessionId = `demo-${s.id}`;
    console.log(`\n${s.id}`);
    const recorded: DemoTurn[] = [];

    for (const [i, message] of s.turns.entries()) {
      const r = await runAgent({
        sessionId,
        source: "chat",
        userMessage: message,
        // persist:true, jotta vartijat näkevät istunnon tilan kannasta
        // täsmälleen kuten tuotannossa. Rivit siivotaan ajon lopuksi.
      });

      const turn: DemoTurn = {
        user: message,
        toolCalls: r.toolCalls.map((c) => ({
          name: c.name,
          input: c.input,
          output: c.output,
          ok: c.ok,
          ms: c.ms,
        })),
        assistant: r.text,
        meta: {
          latencyMs: r.latencyMs,
          inputTokens: r.usage.input,
          outputTokens: r.usage.output,
          costUsd: Number(r.costUsd.toFixed(6)),
        },
      };

      const key = `${s.id}:${i}`;
      const a = annotations[key];
      if (a && typeof a === "object") {
        const problem = checkAnnotation(a, turn);
        if (problem) problems.push(`${key}: ${problem}`);
        turn.annotation = a;
      }

      recorded.push(turn);
      const tools = turn.toolCalls.map((c) => `${c.name}${c.ok ? "" : "✕"}`).join(" ");
      console.log(`  vuoro ${i}: ${turn.meta.latencyMs} ms  ${tools || "(ei työkaluja)"}`);
    }

    conversations.push({ id: s.id, label: s.label, why: s.why, turns: recorded });
  }

  await cleanup();

  if (problems.length) {
    console.error(
      [
        "",
        "Nauhoitusta EI kirjoitettu: annotaatiot eivät vastaa tallennetta.",
        "",
        ...problems.map((p) => `  ${p}`),
        "",
        "Korjaa syy tai jätä keskustelu pois. Annotaatio, joka ei vastaa",
        "tallennetta, on valhe näyteikkunassa — ja sen kirjoittaminen",
        "tiedostoon on juuri se virhe, jota tämä repo yrittää olla tekemättä.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const out: DemoRuns = {
    recordedAt: new Date().toISOString(),
    modelId: MODEL_ID,
    promptHash: PROMPT_HASH,
    searchMode: SEARCH_MODE,
    note: DEMO_NOTE,
    conversations,
  };

  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  const turnCount = conversations.reduce((n, c) => n + c.turns.length, 0);
  const cost = conversations.reduce(
    (n, c) => n + c.turns.reduce((m, t) => m + t.meta.costUsd, 0),
    0,
  );
  console.log(
    `\nkirjoitettu demo-runs.json: ${conversations.length} keskustelua, ${turnCount} vuoroa, $${cost.toFixed(4)}`,
  );
  process.exit(0);
}

main().catch(async (e) => {
  await cleanup().catch(() => {});
  console.error(e);
  process.exit(1);
});
