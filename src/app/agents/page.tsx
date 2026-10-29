"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Activity,
  Award,
  Database,
  Lock,
  MessageCircle,
  Server,
  Shield,
  RefreshCw,
  Play,
  Pencil,
  Plus,
  Trash2,
  Send,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Workflow,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ===== Types (mirror of src/lib/agents/registry.ts) =====
type AgentStatus = "idle" | "active" | "stopped" | "error" | "running";
interface AgentTask {
  id: string;
  text: string;
  enabled: boolean;
  addedAt: number;
}
interface AgentStats {
  runsTotal: number;
  errorsTotal: number;
  uptimeSec: number;
  lastAction: string | null;
}
interface Agent {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  icon: string;
  category: string;
  status: AgentStatus;
  enabled: boolean;
  schedule: number;
  lastRun: number | null;
  lastReport: string | null;
  tasks: AgentTask[];
  config: Record<string, string | number | boolean | string[]>;
  stats: AgentStats;
}
interface AgentReport {
  agentId: string;
  status: AgentStatus;
  success: boolean;
  summary: string;
  findings?: string[];
  recommendations?: string[];
  metrics?: Record<string, number | string>;
  generatedAt: number;
  durationMs: number;
}
interface Overview {
  total: number;
  active: number;
  error: number;
  stopped: number;
  running: number;
  agents: Agent[];
  generatedAt: number;
}

// ===== Icon mapping =====
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Award,
  Lock,
  Server,
  Database,
  MessageCircle,
  Shield,
  RefreshCw,
  Activity,
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "bg-gray-400",
  active: "bg-green-500",
  stopped: "bg-gray-500",
  error: "bg-red-500",
  running: "bg-blue-500 animate-pulse",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "خامل",
  active: "نشط",
  stopped: "متوقف",
  error: "خطأ",
  running: "يعمل الآن",
};

export default function AgentsPage() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [reportsByAgent, setReportsByAgent] = useState<Record<string, AgentReport[]>>({});
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [orchestrateOpen, setOrchestrateOpen] = useState(false);
  const recognitionRef = useRef<any>(null); // SpeechRecognition instance

  // ===== Fetch agents =====
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents?reports=true&reportLimit=3");
      const data = await res.json();
      setOverview(data);
      const reportsMap: Record<string, AgentReport[]> = {};
      for (const a of data.agents) {
        reportsMap[a.id] = a.recentReports ?? [];
      }
      setReportsByAgent(reportsMap);
    } catch (e) {
      toast({
        title: "خطأ",
        description: e instanceof Error ? e.message : "failed to load agents",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // ===== Initial load + periodic refresh + scheduler tick =====
  useEffect(() => {
    void fetchAgents();
    // Auto-refresh every 15 seconds
    const refresh = setInterval(() => void fetchAgents(), 15000);
    // Trigger scheduler tick every 30 seconds (drives agent auto-runs)
    const tick = setInterval(() => {
      void fetch("/api/agents/scheduler/tick", { method: "POST" }).catch(() => {});
    }, 30000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [fetchAgents]);

  // ===== Handlers =====
  const handleRun = async (agentId: string) => {
    setRunningAgent(agentId);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({
          title: "تم التشغيل بنجاح",
          description: data.report.summary,
        });
      } else {
        toast({
          title: "اكتمل مع أخطاء",
          description: data.report?.summary ?? "unknown",
          variant: "destructive",
        });
      }
      await fetchAgents();
    } catch (e) {
      toast({
        title: "فشل التشغيل",
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    } finally {
      setRunningAgent(null);
    }
  };

  const handleToggle = async (agent: Agent) => {
    try {
      const res = await fetch("/api/agents/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          action: "toggle",
          enabled: !agent.enabled,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({
          title: agent.enabled ? "تم التعطيل" : "تم التنشيط",
          description: agent.name,
        });
        await fetchAgents();
      } else {
        toast({
          title: "فشل",
          description: data.error ?? "unknown",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "خطأ",
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    }
  };

  const handleSaveEdit = async (patch: Partial<Agent>) => {
    if (!editingAgent) return;
    try {
      const res = await fetch("/api/agents/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: editingAgent.id,
          action: "edit",
          patch,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({
          title: "تم الحفظ",
          description: "سيُعدّل الوكيل سلوكه تلقائياً وفقاً للتعديلات",
        });
        setEditingAgent(null);
        await fetchAgents();
      } else {
        toast({
          title: "فشل",
          description: data.error ?? "unknown",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "خطأ",
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    }
  };

  const handleAddTask = async (agent: Agent, taskText: string) => {
    if (!taskText.trim()) return;
    try {
      const res = await fetch("/api/agents/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          action: "add-task",
          taskText,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: "تمت إضافة المهمة" });
        await fetchAgents();
      } else {
        toast({
          title: "فشل",
          description: data.error ?? "unknown",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "خطأ",
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    }
  };

  const handleRemoveTask = async (agent: Agent, taskId: string) => {
    try {
      const res = await fetch("/api/agents/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          action: "remove-task",
          taskId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: "تم حذف المهمة" });
        await fetchAgents();
      }
    } catch (e) {
      toast({
        title: "خطأ",
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatHistory((h) => [...h, { role: "user", content: userMsg }]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: chatHistory.slice(-10),
        }),
      });
      const data = await res.json();
      if (data.reply) {
        setChatHistory((h) => [...h, { role: "assistant", content: data.reply }]);
        // Text-to-speech: read the assistant reply aloud in Arabic
        if (ttsEnabled && typeof window !== "undefined" && "speechSynthesis" in window) {
          try {
            const utterance = new SpeechSynthesisUtterance(data.reply);
            utterance.lang = "ar-SA";
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            window.speechSynthesis.speak(utterance);
          } catch {
            // ignore TTS errors
          }
        }
      } else {
        toast({
          title: "فشل",
          description: data.error ?? "unknown",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "خطأ",
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    } finally {
      setChatLoading(false);
    }
  };

  // ===== Voice input (Web Speech API) =====
  const toggleMic = () => {
    if (isListening) {
      // Stop listening
      recognitionRef.current?.stop?.();
      setIsListening(false);
      return;
    }
    // Start listening
    const SpeechRecognition =
      (typeof window !== "undefined" && (window as any).SpeechRecognition) ||
      (typeof window !== "undefined" && (window as any).webkitSpeechRecognition);
    if (!SpeechRecognition) {
      toast({
        title: "غير مدعوم",
        description: "متصفحك لا يدعم Web Speech API. جرّب Chrome.",
        variant: "destructive",
      });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ar-SA";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setChatInput(transcript);
        toast({ title: "تم استلام الصوت", description: transcript.slice(0, 60) });
      }
    };
    recognition.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      toast({
        title: "خطأ في التعرف على الصوت",
        description: event.error ?? "unknown",
        variant: "destructive",
      });
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    toast({ title: "🎤 استمع...", description: "تحدث الآن" });
  };

  // ===== Orchestrate workflow =====
  const [orchestrateWorkflow, setOrchestrateWorkflow] = useState("full-sweep");
  const [orchestrateResults, setOrchestrateResults] = useState<any>(null);
  const [orchestrateLoading, setOrchestrateLoading] = useState(false);

  const runOrchestration = async () => {
    setOrchestrateLoading(true);
    setOrchestrateResults(null);
    try {
      const res = await fetch("/api/agents/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: orchestrateWorkflow }),
      });
      const data = await res.json();
      setOrchestrateResults(data);
      if (data.ok) {
        toast({
          title: "اكتمل سير العمل",
          description: data.summary,
        });
      } else {
        toast({
          title: "أكتمل مع أخطاء",
          description: data.summary,
          variant: "destructive",
        });
      }
      await fetchAgents();
    } catch (e) {
      toast({
        title: "فشل",
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    } finally {
      setOrchestrateLoading(false);
    }
  };

  // ===== Render =====
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">الوكلاء الذكية</h1>
          <p className="text-muted-foreground mt-1">
            7 وكلاء ذكاء يراقبون البرنامج ويحمونه ويحافظون على تشغيله
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchAgents()}>
            <RefreshCw className="h-4 w-4 ml-2" /> تحديث
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOrchestrateOpen(true)}
          >
            <Workflow className="h-4 w-4 ml-2" /> تشغيل سير عمل
          </Button>
          <Button
            size="sm"
            onClick={() => setChatOpen(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <MessageCircle className="h-4 w-4 ml-2" /> اسأل المساعد
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryCard label="الإجمالي" value={overview.total} color="bg-blue-500" />
          <SummaryCard label="نشط" value={overview.active} color="bg-green-500" />
          <SummaryCard label="خطأ" value={overview.error} color="bg-red-500" />
          <SummaryCard label="متوقف" value={overview.stopped} color="bg-gray-500" />
        </div>
      )}

      {/* Agents grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {overview?.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            reports={reportsByAgent[agent.id] ?? []}
            running={runningAgent === agent.id}
            onRun={() => void handleRun(agent.id)}
            onToggle={() => void handleToggle(agent)}
            onEdit={() => setEditingAgent(agent)}
            onAddTask={(text) => void handleAddTask(agent, text)}
            onRemoveTask={(taskId) => void handleRemoveTask(agent, taskId)}
          />
        ))}
      </div>

      {/* Edit dialog */}
      {editingAgent && (
        <EditAgentDialog
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSave={(patch) => void handleSaveEdit(patch)}
        />
      )}

      {/* Chat dialog */}
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>المساعد الذكي — اسألني أي شيء عن البرنامج</DialogTitle>
            <div className="flex items-center gap-2 text-xs">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className="text-xs"
              >
                {ttsEnabled ? (
                  <><Volume2 className="h-3 w-3 ml-1" /> الصوت مفعّل</>
                ) : (
                  <><VolumeX className="h-3 w-3 ml-1" /> الصوت متوقف</>
                )}
              </Button>
            </div>
          </DialogHeader>
          <div className="flex flex-col h-[400px]">
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50 dark:bg-gray-900 rounded">
              {chatHistory.length === 0 && (
                <div className="text-center text-muted-foreground mt-8">
                  جرّب: «كيف يعمل الـ try-on؟» أو «كيف أرفع صورة؟» أو «كيف أحفظ نسخة احتياطية؟»
                  <br />
                  <span className="text-xs">يدعم الصوت — اضغط 🎤 وتحدث</span>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`p-2 rounded ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white ml-auto"
                      : "bg-gray-200 dark:bg-gray-800 mr-auto"
                  } max-w-[80%]`}
                >
                  {msg.content}
                </div>
              ))}
              {chatLoading && (
                <div className="bg-gray-200 dark:bg-gray-800 p-2 rounded mr-auto max-w-[80%] flex items-center">
                  <Loader2 className="h-4 w-4 animate-spin ml-2" /> يكتب...
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                variant={isListening ? "destructive" : "outline"}
                size="sm"
                onClick={toggleMic}
                disabled={chatLoading}
                className="px-3"
              >
                {isListening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !chatLoading) void handleSendMessage();
                }}
                placeholder={isListening ? "استمع..." : "اكتب سؤالك هنا أو اضغط 🎤"}
                disabled={chatLoading || isListening}
              />
              <Button
                onClick={() => void handleSendMessage()}
                disabled={chatLoading || !chatInput.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Orchestrate dialog */}
      <Dialog open={orchestrateOpen} onOpenChange={setOrchestrateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تشغيل سير عمل (Orchestration)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="workflow-select">اختر سير العمل</Label>
              <select
                id="workflow-select"
                value={orchestrateWorkflow}
                onChange={(e) => setOrchestrateWorkflow(e.target.value)}
                className="w-full p-2 rounded border mt-1 bg-background"
              >
                <option value="full-sweep">فحص شامل (full-sweep) — 6 وكلاء بالتوالي</option>
                <option value="qa-fail-recovery">استعادة فشل QA (qa → server-monitor → manager)</option>
                <option value="session-start">بدء الجلسة (update-manager → backup)</option>
                <option value="session-end">نهاية الجلسة (backup → manager)</option>
              </select>
            </div>
            <div className="text-xs p-2 bg-blue-50 dark:bg-blue-950 rounded">
              سيتم تشغيل الوكلاء بالترتيب — كل وكيل يمكنه التفاعل مع نتيجة سابقه (مثال: إذا فشل QA، يحاول server-monitor إعادة التشغيل).
            </div>
            {orchestrateResults && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">النتائج:</div>
                {orchestrateResults.results?.map((r: any, i: number) => (
                  <div
                    key={i}
                    className={`p-2 rounded text-xs ${
                      r.report.success
                        ? "bg-green-50 dark:bg-green-950"
                        : "bg-red-50 dark:bg-red-950"
                    }`}
                  >
                    <span className="font-mono">{r.agentId}</span>: {r.report.summary}
                    <div className="text-[10px] text-muted-foreground">
                      {r.report.durationMs}ms
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrchestrateOpen(false)}>
              إغلاق
            </Button>
            <Button onClick={() => void runOrchestration()} disabled={orchestrateLoading}>
              {orchestrateLoading ? (
                <><Loader2 className="h-4 w-4 ml-2 animate-spin" /> يعمل...</>
              ) : (
                <><Workflow className="h-4 w-4 ml-2" /> شغّل</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Summary card =====
function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card className="p-4 flex items-center justify-between">
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </div>
      <div className={`h-3 w-3 rounded-full ${color}`} />
    </Card>
  );
}

// ===== Agent card =====
function AgentCard({
  agent,
  reports,
  running,
  onRun,
  onToggle,
  onEdit,
  onAddTask,
  onRemoveTask,
}: {
  agent: Agent;
  reports: AgentReport[];
  running: boolean;
  onRun: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onAddTask: (text: string) => void;
  onRemoveTask: (taskId: string) => void;
}) {
  const Icon = ICONS[agent.icon] ?? Activity;
  const [showTasks, setShowTasks] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");

  return (
    <Card className="p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
            <Icon className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <div className="font-bold">{agent.name}</div>
            <div className="text-xs text-muted-foreground">{agent.nameEn}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[agent.status]}`} />
          <span className="text-xs text-muted-foreground">
            {STATUS_LABELS[agent.status]}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
        {agent.description}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-1 text-xs mb-3">
        <Stat label="تشغيلات" value={agent.stats.runsTotal} />
        <Stat label="أخطاء" value={agent.stats.errorsTotal} />
        <Stat
          label="كل"
          value={agent.schedule > 0 ? `${agent.schedule}s` : "يدوي"}
        />
      </div>

      {/* Last report */}
      {agent.lastReport && (
        <div className="text-xs p-2 bg-gray-50 dark:bg-gray-900 rounded mb-3 line-clamp-2">
          <span className="font-semibold">آخر تقرير: </span>
          {agent.lastReport}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1 mb-2">
        <Button size="sm" variant="default" onClick={onRun} disabled={running}>
          {running ? (
            <Loader2 className="h-3 w-3 ml-1 animate-spin" />
          ) : (
            <Play className="h-3 w-3 ml-1" />
          )}
          تشغيل
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="h-3 w-3 ml-1" /> تعديل
        </Button>
        <Button
          size="sm"
          variant={agent.enabled ? "destructive" : "default"}
          onClick={onToggle}
        >
          {agent.enabled ? "تعطيل" : "تنشيط"}
        </Button>
      </div>

      {/* Tasks section */}
      <div className="mt-2 border-t pt-2">
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => setShowTasks(!showTasks)}
        >
          {showTasks ? "▼" : "▶"} المهام ({agent.tasks.length})
        </button>
        {showTasks && (
          <div className="mt-2 space-y-1">
            {agent.tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between text-xs p-1 bg-gray-50 dark:bg-gray-900 rounded"
              >
                <span className={task.enabled ? "" : "text-muted-foreground line-through"}>
                  {task.text}
                </span>
                <button
                  onClick={() => onRemoveTask(task.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="flex gap-1 mt-2">
              <Input
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                placeholder="أضف مهمة جديدة..."
                className="text-xs h-7"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onAddTask(newTaskText);
                  setNewTaskText("");
                }}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Recent reports */}
      {reports.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <div className="text-xs font-semibold mb-1">التقارير الأخيرة</div>
          {reports.slice(0, 2).map((r, i) => (
            <div
              key={i}
              className="text-xs p-1.5 bg-gray-50 dark:bg-gray-900 rounded mb-1"
            >
              <div className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${r.success ? "bg-green-500" : "bg-red-500"}`} />
                <span className="line-clamp-1">{r.summary}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {new Date(r.generatedAt).toLocaleString("ar-SA")} • {r.durationMs}ms
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center p-1 bg-gray-50 dark:bg-gray-900 rounded">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

// ===== Edit dialog =====
function EditAgentDialog({
  agent,
  onClose,
  onSave,
}: {
  agent: Agent;
  onClose: () => void;
  onSave: (patch: Partial<Agent>) => void;
}) {
  const [description, setDescription] = useState(agent.description);
  const [schedule, setSchedule] = useState(agent.schedule);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل: {agent.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="description">الوصف (يحدد سلوك الوكيل)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <div>
            <Label htmlFor="schedule">جدول التشغيل (ثوانٍ بين كل تشغيل تلقائي)</Label>
            <Input
              id="schedule"
              type="number"
              value={schedule}
              onChange={(e) => setSchedule(Number(e.target.value))}
              min={0}
              max={86400}
            />
            <p className="text-xs text-muted-foreground mt-1">
              0 = يدوي فقط، 30 = كل 30 ثانية، 600 = كل 10 دقائق
            </p>
          </div>
          <div className="text-xs p-2 bg-blue-50 dark:bg-blue-950 rounded">
            عند الحفظ، سيُعدّل الوكيل سلوكه تلقائياً وفقاً للتعديلات الجديدة.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={() => onSave({ description, schedule })}
          >
            حفظ التعديلات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
