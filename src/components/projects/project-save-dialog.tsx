"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useModeStore } from "@/stores/mode-store";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ProjectSaveDialog({ open, onOpenChange }: Props) {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const source = useImageStore((s) => s.source);
  const garment = useImageStore((s) => s.garment);
  const garmentDescription = useImageStore((s) => s.garmentDescription);
  const results = useImageStore((s) => s.results);
  const settings = useSettingsStore();
  const mode = useModeStore((s) => s.mode);
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!source) {
      toast({ title: t("errors.noSourceImage"), variant: "destructive" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Project name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const settingsJson = JSON.stringify({
        ...settings,
        mode,
        garmentDescription,
      });
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sourcePath: source.path,
          garmentPath: garment?.path ?? "",
          settingsJson,
          seedUsed: settings.seed?.toString() ?? "",
          modelUsed: mode === "local" ? "catvton" : "cloud-ai",
          resultIds: results.map((r) => r.id).join(","),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("success.projectSaved") });
        onOpenChange(false);
        setName("");
      } else {
        toast({
          title: "Save failed",
          description: data.error,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: t("errors.unknown"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Save className="h-4 w-4 text-cyan-accent" />
            {t("controls.saveProject")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">
              {t("projects.name")}
            </Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("projects.namePlaceholder")}
              className="h-9 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) handleSave();
              }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground space-y-0.5 px-2 py-2 rounded-md bg-muted/30">
            <div>• {t("projects.includesSettings")}</div>
            <div>• {t("projects.includesSeed")}: {settings.seed ?? "random"}</div>
            <div>• {t("projects.includesMode")}: {mode === "local" ? "CatVTON" : "Cloud AI"}</div>
            <div>• {t("projects.includesResults")}: {results.length}</div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-9 text-xs"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="h-9 text-xs bg-cyan-accent text-black hover:bg-cyan-accent/90"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
