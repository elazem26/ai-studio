import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { resolveFilePath, resolveDataRoot } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// Age-range presets with GENDER-SPECIFIC prompts.
//
// Each age has separate `male` and `female` prompts. The API:
//   1. First detects the person's gender using the vision chat API
//   2. Then uses the matching gender's prompt for the age transformation
//
// This ensures that a male is always transformed through male
// age stages (boy → young man → middle-aged man → elderly man),
// and a female through female age stages — never mixing genders.
// ============================================================
const AGE_PRESETS: Record<string, {
  labelAr: string;
  labelEn: string;
  range: string;
  male: string;
  female: string;
}> = {
  "child": {
    labelAr: "طفل",
    labelEn: "Child",
    range: "4-10",
    male: "Transform this person into a young BOY child aged 4 to 10 years old. He MUST remain MALE — keep him a boy, never a girl. Keep the same facial identity, hairstyle (suitable for a young boy), and clothing. Soften facial features, reduce wrinkles, enlarge eyes proportionally, smooth skin, make the face rounder and more childlike. Maintain the male gender and the same ethnicity.",
    female: "Transform this person into a young GIRL child aged 4 to 10 years old. She MUST remain FEMALE — keep her a girl, never a boy. Keep the same facial identity, hairstyle (suitable for a young girl), and clothing. Soften facial features, reduce wrinkles, enlarge eyes proportionally, smooth skin, make the face rounder and more childlike. Maintain the female gender and the same ethnicity.",
  },
  "teenager": {
    labelAr: "يافع",
    labelEn: "Teenager",
    range: "12-18",
    male: "Transform this person into a teenage BOY aged 12 to 18 years old. He MUST remain MALE — keep him a boy, never a girl. Keep the same facial identity, hairstyle (typical teenage boy haircut), and clothing. Remove any wrinkles or aged skin features. Make skin smooth and youthful. Maintain the male gender and the same ethnicity. Reduce facial hair if present (light teenage stubble OK).",
    female: "Transform this person into a teenage GIRL aged 12 to 18 years old. She MUST remain FEMALE — keep her a girl, never a boy. Keep the same facial identity, hairstyle (typical teenage girl hairstyle), and clothing. Remove any wrinkles or aged skin features. Make skin smooth and youthful. Maintain the female gender and the same ethnicity. Remove any facial hair completely.",
  },
  "young-adult": {
    labelAr: "شاب",
    labelEn: "Young Adult",
    range: "20-40",
    male: "Transform this person into a YOUNG MAN aged 20 to 40 years old. He MUST remain MALE — keep him a man, never a woman. Keep the same facial identity, hairstyle (typical young man haircut), and clothing. Make skin look healthy and youthful. Remove any severe wrinkles or age spots. Keep facial hair (beard/stubble) if present, in a youthful style. Maintain the male gender and the same ethnicity.",
    female: "Transform this person into a YOUNG WOMAN aged 20 to 40 years old. She MUST remain FEMALE — keep her a woman, never a man. Keep the same facial identity, hairstyle (typical young woman hairstyle), and clothing. Make skin look healthy, youthful, and radiant. Remove any severe wrinkles or age spots. Apply subtle feminine makeup. Maintain the female gender and the same ethnicity.",
  },
  "middle-aged": {
    labelAr: "شيخ",
    labelEn: "Middle-aged",
    range: "45-60",
    male: "Transform this person into a MIDDLE-AGED MAN aged 45 to 60 years old. He MUST remain MALE — keep him a man, never a woman. Keep the same facial identity, hairstyle, and clothing. Add some fine wrinkles around the eyes and mouth. Slightly thin the cheeks. Add subtle gray hair if not present. Keep facial hair (matured gray beard OK). Maintain the male gender and the same ethnicity.",
    female: "Transform this person into a MIDDLE-AGED WOMAN aged 45 to 60 years old. She MUST remain FEMALE — keep her a woman, never a man. Keep the same facial identity, hairstyle, and clothing. Add some fine wrinkles around the eyes and mouth. Add subtle gray hair if not present. Apply subtle elegant makeup suitable for a middle-aged woman. Maintain the female gender and the same ethnicity.",
  },
  "elderly": {
    labelAr: "شايب",
    labelEn: "Elderly",
    range: "65-100",
    male: "Transform this person into an ELDERLY MAN aged 65 to 100 years old. He MUST remain MALE — keep him an old man, never an old woman. Keep the same facial identity, hairstyle, and clothing. Add deep wrinkles on forehead, around eyes, and mouth. Make skin saggy and thin. Add age spots. Make hair mostly or fully gray/white (keep beard if present, also gray/white). Maintain the male gender and the same ethnicity.",
    female: "Transform this person into an ELDERLY WOMAN aged 65 to 100 years old. She MUST remain FEMALE — keep her an old woman, never an old man. Keep the same facial identity, hairstyle, and clothing. Add deep wrinkles on forehead, around eyes, and mouth. Make skin saggy and thin. Add age spots. Make hair mostly or fully gray/white (typically shorter or pinned up). Maintain the female gender and the same ethnicity.",
  },
  "ancient": {
    labelAr: "كهل",
    labelEn: "Ancient",
    range: "110-150",
    male: "Transform this person into a VERY ANCIENT MAN aged 110 to 150 years old. He MUST remain MALE — keep him an ancient old man, never a woman. Keep the same facial identity, hairstyle, and clothing. Add extreme deep wrinkles, very saggy and thin skin, prominent age spots, fully white hair, sunken cheeks and eyes. Hyper-realistic extreme old age appearance of an ancient man. Maintain the male gender and the same ethnicity.",
    female: "Transform this person into a VERY ANCIENT WOMAN aged 110 to 150 years old. She MUST remain FEMALE — keep her an ancient old woman, never a man. Keep the same facial identity, hairstyle, and clothing. Add extreme deep wrinkles, very saggy and thin skin, prominent age spots, fully white hair, sunken cheeks and eyes. Hyper-realistic extreme old age appearance of an ancient woman. Maintain the female gender and the same ethnicity.",
  },
};

type DetectedGender = "male" | "female";

/**
 * Detect the gender of the person in the image using the z-ai vision
 * chat API. Returns "male" or "female". Falls back to "male" if the
 * API call fails or the response is ambiguous.
 *
 * NOTE: this is a single short vision call with a strict JSON output
 * requirement, so it's fast (~2-4 seconds) and cheap.
 */
async function detectGender(zai: any, dataUrl: string): Promise<DetectedGender> {
  try {
    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Look at the person in this image. Determine their gender based ONLY on visible visual cues (face shape, hairstyle, facial hair, clothing style).

Respond with ONE word only:
- "male" if the person is a man or a boy
- "female" if the person is a woman or a girl

Do not output anything else. No explanation, no punctuation, just the single word.`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });

    const text = String(response?.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
    // Extract the first word, strip any punctuation
    const firstWord = text.split(/\s+/)[0].replace(/[^a-z]/g, "");

    if (firstWord === "female" || firstWord === "woman" || firstWord === "girl" || firstWord === "female.") {
      return "female";
    }
    // Default to male (also covers "male", "man", "boy", and any ambiguous response)
    return "male";
  } catch (e) {
    console.warn("[/api/images/age-transform] gender detection failed, defaulting to male:", e);
    return "male";
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const img = body.image || body.sourcePath;
  const ageKey = body.age || body.style;
  // Optional override — if the client knows the gender in advance,
  // it can skip the detection step by sending { gender: "male"|"female" }.
  const genderOverride = body.gender === "male" || body.gender === "female" ? body.gender : null;

  if (!img) {
    return NextResponse.json({ ok: false, error: "Missing image" }, { status: 400 });
  }
  if (!AGE_PRESETS[ageKey]) {
    return NextResponse.json(
      { ok: false, error: `Unknown age preset: ${ageKey}. Available: ${Object.keys(AGE_PRESETS).join(", ")}` },
      { status: 400 }
    );
  }

  let p: string;
  try {
    p = await resolveFilePath(img);
  } catch {
    return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
  }

  const R = path.resolve(await resolveDataRoot(), "results");
  await fs.mkdir(R, { recursive: true });

  const preset = AGE_PRESETS[ageKey];

  try {
    const ZAI = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.default.create();

    const sb = await fs.readFile(p);
    const m = await sharp(sb).metadata();
    const w = m.width ?? 768;
    const h = m.height ?? 1024;
    const mime = path.extname(p).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${sb.toString("base64")}`;

    // ============================================================
    // Step 1: detect the person's gender (unless the client
    // already provided it). This determines which prompt variant
    // we use so we never mix genders across age transformations.
    // ============================================================
    const gender: DetectedGender = (genderOverride as DetectedGender) ?? (await detectGender(zai, dataUrl));
    const prompt = preset[gender];

    // ============================================================
    // Step 2: run the age transformation using the gender-specific prompt.
    // ============================================================
    const res = await (zai.images.generations.edit as any)({
      prompt,
      images: [{ url: dataUrl }],
      size: "1024x1024",
    });

    const b64 = res?.data?.[0]?.base64;
    if (!b64) {
      throw new Error("Image edit API returned no image data");
    }

    let buf = Buffer.from(b64, "base64");
    const rm = await sharp(buf).metadata();
    if (rm.width !== w || rm.height !== h) {
      buf = await sharp(buf)
        .resize(w, h, { fit: "fill" })
        .png()
        .toBuffer();
    }

    const finalMeta = await sharp(buf).metadata();
    const out = `age-${ageKey}-${gender}-${Date.now()}.png`;
    const outPath = path.join(R, out);
    await fs.writeFile(outPath, buf);

    return NextResponse.json({
      ok: true,
      url: `/results/${out}`,
      path: outPath,
      age: ageKey,
      ageLabelAr: preset.labelAr,
      ageLabelEn: preset.labelEn,
      ageRange: preset.range,
      gender,
      width: finalMeta.width ?? w,
      height: finalMeta.height ?? h,
      size: buf.length,
      method: "z-ai-image-edit-age-gender-aware",
    });
  } catch (e: any) {
    console.error("[/api/images/age-transform] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    ages: Object.entries(AGE_PRESETS).map(([key, p]) => ({
      key,
      labelAr: p.labelAr,
      labelEn: p.labelEn,
      range: p.range,
    })),
  });
}
