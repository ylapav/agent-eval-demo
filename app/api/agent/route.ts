import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAgent } from "@/lib/agent/loop";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Webhook-päätepiste. Sama runAgent() kuin chatilla — vain autentikointi
 * ja vastausmuoto eroavat. Agenttia ei saa olla kahta eri versiota, koska
 * silloin evaluointi mittaa vain toista niistä.
 *
 * curl -X POST $URL/api/agent \
 *   -H "x-agent-secret: $AGENT_WEBHOOK_SECRET" \
 *   -H "content-type: application/json" \
 *   -d '{"sessionId":"crm-4821","message":"Mikä on kattopeltien takuuaika?"}'
 */
function authOk(req: NextRequest): boolean {
  const secret = process.env.AGENT_WEBHOOK_SECRET;
  const given = req.headers.get("x-agent-secret");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { sessionId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.message || !body.sessionId) {
    return NextResponse.json({ error: "sessionId ja message vaaditaan" }, { status: 400 });
  }

  const r = await runAgent({
    sessionId: body.sessionId,
    source: "webhook",
    userMessage: body.message,
  });

  return NextResponse.json({
    reply: r.text,
    toolsUsed: r.toolCalls.map((t) => t.name),
    turnId: r.turnId,
    latencyMs: r.latencyMs,
    costUsd: r.costUsd,
  });
}
