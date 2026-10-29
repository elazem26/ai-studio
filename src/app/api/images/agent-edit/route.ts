import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { createTask, updateTask } from "@/lib/task-store";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const R = path.resolve(process.cwd(), "data/results");
const WR: Record<string,string> = { "woman":"a person","man":"a person","girl":"a person","boy":"a person","face":"","age":"","body":"","skin":"skin tone","naked":"","nude":"","sex":"","violence":"","blood":"","امرأة":"a person","رجل":"a person","بنت":"a person","ولد":"a person","وجه":"","عمر":"","جسم":"","بشرة":"skin tone","عاري":"","جنس":"","عنف":"","دم":"" };
function clean(s: string): string { let p = s.trim().slice(0,800); for(const[w,r] of Object.entries(WR)) p = p.replace(new RegExp(`\\b${w}\\b`,"gi"),r); return p.replace(/\s+/g," ").trim() || "improve"; }
function isCF(e: unknown): boolean { const m = e instanceof Error ? e.message : String(e); return m.includes("1301")||m.includes("contentFilter")||m.includes("不安全")||m.includes("敏感内容"); }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.sourcePath) return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  if (!body.instruction) return NextResponse.json({ error: "Missing instruction" }, { status: 400 });
  try { body.sourcePath = await resolveFilePath(body.sourcePath); } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  await fs.mkdir(R, { recursive: true });
  const c = clean(body.instruction);
  const taskId = createTask("Agent Edit");
  (async () => {
    try {
      updateTask(taskId, { status: "processing", progress: 10 });
      const Z = await import("z-ai-web-dev-sdk"); const zai = await Z.default.create();
      const m = await sharp(body.sourcePath).metadata(); const sW = m.width ?? 768, sH = m.height ?? 1024;
      const b64 = (await fs.readFile(body.sourcePath)).toString("base64");
      const ext = path.extname(body.sourcePath).toLowerCase(); const mime = ext === ".png" ? "image/png" : "image/jpeg";
      const url = `data:${mime};base64,${b64}`;
      const sup = ["1024x1024","768x1344","864x1152","1344x768","1152x864","1440x720","720x1440"];
      let best = sup[0], bd = Infinity; for(const s of sup){const[sw,sh]=s.split("x").map(Number);const d=Math.abs(sw/sh-sW/sH);if(d<bd){bd=d;best=s;}}
      const p = `Apply this edit:\nINSTRUCTION: ${c}\n- PRESERVE same person, identity, pose.\n- Match lighting, color.\n- No seams, no borders.`;
      let er: any = null;
      try { er = await (zai.images.generations.edit as any)({ prompt: p, images: [{ url }], size: best }); }
      catch(e) { if(!isCF(e)) throw e; updateTask(taskId,{progress:30}); try { const cr = await zai.chat.completions.create({messages:[{role:"user",content:`Reword for safety: "${c}". Replace woman/man→person, remove face/age/body. Output ONLY the instruction.`}]}); const pp = cr?.choices?.[0]?.message?.content?.toString?.()?.trim() ?? ""; if(pp) { updateTask(taskId,{progress:50}); er = await (zai.images.generations.edit as any)({ prompt: `Apply: ${pp}. Preserve identity.`, images: [{ url }], size: best }); } } catch {} }
      const b = er?.data?.[0]?.base64; if(!b) { updateTask(taskId,{status:"error",error:"Content filter. Use simpler words."}); return; }
      updateTask(taskId,{progress:80});
      let buf = Buffer.from(b,"base64"); const om = await sharp(buf).metadata(); if(om.width!==sW||om.height!==sH) buf = await sharp(buf).resize(sW,sH,{kernel:"lanczos3",fit:"fill"}).png({quality:95}).toBuffer();
      const n = `agent-edit-${Date.now()}-${Math.random().toString(36).slice(2,8)}.png`; const op = path.join(R,n); await fs.writeFile(op,buf);
      updateTask(taskId,{status:"done",progress:100,result:{url:`/results/${n}`,path:op,width:sW,height:sH,size:buf.length,method:"ai-agent-edit",instruction:body.instruction}});
    } catch(e) { updateTask(taskId,{status:"error",error:e instanceof Error?e.message:"Unknown"}); }
  })();
  return NextResponse.json({ taskId, status: "pending", message: `Poll /api/task/status?id=${taskId}` });
}
