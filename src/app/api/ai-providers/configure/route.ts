import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai-providers/configure
 *
 * Writes a key to the .env file. This is a development convenience so
 * the user can configure providers from the UI without editing files.
 *
 * In production, you'd use a secret manager or env injection.
 *
 * Body: { envVar: "REPLICATE_API_TOKEN", value: "r8_..." }
 *
 * Security note: only specific env var names are allowed (no path injection).
 */
const ALLOWED_ENV_VARS = new Set([
  "REPLICATE_API_TOKEN",
  "OPENAI_API_KEY",
  "FAL_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "NVIDIA_API_KEY",
  "NVIDIA_MODEL",
  "ZAI_API_KEY",
  "AI_PROVIDER",
]);

const ENV_PATH = path.resolve(process.cwd(), ".env");

export async function POST(req: NextRequest) {
  let body: { envVar?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const envVar = body.envVar?.trim();
  const value = body.value?.trim() ?? "";

  if (!envVar || !ALLOWED_ENV_VARS.has(envVar)) {
    return NextResponse.json(
      {
        error: "Invalid env var name",
        allowed: Array.from(ALLOWED_ENV_VARS),
      },
      { status: 400 }
    );
  }

  try {
    // Read existing .env (if any)
    let envContent = "";
    try {
      envContent = await fs.readFile(ENV_PATH, "utf8");
    } catch {
      envContent = `DATABASE_URL=file:${path.resolve(process.cwd(), "db/custom.db")}\n`;
    }

    // Build the new line
    const newLine = value ? `${envVar}=${value}` : `# ${envVar}=`;

    // Replace or append
    const lines = envContent.split("\n");
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (
        trimmed.startsWith(`${envVar}=`) ||
        trimmed.startsWith(`# ${envVar}=`)
      ) {
        lines[i] = newLine;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.push(newLine);
    }

    await fs.writeFile(ENV_PATH, lines.join("\n"));

    // Also set it in process.env for the current session
    if (typeof process !== "undefined") {
      process.env[envVar] = value || "";
    }

    return NextResponse.json({
      ok: true,
      envVar,
      cleared: !value,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to update .env", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
