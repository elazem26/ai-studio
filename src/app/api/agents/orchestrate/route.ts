import { NextRequest, NextResponse } from "next/server";
import { orchestrateAgents, type AgentId } from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/orchestrate
 *
 * Run a chain of agents in sequence. Each agent's report is captured,
 * and downstream agents in the chain can react to upstream failures.
 *
 * Body: {
 *   workflow: AgentId[],  // e.g. ["qa", "server-monitor", "manager"]
 * }
 *
 * Returns: { results: [{agentId, report}], summary, ok }
 *
 * Built-in workflows (if you want shortcuts):
 *   "qa-fail-recovery"  → ["qa", "server-monitor", "manager"]
 *   "full-sweep"        → ["qa", "security", "server-monitor", "manager", "update-manager", "backup"]
 *   "session-start"     → ["update-manager", "backup"]
 *   "session-end"       → ["backup", "manager"]
 */
const BUILTIN_WORKFLOWS: Record<string, AgentId[]> = {
  "qa-fail-recovery": ["qa", "server-monitor", "manager"],
  "full-sweep": ["qa", "security", "server-monitor", "manager", "update-manager", "backup"],
  "session-start": ["update-manager", "backup"],
  "session-end": ["backup", "manager"],
};

export async function POST(req: NextRequest) {
  let body: { workflow?: AgentId[] | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let workflow: AgentId[];
  if (typeof body.workflow === "string") {
    // Built-in workflow shortcut
    const builtin = BUILTIN_WORKFLOWS[body.workflow];
    if (!builtin) {
      return NextResponse.json(
        {
          error: `Unknown built-in workflow: ${body.workflow}`,
          available: Object.keys(BUILTIN_WORKFLOWS),
        },
        { status: 400 }
      );
    }
    workflow = builtin;
  } else if (Array.isArray(body.workflow)) {
    workflow = body.workflow;
  } else {
    return NextResponse.json(
      { error: "Missing workflow (array of agentIds or built-in name)" },
      { status: 400 }
    );
  }

  if (workflow.length === 0) {
    return NextResponse.json({ error: "Empty workflow" }, { status: 400 });
  }

  // Validate all agentIds
  const validIds: AgentId[] = [
    "qa",
    "security",
    "server-monitor",
    "backup",
    "manager",
    "update-manager",
    "chat-assistant",
  ];
  for (const id of workflow) {
    if (!validIds.includes(id)) {
      return NextResponse.json(
        { error: `Invalid agentId in workflow: ${id}` },
        { status: 400 }
      );
    }
  }

  try {
    const results = await orchestrateAgents(workflow);
    const allOk = results.every((r) => r.report.success);
    return NextResponse.json({
      ok: allOk,
      workflow,
      results,
      summary: `${results.filter((r) => r.report.success).length}/${results.length} steps OK`,
    });
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
