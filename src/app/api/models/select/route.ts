import { NextRequest, NextResponse } from "next/server";
import { getAdapter } from "@/lib/ai/model-manager";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

interface SelectBody {
  modelId: string;
  action: "activate" | "deactivate" | "install" | "remove";
}

/**
 * POST /api/models/select
 * Body: { modelId, action }
 *
 * activate: mark as the current try-on model.
 * install:  trigger model install (downloads from HF in production).
 * remove:   uninstall the model files.
 * deactivate: clear the active flag.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as SelectBody;
  if (!body.modelId || !body.action) {
    return NextResponse.json(
      { error: "Missing modelId or action" },
      { status: 400 }
    );
  }

  const adapter = getAdapter(body.modelId);
  if (!adapter) {
    return NextResponse.json(
      { error: `Unknown model ${body.modelId}` },
      { status: 404 }
    );
  }

  const info = await adapter.getInfo();

  // Upsert the model record
  const rec = await db.aIModel.upsert({
    where: { name: info.id },
    update: {},
    create: {
      name: info.id,
      displayName: info.displayName,
      version: info.version,
      sizeGB: info.sizeGB,
      vramRequiredGB: info.vramRequiredGB,
      ramRequiredGB: info.ramRequiredGB,
      category: info.category,
      huggingfaceRepo: info.huggingfaceRepo,
      license: info.license,
      status: "not_installed",
    },
  });

  switch (body.action) {
    case "install": {
      await db.aIModel.update({
        where: { id: rec.id },
        data: { status: "installing" },
      });
      const ok = await adapter.install((p) => {
        // Could push this through SSE too — for now just log
        console.log(`[install ${info.id}] ${p.percent}% ${p.message}`);
      });
      await db.aIModel.update({
        where: { id: rec.id },
        data: {
          status: ok ? "installed" : "error",
          installedAt: ok ? new Date() : null,
        },
      });
      await logEvent({
        category: "model",
        level: ok ? "info" : "error",
        message: `Install ${info.id}: ${ok ? "ok" : "failed"}`,
      });
      return NextResponse.json({ ok, modelId: info.id, status: ok ? "installed" : "error" });
    }
    case "activate": {
      // Deactivate others first
      await db.aIModel.updateMany({
        where: { category: "virtual_tryon" },
        data: { isActive: false },
      });
      await db.aIModel.update({
        where: { id: rec.id },
        data: { isActive: true, status: rec.status === "not_installed" ? "installed" : rec.status, installedAt: rec.installedAt ?? new Date() },
      });
      await logEvent({
        category: "model",
        message: `Activated ${info.id}`,
      });
      return NextResponse.json({ ok: true, modelId: info.id, active: true });
    }
    case "deactivate": {
      await db.aIModel.update({
        where: { id: rec.id },
        data: { isActive: false },
      });
      return NextResponse.json({ ok: true, modelId: info.id, active: false });
    }
    case "remove": {
      await adapter.unload();
      await db.aIModel.update({
        where: { id: rec.id },
        data: {
          status: "not_installed",
          installedAt: null,
          isActive: false,
          installedPath: null,
        },
      });
      await logEvent({
        category: "model",
        message: `Removed ${info.id}`,
      });
      return NextResponse.json({ ok: true, modelId: info.id, status: "not_installed" });
    }
    default:
      return NextResponse.json({ error: `Unknown action ${body.action}` }, { status: 400 });
  }
}
