import { NextRequest, NextResponse } from "next/server";
import { getTask, cleanupOldTasks } from "@/lib/task-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  cleanupOldTasks();
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  // NOTE: `phase` + frame counters MUST be included — the frontend poller
  // gates its progress UI on these fields (missing `phase` froze the bar at 2%).
  return NextResponse.json({
    id: task.id,
    status: task.status,
    result: task.result,
    error: task.error,
    progress: task.progress,
    label: task.label,
    phase: task.phase,
    processedFrames: task.processedFrames,
    totalFrames: task.totalFrames,
    bytesReceived: task.bytesReceived,
    bytesTotal: task.bytesTotal,
  });
}
