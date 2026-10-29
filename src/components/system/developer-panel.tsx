"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useTryOnStore } from "@/stores/tryon-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Code2, Cpu, Trash2, Clock, Activity, MemoryStick, Server } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LogItem {
  id: number;
  level: string;
  category: string;
  message: string;
  details: string | null;
  durationMs: number | null;
  modelUsed: string | null;
  gpuInfo: string | null;
  vramMB: number | null;
  createdAt: string;
}

export function DeveloperPanel() {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const { toast } = useToast();
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const lastDurationMs = useTryOnStore((s) => s.lastDurationMs);
  const modelUsed = useTryOnStore((s) => s.modelUsed);
  const qualityScore = useTryOnStore((s) => s.qualityScore);
  const steps = useTryOnStore((s) => s.steps);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/logs?limit=50");
      const data = await r.json();
      setLogs(data.logs ?? []);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const clearLogs = async () => {
    await fetch("/api/logs", { method: "DELETE" });
    await refresh();
    toast({ title: "Logs cleared" });
  };

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {/* Pipeline info */}
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-accent" />
            {t("developer.pipelineSteps")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">No pipeline runs yet.</p>
          ) : (
            steps.map((step, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-2 py-1.5 rounded-md bg-muted/30 text-[10px]"
              >
                <span className="font-mono">{step.percent}%</span>
                <span className="text-cyan-accent">{step.stage}</span>
                <span className="text-muted-foreground">
                  {new Date(step.ts).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-accent" />
            {t("developer.modelInfo")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <Stat
            icon={<Code2 className="h-3 w-3" />}
            label="Model"
            value={modelUsed ?? "—"}
          />
          <Stat
            icon={<Clock className="h-3 w-3" />}
            label={t("developer.processingTime")}
            value={lastDurationMs ? `${lastDurationMs} ms` : "—"}
          />
          <Stat
            icon={<Activity className="h-3 w-3" />}
            label="Quality"
            value={qualityScore ? `${qualityScore}/100` : "—"}
          />
          <Stat
            icon={<MemoryStick className="h-3 w-3" />}
            label={t("developer.memoryUsage")}
            value={
              typeof performance !== "undefined"
                ? `${(performance.memory?.usedJSHeapSize ?? 0) / 1024 / 1024} MB`
                : "—"
            }
          />
        </CardContent>
      </Card>

      {/* Logs */}
      <Card className="studio-panel border-panel-border md:col-span-2">
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4 text-cyan-accent" />
            {t("developer.logs")}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={refresh} disabled={refreshing}>
              {refreshing ? "..." : "Refresh"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive hover:text-destructive" onClick={clearLogs}>
              <Trash2 className="h-3 w-3" />
              {t("developer.clearLogs")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-y-auto rounded-md bg-black/40 p-2 font-mono text-[10px]">
            {logs.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No logs yet.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex gap-2 py-0.5 hover:bg-muted/20 px-1 rounded">
                  <span className="text-muted-foreground shrink-0">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      log.level === "error" ? "text-red-400 shrink-0" :
                      log.level === "warn" ? "text-amber-400 shrink-0" :
                      log.level === "info" ? "text-cyan-accent shrink-0" :
                      "text-muted-foreground shrink-0"
                    }
                  >
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="text-muted-foreground shrink-0">[{log.category}]</span>
                  <span className="truncate">{log.message}</span>
                  {log.durationMs != null && (
                    <span className="text-muted-foreground/60 ml-auto shrink-0">
                      {log.durationMs}ms
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="px-3 py-2 rounded-md bg-muted/30">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-xs font-mono truncate" title={value}>{value}</div>
    </div>
  );
}
