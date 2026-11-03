"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Cpu, Download, Trash2, Check, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ModelInfo {
  id: string;
  name: string;
  displayName: string;
  version: string;
  category: string;
  huggingfaceRepo: string;
  sizeGB: number;
  vramRequiredGB: number;
  ramRequiredGB: number;
  license: string;
  capabilities: {
    maxResolution: number;
    vramRequiredMB: number;
    supportsBatch: boolean;
    supportsCPU: boolean;
    garmentStrengths: string[];
    supportsSeed: boolean;
    avgGenerationMs: number;
  };
  isActive: boolean;
  status: "not_installed" | "installing" | "installed" | "active" | "error";
  installedAt: string | null;
}

interface GpuStatus {
  gpu: string | null;
  vramTotalMB: number | null;
  vramFreeMB: number | null;
  cudaAvailable: boolean;
  cpu: string | null;
  ramTotalGB: number | null;
  preference: string;
}

export function ModelManagerPanel() {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const { toast } = useToast();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [gpu, setGpu] = useState<GpuStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [m, g] = await Promise.all([
        fetch("/api/models").then((r) => r.json()),
        fetch("/api/gpu/status").then((r) => r.json()),
      ]);
      setModels(m.models ?? []);
      setGpu(g);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleAction = async (modelId: string, action: "install" | "activate" | "deactivate" | "remove") => {
    setBusy(`${modelId}:${action}`);
    try {
      const res = await fetch("/api/models/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, action }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t(`success.${action === "install" ? "modelInstalled" : action === "activate" ? "modelActivated" : "success.generated"}`) });
        void refresh();
      } else {
        toast({ title: "Action failed", description: data.error, variant: "destructive" });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Hardware snapshot */}
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-accent" />
            {t("system.hardwareStatus")}
          </CardTitle>
          {gpu && (
            <Badge variant="outline" className="text-[10px] gap-1 text-cyan-accent border-cyan-accent/40">
              {gpu.preference === "cpu" ? "CPU only" : `CUDA ${gpu.preference.replace("cuda_", "")}`}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Field label={t("system.gpu")} value={gpu?.gpu ?? t("system.notDetected")} />
          <Field label={t("system.vram")} value={gpu?.vramTotalMB ? `${gpu.vramTotalMB} MB` : t("system.notDetected")} />
          <Field label={t("system.cpu")} value={gpu?.cpu ?? t("system.notDetected")} />
          <Field label={t("system.ram")} value={gpu?.ramTotalGB ? `${gpu.ramTotalGB} GB` : t("system.notDetected")} />
        </CardContent>
      </Card>

      {/* Models table */}
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3">
          <CardTitle className="text-sm">{t("models.title")}</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">{t("models.firstRunNotice")}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-accent" />
            </div>
          ) : models.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">{t("models.noModels")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[10px]">{t("models.name")}</TableHead>
                    <TableHead className="text-[10px]">{t("models.version")}</TableHead>
                    <TableHead className="text-[10px]">{t("models.size")}</TableHead>
                    <TableHead className="text-[10px]">{t("models.vram")}</TableHead>
                    <TableHead className="text-[10px]">{t("models.status")}</TableHead>
                    <TableHead className="text-[10px] text-end">{t("models.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((m) => (
                    <TableRow key={m.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="text-xs font-medium">{m.displayName}</div>
                        <div className="text-[9px] text-muted-foreground">{m.huggingfaceRepo}</div>
                      </TableCell>
                      <TableCell className="text-[10px] font-mono">{m.version}</TableCell>
                      <TableCell className="text-[10px] font-mono">{m.sizeGB} GB</TableCell>
                      <TableCell className="text-[10px] font-mono">
                        {m.vramRequiredGB} GB
                        {m.vramRequiredGB * 1024 > (gpu?.vramFreeMB ?? 0) && (
                          <AlertCircle className="h-3 w-3 inline-block ml-1 text-amber-500" />
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={m.status} isActive={m.isActive} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {m.status === "not_installed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px]"
                              onClick={() => handleAction(m.id, "install")}
                              disabled={busy === `${m.id}:install`}
                            >
                              {busy === `${m.id}:install` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              {t("models.install")}
                            </Button>
                          )}
                          {m.status !== "not_installed" && !m.isActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px]"
                              onClick={() => handleAction(m.id, "activate")}
                              disabled={busy === `${m.id}:activate`}
                            >
                              <Check className="h-3 w-3" />
                              {t("models.activate")}
                            </Button>
                          )}
                          {m.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px]"
                              onClick={() => handleAction(m.id, "deactivate")}
                            >
                              {t("models.deactivate")}
                            </Button>
                          )}
                          {m.status !== "not_installed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px] text-destructive hover:text-destructive"
                              onClick={() => handleAction(m.id, "remove")}
                              disabled={busy === `${m.id}:remove`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 rounded-md bg-muted/30">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xs font-medium truncate" title={value}>{value}</div>
    </div>
  );
}

function StatusBadge({ status, isActive }: { status: string; isActive: boolean }) {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const variant =
    isActive ? "default" :
    status === "installed" ? "secondary" :
    status === "installing" ? "outline" :
    status === "error" ? "destructive" :
    "outline";
  const label =
    isActive ? t("models.activeBadge") :
    status === "installed" ? t("models.installed") :
    status === "installing" ? t("models.installing") :
    status === "error" ? "Error" :
    t("models.notInstalled");
  return (
    <Badge
      variant={variant as never}
      className={cn(
        "text-[9px] gap-1",
        isActive && "bg-cyan-accent/15 text-cyan-accent border-cyan-accent/40"
      )}
    >
      {isActive && <span className="h-1 w-1 rounded-full bg-cyan-accent cyan-pulse" />}
      {label}
    </Badge>
  );
}
