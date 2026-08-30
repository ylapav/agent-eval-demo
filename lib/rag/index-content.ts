import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { chunks } from "@/db/schema";
import { embedDocuments, EMBED_MODE, EMBED_MODEL } from "./embed";

/**
 * Indeksoi content/*.md pgvectoriin.
 *
 * Pilkkominen tapahtuu otsikkotasolla (##), ei merkkimäärällä. Syy: näissä
 * dokumenteissa otsikko kantaa merkityksen ("Mitä takuu ei kata"), ja
 * kiinteä merkkiraja katkaisisi sen keskeltä. Katkelma ilman otsikkoaan
 * on juuri se tapaus, jossa haku palauttaa oikean tekstin väärässä
 * kontekstissa — ja se ei näy missään mittarissa.
 */
type Chunk = { docId: string; docTitle: string; heading: string | null; content: string };

function parse(md: string, fallbackId: string): Chunk[] {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = Object.fromEntries(
    (fm?.[1] ?? "").split("\n").map((l) => l.split(/:\s*/).map((s) => s.trim())),
  );
  const body = fm ? md.slice(fm[0].length) : md;
  const docId = meta.docId ?? fallbackId;
  const docTitle = meta.title ?? fallbackId;

  const out: Chunk[] = [];
  let heading: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text.length > 40) out.push({ docId, docTitle, heading, content: text });
    buf = [];
  };

  for (const line of body.split("\n")) {
    if (/^##\s+/.test(line)) {
      flush();
      heading = line.replace(/^##\s+/, "").trim();
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

async function main() {
  const dir = join(process.cwd(), "content");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  const all = files.flatMap((f) =>
    parse(readFileSync(join(dir, f), "utf8"), f.replace(/\.md$/, "")),
  );

  console.log(`upotusmalli: ${EMBED_MODEL}`);
  if (EMBED_MODE === "local") {
    console.warn(
      [
        "VAROITUS: VOYAGE_API_KEY puuttuu, joten indeksi rakennetaan paikallisella",
        "tiivisteupotuksella. Putki toimii, haun laatu ei. Evaluointi kieltäytyy",
        "ajamasta tällä indeksillä.",
      ].join("\n"),
    );
  }
  console.log(`${files.length} dokumenttia, ${all.length} katkelmaa`);

  await db.delete(chunks);

  const B = 32;
  for (let i = 0; i < all.length; i += B) {
    const batch = all.slice(i, i + B);
    const vecs = await embedDocuments(
      batch.map((c) => `${c.docTitle} — ${c.heading ?? ""}\n${c.content}`),
    );
    await db.insert(chunks).values(batch.map((c, j) => ({ ...c, embedding: vecs[j] })));
    console.log(`  ${Math.min(i + B, all.length)}/${all.length}`);
  }
  console.log("valmis");
}

main().catch((e) => { console.error(e); process.exit(1); });
