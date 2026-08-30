import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
 * karkeampi kuin oikea moduuligraafi, mutta riippumaton
 * rakennusvaiheesta ja ajettavissa ilman avaimia ja ilman kantaa —
 * samasta syystä kuin turvakerroksen testit.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "app", "demo", "page.tsx");

const KIELLETYT_PAKETIT = ["@anthropic-ai/sdk"];
const KIELLETYT_TIEDOSTOT = [join("lib", "agent", "loop")];

/** Kaikki importtimuodot: from-lauseet, sivuvaikutusimportit ja dynaamiset. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of [
    /\bfrom\s*["']([^"']+)["']/g,
    /^\s*import\s+["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** Ratkaisee tuontipolun tiedostoksi, tai null jos kyseessä on paketti. */
function resolveFile(spec: string, fromDir: string): string | null {
  const base = spec.startsWith("@/")
    ? join(ROOT, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(fromDir, spec)
      : null;

  if (base === null) return null; // paketti, ei tiedosto

  for (const p of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(p) && !p.endsWith("/") && readFileSafe(p) !== null) return p;
  }
  return null;
}

function readFileSafe(p: string): string | null {
  try {
    const s = readFileSync(p, "utf8");
    return s;
  } catch {
    return null;
  }
}

/** Riippuvuuspuu: kaikki tavoitettavat tiedostot ja paketit. */
function walk(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    const src = readFileSafe(file);
    if (src === null) continue;

    for (const spec of specifiers(src)) {
      const target = resolveFile(spec, dirname(file));
      if (target) queue.push(target);
      // node:-moduulit eivät ole riippuvuuksia joista kustannus syntyy.
      else if (!spec.startsWith("node:")) packages.add(spec);
    }
  }

  return { files, packages };
}

const graph = walk(ENTRY);

// ── Negatiivinen kontrolli ──────────────────────────────────────────────
//
// Ilman näitä rikkinäinen kävelijä läpäisisi kaikki muut testit
// tyhjällä tuloksella. Testi, joka ei voi epäonnistua, ei ole testi.

test("kävelijä löytää sisääntulotiedoston", () => {
  assert.ok(graph.files.has(ENTRY), "app/demo/page.tsx ei ole puussa");
});

test("kävelijä seuraa suhteellisia importteja", () => {
  assert.ok(
    graph.files.has(join(ROOT, "app", "demo", "viewer.tsx")),
    "viewer.tsx ei löytynyt — kävelijä ei seuraa './viewer'-muotoa",
  );
});

test("kävelijä seuraa @/-alkuisia importteja", () => {
  assert.ok(
    graph.files.has(join(ROOT, "lib", "demo", "types.ts")),
    "lib/demo/types.ts ei löytynyt — kävelijä ei ratkaise @/-polkuja",
  );
});

test("kävelijä tunnistaa paketit", () => {
  assert.ok(graph.packages.has("react"), "react ei löytynyt pakettien joukosta");
});

test("kävelijä löytää Anthropic-SDK:n silloin kun se on puussa", () => {
  // Sama kävelijä ajetaan tiedostoon, joka VARMASTI tuo SDK:n. Jos tämä
  // ei löydä sitä, /demo-tarkistus on merkityksetön.
  const loop = walk(join(ROOT, "lib", "agent", "loop.ts"));
  assert.ok(
    loop.packages.has("@anthropic-ai/sdk"),
    "kävelijä ei löydä SDK:ta edes lib/agent/loop.ts:stä",
  );
});

// ── Varsinainen lupaus ──────────────────────────────────────────────────

test("/demo ei tuo Anthropic-SDK:ta", () => {
  for (const pkg of KIELLETYT_PAKETIT) {
    assert.ok(
      !graph.packages.has(pkg),
      `/demo-reitin riippuvuuspuussa on ${pkg}. Sivu on tarkoitettu toistamaan tallennettuja ajoja ilman mallikutsuja.`,
    );
  }
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
