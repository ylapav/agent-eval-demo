"use client";

import { useState } from "react";
import type { DemoConversation, DemoToolCall, DemoTurn } from "@/lib/demo/types";

/**
 * Tallenteen katselin.
 *
 * Ei tuo lib/agent/loop.ts:ää eikä Anthropic-SDK:ta — vain tyypit
 * lib/demo/types.ts:stä, jolla ei ole yhtään importtia. Sivu ei siis voi
 * kutsua mallia edes vahingossa. tests/demo-cost.test.ts pitää tästä
 * huolta, koska kustannuslupaus on rakenteellinen vasta kun testi pitää
 * sen voimassa.
 */

const ANNOTATION_LABEL: Record<string, string> = {
  injection_blocked: "injektio torjuttu",
  guard_blocked: "vartija esti",
  write_ok: "kirjaus onnistui",
  refusal_ok: "kieltäytyminen",
  retrieval: "haku",
};

type Katkelma = { lahde: string; otsikko: string | null; teksti: string; osuvuus: number };

/** Poimii tietopohjahaun katkelmat, jos työkalu oli hae_tietopohjasta. */
function katkelmat(c: DemoToolCall): Katkelma[] {
  if (c.name !== "hae_tietopohjasta" || !c.ok) return [];
  return ((c.output as { katkelmat?: Katkelma[] }).katkelmat ?? []).slice();
}

function ToolCall({ c }: { c: DemoToolCall }) {
  const hits = katkelmat(c);
  return (
    <details className="tool-call">
      <summary>
        <span className={`tool${c.ok ? "" : " tool--fail"}`}>
          {c.name}
          {c.ok ? "" : " ✕"}
        </span>
        <span className="tool-call__ms">{c.ms} ms</span>
        {hits.length > 0 && (
          <span className="tool-call__ms">{hits.length} katkelmaa</span>
        )}
      </summary>

      <div className="tool-call__body">
        <div className="kv">
          <span className="kv__k">input</span>
          <pre className="kv__v">{JSON.stringify(c.input, null, 2)}</pre>
        </div>

        {hits.length > 0 ? (
          <div className="kv">
            <span className="kv__k">katkelmat</span>
            <div className="kv__v">
              {hits.map((h, i) => (
                <div key={i} className="chunk">
                  <div className="chunk__head">
                    <span className="chunk__score">{h.osuvuus.toFixed(3)}</span>
                    <span>
                      {h.lahde}
                      {h.otsikko ? ` / ${h.otsikko}` : ""}
                    </span>
                  </div>
                  <div className="chunk__text">{h.teksti}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="kv">
            <span className="kv__k">output</span>
            <pre className="kv__v">{JSON.stringify(c.output, null, 2)}</pre>
          </div>
        )}

        <div className="kv">
          <span className="kv__k">ok</span>
          <span className="kv__v mono">{String(c.ok)}</span>
        </div>
      </div>
    </details>
  );
}

function Turn({ t, index }: { t: DemoTurn; index: number }) {
  return (
    <div className="demo-turn">
      <div className="msg msg--user">
        <div className="who">käyttäjä · vuoro {index + 1}</div>
        <div className="body">{t.user}</div>
      </div>

      {t.toolCalls.length > 0 && (
        <div className="tool-calls">
          {t.toolCalls.map((c, i) => (
            <ToolCall key={i} c={c} />
          ))}
        </div>
      )}

      <div className="msg msg--assistant">
        <div className="who">agentti</div>
        <div className="body">{t.assistant}</div>
      </div>

      {t.annotation && (
        <div className={`note note--${t.annotation.type}`}>
          <div className="note__type">
            {ANNOTATION_LABEL[t.annotation.type] ?? t.annotation.type}
          </div>
          <div>{t.annotation.text}</div>
        </div>
      )}

      <div className="meta">
        <span>{t.meta.latencyMs} ms</span>
        <span>
          {t.meta.inputTokens}/{t.meta.outputTokens} tokenia
        </span>
        <span>${t.meta.costUsd.toFixed(4)}</span>
      </div>
    </div>
  );
}

export default function Viewer({ conversations }: { conversations: DemoConversation[] }) {
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(1);

  const conv = conversations[active];
  const done = shown >= conv.turns.length;

  const select = (i: number) => {
    setActive(i);
    // Vuoro kerrallaan myös vaihdon jälkeen: koko keskustelu kerralla
    // hukkaisi sen mitä demo yrittää näyttää, eli järjestyksen.
    setShown(1);
  };

  return (
    <div className="demo">
      <nav className="demo__list">
        {conversations.map((c, i) => (
          <button
            key={c.id}
            className={`demo__item${i === active ? " demo__item--on" : ""}`}
            onClick={() => select(i)}
          >
            <span className="demo__label">{c.label}</span>
            <span className="demo__why">{c.why}</span>
          </button>
        ))}
      </nav>

      <section className="demo__thread">
        {conv.turns.slice(0, shown).map((t, i) => (
          <Turn key={i} t={t} index={i} />
        ))}

        <div className="demo__step">
          {done ? (
            <span className="hint">
              Keskustelu päättyi. {conv.turns.length}{" "}
              {conv.turns.length === 1 ? "vuoro" : "vuoroa"}.
            </span>
          ) : (
            <button onClick={() => setShown((n) => n + 1)}>
              Seuraava vuoro ({shown}/{conv.turns.length})
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
