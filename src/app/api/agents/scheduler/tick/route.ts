import { NextResponse } from "next/server";
import { runScheduledAgents } from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/scheduler/tick
 *
 * Internal endpoint — called by a background timer to run any
 * agents whose schedule has elapsed.
 */
export async function POST() {
  try {
    await runScheduledAgents();
    return NextResponse.json({ ok: true, tickedAt: Date.now() });
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
