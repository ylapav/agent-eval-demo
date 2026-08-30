import { existsSync } from "node:fs";
import { join } from "node:path";
import Chat from "./chat";

/**
 * Etusivu valitsee näkymän sen mukaan, onko agentti konfiguroitu.
 *
 * Ilman avainta chattia ei tarjota lainkaan. Aiemmin se tarjottiin, ja
 * ensimmäinen asia jonka kävijä näki oli oma viestinsä ja sen alla
 * "Agenttia ei ole konfiguroitu". Se on huono ensivaikutelma riippumatta
 * siitä miten hyvä koodi on — ja se on väärä ohje, koska kävijä ei voi
 * tehdä asialle mitään.
 *
 * Tarkistus on palvelinpuolella, koska avain ei kuulu selaimeen. Sivu
 * renderöityy dynaamisesti, jotta avaimen lisääminen näkyy ilman uutta
 * käännöstä.
 */
export const dynamic = "force-dynamic";

const onDemo = () => existsSync(join(process.cwd(), "demo-runs.json"));

export default function Home() {
  if (process.env.ANTHROPIC_API_KEY) return <Chat />;

  return (
    <div className="wrap">
      <header className="site">
        <h1>Nordkanta — asiakaspalveluagentti</h1>
        <span className="sub">työnäyte · agentti, turvakerros, evaluointi</span>
      </header>

      <p className="notice">
        Tämä ajo on ilman API-avaimia, joten elävää chattia ei tarjota.{" "}
        <a href="/demo">Tallennetut ajot</a> näyttävät saman agentin
        toiminnassa — todellisia vastauksia, työkalukutsuja ja katkelmia, jotka on
        nauhoitettu kertaalleen eikä kutsuta mallia uudelleen.
      </p>

      <p>
        <a href="/demo">
          <strong>
            {onDemo() ? "Katso tallennetut ajot →" : "Tallennetut ajot (ei vielä nauhoitettu) →"}
          </strong>
        </a>
      </p>

      <p className="hint">
        Elävä versio käyntiin: kopioi <span className="mono">.env.example</span>{" "}
        tiedostoksi <span className="mono">.env.local</span>, täytä{" "}
        <span className="mono">ANTHROPIC_API_KEY</span> ja{" "}
        <span className="mono">OPENAI_API_KEY</span>, aja{" "}
        <span className="mono">npm run index</span> ja lataa sivu uudelleen. Ilman
        OpenAI-avainta haku toimii leksikaalisesti; ilman Anthropic-avainta agentti
        ei vastaa.
      </p>

      <p className="hint">
        Muut näkymät: <a href="/eval">evaluoinnin tulokset</a> ·{" "}
        <a href="/admin">admin</a> (vaatii <span className="mono">ADMIN_PASSWORD</span>)
      </p>
    </div>
  );
}
