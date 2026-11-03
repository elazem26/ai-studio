"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Cpu, HardDrive, Wifi, Lock, Cloud, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SystemStatus {
  privacy: {
    internetRequired: boolean;
    imageUpload: string;
    cloudProcessing: boolean;
    localAIEnabled: boolean;
    apiServer: string;
    lanMode: boolean;
    currentMode?: "cloud_ai" | "local_catvton" | "demo";
  };
  storage: {
    modelsInstalled: number;
    tempSizeBytes: number;
    tempRoot: string;
  };
  build: { version: string; timestamp: number };
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

export function SystemPrivacyPanel() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [gpu, setGpu] = useState<GpuStatus | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/system/status").then((r) => r.json()),
      fetch("/api/gpu/status").then((r) => r.json()),
    ]).then(([s, g]) => {
      setStatus(s);
      setGpu(g);
    });
  }, [locale]);

  const mode = status?.privacy.currentMode ?? "cloud_ai";
  const modeLabel = mode === "cloud_ai" ? t("system.modeCloud") : mode === "local_catvton" ? t("system.modeLocal") : t("system.modeDemo");
  const modeDesc = mode === "cloud_ai" ? t("system.modeCloudDesc") : mode === "local_catvton" ? t("system.modeLocalDesc") : "";
  const isCloud = mode === "cloud_ai";

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {/* Current Mode Banner */}
      <Card className={cn(
        "studio-panel border-panel-border md:col-span-2",
        isCloud && "border-amber-500/30"
      )}>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {isCloud ? (
              <Cloud className="h-4 w-4 text-amber-500" />
            ) : (
              <Shield className="h-4 w-4 text-emerald-400" />
            )}
            {t("system.currentMode")}: <span className="text-cyan-accent">{modeLabel}</span>
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">{modeDesc}</p>
        </CardHeader>
        {isCloud && (
          <CardContent className="pt-0 pb-3">
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <strong className="text-amber-400">إشعار الخصوصية / Privacy Notice:</strong>
                <br />
                الصور تُرسل لخدمة AI سحابية (z-ai-web-dev-sdk) للحصول على نتائج حقيقية. للخصوصية الكاملة، ثبّت CatVTON محليًا مع Python + NVIDIA GPU.
                <br />
                <span dir="ltr">Images are sent to a cloud AI service for realistic try-on results. For full privacy, install CatVTON locally (requires Python + NVIDIA GPU).</span>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Privacy */}
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-cyan-accent" />
            {t("system.privacyStatus")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <PrivacyRow
            icon={<Wifi className="h-3.5 w-3.5" />}
            label={t("system.internetConnection")}
            value={status?.privacy.internetRequired ? t("system.required") : t("system.notRequired")}
            positive={!status?.privacy.internetRequired}
          />
          <PrivacyRow
            icon={<Lock className="h-3.5 w-3.5" />}
            label={t("system.imageUpload")}
            value={isCloud ? t("system.enabled") : t("system.disabled")}
            positive={!isCloud}
          />
          <PrivacyRow
            icon={<Cloud className="h-3.5 w-3.5" />}
            label={t("system.cloudProcessing")}
            value={isCloud ? t("system.enabled") : t("system.disabled")}
            positive={!isCloud}
          />
          <PrivacyRow
            icon={<Cpu className="h-3.5 w-3.5" />}
            label={t("system.localAI")}
            value={!isCloud ? t("system.enabled") : t("system.disabled")}
            positive={!isCloud}
          />
          <PrivacyRow
            icon={<Wifi className="h-3.5 w-3.5" />}
            label={t("system.apiServer")}
            value={status?.privacy.apiServer ? `${status.privacy.apiServer}` : "127.0.0.1"}
            positive
          />
          <PrivacyRow
            icon={<Lock className="h-3.5 w-3.5" />}
            label={t("system.lanMode")}
            value={t("system.lanModeOff")}
            positive
          />
        </CardContent>
      </Card>

      {/* Hardware */}
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-accent" />
            {t("system.hardwareStatus")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <PrivacyRow
            icon={<Cpu className="h-3.5 w-3.5" />}
            label={t("system.gpu")}
            value={gpu?.gpu ?? t("system.notDetected")}
            positive={!!gpu?.gpu}
          />
          <PrivacyRow
            icon={<HardDrive className="h-3.5 w-3.5" />}
            label={t("system.vram")}
            value={gpu?.vramTotalMB ? `${gpu.vramTotalMB} MB` : t("system.notDetected")}
            positive={!!gpu?.vramTotalMB}
          />
          <PrivacyRow
            icon={<Cpu className="h-3.5 w-3.5" />}
            label={t("system.cuda")}
            value={gpu?.cudaAvailable ? t("system.detected") : t("system.notDetected")}
            positive={!!gpu?.cudaAvailable}
          />
          <PrivacyRow
            icon={<Cpu className="h-3.5 w-3.5" />}
            label={t("system.cpu")}
            value={gpu?.cpu ?? t("system.notDetected")}
            positive={!!gpu?.cpu}
          />
          <PrivacyRow
            icon={<HardDrive className="h-3.5 w-3.5" />}
            label={t("system.ram")}
            value={gpu?.ramTotalGB ? `${gpu.ramTotalGB} GB` : t("system.notDetected")}
            positive={!!gpu?.ramTotalGB}
          />
        </CardContent>
      </Card>

      {/* Storage */}
      <Card className="studio-panel border-panel-border md:col-span-2">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-cyan-accent" />
            {t("system.tempFiles")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div className="px-3 py-2 rounded-md bg-muted/30">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{t("models.installed")}</div>
            <div className="text-sm font-mono">{status?.storage.modelsInstalled ?? 0}</div>
          </div>
          <div className="px-3 py-2 rounded-md bg-muted/30">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{t("system.tempFiles")}</div>
            <div className="text-sm font-mono">
              {status ? (status.storage.tempSizeBytes / 1024 / 1024).toFixed(2) : "0"} MB
            </div>
          </div>
          <div className="px-3 py-2 rounded-md bg-muted/30">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{t("system.autoCleanup")}</div>
            <div className="text-sm font-mono">{t("system.yes")}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PrivacyRow({
  icon,
  label,
  value,
  positive,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/30">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-cyan-accent/70">{icon}</span>
        <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{value}</span>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            positive ? "bg-emerald-400 cyan-pulse" : "bg-amber-500"
          )}
        />
      </div>
    </div>
  );
}
