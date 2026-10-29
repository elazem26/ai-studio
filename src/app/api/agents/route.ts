import { NextRequest, NextResponse } from "next/server";
import {
  listAgents,
  getAgentsOverview,
  getAgentReports,
  type AgentId,
} from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agents
 *
 * Returns the list of all 6 agents with their current status,
 * last report, and per-agent stats.
 *
 * Optional query params:
 *   ?reports=true     include recent reports for each agent
 *   ?reportLimit=5    max reports per agent (default 5, max 20)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const includeReports = url.searchParams.get("reports") === "true";
  const reportLimit = Math.min(
    20,
    parseInt(url.searchParams.get("reportLimit") || "5", 10)
  );

  const overview = getAgentsOverview();

  if (includeReports) {
    const agentsWithReports = overview.agents.map((a) => ({
      ...a,
      recentReports: getAgentReports(a.id as AgentId, reportLimit),
    }));
    return NextResponse.json({
      ...overview,
      agents: agentsWithReports,
    });
  }

  return NextResponse.json(overview);
}
