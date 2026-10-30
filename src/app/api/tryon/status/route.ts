import { NextRequest, NextResponse } from "next/server";
import { generationProgress, generationResults } from "../generate/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tryon/status?id=<taskId>
 *
 * Returns the current task state as JSON. The client polls this
 * endpoint every 500ms until `done: true`.
 *
 * Response shape:
 *   {
 *     done: boolean,
 *     steps: [{ stage, percent, labelKey, detail, ts }],
 *     result?: GenerationResult  // present when done === true
 *   }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("id");
  if (!taskId) {
    return NextResponse.json(
      { error: "Missing id" },
      { status: 400 }
    );
  }

  const steps = generationProgress.get(taskId) ?? [];
  const result = generationResults.get(taskId);

  if (result) {
    // Clean up
    generationProgress.delete(taskId);
    generationResults.delete(taskId);
  }

  return NextResponse.json({
    done: !!result,
    steps,
    result: result ?? null,
  });
}
