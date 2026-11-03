"use client";

import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import { useUIStore } from "@/stores/ui-store";
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
import { Printer } from "lucide-react";

export function PrintModal() {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const results = useImageStore((s) => s.results);
  const activeResultId = useImageStore((s) => s.activeResultId);
  const active = results.find((r) => r.id === activeResultId) ?? results[0];
  const open = useUIStore((s) => s.printModalOpen);
  const setOpen = useUIStore((s) => s.setPrintModalOpen);

  if (!active) return null;

  // For the print action we just call window.print() on a hidden iframe with the image
  const handlePrint = () => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`
      <html><head><title>Print</title>
      <style>
        @page { size: A4; margin: 20mm; }
        body { margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; background: #fff; }
        img { max-width: 100%; max-height: 100%; object-fit: contain; }
      </style></head>
      <body><img src="${active.url}" /></body></html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("print.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">{t("print.paperSize")}</Label>
              <Select defaultValue="a4">
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4" className="text-xs">{t("print.a4")}</SelectItem>
                  <SelectItem value="a5" className="text-xs">{t("print.a5")}</SelectItem>
                  <SelectItem value="letter" className="text-xs">{t("print.letter")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">{t("print.orientation")}</Label>
              <ToggleGroup type="single" defaultValue="portrait" className="justify-start">
                <ToggleGroupItem value="portrait" className="text-[10px] h-7">{t("print.portrait")}</ToggleGroupItem>
                <ToggleGroupItem value="landscape" className="text-[10px] h-7">{t("print.landscape")}</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{t("print.margins")}</Label>
            <ToggleGroup type="single" defaultValue="normal" className="justify-start">
              <ToggleGroupItem value="narrow" className="text-[10px] h-7">{t("print.marginsNarrow")}</ToggleGroupItem>
              <ToggleGroupItem value="normal" className="text-[10px] h-7">{t("print.marginsNormal")}</ToggleGroupItem>
              <ToggleGroupItem value="wide" className="text-[10px] h-7">{t("print.marginsWide")}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="studio-inset p-3 rounded-md bg-black/30 flex items-center justify-center min-h-[200px]">
            { }
            <img src={active.url} alt="Print preview" className="max-h-[200px] object-contain" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="h-9 text-xs">
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handlePrint}
            className="h-9 text-xs bg-cyan-accent text-black hover:bg-cyan-accent/90"
          >
            <Printer className="h-3.5 w-3.5" />
            {t("print.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
