"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Copy, Check, Loader2, FileArchive, Terminal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface CompleteDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Manifest {
  ready: boolean;
  building: boolean;
  builtAt?: string;
  fullSizeMB?: number;
  partCount?: number;
  parts?: { name: string; sizeMB: number }[];
  error?: string;
}

/**
 * "نسخة كمبيوتر كاملة" — full archive (code + keys + db + data + models).
 * Build starts server-side on first open; parts are served statically.
 */
export function CompleteDownloadDialog({ open, onOpenChange }: CompleteDownloadDialogProps) {
  const { toast } = useToast();
  const [origin, setOrigin] = useState("");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [copied, setCopied] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(() => {
    fetch("/api/system/full-archive", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Manifest) => {
        setManifest(d);
        if (d.building && !d.ready) {
          timerRef.current = setTimeout(poll, 4000);
        }
      })
      .catch(() => {
        timerRef.current = setTimeout(poll, 6000);
      });
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (open) {
      poll();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, poll]);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(""), 2000);
    toast({ title: "تم النسخ" });
  };

  const building = manifest?.building && !manifest?.ready;
  const parts = manifest?.parts || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5 text-fuchsia-500" />
            تحميل النسخة الكاملة
          </DialogTitle>
          <DialogDescription>
            كل الملفات: الكود + المفاتيح + قاعدة البيانات + النماذج (~{manifest?.fullSizeMB || 900}MB)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {building && (
            <div className="p-4 rounded-md bg-muted/40 ring-1 ring-fuchsia-500/30 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-fuchsia-500" />
              <p className="text-xs font-medium mt-2">جاري بناء النسخة الكاملة وتقسيمها...</p>
              <p className="text-[10px] text-muted-foreground mt-1">قد يستغرق 2-5 دقائق — أبقِ النافذة مفتوحة</p>
            </div>
          )}

          {manifest?.error && (
            <div className="p-3 rounded-md bg-red-500/10 ring-1 ring-red-500/30">
              <p className="text-[11px] text-red-400">فشل البناء: {manifest.error}</p>
              <button onClick={poll} className="text-[10px] text-red-300 underline mt-1">إعادة المحاولة</button>
            </div>
          )}

          {manifest?.ready && parts.length > 0 && (
            <>
              <div className="p-3 rounded-md bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 ring-2 ring-violet-500/40">
                <p className="text-xs font-semibold mb-2">
                  الأجزاء الجاهزة ({parts.length} أجزاء · {manifest.fullSizeMB}MB إجمالاً)
                </p>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {parts.map((p) => (
                    <div key={p.name} className="flex items-center gap-2 p-2 rounded-md bg-muted/40 ring-1 ring-fuchsia-500/20">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-mono truncate">{p.name}</p>
                        <p className="text-[9px] text-muted-foreground">{p.sizeMB}MB</p>
                      </div>
                      <a
                        href={`${origin}/${p.name}`}
                        download
                        className="shrink-0 h-8 px-2 rounded-md bg-fuchsia-500/20 hover:bg-fuchsia-500/30 ring-1 ring-fuchsia-500/40 flex items-center gap-1 text-[10px] text-fuchsia-300"
                      >
                        <Download className="h-3 w-3" /> تحميل
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              {/* Combine scripts */}
              <div className="flex gap-2">
                <a href={`${origin}/combine-parts.bat`} download className="flex-1 px-2 py-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 ring-1 ring-blue-500/40 text-[10px] font-mono text-blue-300 text-center">
                  combine-parts.bat (ويندوز)
                </a>
                <a href={`${origin}/combine-parts.sh`} download className="flex-1 px-2 py-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 ring-1 ring-blue-500/40 text-[10px] font-mono text-blue-300 text-center">
                  combine-parts.sh (لينكس/ماك)
                </a>
              </div>

              {/* Steps */}
              <div className="p-2 rounded-md bg-muted/40 ring-1 ring-border">
                <p className="text-[10px] font-medium text-muted-foreground">طريقة الدمج:</p>
                <ol className="text-[10px] text-muted-foreground space-y-0.5 list-decimal list-inside mt-1">
                  <li>حمّل كل الأجزاء ({parts.length}) + سكريبت الدمج في مجلد واحد</li>
                  <li>شغّل combine-parts.bat (ويندوز) أو bash combine-parts.sh</li>
                  <li>سيُنتج ai-studio-complete.tar.gz ثم استخرجه بـ 7-Zip</li>
                  <li>النسخة مكتملة: الكود + .env + قاعدة البيانات + النماذج</li>
                </ol>
              </div>

              {/* curl for advanced users */}
              <div className="p-2 rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/30">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-medium text-emerald-400 flex items-center gap-1">
                    <Terminal className="h-3 w-3" /> للمتقدمين — curl مع استئناف:
                  </p>
                  <button
                    onClick={() => copy(parts.map((p) => `curl -L -C - -o "${p.name}" "${origin}/${p.name}"`).join("\n"), "curl")}
                    className="text-[9px] text-emerald-300 underline flex items-center gap-0.5"
                  >
                    {copied === "curl" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} نسخ الكل
                  </button>
                </div>
                <code className="block text-[9px] font-mono text-emerald-300 break-all">
                  curl -L -C - -o "PART" "{origin}/PART"
                </code>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
