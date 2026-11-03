import { NextResponse } from "next/server";
import { PLANS } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ plans: PLANS }); }
