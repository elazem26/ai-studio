import { NextRequest, NextResponse } from "next/server";
import { cancelActiveTask } from "../generate/route";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/tryon/cancel
 * Body: { taskId: string }
 *
 * Aborts the in-flight generation. The SSE stream will then receive
 * a "complete" event with success=false.
 */
export async function POST(req: NextRequest) {
  const { taskId } = (await req.json().catch(() => ({}))) as { taskId?: string };
  if (!taskId) {
    return NextResponse.json(
      { error: "Missing taskId" },
      { status: 400 }
    );
  }
  const ok = cancelActiveTask(taskId);
  await logEvent({
    category: "tryon",
    message: `Task ${taskId} cancelled by user`,
    details: ok ? "found" : "not found",
  });
  return NextResponse.json({ ok, taskId });
}
