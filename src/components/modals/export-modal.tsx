"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import { useUIStore } from "@/stores/ui-store";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Download, Loader2 } from "lucide-react";

export function ExportModal() {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const results = useImageStore((s) => s.results);
  const activeResultId = useImageStore((s) => s.activeResultId);
  const active = results.find((r) => r.id === activeResultId) ?? results[0];
  const open = useUIStore((s) => s.exportModalOpen);
  const setOpen = useUIStore((s) => s.setExportModalOpen);
  const { toast } = useToast();

  const [format, setFormat] = useState<"jpg" | "png" | "webp" | "tiff">("png");
  const [quality, setQuality] = useState<"low" | "medium" | "high" | "maximum">("high");
  const [resolution, setResolution] = useState<"original" | "hd" | "fullHd" | "twoK" | "fourK" | "ultraHd">("original");
  const [dpi, setDpi] = useState(300);
  const [fileName, setFileName] = useState("result");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  if (!active) return null;

  async function handleExport() {
    if (!active) return;
    setBusy(true);
    setResultUrl(null);
    try {
      // Pass the result URL directly — the /api/images/export endpoint
      // uses resolveFilePath which checks multiple paths including
      // process.cwd()/data/ (which is /home/z/my-project/extracted/data/).
      //
      // Previous version used `/home/z/my-project/data/${rel}` which was
      // WRONG (the actual path is /home/z/my-project/extracted/data/).
      const urlPath = active.url ?? "";
      const derivedPath =
        (active as { path?: string }).path ||
        urlPath;  // just pass the URL — resolveFilePath will find it

      const res = await fetch("/api/images/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: derivedPath,
          format,
          quality,
          resolution,
          dpi,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Export failed", description: data.message, variant: "destructive" });
        return;
      }
      setResultUrl(data.url);
      toast({ title: t("success.exported") });
    } catch (e) {
      toast({
        title: t("errors.unknown"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("export.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{t("export.format")}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as never)}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["jpg", "png", "webp", "tiff"].map((f) => (
                  <SelectItem key={f} value={f} className="text-xs uppercase">
                    {f.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{t("export.quality")}</Label>
            <ToggleGroup
              type="single"
              value={quality}
              onValueChange={(v) => v && setQuality(v as never)}
              className="justify-start"
            >
              <ToggleGroupItem value="low" className="text-[10px] h-7">{t("export.low")}</ToggleGroupItem>
              <ToggleGroupItem value="medium" className="text-[10px] h-7">{t("export.medium")}</ToggleGroupItem>
              <ToggleGroupItem value="high" className="text-[10px] h-7">{t("export.high")}</ToggleGroupItem>
              <ToggleGroupItem value="maximum" className="text-[10px] h-7">{t("export.maximum")}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{t("export.resolution")}</Label>
            <ToggleGroup
              type="single"
              value={resolution}
              onValueChange={(v) => v && setResolution(v as never)}
              className="justify-start flex-wrap"
            >
              <ToggleGroupItem value="original" className="text-[10px] h-7">{t("export.original")}</ToggleGroupItem>
              <ToggleGroupItem value="hd" className="text-[10px] h-7">{t("export.hd")}</ToggleGroupItem>
              <ToggleGroupItem value="fullHd" className="text-[10px] h-7">{t("export.fullHd")}</ToggleGroupItem>
              <ToggleGroupItem value="twoK" className="text-[10px] h-7">{t("export.twoK")}</ToggleGroupItem>
              <ToggleGroupItem value="fourK" className="text-[10px] h-7">{t("export.fourK")}</ToggleGroupItem>
              <ToggleGroupItem value="ultraHd" className="text-[10px] h-7">{t("export.ultraHd")}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">{t("export.dpi")}</Label>
              <Input
                type="number"
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">{t("export.fileName")}</Label>
              <Input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="h-9 text-xs font-mono"
              />
            </div>
          </div>

          {resultUrl && (
            <a
              href={resultUrl}
              download={`${fileName}.${format}`}
              className="text-[11px] text-cyan-accent underline underline-offset-2 truncate"
            >
              {t("common.download")}: {resultUrl}
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="h-9 text-xs">
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleExport}
            disabled={busy}
            className="h-9 text-xs bg-cyan-accent text-black hover:bg-cyan-accent/90"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
