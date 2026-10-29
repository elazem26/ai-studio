import { NextRequest, NextResponse } from "next/server";
import {
  runAgent,
  type AgentId,
} from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/run
 *
 * Manually trigger an agent run. Returns the agent's report.
 *
 * Body: { agentId: "qa" | "security" | "server-monitor" | "backup" | "manager" }
 */
export async function POST(req: NextRequest) {
  let body: { agentId?: AgentId };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agentId = body.agentId;
  if (!agentId) {
    return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
  }

  const validIds: AgentId[] = [
    "qa",
    "security",
    "server-monitor",
    "backup",
    "manager",
    "update-manager",
    "chat-assistant",
  ];
  if (!validIds.includes(agentId)) {
    return NextResponse.json(
      { error: `Invalid agentId. Valid: ${validIds.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const report = await runAgent(agentId);
    return NextResponse.json({ ok: report.success, report });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
