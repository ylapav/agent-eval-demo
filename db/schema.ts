import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  index,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Tietopohjan katkelmat. Yksi rivi = yksi haettava pala markdownia.
 * Upotus on 512-ulotteinen (voyage-3-lite). Jos vaihdat mallia, vaihda myös
 * dimensio täällä ja aja migraatio — muuten haku palauttaa hiljaa roskaa.
 */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    docId: text("doc_id").notNull(),
    docTitle: text("doc_title").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    /** Nullable: "ei upotusta" on todellinen tila, kun indeksointi ajettiin
     *  ilman avainta ja ilman esilaskettua tiedostoa. Nollavektori olisi
     *  valhe, joka tuottaisi kosinietäisyyksiä jotka näyttävät luvuilta. */
    embedding: vector("embedding", { dimensions: 512 }),
    /**
     * Millä mallilla tämän rivin upotus on laskettu.
     *
     * Tämä sarake on olemassa yhtä hiljaista virhettä varten: jos
     * upotusmalli vaihdetaan eikä indeksointia ajeta uudelleen, vanhat
     * vektorit jäävät vanhaan avaruuteen ja uudet kyselyt tulevat
     * uudesta. Dimensio täsmää, mikään ei kaadu, ja haku palauttaa
     * roskaa. Ilman tätä saraketta epäsuhtaa ei voi havaita mistään.
     *
     * NULL tarkoittaa "ei upotusta" (leksikaalinen tila), ei tuntematonta.
     */
    embedModel: text("embed_model"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_doc_idx").on(t.docId),
  ],
);

/** Rakenteinen tuotedata. Erillään tietopohjasta, koska sitä haetaan suodattamalla
 *  eikä semanttisesti. Vektorihaku tuotenumeroilla on huono idea. */
export const products = pgTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  material: text("material"),
  colors: jsonb("colors").$type<string[]>().default([]),
  priceEur: real("price_eur"),
  unit: text("unit"),
  leadTimeDays: integer("lead_time_days"),
  warrantyYears: integer("warranty_years"),
  inStock: text("in_stock").$type<"yes" | "no" | "order">().notNull(),
});

/**
 * Yksi rivi per agentin vuoro. Kirjoitetaan aina, myös virhetilanteessa.
 *
 * promptHash ja modelId ovat mukana siksi, että ilman niitä ei voi verrata
 * evaluointituloksia ajojen välillä: et tiedä muuttuiko tulos koodista,
 * kehotteesta vai mallista.
 */
export const turns = pgTable(
  "turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: text("session_id").notNull(),
    source: text("source").$type<"chat" | "webhook" | "eval">().notNull(),
    userMessage: text("user_message").notNull(),
    assistantMessage: text("assistant_message"),
    toolCalls: jsonb("tool_calls").$type<ToolCallLog[]>().default([]),
    retrievedChunkIds: jsonb("retrieved_chunk_ids").$type<string[]>().default([]),
    modelId: text("model_id").notNull(),
    promptHash: text("prompt_hash").notNull(),
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    /** Välimuistista luetut ja välimuistiin kirjoitetut syötetokenit.
     *  Erillään siksi, että ne hinnoitellaan eri kertoimella (0,1× ja 1,25×).
     *  Ilman erottelua kustannusarvio on väärä juuri silloin, kun välimuisti
     *  toimii — eli kun arvio olisi tärkein. */
    cacheReadTokens: integer("cache_read_tokens").default(0),
    cacheWriteTokens: integer("cache_write_tokens").default(0),
    /** Mallin lopetussyy. "refusal" erottuu virheestä: se on onnistunut
     *  API-kutsu, jossa malli kieltäytyi. Ne pitää voida laskea erikseen. */
    stopReason: text("stop_reason"),
    costEstimateUsd: real("cost_estimate_usd").default(0),
    latencyMs: integer("latency_ms").default(0),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("turns_session_idx").on(t.sessionId),
    index("turns_created_idx").on(t.createdAt),
  ],
);

export type ToolCallLog = {
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  ms: number;
};

/** Soittopyynnöt. status on koodin asettama, ei mallin. */
export const callbacks = pgTable("callbacks", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  topic: text("topic").notNull(),
  preferredWindow: text("preferred_window"),
  status: text("status").$type<"new" | "handled">().default("new").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Tiketit. priority EI tule mallilta — se johdetaan tyypistä koodissa
 * (lib/agent/guards.ts). Tämä sulkee koko luokan injektioita, joissa
 * käyttäjä yrittää nostaa oman tikettinsä prioriteettia tekstillä.
 */
export const tickets = pgTable("tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id").notNull(),
  type: text("type").$type<"reklamaatio" | "takuu" | "toimitus" | "muu">().notNull(),
  priority: text("priority").$type<"low" | "normal" | "high">().notNull(),
  summary: text("summary").notNull(),
  contactEmail: text("contact_email").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Evaluointiajojen tulokset. Säilytetään, jotta admin näyttää historian
 *  eikä vain viimeisintä lukua. */
export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  suite: text("suite").notNull(),
  modelId: text("model_id").notNull(),
  promptHash: text("prompt_hash").notNull(),
  score: real("score").notNull(),
  threshold: real("threshold").notNull(),
  passed: text("passed").$type<"pass" | "fail">().notNull(),
  cases: jsonb("cases").$type<unknown[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
