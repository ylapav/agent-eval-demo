import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireModel, specFor, UnknownModelError } from "../lib/agent/models";

/**
 * Lukitsee mallitaulun tuntemattoman mallin käsittelyn.
 *
 * Tämä sattui oikeasti: gpt-4.1-mini puuttui taulusta, specFor() palautti
 * oletuksen provider: "anthropic", ja ajaja kieltäytyi väittäen agentin ja
 * arvioijan olevan samalta toimittajalta. Kieltäytyminen oli oikea, syy
 * väärä — ja sama oletus toisin päin olisi päästänyt saman toimittajan
 * arvioijan läpi hiljaa.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TUNTEMATON = "ei-olemassa-oleva-malli-xyz";

test("gpt-4.1-mini on taulussa OpenAI:n mallina", () => {
  assert.equal(requireModel("gpt-4.1-mini").provider, "openai");
});

test("tuntematon malli: requireModel heittää nimetyn virheen", () => {
  assert.throws(
    () => requireModel(TUNTEMATON),
    (e: unknown) =>
      e instanceof UnknownModelError &&
      e.model === TUNTEMATON &&
      e.message.includes("puuttuu hintataulusta") &&
      e.message.includes("lib/agent/models.ts"),
  );
});

test("tuntematon malli: specFor ei oleta toimittajaa", () => {
  assert.equal(specFor(TUNTEMATON).provider, null);
});

test("tuntematon arvioija: judge-check kieltäytyy exit-koodilla 2 ennen API-kutsuja", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/judge-check.ts"], {
    cwd: ROOT,
    // Ei avaimia: jos tarkistus ei laukea ensin, skripti kaatuisi
    // avaintarkistukseen eri viestillä ja testi huomaisi sen.
    env: { ...process.env, JUDGE_MODEL: TUNTEMATON, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 2, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, new RegExp(`malli ${TUNTEMATON} puuttuu hintataulusta`));
});
