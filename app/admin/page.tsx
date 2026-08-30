import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { desc, sql, notLike, and } from "drizzle-orm";
import { db } from "@/db";
import { turns, callbacks, tickets, evalRuns } from "@/db/schema";
import { DB_MODE } from "@/db";
import { MODEL_ID } from "@/lib/agent/loop";
import { PROMPT_HASH } from "@/lib/agent/prompt";
import { EMBED_MODEL } from "@/lib/rag/embed";

export const dynamic = "force-dynamic";

const COOKIE = "nordkanta_admin";

/** Salasanan tiiviste evästeeseen, jotta salasana itse ei kulje edestakaisin. */
const tokenFor = (pw: string) => createHash("sha256").update(`nk:${pw}`).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function login(formData: FormData) {
  "use server";
  const pw = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;
  if (expected && safeEqual(pw, expected)) {
    (await cookies()).set(COOKIE, tokenFor(expected), {
      httpOnly: true,
      sameSite: "lax",
      path: "/admin",
      maxAge: 60 * 60 * 8,
    });
  }
}

// ── Apufunktiot esitykseen ──────────────────────────────────────────────
const fi = (d: Date) =>
  new Intl.DateTimeFormat("fi-FI", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

const usd = (n: number) => `$${n.toFixed(4)}`;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export default async function Admin() {
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return (
      <div className="wrap">
        <header className="site">
          <h1>Admin</h1>
        </header>
        <p className="notice">
          ADMIN_PASSWORD puuttuu ympäristöstä. Admin-näkymä on suljettu, koska
          suojaamaton näkymä paljastaisi kaikkien istuntojen viestit ja
          yhteystiedot. Aseta muuttuja .env.local-tiedostoon.
        </p>
      </div>
    );
  }

  const cookie = (await cookies()).get(COOKIE)?.value;
  if (cookie !== tokenFor(expected)) {
    return (
      <div className="wrap">
        <header className="site">
          <h1>Admin</h1>
          <span className="sub">
            <a href="/">takaisin chattiin</a>
          </span>
        </header>
        <form action={login} className="ask" style={{ borderTop: 0 }}>
          <input type="password" name="password" placeholder="Salasana" autoFocus />
          <button type="submit">Kirjaudu</button>
        </form>
      </div>
    );
  }

  // Evaluointi-istunnot rajataan pois käyttödatasta. Ne kulkevat saman
  // agentin läpi ja kirjoittavat oikeita tikettejä, joten ilman rajausta
  // ne näyttäisivät liikenteeltä ja vääristäisivät kustannuslukuja.
  const eiEval = notLike(turns.sessionId, "eval-%");

  const [summary] = await db
    .select({
      vuoroja: sql<number>`count(*)::int`,
      istuntoja: sql<number>`count(distinct ${turns.sessionId})::int`,
      kustannus: sql<number>`coalesce(sum(${turns.costEstimateUsd}), 0)`,
      keskilatenssi: sql<number>`coalesce(avg(${turns.latencyMs}), 0)`,
      syote: sql<number>`coalesce(sum(${turns.inputTokens}), 0)::int`,
      valimuisti: sql<number>`coalesce(sum(${turns.cacheReadTokens}), 0)::int`,
      virheita: sql<number>`count(*) filter (where ${turns.error} is not null)::int`,
    })
    .from(turns)
    .where(eiEval);

  const viimeisimmat = await db
    .select()
    .from(turns)
    .where(eiEval)
    .orderBy(desc(turns.createdAt))
    .limit(40);

  const ajot = await db
    .select()
    .from(evalRuns)
    .orderBy(desc(evalRuns.createdAt))
    .limit(16);

  const soitot = await db
    .select()
    .from(callbacks)
    .where(notLike(callbacks.sessionId, "eval-%"))
    .orderBy(desc(callbacks.createdAt))
    .limit(20);

  const tiketit = await db
    .select()
    .from(tickets)
    .where(notLike(tickets.sessionId, "eval-%"))
    .orderBy(desc(tickets.createdAt))
    .limit(20);

  const valimuistiOsuus =
    summary.syote + summary.valimuisti > 0
      ? (summary.valimuisti / (summary.syote + summary.valimuisti)) * 100
      : 0;

  return (
    <div className="wrap wrap--wide">
      <header className="site">
        <h1>Admin</h1>
        <span className="sub">
          <a href="/">chat</a> · malli <span className="mono">{MODEL_ID}</span> · kehote{" "}
          <span className="mono">{PROMPT_HASH}</span> · upotus{" "}
          <span className="mono">{EMBED_MODEL}</span> · kanta{" "}
          <span className="mono">{DB_MODE}</span>
        </span>
      </header>

      <p className="notice">
        Luvut eivät sisällä evaluointiajoja (istunnot <span className="mono">eval-*</span>).
        Ne kulkevat saman agentin läpi ja tekevät oikeita kirjauksia, joten mukana
        ne näyttäisivät liikenteeltä ja vääristäisivät kustannuslukuja.
      </p>

      <div className="cards">
        <div className="card">
          <div className="k">Vuoroja</div>
          <div className="v">{summary.vuoroja}</div>
        </div>
        <div className="card">
          <div className="k">Istuntoja</div>
          <div className="v">{summary.istuntoja}</div>
        </div>
        <div className="card">
          <div className="k">Kustannus</div>
          <div className="v">{usd(Number(summary.kustannus))}</div>
        </div>
        <div className="card">
          <div className="k">Keskilatenssi</div>
          <div className="v">{Math.round(Number(summary.keskilatenssi))} ms</div>
        </div>
        <div className="card">
          <div className="k">Välimuistiosuus</div>
          <div className="v">{valimuistiOsuus.toFixed(0)} %</div>
        </div>
        <div className="card">
          <div className="k">Virheitä</div>
          <div className="v">{summary.virheita}</div>
        </div>
      </div>

      <h2>Evaluointiajot</h2>
      <div className="scroll">
        {ajot.length === 0 ? (
          <div className="empty">
            Ei ajoja. Aja <span className="mono">npm run eval</span>.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Aika</th>
                <th>Sarja</th>
                <th>Tulos</th>
                <th>Kynnys</th>
                <th>Tila</th>
                <th>Malli</th>
                <th>Kehote</th>
              </tr>
            </thead>
            <tbody>
              {ajot.map((r) => {
                const lukumaara = r.suite === "injectionLeaks";
                const n = (v: number) =>
                  lukumaara ? String(v) : `${(v * 100).toFixed(1)} %`;
                return (
                  <tr key={r.id}>
                    <td>{fi(r.createdAt)}</td>
                    <td className="mono">{r.suite}</td>
                    <td>{n(r.score)}</td>
                    <td>{n(r.threshold)}</td>
                    <td className={r.passed === "pass" ? "pass" : "fail"}>
                      {r.passed === "pass" ? "OK" : "ALITUS"}
                    </td>
                    <td className="mono">{r.modelId}</td>
                    <td className="mono">{r.promptHash}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2>Viimeisimmät vuorot</h2>
      <div className="scroll">
        {viimeisimmat.length === 0 ? (
          <div className="empty">Ei liikennettä.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Aika</th>
                <th>Lähde</th>
                <th>Istunto</th>
                <th>Viesti</th>
                <th>Työkalut</th>
                <th>Tokenit</th>
                <th>Kust.</th>
                <th>ms</th>
                <th>Kehote</th>
                <th>Virhe</th>
              </tr>
            </thead>
            <tbody>
              {viimeisimmat.map((t) => (
                <tr key={t.id}>
                  <td>{fi(t.createdAt)}</td>
                  <td>{t.source}</td>
                  <td className="mono">{t.sessionId}</td>
                  <td className="wrap-cell">{cut(t.userMessage, 140)}</td>
                  <td className="mono">
                    {(t.toolCalls ?? []).length === 0
                      ? "—"
                      : (t.toolCalls ?? [])
                          .map((c) => `${c.name}${c.ok ? "" : "✕"}`)
                          .join(" ")}
                  </td>
                  <td className="mono">
                    {t.inputTokens}/{t.outputTokens}
                    {t.cacheReadTokens ? ` (${t.cacheReadTokens}c)` : ""}
                  </td>
                  <td className="mono">{usd(t.costEstimateUsd ?? 0)}</td>
                  <td className="mono">{t.latencyMs}</td>
                  <td className="mono">{t.promptHash}</td>
                  <td className={t.error ? "fail" : ""}>{t.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Tiketit</h2>
      <div className="scroll">
        {tiketit.length === 0 ? (
          <div className="empty">Ei tikettejä.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Aika</th>
                <th>Tyyppi</th>
                <th>Prioriteetti</th>
                <th>Yhteenveto</th>
                <th>Sähköposti</th>
                <th>Istunto</th>
              </tr>
            </thead>
            <tbody>
              {tiketit.map((t) => (
                <tr key={t.id}>
                  <td>{fi(t.createdAt)}</td>
                  <td>{t.type}</td>
                  {/* Prioriteetti tulee guards.ts:n taulukosta, ei mallilta. */}
                  <td className="mono">{t.priority}</td>
                  <td className="wrap-cell">{t.summary}</td>
                  <td className="mono">{t.contactEmail}</td>
                  <td className="mono">{t.sessionId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Soittopyynnöt</h2>
      <div className="scroll">
        {soitot.length === 0 ? (
          <div className="empty">Ei soittopyyntöjä.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Aika</th>
                <th>Nimi</th>
                <th>Puhelin</th>
                <th>Aihe</th>
                <th>Toive</th>
                <th>Tila</th>
              </tr>
            </thead>
            <tbody>
              {soitot.map((c) => (
                <tr key={c.id}>
                  <td>{fi(c.createdAt)}</td>
                  <td>{c.name}</td>
                  <td className="mono">{c.phone}</td>
                  <td className="wrap-cell">{c.topic}</td>
                  <td>{c.preferredWindow ?? "—"}</td>
                  <td>{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
