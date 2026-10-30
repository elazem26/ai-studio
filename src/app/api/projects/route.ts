import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/projects — list saved project sessions
 */
export async function GET() {
  const projects = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ projects });
}

interface SaveBody {
  name: string;
  sourcePath: string;
  garmentPath: string;
  settingsJson: string;
  seedUsed?: string;
  modelUsed?: string;
  resultIds?: string;
}

/**
 * POST /api/projects — save a new project session
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as SaveBody;
  if (!body.name || !body.sourcePath) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const proj = await db.project.create({
    data: {
      name: body.name,
      sourcePath: body.sourcePath,
      garmentPath: body.garmentPath,
      settingsJson: body.settingsJson,
      seedUsed: body.seedUsed ? BigInt(body.seedUsed) : null,
      modelUsed: body.modelUsed ?? null,
      resultIds: body.resultIds ?? "",
    },
  });
  return NextResponse.json({ project: proj });
}
