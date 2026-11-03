"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * /repair — إصلاح واستعادة بنقرة واحدة (من الهاتف).
 *
 * Owner request 2026-11-02: "أريد زر أو طريقة لتنشيط المشروع وفتح المعاينة
 * واستعادة المحذوف عن طريق الهاتف". This page is the phone-friendly entry:
 *   • /api/proxy/health-check — فحص كل المكونات
 *   • /api/proxy/self-heal    — إصلاح شامل: استعادة + نماذج + بناء + تشغيل
 *   • polls through the restart (connection errors are EXPECTED while the
 *     server reboots — keep polling until it answers again)
 */

type Component = { ok: boolean; note?: string };
type Status = {
  ok: boolean;
  components?: Record<string, Component & { note?: string }>;
  repairStats?: { lastRepairAt: string | null; totalRepairs: number; lastResult: string | null; lastDurationSec?: number };
  repairRunning?: boolean;
  logTail?: string[];
};

const LABELS: Record<string, string> = {
  server: "السيرفر",
  swapService: "خدمة تبديل الوجوه",
  criticalFiles: "الملفات الحرجة",
  build: "البناء المترجم",
  db: "قاعدة البيانات",
  storage: "مجلدات التخزين",
  resources: "القرص والذاكرة",
};

export default function RepairPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/proxy/health-check", { cache: "no-store" });
      if (r.ok) {
        const d: Status = await r.json();
        setStatus(d);
        return d;
      }
    } catch {
      /* server restarting — caller keeps polling */
    }
    return null;
  }, []);

  const loadProgress = useCallback(async () => {
    try {
      const r = await fetch("/api/proxy/self-heal", { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setLog(d.logTail ?? []);
        return d;
      }
    } catch {
      /* expected during restart */
    }
    return null;
  }, []);

  useEffect(() => {
    load();
    loadProgress();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load, loadProgress]);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    let failures = 0;
    pollRef.current = setInterval(async () => {
      try {
        const d = await loadProgress();
        const tail = (d?.logTail ?? []).join(" ");
        if (tail.includes("REPAIR-DONE")) {
          setPhase("done");
          setMsg("✅ اكتمل الإصلاح والسيرفر يعمل — افتح المعاينة الآن");
          if (pollRef.current) clearInterval(pollRef.current);
          load();
          return;
        }
        if (tail.includes("REPAIR-FAILED")) {
          setPhase("failed");
          setMsg("⚠ انتهى الإصلاح بمشاكل — راجع السجل وحاول مرة أخرى");
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
      } catch {
        failures++; // server restarting — expected
      }
      if (failures > 90) {
        setPhase("failed");
        setMsg("⚠ انقطع الاتصال لمدة طويلة — أعد تحميل الصفحة بعد دقيقة");
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 4000);
  }, [loadProgress, load]);

  const repair = async () => {
    setPhase("running");
    setMsg("⏳ جاري الإصلاح الشامل: استعادة الملفات ← النماذج ← البناء ← إعادة التشغيل…");
    try {
      const r = await fetch("/api/proxy/self-heal", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.status === 403) {
        setPhase("failed");
        setMsg("🔒 سجّل الدخول بحساب المالك أولاً ثم أعد المحاولة");
        return;
      }
      setMsg(d.message ?? "بدأ الإصلاح…");
      startPolling();
    } catch {
      setPhase("failed");
      setMsg("تعذر الاتصال — تأكد أن السيرفر يعمل ثم أعد المحاولة");
    }
  };

  const st = status?.components ?? {};
  const stats = status?.repairStats;
  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })
      : "لم يُنفّذ إصلاح بعد";

  const chip = (ok: boolean | undefined, label: string, note?: string) => (
    <div
      className={`rounded-xl px-4 py-3 text-sm ${
        ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
      }`}
    >
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-bold">{ok === undefined ? "…" : ok ? "سليم ✓" : "مشكلة ✗"}</span>
      </div>
      {note && <p className="mt-1 text-xs opacity-80">{note}</p>}
    </div>
  );

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-8" dir="rtl">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="text-center space-y-1">
          <h1 className="text-2xl font-bold">🛠️ إصلاح واستعادة المشروع</h1>
          <p className="text-sm text-muted-foreground">
            فحص شامل + استعادة الملفات المحذوفة والنماذج + إعادة البناء والتشغيل
          </p>
        </header>

        <section className="space-y-2">
          {chip(st.server?.ok, LABELS.server, st.server?.note)}
          {chip(st.criticalFiles?.ok, LABELS.criticalFiles, st.criticalFiles?.note)}
          {chip(st.build?.ok, LABELS.build, st.build?.note)}
          {chip(st.swapService?.ok, LABELS.swapService, st.swapService?.note)}
          {chip(st.db?.ok, LABELS.db, st.db?.note)}
          {chip(st.storage?.ok, LABELS.storage, st.storage?.note)}
          {chip(st.resources?.ok, LABELS.resources, st.resources?.note)}
        </section>

        {stats && (
          <section className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <p>
              📊 <b>آخر إصلاح:</b> {fmtDate(stats.lastRepairAt)}
              {stats.lastResult ? ` — ${stats.lastResult === "success" ? "ناجح ✓" : "بمشاكل ⚠"}` : ""}
            </p>
            <p className="mt-1">
              عدد مرات الإصلاح: <b>{stats.totalRepairs ?? 0}</b>
              {stats.lastDurationSec ? ` — مدة آخر إصلاح: ${stats.lastDurationSec} ثانية` : ""}
            </p>
          </section>
        )}

        {phase === "running" && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center text-sm text-amber-400">
            <p className="font-bold">{msg}</p>
            <p className="mt-1 text-xs">أبقِ هذه الصفحة مفتوحة — قد يستغرق البناء 2-4 دقائق</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-500/20">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-500" />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-center">
            <p className="text-sm font-bold text-emerald-400">{msg}</p>
            <Link
              href="/"
              className="mt-3 inline-block rounded-xl bg-gradient-to-l from-cyan-500 to-blue-500 px-6 py-3 font-bold text-white"
            >
              🏠 فتح المعاينة الرئيسية
            </Link>
          </div>
        )}

        {phase === "failed" && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {msg}
          </div>
        )}

        {phase === "idle" && msg && <p className="text-center text-sm">{msg}</p>}

        <div className="grid grid-cols-1 gap-3">
          {phase !== "running" && (
            <button
              onClick={repair}
              className="rounded-2xl bg-gradient-to-l from-cyan-500 to-blue-500 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-cyan-500/25 active:scale-95"
            >
              🛠️ إصلاح شامل واستعادة + إعادة تشغيل
            </button>
          )}
          <button
            onClick={() => load()}
            className="rounded-2xl border border-border px-6 py-3 font-bold active:scale-95"
          >
            🔍 تحديث الفحص
          </button>
        </div>

        {log.length > 0 && (
          <section className="rounded-xl border border-border bg-black/30 p-3">
            <h2 className="mb-2 text-xs font-bold text-muted-foreground">سجل الإصلاح (آخر الأسطر)</h2>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground" dir="rtl">
              {log.join("\n")}
            </pre>
          </section>
        )}

        <p className="text-center text-xs text-muted-foreground">
          إذا كانت هذه الصفحة تُفتح فالسيرفر يعمل — وإن كانت الشاشة فارغة في الصفحات
          الأخرى فهذا الإصلاح يعيد بناءها وتشغيلها.
        </p>
      </div>
    </main>
  );
}
