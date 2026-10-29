import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken } from "@/lib/auth";
import {
  callLLM, setApiKey, setCloudflareAccountId,
  getMaskedApiKey, getMaskedCloudflareAccountId,
  getConfiguredProviders, DEFAULT_MODELS,
  getAllProviderStats, resetProviderCooldown, resetAllCooldowns,
  getProviderInfo,
  type LLMProvider,
} from "@/lib/ai/free-llm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_PROVIDERS = [
  "groq", "google", "openrouter",
  "cerebras", "mistral", "cohere", "github", "cloudflare",
  "zai",
] as const;

async function requireAdmin(req: NextRequest) {
  const token = getSessionToken(req);
  if (!token) return { error: "غير مسجل", status: 401 };
  const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
  if (!session) return { error: "جلسة منتهية", status: 401 };
  const admin = await db.user.findUnique({ where: { id: session.value } });
  if (!admin || (admin.role !== "admin" && !admin.isOwner))
    return { error: "صلاحيات غير كافية", status: 403 };
  return { admin };
}

/** GET — list providers + masked API keys + performance stats */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const stats = getAllProviderStats();
  const result: any[] = [];
  for (const p of ALL_PROVIDERS) {
    const info = getProviderInfo(p);
    const maskedKey = await getMaskedApiKey(p);
    const maskedCloudflareAccountId = p === "cloudflare" ? await getMaskedCloudflareAccountId() : "";
    result.push({
      provider: p,
      maskedKey,
      configured: p === "zai" ? true : !!maskedKey,
      isOldKey: p === "zai",
      defaultModel: info.defaultModel,
      docsUrl: info.docsUrl,
      envVar: info.envVar,
      freeTierInfo: info.freeTierInfo,
      maskedCloudflareAccountId,
      stats: stats[p],
    });
  }
  return NextResponse.json({
    providers: result,
    configuredProviders: await getConfiguredProviders(),
    cooldownThreshold: 3,
    cooldownMinutes: 5,
  });
}

/** POST — set API key, set Cloudflare account_id, test provider, or reset cooldown */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  const { action, provider, apiKey, accountId, testPrompt } = body;

  if (action === "set_key") {
    if (!provider || !apiKey) return NextResponse.json({ error: "provider و apiKey مطلوبان" }, { status: 400 });
    if (!(ALL_PROVIDERS as readonly string[]).includes(provider)) {
      return NextResponse.json({ error: "مزود غير معروف" }, { status: 400 });
    }
    await setApiKey(provider as LLMProvider, apiKey);
    return NextResponse.json({ ok: true, message: `تم حفظ مفتاح ${provider}` });
  }

  if (action === "set_cloudflare_account") {
    if (!accountId) return NextResponse.json({ error: "accountId مطلوب" }, { status: 400 });
    await setCloudflareAccountId(accountId);
    return NextResponse.json({ ok: true, message: "تم حفظ معرف حساب Cloudflare" });
  }

  if (action === "test") {
    if (!(ALL_PROVIDERS as readonly string[]).includes(provider)) {
      return NextResponse.json({ error: "مزود غير معروف" }, { status: 400 });
    }
    try {
      const response = await callLLM(
        [
          { role: "system", content: "You are a test assistant. Reply briefly." },
          { role: "user", content: testPrompt || "Say 'Hello' in Arabic." },
        ],
        { preferProvider: provider as LLMProvider }
      );
      return NextResponse.json({
        ok: true,
        provider: response.provider,
        model: response.model,
        response: response.text,
        responseTimeMs: response.responseTimeMs,
        usage: response.usage,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
    }
  }

  if (action === "reset_cooldown") {
    if (provider === "all") {
      resetAllCooldowns();
      return NextResponse.json({ ok: true, message: "تم إعادة تفعيل كل المزودين" });
    }
    if (!provider) return NextResponse.json({ error: "provider مطلوب" }, { status: 400 });
    if (!(ALL_PROVIDERS as readonly string[]).includes(provider)) {
      return NextResponse.json({ error: "مزود غير معروف" }, { status: 400 });
    }
    resetProviderCooldown(provider as LLMProvider);
    return NextResponse.json({ ok: true, message: `تم إعادة تفعيل ${provider}` });
  }

  return NextResponse.json(
    { error: "إجراء غير معروف (set_key | set_cloudflare_account | test | reset_cooldown)" },
    { status: 400 },
  );
}
