import { NextResponse } from "next/server";
import { listAllModels } from "@/lib/ai/model-manager";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/models
 *
 * Returns all registered models, merged with the persisted DB record
 * (so we know which are installed/active on this machine).
 */
export async function GET() {
  const registered = await listAllModels();
  const dbModels = await db.aIModel.findMany();
  const dbById = new Map(dbModels.map((m) => [m.name, m]));

  const out = registered.map((info) => {
    const rec = dbById.get(info.id);
    return {
      ...info,
      isActive: rec?.isActive ?? false,
      status: rec?.status ?? "not_installed",
      installedAt: rec?.installedAt ?? null,
    };
  });

  return NextResponse.json({ models: out });
}
