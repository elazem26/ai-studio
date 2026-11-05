import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import sharp from "sharp";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

/**
 * POST /api/images/part-transplant/select — وكيل الدردشة: تحديد المكان بالنص.
 *
 * 1) يحاول المحلل العربي الحتمي في خدمة بايثون (/regions/select).
 * 2) إذا لم يفهم النص → نموذج LLM يحوّل الجملة الحرة إلى مواصفات JSON.
 * 3) يعيد: overlay (معاينة ملونة على الصورة) + mask (القناع المعتمد)
 *    + spec (يُعاد إرساله عند التنفيذ) — فيرى المستخدم التحديد قبل النقل
 *    ويعدّل كتابته حتى يصبح صحيحاً.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINI_SERVICE_URL = process.env.FACE_SWAP_SERVICE_URL || "http://localhost:3030";

async function pySelect(payload: Record<string, unknown>) {
  const r = await fetch(`${MINI_SERVICE_URL}/regions/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

const SPEC_SYSTEM_PROMPT = `أنت محلل أوامر عربية لتحديد مناطق في صورة لنقلها بين الصور. أعد كائن JSON فقط بدون أي شرح أو نص إضافي.
الشكل المسموح:
{"part": "...", "side": "...", "faceIndex": 0, "bbox": [x1,y1,x2,y2], "expand": 0.1, "exclude": {...نفس الشكل...}, "placeBox": [x,y,w,h]}
القيم المسموحة لـ part:
"head"=الرأس كامل، "face"=الوجه فقط، "hair"=الشعر، "eyes"=العينان، "nose"=الأنف، "mouth"=الفم،
"chest"=الصدر/الكتفان، "torso"=الجذع/البطن/الملابس، "arms"=الذراعان/اليدان، "legs"=الرجلان/الساقان،
"person"=الشخص/الجسم كامل، "object"=حيوان/كائن/رسمة/منتج/شعار، "background"=الخلفية، "bbox"=منطقة بإحداثيات.
side: "left" أو "right" (من وجهة نظر المشاهد) أو "top" أو "bottom" — فقط إذا ذكر المستخدم جهة.
faceIndex: ترتيب الوجه (0=الأول) عند ذكر "الأول/الثاني" أو "الشخص اليمين/الشمال".
bbox: قيم من 0 إلى 1 عند طلب منطقة عامة: "النصف العلوي"=[0,0,1,0.5]، "النصف السفلي"=[0,0.5,1,1]، "النصف الأيمن"=[0.5,0,1,1]، "النصف الأيسر"=[0,0,0.5,1].
expand: رقم موجب لتكبير التحديد أو سالب لتصغيره عند "وسّع/كبّر التحديد" أو "ضيّق/صغّر التحديد".
exclude: جزء يُستثنى من التحديد: "الرأس بدون الوجه"={"part":"head","exclude":{"part":"face"}}.
placeBox: فقط إذا طلب وضع الجزء في مكان محدد على الصورة الأخرى: "في المنتصف"=[0.25,0.25,0.5,0.5]، "أسفل يمين"=[0.5,0.5,0.5,0.5].
أمثلة:
"خذ الشعر بس" → {"part":"hair"}
"الجهة اليسرى من الخلفية" → {"part":"background","side":"left"}
"الشخص الثاني" → {"part":"person","faceIndex":1}
"عيون المرجع" → {"part":"eyes"}
"انقل القط" → {"part":"object"}
"النصف العلوي" → {"part":"bbox","bbox":[0,0,1,0.5]}
أجب بـ JSON فقط.`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  const side = body.side === "source" ? "source" : "ref";
  const rawPath = side === "source" ? body.sourcePath : body.refPath;
  if (!rawPath) {
    return NextResponse.json({ ok: false, error: "ارفع الصورة أولاً ثم اكتب المكان" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "اكتب المكان المطلوب — مثال: «الرأس» أو «الخلفية»" }, { status: 400 });
  }

  let p: string;
  try {
    p = await resolveFilePath(rawPath);
  } catch {
    return NextResponse.json({ ok: false, error: "الصورة غير موجودة" }, { status: 404 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(p);
  } catch {
    return NextResponse.json({ ok: false, error: "تعذر قراءة الصورة" }, { status: 404 });
  }
  const png = await sharp(buf).png().toBuffer();
  const image = `data:image/png;base64,${png.toString("base64")}`;

  // ---- المحاولة 1: المحلل العربي الحتمي (سريع ومجاني) ----
  // prevSpec: تحديد قائم يعدّله المستخدم («كبّر التحديد»، «بدون الوجه»…)
  const prevSpec = body.prevSpec && typeof body.prevSpec === "object" ? body.prevSpec : undefined;
  let res = await pySelect({ image, text, ...(prevSpec ? { prevSpec } : {}) });
  if (res.data?.ok) {
    // المربعات المرقمة: المستخدم نقر شخصاً محدداً → إعادة التحديد على ذلك الشخص
    // (فقط لأجزاء الجسم المرتبطة بوجه، وإذا لم يحدد المحلل شخصاً بنفسه)
    const fi = Number(body.faceIndex);
    const sp: any = res.data.spec && typeof res.data.spec === "object" ? res.data.spec : {};
    const FACE_PARTS = new Set(["head", "face", "hair", "eyes", "nose", "mouth", "chest", "torso", "arms", "legs", "person"]);
    if (Number.isInteger(fi) && fi >= 0 && FACE_PARTS.has(String(sp.part)) && sp.faceIndex == null) {
      const res2 = await pySelect({ image, spec: { ...sp, faceIndex: fi } });
      if (res2.data?.ok) return NextResponse.json({ ...res2.data, personPicked: fi + 1 });
    }
    return NextResponse.json(res.data);
  }

  // ---- المحاولة 2: LLM للصياغة الحرة (بميزانية زمنية 9 ثوانٍ) ----
  // سبب الجذر (2026-11-06): استدعاء LLM الحر كان بلا مهلة — 35 ثانية وأكثر
  // → وكيل المعاينة space-z.ai يقطع الاستجابة عند ~20 ثانية → HTML 502 →
  // الواجهة تفشل في JSON.parse → تُظهر «لم افهم المكان.» فارغة. الآن: إن
  // تجاوز LLM الميزانية نُعيد رسالة المحلل الحتمي فوراً ونُتابع عمل LLM في
  // الخلفية (يُتجاهل).
  const LLM_BUDGET_MS = 9_000;
  const llmTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LLM_BUDGET_MS));
  const llmWork = (async () => {
    const Z = await import("z-ai-web-dev-sdk");
    const zai = await Z.default.create();
    const facesInfo = JSON.stringify(res.data?.faces || []);
    const cr = await zai.chat.completions.create({
      messages: [
        { role: "system", content: SPEC_SYSTEM_PROMPT },
        {
          role: "user",
          content: `الطلب: ${text}\nأبعاد الصورة: ${res.data?.width || "?"}×${res.data?.height || "?"}\nالوجوه المكتشفة (bbox موحدة 0..1، مرتبة من الأكبر): ${facesInfo}`,
        },
      ],
    });
    const raw = cr?.choices?.[0]?.message?.content?.toString?.() || "";
    const js = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    if (js) {
      const spec = JSON.parse(js);
      if (spec && spec.part) {
        const res2 = await pySelect({ image, spec });
        if (res2.data?.ok) {
          return NextResponse.json({ ...res2.data, viaLLM: true });
        }
      }
    }
    return null;
  })();

  const won = await Promise.race([llmWork, llmTimeout]);
  if (won) return won;
  llmWork.catch(() => {});

  return NextResponse.json({
    ok: false,
    unparsed: true,
    error: res.data?.error || "لم أفهم المكان المطلوب — أعد الصياغة أو جرّب أحد الاقتراحات",
    hint: res.data?.hint || [],
    faces: res.data?.faces || [],
  });
}
