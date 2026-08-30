import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lukitsee /demo-reitin nollakustanteisuuden.
 *
 * Tämä ei ole muodollisuus. Ilman testiä joku tuo myöhemmin apufunktion
 * lib/agent/loop.ts:stä — vaikka vain tyypin — ja sivu alkaa hiljaa vetää
 * Anthropic-SDK:ta mukaansa. Repo on julkinen ja linkitetty portfolioon,
 * joten se olisi kustannus jokaisesta kävijästä. Kustannuslupaus on
 * rakenteellinen vasta kun testi pitää sen voimassa.
 *
 * Testi kävelee riippuvuuspuun lähdekoodista eikä bundlerista. Se on
 * karkeampi kuin oikea moduuligraafi, mutta riippumaton rakennusvaiheesta
 * ja ajettavissa ilman avaimia ja ilman kantaa — samasta syystä kuin
 * turvakerroksen testit.
 *
 * Karkeus maksoi kerran: ensimmäinen versio läpäisi kolme mutaatiota,
 * jotka kaikki kääntyivät ja olisivat kutsuneet mallia. Ne on nyt suljettu
 * ja jokaisella on oma testinsä alempana. Se on tämän tiedoston tärkein
 * opetus: kieltolistaan nojaava testi on juuri niin vahva kuin sen
 * polunratkaisu, ja hiljaa ohitettu importti on pahempi kuin puuttuva testi.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Sisääntulot ovat REITTI, ei yksi tiedosto.
 *
 * app/layout.tsx kääriytyy jokaisen sivun ympärille, joten se on
 * /demo-reitin todellisessa renderöintipuussa vaikka page.tsx ei tuo sitä.
 * Sama koskee app-routerin muita konventiotiedostoja ja middlewarea.
 * Ensimmäinen versio kävi vain page.tsx:n, ja SDK app/layout.tsx:ssä
 * läpäisi testin.
 */
function entryPoints(): string[] {
  const konventiot = [
    "layout.tsx",
    "template.tsx",
    "error.tsx",
    "loading.tsx",
    "not-found.tsx",
  ];
  const kansiot = [join(ROOT, "app"), join(ROOT, "app", "demo")];

  const out = [join(ROOT, "app", "demo", "page.tsx")];
  for (const d of kansiot) {
    for (const f of konventiot) {
      const p = join(d, f);
      if (existsSync(p)) out.push(p);
    }
  }
  for (const m of ["middleware.ts", "middleware.tsx", "instrumentation.ts"]) {
    const p = join(ROOT, m);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

const KIELLETYT_PAKETIT = ["@anthropic-ai/sdk"];
const KIELLETYT_TIEDOSTOT = [join("lib", "agent", "loop")];

/** Kaikki importtimuodot: from-lauseet, sivuvaikutusimportit ja dynaamiset. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of [
    /\bfrom\s*["'`]([^"'`]+)["'`]/g,
    /^\s*import\s+["'`]([^"'`]+)["'`]/gm,
    // Myös backtick-muotoinen dynaaminen importti: import(`@/lib/agent/loop`)
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ]) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out;
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/**
 * Ratkaisee tuontipolun tiedostoksi.
 *
 * Palauttaa tiedostopolun, tai null jos kyseessä on paketti. Heittää, jos
 * polku on paikallinen (./ tai @/) mutta ei ratkea miksikään tiedostoksi:
 * ratkeamaton paikallinen polku ei saa vaipua hiljaa "paketiksi", koska
 * silloin sen koko alipuu jäisi kävelemättä. Juuri niin
 * `import { runAgent } from "@/lib/agent/loop.js"` läpäisi ensimmäisen
 * version — ja se kääntyy, koska TypeScript kartoittaa .js-päätteen
 * .ts-tiedostoon.
 */
function resolveFile(spec: string, fromDir: string): string | null {
  const paikallinen = spec.startsWith("@/") || spec.startsWith(".");
  if (!paikallinen) return null;

  const base = spec.startsWith("@/")
    ? join(ROOT, spec.slice(2))
    : resolve(fromDir, spec);

  // TypeScript sallii .js-päätteen viittaamaan .ts-tiedostoon.
  const riisuttu = base.replace(/\.(js|jsx|mjs|cjs|mts|cts)$/, "");

  for (const p of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    riisuttu,
    `${riisuttu}.ts`,
    `${riisuttu}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (isFile(p)) return p;
  }

  throw new Error(
    `Paikallinen tuontipolku "${spec}" (tiedostossa ${fromDir}) ei ratkea miksikään tiedostoksi. Kävelijä ei voi tarkistaa sen alipuuta, joten testi ei voi luvata mitään.`,
  );
}

/** Riippuvuuspuu: kaikki tavoitettavat tiedostot ja paketit. */
function walk(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];

  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const spec of specifiers(src)) {
      const target = resolveFile(spec, dirname(file));
      if (target) queue.push(target);
      // node:-moduulit eivät ole riippuvuuksia joista kustannus syntyy.
      else if (!spec.startsWith("node:")) packages.add(spec);
    }
  }

  return { files, packages };
}

const ENTRIES = entryPoints();
const graph = walk(ENTRIES);

/** Osuuko paketti kieltoon myös alipolkuna (@anthropic-ai/sdk/client)? */
const kiellettyPaketti = (p: string) =>
  KIELLETYT_PAKETIT.some((k) => p === k || p.startsWith(`${k}/`));

// ── Negatiivinen kontrolli ──────────────────────────────────────────────
//
// Ilman näitä rikkinäinen kävelijä läpäisisi kaikki muut testit tyhjällä
// tuloksella. Testi, joka ei voi epäonnistua, ei ole testi.

test("kävelijä kattaa koko reitin, ei vain page.tsx:ää", () => {
  assert.ok(graph.files.has(join(ROOT, "app", "demo", "page.tsx")), "page.tsx puuttuu");
  assert.ok(
    graph.files.has(join(ROOT, "app", "layout.tsx")),
    "app/layout.tsx ei ole puussa — se kääriytyy /demo:n ympärille ja voi tuoda mitä tahansa",
  );
});

test("kävelijä seuraa suhteellisia ja @/-alkuisia importteja", () => {
  assert.ok(
    graph.files.has(join(ROOT, "app", "demo", "viewer.tsx")),
    "viewer.tsx ei löytynyt — './viewer' jäi seuraamatta",
  );
  assert.ok(
    graph.files.has(join(ROOT, "lib", "demo", "types.ts")),
    "lib/demo/types.ts ei löytynyt — @/-polku jäi ratkaisematta",
  );
});

test("kävelijä tunnistaa paketit", () => {
  assert.ok(graph.packages.has("react"), "react ei löytynyt pakettien joukosta");
});

test("kävelijä löytää SDK:n silloin kun se on puussa", () => {
  // Sama kävelijä ajetaan tiedostoon, joka VARMASTI tuo SDK:n. Jos tämä ei
  // löydä sitä, /demo-tarkistus on merkityksetön.
  const loop = walk([join(ROOT, "lib", "agent", "loop.ts")]);
  assert.ok(
    loop.packages.has("@anthropic-ai/sdk"),
    "kävelijä ei löydä SDK:ta edes lib/agent/loop.ts:stä",
  );
});

test("ratkeamaton paikallinen polku kaataa kävelijän eikä vaivu paketiksi", () => {
  assert.throws(
    () => resolveFile("@/lib/agent/loop-ei-olemassa", ROOT),
    /ei ratkea/,
    "ratkeamaton @/-polku ei heittänyt — sen alipuu jäisi kävelemättä",
  );
});

test("kiellon tunnistus kattaa alipolut", () => {
  assert.ok(kiellettyPaketti("@anthropic-ai/sdk"), "tarkka nimi ei osu");
  assert.ok(
    kiellettyPaketti("@anthropic-ai/sdk/client"),
    "alipolku ei osu — SDK:lla on aitoja alipolkuexportteja",
  );
  assert.ok(!kiellettyPaketti("react"), "sallittu paketti tunnistettiin kielletyksi");
});

test(".js-päätteinen tuonti ratkeaa .ts-tiedostoon", () => {
  // TypeScript sallii tämän muodon, ja se kääntyy. Ensimmäisessä versiossa
  // se ohitti koko tarkistuksen.
  assert.equal(
    resolveFile("@/lib/agent/loop.js", ROOT),
    join(ROOT, "lib", "agent", "loop.ts"),
  );
});

// ── Varsinainen lupaus ──────────────────────────────────────────────────

test("/demo ei tuo Anthropic-SDK:ta", () => {
  const osuma = [...graph.packages].find(kiellettyPaketti);
  assert.ok(
    !osuma,
    `/demo-reitin riippuvuuspuussa on ${osuma}. Sivu on tarkoitettu toistamaan tallennettuja ajoja ilman mallikutsuja.`,
  );
});

test("/demo ei tuo agenttisilmukkaa", () => {
  for (const kielletty of KIELLETYT_TIEDOSTOT) {
    const osuma = [...graph.files].find((f) =>
      f.replace(/\\/g, "/").includes(kielletty.replace(/\\/g, "/")),
    );
    assert.ok(
      !osuma,
      `/demo-reitin riippuvuuspuussa on ${osuma}. Silmukan tuominen vetää Anthropic-SDK:n mukanaan ja rikkoo kustannuslupauksen.`,
    );
  }
});
