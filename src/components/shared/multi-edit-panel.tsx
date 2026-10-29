"use client";
import { useState, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Wand2, MousePointerClick } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
interface LI { path: string; url: string; width: number; height: number; name: string; }
interface P { image: LI | null; onUpdate: (d: { path: string; url: string; width: number; height: number }) => void; compact?: boolean; className?: string; }
type TZ = "all" | "person1" | "person2" | "object" | "background" | "region";
export function MultiEditPanel({ image, onUpdate, compact, className }: P) {
  const locale = useI18n(s => s.locale); const { toast } = useToast(); const isAr = locale === "ar";
  const [busy, setBusy] = useState(false); const [inst, setInst] = useState(""); const [target, setTarget] = useState<TZ>("all");
  const [region, setRegion] = useState<{x:number;y:number;w:number;h:number}|null>(null);
  const [drawing, setDrawing] = useState(false); const [sp, setSP] = useState<{x:number;y:number}|null>(null);
  const ir = useRef<HTMLImageElement>(null);
  const gp = useCallback((e: React.MouseEvent|React.TouchEvent) => { if(!ir.current||!image) return {x:0,y:0}; const r = ir.current.getBoundingClientRect(); const cx = "touches" in e ? e.touches[0]?.clientX ?? 0 : (e as React.MouseEvent).clientX; const cy = "touches" in e ? e.touches[0]?.clientY ?? 0 : (e as React.MouseEvent).clientY; return {x:Math.round(((cx-r.left)/r.width)*image.width), y:Math.round(((cy-r.top)/r.height)*image.height)}; }, [image]);
  const hs = useCallback((e: React.MouseEvent|React.TouchEvent) => { if(target!=="region"||!image) return; e.preventDefault(); setDrawing(true); const p = gp(e); setSP(p); setRegion({x:p.x,y:p.y,w:0,h:0}); }, [target,image,gp]);
  const hm = useCallback((e: React.MouseEvent|React.TouchEvent) => { if(!drawing||!image) return; e.preventDefault(); const p = gp(e); if(sp) setRegion({x:Math.min(sp.x,p.x),y:Math.min(sp.y,p.y),w:Math.abs(p.x-sp.x),h:Math.abs(p.y-sp.y)}); }, [drawing,image,sp,gp]);
  const he = useCallback(() => setDrawing(false), []);
  const apply = async () => {
    if(!image||!inst.trim()) return; setBusy(true);
    let fi = inst.trim(); if(target==="person1") fi=`Apply ONLY to first person: ${fi}`; else if(target==="person2") fi=`Apply ONLY to second person: ${fi}`; else if(target==="background") fi=`Apply ONLY to background: ${fi}`;
    try { const r = await fetch("/api/images/agent-edit", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourcePath:image.path,instruction:fi,region:target==="region"?region:undefined,wholeImage:target==="all"})}); let d:any; try{d=await r.json();}catch{return;}
      if(d.taskId){for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,3000));const pr=await fetch(`/api/task/status?id=${d.taskId}`);let pd:any;try{pd=await pr.json();}catch{continue;}
        if(pd.status==="done"&&pd.result){onUpdate({path:pd.result.path,url:pd.result.url,width:pd.result.width,height:pd.result.height});toast({title:isAr?"تم":"Done"});setInst("");return;}
        if(pd.status==="error"){toast({title:"Error",description:pd.error,variant:"destructive"});return;}}}
    } catch(e){toast({title:"Error",description:e instanceof Error?e.message:"",variant:"destructive"});} finally{setBusy(false);}
  };
  if(!image) return (<Card className={cn("studio-panel",className)}><CardContent className={compact?"py-3 text-center":"py-6 text-center"}><MousePointerClick className="h-6 w-6 text-muted-foreground mx-auto mb-2" /><p className="text-xs text-muted-foreground">{isAr?"ارفع صورة":"Upload"}</p></CardContent></Card>);
  const to: {key:TZ;ar:string;en:string}[] = [{key:"all",ar:"الكل",en:"All"},{key:"person1",ar:"شخص1",en:"P1"},{key:"person2",ar:"شخص2",en:"P2"},{key:"object",ar:"كائن",en:"Obj"},{key:"background",ar:"خلفية",en:"BG"},{key:"region",ar:"ارسم",en:"Draw"}];
  return (<Card className={cn("studio-panel border-cyan-accent/30",className)}><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><MousePointerClick className="h-4 w-4 text-cyan-accent" />{isAr?"تعديل متعدد":"Multi-Edit"}</CardTitle></CardHeader><CardContent className="space-y-2">
    <div className={cn("relative w-full overflow-auto rounded-md bg-black/30 aspect-square max-h-[300px]",target==="region"?"cursor-crosshair":"cursor-default")} onMouseDown={hs} onMouseMove={hm} onMouseUp={he} onMouseLeave={he} onTouchStart={hs} onTouchMove={hm} onTouchEnd={he}>
      <img ref={ir} src={image.url} alt="edit" className="w-full h-full object-contain select-none pointer-events-none" draggable={false} />
      {region&&target==="region"&&<div className="absolute border-2 border-cyan-accent bg-cyan-accent/20 pointer-events-none" style={{left:`${(region.x/image.width)*100}%`,top:`${(region.y/image.height)*100}%`,width:`${(region.w/image.width)*100}%`,height:`${(region.h/image.height)*100}%`}}/>}
      <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/70 text-[10px] text-white/80">{image.width}x{image.height}</div>
    </div>
    <div className="flex flex-wrap gap-1">{to.map(o=><button key={o.key} onClick={()=>{setTarget(o.key);if(o.key!=="region")setRegion(null);}} className={cn("px-2 py-1 rounded text-[10px]",target===o.key?"bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent":"bg-muted/30")}>{isAr?o.ar:o.en}</button>)}</div>
    <textarea value={inst} onChange={e=>setInst(e.target.value)} placeholder={isAr?"اكتب التعديل...":"Describe edit..."} className="w-full h-16 text-[11px] bg-black/30 border border-cyan-accent/30 rounded p-2 resize-none" />
    <Button size="sm" onClick={apply} disabled={busy||!inst.trim()} className="w-full h-9 text-[11px] bg-cyan-accent text-black">{busy?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Wand2 className="h-3.5 w-3.5"/>}{isAr?"نفّذ":"Apply"}</Button>
  </CardContent></Card>);
}
