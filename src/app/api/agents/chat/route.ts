import { NextRequest, NextResponse } from "next/server";
import { runChatAssistant } from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/chat
 *
 * Voice/text chat with the chat-assistant agent.
 *
 * Body: { message: string, history?: [{role, content}] }
 *
 * Response: { reply: string, provider: string, ms: number }
 */
export async function POST(req: NextRequest) {
  let body: {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  try {
    const result = await runChatAssistant(
      body.message,
      body.history ?? []
    );
    return NextResponse.json({
      reply: result.reply,
      provider: result.provider,
      ms: result.ms,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
