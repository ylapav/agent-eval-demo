import Anthropic from "@anthropic-ai/sdk";
import { requireModel } from "@/lib/agent/models";

/**
 * Arvioijan yhteys, erillään arvioijan logiikasta.
 *
 * Miksi omana tiedostonaan: arvioijan KEHOTE ja sen tulkinta ovat mittarin
 * määritelmä (lib/eval/groundedness.ts), ja se ei saa muuttua kun
 * toimittaja vaihtuu. Tämä tiedosto tietää vain miten teksti lähetetään ja
 * miten vastaus luetaan. Jos nämä olisivat samassa tiedostossa,
 * toimittajan vaihto koskisi mittarin määritelmää — ja silloin eri ajojen
 * luvut eivät olisi vertailukelpoisia.
 */
export const JUDGE_PROVIDER = (process.env.JUDGE_PROVIDER ?? "openai") as
  | "openai"
  | "anthropic";

export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "gpt-5-nano";

/** Toimittaja mallitaulukosta, ei ympäristöstä: taulukko on totuus.
 *  Tuntematon malli heittää UnknownModelError — toimittajaa ei arvata. */
export const judgeProviderOf = (model: string) => requireModel(model).provider;

type OpenAIChatResponse = {
  choices: { message: { content: string | null } }[];
};

async function callOpenAI(system: string, user: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY puuttuu, joten arvioijaa ei voi kutsua.");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // Arvioijan tehtävä on luokittelu, ei kirjoittaminen. JSON-tila
      // poistaa yhden virhelähteen kokonaan: mallin ei tarvitse muistaa
      // olla kirjoittamatta koodimerkintöjä ympärille.
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as OpenAIChatResponse;
  return json.choices[0]?.message?.content ?? "";
}

const anthropic = new Anthropic();

async function callAnthropic(system: string, user: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1000,
    system,
    messages: [{ role: "user", content: user }],
  });

  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Yksi arviointikutsu. Palauttaa mallin raakatekstin.
 *
 * Tulkinta — JSONin jäsentäminen ja pisteytys — kuuluu kutsujalle, koska
 * se on mittarin määritelmä eikä yhteyskerroksen asia.
 */
export async function callJudge(system: string, user: string): Promise<string> {
  return JUDGE_PROVIDER === "openai"
    ? callOpenAI(system, user)
    : callAnthropic(system, user);
}
