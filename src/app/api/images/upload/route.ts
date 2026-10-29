import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { resolveDataRoot } from "@/lib/security/resolve-file-path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function mimeToFormat(mime: string, fb?: string): { format: string; ext: string } {
  const m = (mime||"").toLowerCase();
  if (m.includes("png")) return { format: "png", ext: ".png" };
  if (m.includes("webp")) return { format: "webp", ext: ".webp" };
  if (m.includes("jpeg")||m.includes("jpg")) return { format: "jpeg", ext: ".jpg" };
  if (m.includes("tiff")||m.includes("tif")) return { format: "tiff", ext: ".tiff" };
  const e = (fb||"").toLowerCase();
  if (e===".png") return { format: "png", ext: ".png" };
  if (e===".jpg"||e===".jpeg") return { format: "jpeg", ext: ".jpg" };
  return { format: "png", ext: ".png" };
}
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type")||"";
    let buf: Buffer; let mime="image/png"; let ext=".png"; let name="image";
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const f = (fd.get("file")||fd.get("image")) as File|null;
      if (!f) return NextResponse.json({ok:false,error:"No file"},{status:400});
      buf = Buffer.from(await f.arrayBuffer()); mime = f.type||"image/png"; ext = path.extname(f.name||"")||".png"; name = f.name||"image";
    } else if (ct.includes("application/json")) {
      const body = await req.json();
      if (body.data?.startsWith("data:")) { const m = body.data.match(/^data:([^;]+);base64,(.*)$/); if (!m) return NextResponse.json({ok:false,error:"Invalid"},{status:400}); buf = Buffer.from(m[2],"base64"); mime = m[1]; ext = mimeToFormat(mime).ext; }
      else if (body.url) { const r = await fetch(body.url); buf = Buffer.from(await r.arrayBuffer()); mime = r.headers.get("content-type")||"image/png"; ext = mimeToFormat(mime,path.extname(body.url)).ext; name = path.basename(new URL(body.url).pathname)||"image"; }
      else return NextResponse.json({ok:false,error:"No data"},{status:400});
    } else { buf = Buffer.from(await req.arrayBuffer()); }
    if (!buf.length) return NextResponse.json({ok:false,error:"Empty"},{status:400});
    let w=0,h=0;
    try { const meta = await sharp(buf).metadata(); w = meta.width??0; h = meta.height??0; if (meta.format) ext = mimeToFormat(`image/${meta.format}`,ext).ext; } catch {}
    const fmt = mimeToFormat(mime,ext);
    const root = await resolveDataRoot();
    const dir = path.join(root,"uploads");
    await fs.mkdir(dir,{recursive:true});
    const id = randomUUID();
    const filename = `${id}${fmt.ext}`;
    await fs.writeFile(path.join(dir,filename),buf);
    const p = `/uploads/${filename}`;
    return NextResponse.json({ok:true,id,name,path:p,fullPath:path.join(dir,filename),url:p,mime,size:buf.length,width:w,height:h,format:fmt.format,filename,uploadedAt:Date.now(),createdAt:Date.now()});
  } catch(e:any) { return NextResponse.json({ok:false,error:e?.message},{status:500}); }
}
export async function GET() { return NextResponse.json({ok:true,endpoint:"/api/images/upload"}); }
