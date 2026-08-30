import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/loop";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Chat-UI:n reitti.
 *
 * Historiaa ei oteta vastaan pyynnössä. Se luetaan turns-taulusta
 * sessionId:n perusteella. Syy on turvallisuus eikä siisteys:
 * kirjoitusvartijat nojaavat aiempien vuorojen määrään, joten jos selain
 * saisi lähettää historian, asiakas voisi keksiä vahvistuskierroksen
 * jota ei tapahtunut.
 */
export async function POST(req: NextRequest) {
  let body: { sessionId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = body.message?.trim();
  const sessionId = body.sessionId?.trim();

  if (!message || !sessionId) {
    return NextResponse.json({ error: "sessionId ja message vaaditaan" }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "viesti on liian pitkä" }, { status: 400 });
  }

  const r = await runAgent({ sessionId, source: "chat", userMessage: message });

  return NextResponse.json({
    reply: r.text,
    // Työkalut näytetään käyttöliittymässä. Se on demon kannalta olennaista:
    // agentin arvo on siinä mitä se teki, ei vain siinä mitä se sanoi.
    tools: r.toolCalls.map((t) => ({ name: t.name, ok: t.ok, ms: t.ms })),
    latencyMs: r.latencyMs,
    costUsd: r.costUsd,
  });
}
