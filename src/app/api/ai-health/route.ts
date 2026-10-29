import { NextResponse } from "next/server";
import { isApiHealthy } from "@/lib/ai-rate-limiter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const healthy = isApiHealthy();
  return NextResponse.json({ aiAvailable: healthy, status: healthy ? "ok" : "rate-limited" });
}
