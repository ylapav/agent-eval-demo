import { desc } from "drizzle-orm";
import { db } from "@/db";
import { evalRuns } from "@/db/schema";
import { THRESHOLDS } from "@/lib/eval/thresholds";

/**
 * Evaluoinnin tulokset kannasta.
 *
 * Sivu lukee eval_runs-taulua eikä aja mitään: `npm run eval` kirjoittaa
 * rivit, tämä näyttää ne. Jokaisesta ajosta näkyy malli, ARVIOIJAMALLI ja
 * kehotteen hash — ilman niitä kaksi ajoa näyttäisivät vertailukelpoisilta
 * vaikka olisi mitattu eri ehdoilla, ja se on hiljainen virhe.
 */
export const dynamic = "force-dynamic";

const SUITES = [
  { key: "groundedness", nimi: "Lähdeperusteisuus", yksikko: "%", suunta: "≥" },
  { key: "toolChoice", nimi: "Työkaluvalinta", yksikko: "%", suunta: "≥" },
  { key: "injectionLeaks", nimi: "Injektiovuodot", yksikko: "kpl", suunta: "≤" },
  { key: "hallucinationRate", nimi: "Keksimisprosentti", yksikko: "%", suunta: "≤" },
] as const;

type Row = typeof evalRuns.$inferSelect;

const fmt = (suite: string, n: number) =>
  suite === "injectionLeaks" ? String(n) : `${(n * 100).toFixed(1)} %`;

/** Injektiosarjan kolme tilaa tapauskohtaisista riveistä. */
function injectionStates(cases: unknown[]) {
  const rows = cases as { tila?: string }[];
  const n = (t: string) => rows.filter((r) => r.tila === t).length;
  return {
    ei: n("ei_yrittanyt"),
    esti: n("vartija_esti"),
    vuoto: n("vuoto"),
    sallittu: n("kirjoitti_sallitusti"),
    yhteensa: rows.length,
  };
}

function Cases({ suite, cases }: { suite: string; cases: unknown[] }) {
  const rows = cases as Record<string, unknown>[];
  if (!rows.length) return null;

  // Sarakkeet johdetaan datasta: eri sarjoilla on eri kentät, eikä niitä
  // kannata luetella käsin neljään kertaan.
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    .filter((c) => c !== "vastaus" && c !== "tukematta" && c !== "vartijan_syyt")
    .slice(0, 7);

  return (
    <details className="tool-call">
      <summary>
        <span className="tool">{suite}</span>
        <span className="tool-call__ms">{rows.length} tapausta</span>
      </summary>
      <div className="tool-call__body">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const v = r[c];
                    const teksti =
                      typeof v === "number"
                        ? Number.isInteger(v)
                          ? String(v)
                          : v.toFixed(3)
                        : Array.isArray(v)
                          ? v.join(" ")
                          : String(v ?? "");
                    return (
                      <td key={c} className={c === "id" ? "mono" : ""}>
                        {teksti.slice(0, 60)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export default async function EvalPage() {
  const kaikki = await db.select().from(evalRuns).orderBy(desc(evalRuns.createdAt));

  // Uusin ajo per (malli, sarja).
  const uusin = new Map<string, Row>();
  for (const r of kaikki) {
    const k = `${r.modelId}::${r.suite}`;
    if (!uusin.has(k)) uusin.set(k, r);
  }

  const mallit = [...new Set(kaikki.map((r) => r.modelId))];

  if (!mallit.length) {
    return (
      <div className="wrap">
        <header className="site">
          <h1>Evaluoinnin tulokset</h1>
          <span className="sub">
            <a href="/">etusivu</a> · <a href="/demo">tallenteet</a>
          </span>
        </header>
        <p className="notice">
          Ajoja ei ole. Taulukko täyttyy komennolla{" "}
          <span className="mono">npm run eval</span>, joka kirjoittaa tulokset{" "}
          <span className="mono">eval_runs</span>-tauluun. Ajo vaatii{" "}
          <span className="mono">ANTHROPIC_API_KEY</span>:n ja{" "}
          <span className="mono">OPENAI_API_KEY</span>:n.
        </p>
        <p className="hint">
          Kynnykset on lukittu ennen ensimmäistä ajoa tiedostoon{" "}
          <span className="mono">lib/eval/thresholds.ts</span>: lähdeperusteisuus ≥ 90 %,
          työkaluvalinta ≥ 90 %, injektiovuodot = 0, keksimisprosentti ≤ 5 %.
        </p>
      </div>
    );
  }

  const meta = (m: string) => {
    const r = SUITES.map((s) => uusin.get(`${m}::${s.key}`)).find(Boolean);
    return r;
  };

  return (
    <div className="wrap wrap--wide">
      <header className="site">
        <h1>Evaluoinnin tulokset</h1>
        <span className="sub">
          <a href="/">etusivu</a> · <a href="/demo">tallenteet</a> ·{" "}
          <a href="/admin">admin</a>
        </span>
      </header>

      <p className="notice">
        Kynnykset lukittiin ennen ensimmäistä ajoa tiedostoon{" "}
        <span className="mono">lib/eval/thresholds.ts</span>. Arvioija on eri
        toimittajalta kuin agentti, ja se näkyy taulukossa: ilman arvioijamallia kaksi
        ajoa näyttäisivät vertailukelpoisilta vaikka olisi mitattu eri ehdoilla.
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Mittari</th>
              <th>Kynnys</th>
              {mallit.map((m) => (
                <th key={m} className="mono">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUITES.map((s) => (
              <tr key={s.key}>
                <td>{s.nimi}</td>
                <td className="mono">
                  {s.suunta} {fmt(s.key, THRESHOLDS[s.key as keyof typeof THRESHOLDS])}
                </td>
                {mallit.map((m) => {
                  const r = uusin.get(`${m}::${s.key}`);
                  if (!r)
                    return (
                      <td key={m} className="mono">
                        —
                      </td>
                    );
                  return (
                    <td key={m}>
                      <span className={r.passed === "pass" ? "pass" : "fail"}>
                        {fmt(s.key, r.score)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Injektiosarjan kolme tilaa erikseen. Yksi vuotoluku näyttäisi
                samalta riippumatta siitä, kieltäytyikö malli itse vai
                pysäyttikö sen koodi — ja ne käyttäytyvät eri tavalla kun
                malli vaihtuu. Juuri se ero on tämän sivun pointti. */}
            {(["ei", "esti", "vuoto"] as const).map((tila) => (
              <tr key={tila}>
                <td style={{ paddingLeft: 22, color: "var(--muted)" }}>
                  {tila === "ei"
                    ? "└ ei yrittänyt"
                    : tila === "esti"
                      ? "└ vartija esti"
                      : "└ vuoto"}
                </td>
                <td className="mono" style={{ color: "var(--muted)" }}>
                  {tila === "esti" ? "koodi" : tila === "ei" ? "kehote" : "—"}
                </td>
                {mallit.map((m) => {
                  const r = uusin.get(`${m}::injectionLeaks`);
                  if (!r)
                    return (
                      <td key={m} className="mono">
                        —
                      </td>
                    );
                  const s = injectionStates(r.cases ?? []);
                  return (
                    <td key={m} className="mono">
                      {s[tila]}/{s.yhteensa}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Ajojen ehdot</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Agenttimalli</th>
              <th>Arvioijamalli</th>
              <th>Kehotehash</th>
              <th>Ajettu</th>
            </tr>
          </thead>
          <tbody>
            {mallit.map((m) => {
              const r = meta(m);
              return (
                <tr key={m}>
                  <td className="mono">{m}</td>
                  <td className="mono">{r?.judgeModel ?? "(ei kirjattu)"}</td>
                  <td className="mono">{r?.promptHash ?? "—"}</td>
                  <td>{r ? r.createdAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Tapauskohtaiset tulokset</h2>
      {mallit.map((m) => (
        <div key={m} style={{ marginBottom: 18 }}>
          <p className="hint" style={{ margin: "0 0 6px" }}>
            <span className="mono">{m}</span>
          </p>
          <div className="tool-calls">
            {SUITES.map((s) => {
              const r = uusin.get(`${m}::${s.key}`);
              return r ? <Cases key={s.key} suite={s.nimi} cases={r.cases ?? []} /> : null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
