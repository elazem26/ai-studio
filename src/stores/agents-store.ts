"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
export type AgentStatus = "idle" | "active" | "stopped" | "error";
export interface AgentTask { id: string; text: string; enabled: boolean; addedAt: number; }
export interface Agent { id: string; name: string; nameEn: string; description: string; descriptionEn: string; icon: string; category: "monitor" | "security" | "assistant" | "generator" | "supervisor" | "quality"; status: AgentStatus; tasks: AgentTask[]; lastHeartbeat: number | null; stats: { requestsHandled: number; errors: number; uptime: number; lastAction: string | null; }; config: Record<string, string | number | boolean>; }
interface AgentsState { agents: Record<string, Agent>; supervisorRunning: boolean; cleanupOnClose: boolean; setAgentStatus: (id: string, status: AgentStatus) => void; activateAll: () => void; stopAll: () => void; recordAction: (id: string, action: string, isError?: boolean) => void; recordHeartbeat: (id: string) => void; setSupervisorRunning: (v: boolean) => void; setCleanupOnClose: (v: boolean) => void; reset: () => void; }
const mk = (id: string, name: string, nameEn: string, desc: string, descEn: string, icon: string, cat: Agent["category"], tasks: AgentTask[]): Agent => ({ id, name, nameEn, description: desc, descriptionEn: descEn, icon, category: cat, status: "active", tasks, lastHeartbeat: null, stats: { requestsHandled: 0, errors: 0, uptime: 0, lastAction: null }, config: {} });
const DEFAULT_AGENTS: Record<string, Agent> = {
  supervisor: mk("supervisor", "الوكيل المشرف", "Supervisor", "يراقب جميع الوكلاء", "Monitors all agents", "Shield", "supervisor", [{ id: "t1", text: "فحص الوكلاء كل 30 ثانية", enabled: true, addedAt: 0 }]),
  serverMonitor: mk("serverMonitor", "وكيل الخادم", "Server Monitor", "يراقب الخادم", "Monitors server", "Server", "monitor", [{ id: "t1", text: "فحص الخادم كل 15 ثانية", enabled: true, addedAt: 0 }]),
  security: mk("security", "وكيل الأمان", "Security", "يحمي البرنامج", "Protects", "Lock", "security", [{ id: "t1", text: "مراقبة API", enabled: true, addedAt: 0 }]),
  chatAssistant: mk("chatAssistant", "المساعد الذكي", "Chat Assistant", "يجيب أسئلة المستخدم", "Answers questions", "MessageCircle", "assistant", [{ id: "t1", text: "الإجابة عن الأسئلة", enabled: true, addedAt: 0 }]),
  multiResult: mk("multiResult", "النتائج المتعددة", "Multi-Result", "يولد نتائج متعددة", "Multiple results", "Sparkles", "generator", [{ id: "t1", text: "4 نتائج بالتوازي", enabled: true, addedAt: 0 }]),
  monitor: mk("monitor", "مراقب الأداء", "Monitor", "يكتب تقرير الأداء", "Performance reports", "Activity", "monitor", [{ id: "t1", text: "مراقبة كل 60 ثانية", enabled: true, addedAt: 0 }]),
  quality: mk("quality", "وكيل الجودة", "Quality", "ينتج نتائج عالية الجودة", "High quality", "Award", "quality", [{ id: "t1", text: "40 خطوة توليد", enabled: true, addedAt: 0 }]),
};
export const useAgentsStore = create<AgentsState>()(persist((set) => ({
  agents: DEFAULT_AGENTS, supervisorRunning: true, cleanupOnClose: true,
  setAgentStatus: (id, status) => set((s) => ({ agents: { ...s.agents, [id]: { ...s.agents[id], status } } })),
  activateAll: () => set((s) => { const a = { ...s.agents }; for (const id of Object.keys(a)) a[id] = { ...a[id], status: "active" as AgentStatus, lastHeartbeat: Date.now() }; return { agents: a, supervisorRunning: true }; }),
  stopAll: () => set((s) => { const a = { ...s.agents }; for (const id of Object.keys(a)) a[id] = { ...a[id], status: "stopped" as AgentStatus }; return { agents: a, supervisorRunning: false }; }),
  recordAction: (id, action, isError = false) => set((s) => { const a = s.agents[id]; if (!a) return s; return { agents: { ...s.agents, [id]: { ...a, stats: { ...a.stats, requestsHandled: a.stats.requestsHandled + 1, errors: a.stats.errors + (isError ? 1 : 0), lastAction: action } } } }; }),
  recordHeartbeat: (id) => set((s) => { const a = s.agents[id]; if (!a) return s; return { agents: { ...s.agents, [id]: { ...a, lastHeartbeat: Date.now() } } }; }),
  setSupervisorRunning: (v) => set({ supervisorRunning: v }),
  setCleanupOnClose: (v) => set({ cleanupOnClose: v }),
  reset: () => set({ agents: DEFAULT_AGENTS }),
}), { name: "ai-studio-agents", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ cleanupOnClose: s.cleanupOnClose }) }));
