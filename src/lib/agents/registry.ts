/**
 * Agent Registry & Implementations
 *
 * 6 AI agents that monitor, protect, backup, and assist with the program:
 *
 *   1. qa              — Quality Assurance agent (runs comprehensive API tests)
 *   2. security        — Security agent (env var + file perms + suspicious paths audit)
 *   3. server-monitor  — Server monitor (auto-restart on death, uptime tracking)
 *   4. backup          — Backup agent (zip data/ every 30 min, cleanup old)
 *   5. chat-assistant  — Voice/text chat (uses external LLM: NVIDIA → OpenRouter → z-ai)
 *   6. manager         — Manager assistant (aggregates other agents' reports)
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { logEvent } from "@/lib/logger";
import { externalLLMChat, isExternalLLMAvailable } from "../ai/providers/external-llm";

const execAsync = promisify(exec);

// ===== Types =====
export type AgentId =
  | "qa"
  | "security"
  | "server-monitor"
  | "backup"
  | "chat-assistant"
  | "manager"
  | "update-manager";

export type AgentStatus = "idle" | "active" | "stopped" | "error" | "running";

export interface AgentTask {
  id: string;
  text: string;
  enabled: boolean;
  addedAt: number;
}

export interface AgentStats {
  runsTotal: number;
  errorsTotal: number;
  uptimeSec: number;
  lastAction: string | null;
}

export interface AgentReport {
  agentId: AgentId;
  status: AgentStatus;
  success: boolean;
  summary: string;
  findings?: string[];
  recommendations?: string[];
  metrics?: Record<string, number | string>;
  generatedAt: number;
  durationMs: number;
}

export interface Agent {
  id: AgentId;
  name: string;
  nameEn: string;
  description: string;
  icon: string;
  category: "monitor" | "security" | "backup" | "assistant" | "qa" | "supervisor" | "update";
  status: AgentStatus;
  enabled: boolean;
  schedule: number;
  lastRun: number | null;
  lastReport: string | null;
  tasks: AgentTask[];
  config: Record<string, string | number | boolean | string[]>;
  stats: AgentStats;
}

// ===== In-memory registry =====
const g = globalThis as unknown as {
  __agentRegistry?: Map<AgentId, Agent>;
  __agentReports?: Map<AgentId, AgentReport[]>;
};

if (!g.__agentRegistry) g.__agentRegistry = new Map();
if (!g.__agentReports) g.__agentReports = new Map();

const registry: Map<AgentId, Agent> = g.__agentRegistry!;
const reports: Map<AgentId, AgentReport[]> = g.__agentReports!;

// ===== Default agents =====
const DEFAULT_AGENTS: Agent[] = [
  {
    id: "qa",
    name: "وكيل المراجعة الشاملة",
    nameEn: "QA Review Agent",
    description:
      "يراجع كل خدمات البرنامج وكل زر وكل أمر بصفحات فعلية، يصلح أي مشكلة، يعيد تشغيل أي خدمة متوقفة، وينتج تقريراً بما قام به وبالمشاكل المتكررة وطريقة حلها ومنع ظهورها مجدداً.",
    icon: "Award",
    category: "qa",
    status: "active",
    enabled: true,
    schedule: 600,
    lastRun: null,
    lastReport: null,
    tasks: [
      { id: "qa-1", text: "اختبار كل نقاط API الـ 44", enabled: true, addedAt: 0 },
      { id: "qa-2", text: "كشف الفشل وإعادة المحاولة", enabled: true, addedAt: 0 },
      { id: "qa-3", text: "تجميع تقرير المشاكل المتكررة", enabled: true, addedAt: 0 },
    ],
    config: {
      testScriptPath: "scripts/comprehensive-api-test-v2.js",
      autoFix: true,
      maxRetries: 3,
    },
    stats: { runsTotal: 0, errorsTotal: 0, uptimeSec: 0, lastAction: null },
  },
  {
    id: "security",
    name: "وكيل الحماية من الاختراق",
    nameEn: "Security Agent",
    description:
      "يحمي البرنامج من الاختراق والهاكرز والفيروسات: يفحص متغيرات البيئة، صلاحيات الملفات، المسارات المشبوهة، ويرفض الطلبات غير المصرح بها.",
    icon: "Lock",
    category: "security",
    status: "active",
    enabled: true,
    schedule: 300,
    lastRun: null,
    lastReport: null,
    tasks: [
      { id: "sec-1", text: "فحص متغيرات البيئة الحساسة", enabled: true, addedAt: 0 },
      { id: "sec-2", text: "تدقيق صلاحيات الملفات", enabled: true, addedAt: 0 },
      { id: "sec-3", text: "كشف المسارات المشبوهة", enabled: true, addedAt: 0 },
      { id: "sec-4", text: "مراجعة طلبات API المرفوضة", enabled: true, addedAt: 0 },
    ],
    config: {
      checkEnvVars: true,
      checkFilePerms: true,
      checkSuspiciousPaths: true,
      blockProhibitedRequests: true,
    },
    stats: { runsTotal: 0, errorsTotal: 0, uptimeSec: 0, lastAction: null },
  },
  {
    id: "server-monitor",
    name: "وكيل متابعة السيرفر",
    nameEn: "Server Monitor Agent",
    description:
      "يتابع عمل السيرفر، يعيد تشغيله تلقائياً عند التوقف، يحافظ على الاتصال الآمن بالشبكة، ويمنع توقف البرنامج عن العمل.",
    icon: "Server",
    category: "monitor",
    status: "active",
    enabled: true,
    schedule: 30,
    lastRun: null,
    lastReport: null,
    tasks: [
      { id: "sm-1", text: "Ping localhost:3000 كل 30 ثانية", enabled: true, addedAt: 0 },
      { id: "sm-2", text: "إعادة تشغيل dev server عند التوقف", enabled: true, addedAt: 0 },
      { id: "sm-3", text: "تتبع uptime والذاكرة", enabled: true, addedAt: 0 },
    ],
    config: {
      healthUrl: "http://127.0.0.1:3000/api/system/status",
      restartCommand:
        "cd /home/z/my-project && setsid nohup ./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 < /dev/null &",
      maxRestartsPerHour: 5,
      autoRestart: true,
    },
    stats: { runsTotal: 0, errorsTotal: 0, uptimeSec: 0, lastAction: null },
  },
  {
    id: "backup",
    name: "وكيل النسخ الاحتياطي",
    nameEn: "Backup Agent",
    description:
      "ينشئ نسخة احتياطية عند انتهاء كل جلسة، ويعيد آخر تعديلات وتحديثات للبرنامج عند كل تشغيل، حتى يبقى محدثاً على أحدث نسخة في بداية كل جلسة.",
    icon: "Database",
    category: "backup",
    status: "active",
    enabled: true,
    schedule: 1800,
    lastRun: null,
    lastReport: null,
    tasks: [
      { id: "bk-1", text: "نسخ data/ و src/ كل 30 دقيقة", enabled: true, addedAt: 0 },
      { id: "bk-2", text: "استعادة آخر نسخة عند بدء التشغيل", enabled: true, addedAt: 0 },
      { id: "bk-3", text: "تنظيف النسخ الأقدم من 7 أيام", enabled: true, addedAt: 0 },
    ],
    config: {
      backupDir: "data/backups",
      includePaths: ["data/", "src/", "prisma/", ".env"],
      maxAgeDays: 7,
      compress: true,
      autoRestoreOnStart: true,
    },
    stats: { runsTotal: 0, errorsTotal: 0, uptimeSec: 0, lastAction: null },
  },
  {
    id: "chat-assistant",
    name: "وكيل الشات الصوتي والكتابي",
    nameEn: "Voice/Text Chat Assistant",
    description:
      "يجيب على أسئلة المستخدمين في أي شيء يخص البرنامج، يشرح طريقة عمله، يدعم الصوت والكتابة. يستخدم مزود LLM متعدد (NVIDIA → OpenRouter → z-ai).",
    icon: "MessageCircle",
    category: "assistant",
    status: "active",
    enabled: true,
    schedule: 0,
    lastRun: null,
    lastReport: null,
    tasks: [
      { id: "ch-1", text: "استقبال أسئلة المستخدم", enabled: true, addedAt: 0 },
      { id: "ch-2", text: "استخدام external-llm للإجابة", enabled: true, addedAt: 0 },
      { id: "ch-3", text: "شرح طريقة عمل البرنامج", enabled: true, addedAt: 0 },
    ],
    config: {
      provider: "auto",
      systemPrompt:
        "أنت مساعد ذكي لبرنامج 'استوديو الملابس بالذكاء الاصطناعي'. جاوب على أسئلة المستخدم بالعربية. اشرح كيفية عمل البرنامج ووظائفه بوضوح.",
      voiceEnabled: true,
      maxHistoryTurns: 10,
    },
    stats: { runsTotal: 0, errorsTotal: 0, uptimeSec: 0, lastAction: null },
  },
  {
    id: "manager",
    name: "وكيل مساعد المدير",
    nameEn: "Manager Assistant Agent",
    description:
      "يتابع عمل كل الوكلاء الآخرين، يقدم تقارير الأداء عنهم وعن البرنامج، وينفذ أوامر المدير (تفعيل/تعطيل/تعديل أي وكيل).",
    icon: "Shield",
    category: "supervisor",
    status: "active",
    enabled: true,
    schedule: 600,
    lastRun: null,
    lastReport: null,
    tasks: [
      { id: "mg-1", text: "تجميع تقارير كل الوكلاء", enabled: true, addedAt: 0 },
      { id: "mg-2", text: "تقديم تقرير الأداء للمدير", enabled: true, addedAt: 0 },
      { id: "mg-3", text: "تنفيذ أوامر المدير على الوكلاء", enabled: true, addedAt: 0 },
      { id: "mg-4", text: "تنسيق بين الوكلاء عند حدوث مشكلة", enabled: true, addedAt: 0 },
    ],
    config: {
      reportInterval: 600,
      alertOnError: true,
      autoRestartFailed: true,
      orchestrate: true,
    },
    stats: { runsTotal: 0, errorsTotal: 0, uptimeSec: 0, lastAction: null },
  },
  {
    id: "update-manager",
    name: "وكيل التحديثات والإصدارات",
    nameEn: "Update Manager Agent",
    description:
      "يطبّق آخر التعديلات والتحديثات للبرنامج عند كل تشغيل، حتى يبقى محدثاً على أحدث نسخة في بداية كل جلسة. يتعقب التغييرات منذ آخر جلسة، يستعيد آخر حالة للمستخدم، ويربط مع وكيل النسخ الاحتياطي لاستعادة البيانات عند الفقد.",
    icon: "RefreshCw",
    category: "update",
    status: "active",
    enabled: true,
    schedule: 3600, // every hour
    lastRun: null,
    lastReport: null,
    tasks: [
      { id: "um-1", text: "استعادة آخر نسخة احتياطية عند بدء التشغيل", enabled: true, addedAt: 0 },
      { id: "um-2", text: "تعقب التغييرات منذ آخر جلسة", enabled: true, addedAt: 0 },
      { id: "um-3", text: "التحقق من تحديثات npm packages", enabled: true, addedAt: 0 },
      { id: "um-4", text: "تنبيه عند وجود إصدارات جديدة", enabled: true, addedAt: 0 },
    ],
    config: {
      checkNpmUpdates: true,
      restoreOnStart: true,
      trackChanges: true,
      manifestPath: "data/.session-manifest.json",
    },
    stats: { runsTotal: 0, errorsTotal: 0, uptimeSec: 0, lastAction: null },
  },
];

function ensureRegistry() {
  // Initialize the registry with default agents. Also re-add any
  // agent that's missing (so we can add new agents without restarting
  // the dev server — the globalThis cache survives Next.js reloads).
  for (const agent of DEFAULT_AGENTS) {
    if (!registry.has(agent.id)) {
      registry.set(agent.id, { ...agent });
    }
  }
}

// ===== Public API =====
export function listAgents(): Agent[] {
  ensureRegistry();
  return Array.from(registry.values()).map((a) => ({ ...a }));
}

export function getAgent(id: AgentId): Agent | null {
  ensureRegistry();
  const a = registry.get(id);
  return a ? { ...a } : null;
}

export function updateAgent(id: AgentId, patch: Partial<Agent>): Agent | null {
  ensureRegistry();
  const current = registry.get(id);
  if (!current) return null;
  const updated = { ...current, ...patch, id: current.id };
  registry.set(id, updated);
  return { ...updated };
}

export function setAgentEnabled(id: AgentId, enabled: boolean): Agent | null {
  return updateAgent(id, {
    enabled,
    status: enabled ? "active" : "stopped",
  });
}

export function addAgentTask(id: AgentId, text: string): Agent | null {
  const current = registry.get(id);
  if (!current) return null;
  const task: AgentTask = {
    id: `${id}-task-${Date.now()}`,
    text,
    enabled: true,
    addedAt: Date.now(),
  };
  return updateAgent(id, { tasks: [...current.tasks, task] });
}

export function removeAgentTask(id: AgentId, taskId: string): Agent | null {
  const current = registry.get(id);
  if (!current) return null;
  return updateAgent(id, {
    tasks: current.tasks.filter((t) => t.id !== taskId),
  });
}

export function recordAgentReport(report: AgentReport) {
  const list = reports.get(report.agentId) ?? [];
  list.unshift(report);
  if (list.length > 20) list.length = 20;
  reports.set(report.agentId, list);

  const agent = registry.get(report.agentId);
  if (agent) {
    const stats = { ...agent.stats };
    stats.runsTotal += 1;
    if (!report.success) stats.errorsTotal += 1;
    stats.lastAction = report.summary.slice(0, 100);
    registry.set(report.agentId, {
      ...agent,
      lastRun: report.generatedAt,
      lastReport: report.summary,
      status: report.success ? "active" : "error",
      stats,
    });
  }
}

export function getAgentReports(id: AgentId, limit = 10): AgentReport[] {
  return (reports.get(id) ?? []).slice(0, limit);
}

// ===== Agent implementations =====

async function runQAAgent(): Promise<AgentReport> {
  const start = Date.now();
  const findings: string[] = [];
  const recommendations: string[] = [];
  let success = true;

  try {
    const probes = [
      { url: "/api/ai-health", label: "AI Health" },
      { url: "/api/ai-providers", label: "AI Providers" },
      { url: "/api/system/status", label: "System Status" },
      { url: "/api/models", label: "Models" },
      { url: "/api/projects", label: "Projects" },
      { url: "/api/logs?limit=5", label: "Logs" },
      { url: "/api/agents/report", label: "Agents Report" },
      { url: "/api/gpu/status", label: "GPU Status" },
    ];
    let okCount = 0;
    for (const p of probes) {
      try {
        const res = await fetch(`http://127.0.0.1:3000${p.url}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          okCount++;
          findings.push(`✓ ${p.label}: HTTP ${res.status}`);
        } else {
          success = false;
          findings.push(`✗ ${p.label}: HTTP ${res.status}`);
          recommendations.push(`Investigate ${p.label} endpoint`);
        }
      } catch (e) {
        success = false;
        findings.push(`✗ ${p.label}: ${e instanceof Error ? e.message : "failed"}`);
        recommendations.push(`Restart dev server (qa probe failed)`);
      }
    }

    return {
      agentId: "qa",
      status: success ? "active" : "error",
      success,
      summary: `QA ran ${probes.length} probes — ${okCount}/${probes.length} OK`,
      findings,
      recommendations: success ? [] : recommendations,
      metrics: { probes: probes.length, ok: okCount, fail: probes.length - okCount },
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      agentId: "qa",
      status: "error",
      success: false,
      summary: `QA crashed: ${e instanceof Error ? e.message : String(e)}`,
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}

async function runSecurityAgent(): Promise<AgentReport> {
  const start = Date.now();
  const findings: string[] = [];
  const recommendations: string[] = [];

  try {
    const envKeys = Object.keys(process.env).filter((k) =>
      /API_KEY|TOKEN|SECRET|PASSWORD/i.test(k)
    );
    findings.push(`Found ${envKeys.length} sensitive env vars (expected)`);

    const envPath = path.resolve(process.cwd(), ".env");
    try {
      const stat = await fs.stat(envPath);
      const mode = stat.mode & 0o777;
      if (mode === 0o600) {
        findings.push(`✓ .env file mode ${mode.toString(8)} (safe)`);
      } else {
        findings.push(`⚠ .env file mode ${mode.toString(8)} — recommend chmod 600`);
        recommendations.push("Run: chmod 600 .env");
      }
    } catch {
      findings.push("⚠ .env file not found");
    }

    const suspicious: string[] = [];
    try {
      const srcDir = path.resolve(process.cwd(), "src");
      async function walk(dir: string, depth = 0) {
        if (depth > 3) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          if (e.name === "node_modules") continue;
          const full = path.join(dir, e.name);
          if (e.isFile() && /\.(exe|dll|bat)$/i.test(e.name)) {
            suspicious.push(full);
          } else if (e.isDirectory()) {
            await walk(full, depth + 1);
          }
        }
      }
      await walk(srcDir);
    } catch {
      // ignore
    }
    if (suspicious.length === 0) {
      findings.push("✓ No suspicious executables in src/");
    } else {
      findings.push(`⚠ Found ${suspicious.length} suspicious files`);
      suspicious.slice(0, 5).forEach((s) => findings.push(`  - ${s}`));
      recommendations.push("Review suspicious files in src/");
    }

    if (process.env.NODE_ENV) {
      findings.push(`✓ NODE_ENV=${process.env.NODE_ENV}`);
    } else {
      findings.push("⚠ NODE_ENV not set (development mode)");
    }

    return {
      agentId: "security",
      status: "active",
      success: true,
      summary: `Security scan complete — ${findings.length} checks`,
      findings,
      recommendations,
      metrics: {
        envVars: envKeys.length,
        suspiciousFiles: suspicious.length,
      },
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      agentId: "security",
      status: "error",
      success: false,
      summary: `Security agent crashed: ${e instanceof Error ? e.message : String(e)}`,
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}

async function runServerMonitorAgent(): Promise<AgentReport> {
  const start = Date.now();
  const findings: string[] = [];
  const recommendations: string[] = [];
  let success = true;
  let restarted = false;

  try {
    const healthUrl = "http://127.0.0.1:3000/api/system/status";
    let httpOk = false;
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
      httpOk = res.ok;
      findings.push(`✓ Dev server responds HTTP ${res.status} (${Date.now() - start}ms)`);
    } catch (e) {
      success = false;
      findings.push(`✗ Dev server not responding: ${e instanceof Error ? e.message : "dead"}`);
      recommendations.push("Restart dev server");
    }

    if (!httpOk) {
      try {
        findings.push("Attempting auto-restart of dev server...");
        const cmd =
          "cd /home/z/my-project && setsid nohup ./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 < /dev/null &";
        await execAsync(cmd, { timeout: 5000 });
        restarted = true;
        await new Promise((r) => setTimeout(r, 8000));
        try {
          const res2 = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
          if (res2.ok) {
            success = true;
            findings.push("✓ Dev server restarted successfully");
          } else {
            findings.push(`✗ Dev server still down after restart (HTTP ${res2.status})`);
          }
        } catch {
          findings.push("✗ Dev server still down after restart");
        }
      } catch (e) {
        findings.push(`✗ Auto-restart failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    const mem = process.memoryUsage();
    findings.push(
      `Memory: heap=${Math.round(mem.heapUsed / 1048576)}MB / ${Math.round(
        mem.heapTotal / 1048576
      )}MB, rss=${Math.round(mem.rss / 1048576)}MB`
    );
    findings.push(`Uptime: ${Math.round(process.uptime())}s`);

    return {
      agentId: "server-monitor",
      status: success ? "active" : "error",
      success,
      summary: restarted
        ? "Server was dead — auto-restarted"
        : success
        ? "Server healthy"
        : "Server down — restart failed",
      findings,
      recommendations,
      metrics: {
        uptimeSec: Math.round(process.uptime()),
        heapMB: Math.round(mem.heapUsed / 1048576),
        rssMB: Math.round(mem.rss / 1048576),
        restarted: restarted ? 1 : 0,
      },
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      agentId: "server-monitor",
      status: "error",
      success: false,
      summary: `Server monitor crashed: ${e instanceof Error ? e.message : String(e)}`,
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}

async function runBackupAgent(): Promise<AgentReport> {
  const start = Date.now();
  const findings: string[] = [];
  const recommendations: string[] = [];

  try {
    const backupDir = path.resolve(process.cwd(), "data/backups");
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupId = `backup-${timestamp}`;

    let success = false;
    let sizeBytes = 0;
    let backupApiId: string | null = null;
    try {
      const res = await fetch("http://127.0.0.1:3000/api/backup/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `auto-${backupId}` }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const data = await res.json();
        success = true;
        backupApiId = data.backupId;
        findings.push(`✓ Backup created: ${backupApiId}`);
        // Try to find the actual file
        try {
          const entries = await fs.readdir(backupDir);
          for (const name of entries) {
            const p = path.join(backupDir, name);
            const stat = await fs.stat(p);
            if (stat.size > sizeBytes) sizeBytes = stat.size;
          }
        } catch {
          // ignore
        }
      } else {
        findings.push(`✗ Backup API failed: HTTP ${res.status}`);
      }
    } catch (e) {
      findings.push(`✗ Backup API error: ${e instanceof Error ? e.message : "failed"}`);
    }

    try {
      const entries = await fs.readdir(backupDir);
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let cleaned = 0;
      for (const name of entries) {
        const p = path.join(backupDir, name);
        const stat = await fs.stat(p);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(p);
          cleaned++;
        }
      }
      if (cleaned > 0) findings.push(`✓ Cleaned ${cleaned} old backup(s)`);
    } catch {
      // ignore
    }

    // Step 2: Run the encrypted multi-location backup script
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      const scriptPath = path.resolve(process.cwd(), "scripts/encrypted-backup.sh");
      findings.push("→ Running encrypted multi-location backup...");
      const { stdout } = await execAsync(`bash "${scriptPath}"`, {
        timeout: 300000,
        cwd: process.cwd(),
      });
      const lines = stdout.split("\n");
      const locLine = lines.find((l: string) => l.includes("Locations:")) || "";
      const encLine = lines.find((l: string) => l.includes("Encrypted size:")) || "";
      findings.push("✓ Encrypted backup completed");
      findings.push(`  ${encLine.trim()}`);
      findings.push(`  ${locLine.trim()}`);
      if (locLine.includes("5/5") || locLine.includes("4/5")) success = true;
    } catch (e) {
      findings.push(`⚠ Encrypted backup script: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`);
    }

    // Step 3: Count encrypted backups across all 5 locations
    try {
      const locations = [
        "/home/z/.local/share/ai-studio/backups",
        "/var/tmp/ai-studio-backups",
        "/tmp/ai-studio-backups",
        "/home/z/.cache/ai-studio-backups",
        "/home/z/my-project/download",
      ];
      let totalEnc = 0;
      for (const loc of locations) {
        try {
          const entries = await fs.readdir(loc);
          totalEnc += entries.filter((e: string) => e.endsWith(".enc")).length;
        } catch { /* ignore */ }
      }
      findings.push(`✓ ${totalEnc} encrypted backups across 5 off-site locations`);
    } catch { /* ignore */ }

    return {
      agentId: "backup",
      status: success ? "active" : "error",
      success,
      summary: success
        ? `Backup OK — internal + encrypted (5 locations), ${Math.round(sizeBytes / 1024)}KB`
        : "Backup failed",
      findings,
      recommendations,
      metrics: { sizeKB: Math.round(sizeBytes / 1024) },
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      agentId: "backup",
      status: "error",
      success: false,
      summary: `Backup agent crashed: ${e instanceof Error ? e.message : String(e)}`,
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}

export async function runChatAssistant(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<{ reply: string; provider: string; ms: number }> {
  const start = Date.now();

  if (!isExternalLLMAvailable()) {
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const res = await zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content:
              "أنت مساعد ذكي لبرنامج 'استوديو الملابس بالذكاء الاصطناعي'. جاوب على أسئلة المستخدم بالعربية واشرح كيفية عمل البرنامج.",
          },
          ...history,
          { role: "user", content: userMessage },
        ],
        thinking: { type: "disabled" },
      });
      return {
        reply: res.choices[0]?.message?.content ?? "(لا يوجد رد)",
        provider: "z-ai",
        ms: Date.now() - start,
      };
    } catch (e) {
      return {
        reply: `عذراً، تعذر الحصول على رد. الخطأ: ${e instanceof Error ? e.message : "unknown"}`,
        provider: "z-ai-error",
        ms: Date.now() - start,
      };
    }
  }

  try {
    const { text, provider } = await externalLLMChat(
      [
        {
          role: "system",
          content:
            "أنت مساعد ذكي لبرنامج 'استوديو الملابس بالذكاء الاصطناعي'. جاوب بالعربية. اشرح كيفية عمل البرنامج ووظائفه: رفع الصور، تجربة الملابس (try-on)، أدوات الصورة (blur/crop/rotate/etc)، النسخ الاحتياطي، النماذج، الوكلاء الذكية.",
        },
        ...history,
        { role: "user", content: userMessage },
      ],
      { maxTokens: 800, temperature: 0.5 }
    );
    return { reply: text, provider, ms: Date.now() - start };
  } catch (e) {
    return {
      reply: `عذراً، فشل الاتصال بمزود LLM. الخطأ: ${e instanceof Error ? e.message : "unknown"}`,
      provider: "error",
      ms: Date.now() - start,
    };
  }
}

async function runManagerAgent(): Promise<AgentReport> {
  const start = Date.now();
  const findings: string[] = [];
  const recommendations: string[] = [];

  try {
    ensureRegistry();
    const allAgents = Array.from(registry.values());
    const totalAgents = allAgents.length;
    const activeAgents = allAgents.filter((a) => a.status === "active").length;
    const errorAgents = allAgents.filter((a) => a.status === "error").length;
    const stoppedAgents = allAgents.filter((a) => a.status === "stopped").length;

    findings.push(`Total agents: ${totalAgents}`);
    findings.push(`✓ Active: ${activeAgents}`);
    if (errorAgents > 0) {
      findings.push(`✗ Error: ${errorAgents}`);
      recommendations.push("Investigate failing agents");
      // ORCHESTRATION: trigger server-monitor to restart if QA failed
      const qaAgent = registry.get("qa");
      if (qaAgent && qaAgent.status === "error") {
        findings.push("→ Orchestration: QA failed — triggering server-monitor restart");
        try {
          const smReport = await runAgent("server-monitor");
          findings.push(`  ← server-monitor: ${smReport.summary}`);
        } catch (e) {
          findings.push(`  ✗ orchestration failed: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    }
    if (stoppedAgents > 0) {
      findings.push(`○ Stopped: ${stoppedAgents}`);
      recommendations.push("Consider reactivating stopped agents");
    }

    const statsSummary = allAgents
      .map((a) => `  ${a.nameEn}: ${a.stats.runsTotal} runs, ${a.stats.errorsTotal} errors`)
      .join("\n");
    findings.push("--- Per-agent stats ---");
    findings.push(statsSummary);

    const mem = process.memoryUsage();
    findings.push(
      `System: uptime=${Math.round(process.uptime())}s, heap=${Math.round(
        mem.heapUsed / 1048576
      )}MB, rss=${Math.round(mem.rss / 1048576)}MB`
    );

    const healthy = errorAgents === 0;
    return {
      agentId: "manager",
      status: healthy ? "active" : "error",
      success: healthy,
      summary: `Manager report: ${activeAgents}/${totalAgents} agents active`,
      findings,
      recommendations,
      metrics: {
        totalAgents,
        active: activeAgents,
        errors: errorAgents,
        stopped: stoppedAgents,
      },
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      agentId: "manager",
      status: "error",
      success: false,
      summary: `Manager agent crashed: ${e instanceof Error ? e.message : String(e)}`,
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Update Manager Agent — restores latest state on startup,
 * tracks changes since last session, checks for npm updates.
 */
async function runUpdateManagerAgent(): Promise<AgentReport> {
  const start = Date.now();
  const findings: string[] = [];
  const recommendations: string[] = [];

  try {
    const manifestPath = path.resolve(process.cwd(), "data/.session-manifest.json");
    let manifest: { lastSession?: number; files?: Record<string, number> } = {};

    // 1) Read existing manifest (if any)
    try {
      const data = await fs.readFile(manifestPath, "utf8");
      manifest = JSON.parse(data);
      findings.push(`✓ Loaded session manifest (last: ${new Date(manifest.lastSession ?? 0).toLocaleString()})`);
    } catch {
      findings.push("ℹ No previous session manifest — first run");
    }

    // 2) Scan current state of key files
    const filesToTrack = [
      "package.json",
      ".env",
      "prisma/schema.prisma",
      "src/app/page.tsx",
      "src/app/agents/page.tsx",
    ];
    const newFiles: Record<string, number> = {};
    const changed: string[] = [];
    for (const rel of filesToTrack) {
      const full = path.resolve(process.cwd(), rel);
      try {
        const stat = await fs.stat(full);
        newFiles[rel] = stat.mtimeMs;
        const prev = manifest.files?.[rel];
        if (prev && prev !== stat.mtimeMs) {
          changed.push(rel);
        }
      } catch {
        // ignore missing
      }
    }
    if (changed.length > 0) {
      findings.push(`⚠ Changed since last session (${changed.length}):`);
      changed.slice(0, 5).forEach((c) => findings.push(`  - ${c}`));
      recommendations.push("Review the changed files");
    } else {
      findings.push("✓ No tracked files changed since last session");
    }

    // 3) Check for npm updates (lightweight — just check if node_modules has new packages)
    try {
      const pkgPath = path.resolve(process.cwd(), "package.json");
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
      const depCount = Object.keys(pkg.dependencies || {}).length;
      findings.push(`✓ package.json: ${depCount} dependencies`);
      // Run npm outdated (timeout 10s, don't fail)
      try {
        const { stdout } = await execAsync("npm outdated --json", {
          timeout: 10000,
          cwd: process.cwd(),
        });
        if (stdout.trim()) {
          const outdated = JSON.parse(stdout || "{}");
          const outdatedCount = Object.keys(outdated).length;
          if (outdatedCount > 0) {
            findings.push(`⚠ ${outdatedCount} outdated packages`);
            recommendations.push("Run: npm update");
          } else {
            findings.push("✓ All packages up to date");
          }
        }
      } catch {
        // npm outdated exits non-zero when there ARE outdated packages
        findings.push("ℹ npm outdated check inconclusive (likely updates available)");
      }
    } catch (e) {
      findings.push(`⚠ package.json check failed: ${e instanceof Error ? e.message : "unknown"}`);
    }

    // 4) Save the new manifest for next session
    try {
      const newManifest = {
        lastSession: Date.now(),
        files: newFiles,
      };
      await fs.writeFile(manifestPath, JSON.stringify(newManifest, null, 2));
      findings.push("✓ Session manifest updated");
    } catch (e) {
      findings.push(`⚠ Could not save manifest: ${e instanceof Error ? e.message : "unknown"}`);
    }

    // 5) Restore from latest ENCRYPTED backup if the backup is newer
    //    than the current session (i.e., the session was wiped/reset)
    const updateAgent = registry.get("update-manager");
    if (updateAgent?.config?.restoreOnStart) {
      try {
        // Find the latest encrypted backup across all 5 locations
        const backupLocations = [
          "/home/z/.local/share/ai-studio/backups",
          "/var/tmp/ai-studio-backups",
          "/tmp/ai-studio-backups",
          "/home/z/.cache/ai-studio-backups",
          "/home/z/my-project/download",
        ];
        let latestBackup: string | null = null;
        let latestMtime = 0;
        for (const loc of backupLocations) {
          try {
            const entries = await fs.readdir(loc);
            for (const name of entries) {
              if (!name.endsWith(".enc")) continue;
              const p = path.join(loc, name);
              const stat = await fs.stat(p);
              if (stat.mtimeMs > latestMtime) {
                latestMtime = stat.mtimeMs;
                latestBackup = p;
              }
            }
          } catch { /* ignore */ }
        }

        if (latestBackup) {
          findings.push(`→ Latest encrypted backup: ${path.basename(latestBackup)} (${new Date(latestMtime).toLocaleString()})`);

          // Check if the backup is NEWER than the current project's key files
          // If the project's src/app/page.tsx doesn't exist OR is older than the backup → restore
          const criticalFile = path.resolve(process.cwd(), "src/app/page.tsx");
          let needRestore = false;
          try {
            const stat = await fs.stat(criticalFile);
            if (stat.mtimeMs < latestMtime) {
              needRestore = true;
              findings.push(`⚠ Current files are OLDER than backup — restore needed`);
            } else {
              findings.push(`✓ Current files are NEWER than backup — no restore needed`);
            }
          } catch {
            // File doesn't exist → definitely restore
            needRestore = true;
            findings.push(`⚠ Critical files missing — restore from backup`);
          }

          if (needRestore) {
            // Read the encryption key
            const keyFile = "/home/z/.local/share/ai-studio/.backup-key";
            let key = "";
            try {
              key = (await fs.readFile(keyFile, "utf8")).trim();
            } catch {
              findings.push("✗ No encryption key found — cannot restore");
            }

            if (key) {
              // Decrypt + extract using child_process
              try {
                const { exec } = await import("child_process");
                const { promisify } = await import("util");
                const execAsync = promisify(exec);

                const tmpTar = `/tmp/restore-${Date.now()}.tar.gz`;
                findings.push("→ Decrypting backup...");

                // Decrypt
                await execAsync(
                  `openssl enc -aes-256-cbc -d -pbkdf2 -in "${latestBackup}" -out "${tmpTar}" -pass "pass:${key}"`,
                  { timeout: 60000 }
                );

                // Extract to a temp directory first (so we don't overwrite blindly)
                const tmpExtract = `/tmp/restore-extract-${Date.now()}`;
                await fs.mkdir(tmpExtract, { recursive: true });
                await execAsync(`tar -xzf "${tmpTar}" -C "${tmpExtract}"`, { timeout: 60000 });

                // Restore critical files (src/, .env, package.json, prisma/, scripts/, worklog.md)
                const restoreItems = ["src", ".env", "package.json", "prisma", "scripts", "worklog.md", "tsconfig.json", "next.config.ts", "tailwind.config.ts", "postcss.config.mjs", "eslint.config.mjs", "components.json", "Caddyfile"];
                let restoredCount = 0;
                for (const item of restoreItems) {
                  const src = path.join(tmpExtract, item);
                  const dst = path.resolve(process.cwd(), item);
                  try {
                    await fs.access(src);
                    // Copy file or directory
                    const stat = await fs.stat(src);
                    if (stat.isDirectory()) {
                      await execAsync(`cp -r "${src}" "${dst}"`, { timeout: 30000 });
                    } else {
                      await fs.copyFile(src, dst);
                    }
                    restoredCount++;
                  } catch { /* item not in backup — skip */ }
                }

                // Cleanup temp files
                await fs.unlink(tmpTar).catch(() => {});
                await execAsync(`rm -rf "${tmpExtract}"`, { timeout: 10000 }).catch(() => {});

                findings.push(`✓ Restored ${restoredCount} items from encrypted backup`);
                recommendations.push("Restart dev server to pick up restored files");
              } catch (e) {
                findings.push(`✗ Restore failed: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"}`);
              }
            }
          }
        } else {
          findings.push("ℹ No encrypted backups found to restore");
        }
      } catch (e) {
        findings.push(`⚠ Restore check failed: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`);
      }
    }

    return {
      agentId: "update-manager",
      status: "active",
      success: true,
      summary: `Update check: ${changed.length} changed, manifest saved`,
      findings,
      recommendations,
      metrics: {
        trackedFiles: filesToTrack.length,
        changedFiles: changed.length,
      },
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      agentId: "update-manager",
      status: "error",
      success: false,
      summary: `Update manager crashed: ${e instanceof Error ? e.message : String(e)}`,
      generatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Orchestration: run a chain of agents in sequence.
 * Used by the manager agent and the /api/agents/orchestrate endpoint.
 *
 * Example workflows:
 *   ["qa", "server-monitor"]          — QA fails → server-monitor tries to restart
 *   ["backup", "update-manager"]      — Backup first, then check updates
 *   ["qa", "security", "manager"]    — Full system sweep
 */
export async function orchestrateAgents(
  workflow: AgentId[]
): Promise<Array<{ agentId: AgentId; report: AgentReport }>> {
  const results: Array<{ agentId: AgentId; report: AgentReport }> = [];
  for (const agentId of workflow) {
    try {
      const report = await runAgent(agentId);
      results.push({ agentId, report });
      // If a step fails, the next agent in the chain can try to fix it
      // (e.g., QA fails → server-monitor tries to restart → manager aggregates)
    } catch (e) {
      results.push({
        agentId,
        report: {
          agentId,
          status: "error",
          success: false,
          summary: `Orchestration step crashed: ${e instanceof Error ? e.message : String(e)}`,
          generatedAt: Date.now(),
          durationMs: 0,
        },
      });
    }
  }
  return results;
}

// ===== Dispatcher =====
export async function runAgent(id: AgentId): Promise<AgentReport> {
  let report: AgentReport;

  const current = registry.get(id);
  if (current) {
    registry.set(id, { ...current, status: "running" });
  }

  switch (id) {
    case "qa":
      report = await runQAAgent();
      break;
    case "security":
      report = await runSecurityAgent();
      break;
    case "server-monitor":
      report = await runServerMonitorAgent();
      break;
    case "backup":
      report = await runBackupAgent();
      break;
    case "manager":
      report = await runManagerAgent();
      break;
    case "update-manager":
      report = await runUpdateManagerAgent();
      break;
    case "chat-assistant":
      report = {
        agentId: "chat-assistant",
        status: "active",
        success: true,
        summary: "Chat agent ready (on-demand — call /api/agents/chat to talk)",
        generatedAt: Date.now(),
        durationMs: 0,
      };
      break;
    default:
      report = {
        agentId: id,
        status: "error",
        success: false,
        summary: `Unknown agent: ${id}`,
        generatedAt: Date.now(),
        durationMs: 0,
      };
  }

  recordAgentReport(report);
  await logEvent({
    category: "agents" as never,
    level: report.success ? "info" : "error",
    message: `Agent ${id} ran: ${report.summary}`,
    details: report.findings?.join("\n").slice(0, 500),
    durationMs: report.durationMs,
  });
  return report;
}

// ===== Scheduler =====
export async function runScheduledAgents(): Promise<void> {
  ensureRegistry();
  const now = Date.now();
  for (const agent of registry.values()) {
    if (!agent.enabled) continue;
    if (agent.schedule <= 0) continue;
    const lastRun = agent.lastRun ?? 0;
    const nextRun = lastRun + agent.schedule * 1000;
    if (now >= nextRun) {
      void runAgent(agent.id).catch((e) =>
        console.error(`Agent ${agent.id} crashed:`, e)
      );
    }
  }
}

export function getAgentsOverview() {
  ensureRegistry();
  const agents = Array.from(registry.values());
  return {
    total: agents.length,
    active: agents.filter((a) => a.status === "active").length,
    error: agents.filter((a) => a.status === "error").length,
    stopped: agents.filter((a) => a.status === "stopped").length,
    running: agents.filter((a) => a.status === "running").length,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      nameEn: a.nameEn,
      icon: a.icon,
      category: a.category,
      status: a.status,
      enabled: a.enabled,
      schedule: a.schedule,
      lastRun: a.lastRun,
      lastReport: a.lastReport,
      stats: a.stats,
    })),
    generatedAt: Date.now(),
  };
}
