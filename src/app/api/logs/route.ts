import { NextRequest, NextResponse } from "next/server";
import { getRecentLogs, clearLogs } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/logs?limit=100 — recent log entries
 * DELETE /api/logs — clear all
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? "100"));
  const logs = await getRecentLogs(limit);
  return NextResponse.json({ logs });
}

export async function DELETE() {
  await clearLogs();
  return NextResponse.json({ ok: true });
}
