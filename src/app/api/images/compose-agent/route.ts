import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { createTask, updateTask } from "@/lib/task-store";
import { resolveFilePath, dataRootSync } from "@/lib/security/resolve-file-path";
import {
  callImageEdit,
  describePeople,
  planScene,
  searchPortraits,
  composeScene,
  lockIdentities,
  loadPersonDataUrl,
  saveResult,
  type PersonImage,
} from "@/lib/composer-engine";

const DATA_ROOT = dataRootSync();
const R = path.join(DATA_ROOT, "results");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/images/compose-agent — وكيل «إضافة محتوى إلى الصورة» (v2 متعدد)
 *
 * يجمع عدة أشخاص من عدة صور مصدر + عدة صور مرجع (أو شخصيات تُذكر بالاسم
 * فيبحث عنها الوكيل) في صورة واحدة لأي مشهد/وضعية يطلبها المستخدم
 * مع المحافظة الإلزامية على ملامح الوجه الحقيقية لكل شخص.
 *
 * الجسم:
 *   sourcePaths?: string[]      — صور المصدر (أشخاصك) — يمكن دمج أكثر من شخص
 *   referencePaths?: string[]   — صور المرجع (أشخاص آخرين)
 *   sourcePath?/referencePath?  — التوافق مع الإصدار الأول (صورة واحدة)
 *   resultPath?: string         — وضع التعديل التتابعي على آخر نتيجة
 *   instruction: string         — الطلب باللغة الطبيعية
 *   poses?: string[]            — وضعيات مختارة (تبادل الأحضان، القبلات...)
 *   size?: string               — مقاس الصورة (اختياري — الوكيل يختار إن تُرك)
 *   lockFaces?: boolean         — قفل الملامح عبر 3030 (افتراضي true في الدمج)
 *
 * المراحل: فهم ← تركيز وتحليل (VLM + LLM + بحث) ← تطبيق (توليد) ← قفل الملامح
 * الرد: { taskId } ثم poll /api/task/status?id=
 */

const MAX_PER_SIDE = 4;

function normPaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).slice(0, MAX_PER_SIDE);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const instruction: string = (body.instruction ?? "").toString().trim();
  if (!instruction) return NextResponse.json({ error: "Missing instruction" }, { status: 400 });
  if (instruction.length > 2000) return NextResponse.json({ error: "Instruction too long" }, { status: 400 });

  const sourcePaths = normPaths(body.sourcePaths);
  const referencePaths = normPaths(body.referencePaths);
  const legacySource = typeof body.sourcePath === "string" && body.sourcePath ? [body.sourcePath] : [];
  const legacyRef = typeof body.referencePath === "string" && body.referencePath ? [body.referencePath] : [];
  const sources = sourcePaths.length ? sourcePaths : legacySource;
  const refs = referencePaths.length ? referencePaths : legacyRef;

  const hasResult = !!body.resultPath;
  if (!hasResult && !sources.length && !refs.length) {
    return NextResponse.json({ error: "أضف صورة مصدر أو مرجع واحد على الأقل — أو اسم شخصية يبحث عنها الوكيل مع وجود صورة مصدر" }, { status: 400 });
  }

  // التحقق من وجود الملفات
  const resolved: string[] = [];
  try {
    for (const p of [...sources, ...refs, ...(hasResult ? [body.resultPath] : [])]) {
      resolved.push(await resolveFilePath(p));
    }
  } catch {
    return NextResponse.json({ error: "Image file not found" }, { status: 404 });
  }
  const srcResolved = resolved.slice(0, sources.length);
  const refResolved = resolved.slice(sources.length, sources.length + refs.length);
  const resultResolved = hasResult ? resolved[resolved.length - 1] : null;

  const poses: string[] = Array.isArray(body.poses)
    ? body.poses.filter((p: unknown) => typeof p === "string" && p.trim()).slice(0, 4)
    : [];
  const userSize: string | null = typeof body.size === "string" && body.size ? body.size : null;
  const lockFaces: boolean = body.lockFaces !== false;

  await fs.mkdir(R, { recursive: true });
  const taskId = createTask("Compose Agent v2");

  (async () => {
    try {
      // ---------- 1) فهم ----------
      updateTask(taskId, { status: "processing", progress: 5, phase: "understand" });
      const mode = resultResolved ? "edit" : "compose";

      // ---------- 2) تركيز وتحليل ----------
      updateTask(taskId, { progress: 15, phase: "analyze", meta: { mode, people: srcResolved.length + refResolved.length, poses } });

      // تجهيز صور الأشخاص + وصفهم عبر VLM (لتحسين دقة المشهد)
      const people: PersonImage[] = [];
      for (const p of srcResolved) people.push({ path: p, role: "source" });
      for (const p of refResolved) people.push({ path: p, role: "reference" });

      if (mode === "compose") {
        updateTask(taskId, { progress: 22, meta: { mode, stage2: "vision" } });
        const dataUrls = await Promise.all(
          people.map(async (p) => {
            try {
              return await loadPersonDataUrl(p.path);
            } catch {
              return "";
            }
          })
        );
        const descs = await describePeople(dataUrls.filter(Boolean));
        let di = 0;
        for (let i = 0; i < people.length; i++) {
          if (dataUrls[i]) {
            (people[i] as any).dataUrl = dataUrls[i];
            people[i].desc = descs[di] || undefined;
            di++;
          }
        }
      }

      // تخطيط المشهد
      const plan = await planScene({
        instruction,
        people: people.map((p) => ({ role: p.role, name: p.name, desc: p.desc })),
        poses,
        userSize: userSize ?? undefined,
        mode: mode as "compose" | "edit",
      });

      // بحث عن شخصيات مذكورة بالاسم (مشاهير) غير مرفوعة
      let searched: PersonImage[] = [];
      if (mode === "compose" && plan.searches.length) {
        updateTask(taskId, { progress: 28, phase: "analyze", meta: { mode, searching: plan.searches.map((s) => s.name) } });
        searched = await searchPortraits(plan.searches);
        for (const s of searched) {
          people.push(s);
          if (!s.desc && s.name) s.desc = `real photo of ${s.name}`;
        }
      }

      // ---------- 3) تطبيق ----------
      let sceneBuffer: Buffer;
      let method = "";

      if (mode === "edit") {
        updateTask(taskId, { progress: 40, phase: "apply", meta: { mode, size: plan.size } });
        const zaiMod = await import("z-ai-web-dev-sdk");
        const zai = await zaiMod.default.create();
        const buf = await sharp(resultResolved!)
          .rotate()
          .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();
        const url = `data:image/jpeg;base64,${buf.toString("base64")}`;
        const er = await callImageEdit(
          zai,
          [{ url }],
          `${plan.prompt}\n- Edit this existing photo; keep every face exactly identical, seamless natural result.`,
          plan.size
        );
        const b64 = er?.data?.[0]?.base64;
        if (!b64) throw new Error("تعذر تعديل الصورة — جرّب صياغة أبسط");
        sceneBuffer = Buffer.from(b64, "base64");
        method = "result-edit";
      } else {
        const dataUrls = people.map((p) => p.dataUrl).filter(Boolean) as string[];
        if (!dataUrls.length) throw new Error("لا توجد صور صالحة للأشخاص — ارفع صورة واحدة على الأقل");
        updateTask(taskId, { progress: 38, phase: "apply", meta: { mode, size: plan.size, images: dataUrls.length, method0: plan.provider } });
        const out = await composeScene({
          dataUrls,
          prompt: plan.prompt,
          size: plan.size,
          onRetry: (attempt) => updateTask(taskId, { progress: Math.min(60, 42 + attempt * 5), meta: { mode, retry429: attempt } }),
        });
        sceneBuffer = out.buffer;
        method = out.method;
      }

      // ---------- 4) قفل الملامح (حفظ إلزامي للوجوه الحقيقية) ----------
      let lockNote = "";
      let locked = 0;
      if (mode === "compose" && lockFaces) {
        updateTask(taskId, { progress: 70, phase: "apply", meta: { mode, locking: true } });
        const persons = people
          .filter((p) => (p as any).dataUrl)
          .map((p) => ({ dataUrl: (p as any).dataUrl as string, name: p.name }));
        const lock = await lockIdentities({
          sceneBuffer,
          persons,
          onProgress: (l, t) => updateTask(taskId, { progress: 70 + Math.round((l / Math.max(t, 1)) * 15), meta: { mode, locked: l, lockTotal: t } }),
        });
        sceneBuffer = lock.buffer;
        lockNote = lock.note;
        locked = lock.locked;
        method += locked > 0 ? "+identity-lock" : "";
      }

      // ---------- إنهاء ----------
      updateTask(taskId, { progress: 92, phase: "finalizing", meta: { mode } });
      const meta = await sharp(sceneBuffer).metadata();
      if (!meta.width || !meta.height) throw new Error("ناتج غير صالح");
      const name = await saveResult(sceneBuffer, "compose");
      const op = path.join(R, name);

      updateTask(taskId, {
        status: "done",
        progress: 100,
        phase: "done",
        result: {
          url: `/results/${name}`,
          path: op,
          width: meta.width,
          height: meta.height,
          size: sceneBuffer.length,
          method,
          prompt: plan.prompt,
          size: plan.size,
          people: people.length,
          searched: searched.map((s) => s.name).filter(Boolean),
          locked,
          lockNote,
          understanding: plan.understanding,
        },
      });
    } catch (e) {
      await logEvent({ category: "tryon", level: "error", message: "compose-agent v2 failed", details: e instanceof Error ? e.message : String(e) });
      updateTask(taskId, { status: "error", error: e instanceof Error ? e.message : "Unknown error" });
    }
  })();

  return NextResponse.json({ taskId, status: "pending", message: `Poll /api/task/status?id=${taskId}` });
}
