"use client";

import { useEffect, useState } from "react";
import { Download, Github, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * QuickLaunch — the 3 one-click launch buttons (owner spec 2026-10-29):
 *
 *   1. "تشغيل من النظام الحالي"  → opens the running cloud system now.
 *   2. "تشغيل من GitHub"        → creates a GitHub Codespace from the
 *      elazem26/ai-studio repo; the devcontainer auto-installs deps and
 *      auto-starts the server, the browser opens automatically.
 *      Use when the main system is down/hanging.
 *   3. "تشغيل من الكمبيوتر"      → downloads AI-Studio-v5.5.0.tar.gz
 *      (code + db + keys + models + one-click launchers); the user
 *      extracts it and double-clicks START-AI-STUDIO.bat — browser
 *      opens automatically.
 */

const GITHUB_REPO = "elazem26/ai-studio";
// quickstart=1 → creates the Codespace IMMEDIATELY (skips the config
// page + the manual "Create codespace" click). ref=main pins the
// branch. devcontainer then installs deps, starts the server, and the
// browser opens the RUNNING app automatically (openBrowser on :3000).
const CODESPACES_URL = `https://codespaces.new/${GITHUB_REPO}?quickstart=1&ref=main`;

// Public demo owner credentials — displayed on the login page itself.
// Used ONLY to silently authenticate the PC-package download so the
// button works with ZERO messages/steps (owner request 2026-10-29).
const OWNER_LOGIN = { email: "mohamed", password: "1970" };

export function QuickLaunch({ compact = false }: { compact?: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    try {
      setAuthed(!!localStorage.getItem("authToken"));
    } catch { /* ignore */ }
  }, []);

  // Silent login (no UI): uses the public demo owner account so the
  // download works even from the login page without manual login.
  const silentLogin = async (): Promise<string> => {
    let token = "";
    try { token = localStorage.getItem("authToken") || ""; } catch { /* ignore */ }
    if (token) return token;
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(OWNER_LOGIN),
      });
      if (r.ok) {
        const d = await r.json();
        token = d.token || "";
        if (token) {
          try {
            localStorage.setItem("authToken", token);
            localStorage.setItem("userName", d.user?.name || "");
          } catch { /* ignore */ }
          setAuthed(true);
          window.dispatchEvent(new Event("auth-changed"));
        }
      }
    } catch { /* ignore */ }
    return token;
  };

  // ---- 1) current system ----
  const runCurrent = () => {
    // same running system — just go to the app root
    window.location.href = "/";
  };

  // ---- 2) run from GitHub (Codespaces) ----
  // Opens the one-click Codespace creation; the dev container
  // auto-installs, auto-starts the server, and the browser pops open
  // on the RUNNING app. One short line explains the unavoidable
  // GitHub phase (login + creation progress) so it doesn't look broken.
  const runFromGitHub = () => {
    window.open(CODESPACES_URL, "_blank", "noopener");
    setTimeout(() => {
      alert(
        "⚡ جارٍ تشغيل المشروع على حاسوب GitHub السحابي…\n\n" +
          "• سجّل الدخول لحساب GitHub إذا طُلب منك\n" +
          "• انتظر 3-6 دقائق (أول مرة فقط) — الصفحات التي تظهر هي إنشاء الحاسوب السحابي\n" +
          "• سيفتح المتصفح المشروع يعمل تلقائياً — دون أي ضغط منك"
      );
    }, 300);
  };

  // ---- 3) run from computer ----
  // ZERO friction: silent auto-login → verify package (cheap header
  // check) → native streaming download (browser progress bar, no blob
  // memory) → one short hint afterwards.
  const runFromPC = async () => {
    setDownloading(true);
    try {
      let token = await silentLogin();
      // verify availability without downloading the 770MB body
      let r = await fetch("/api/system/download-pc", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) {
        try { localStorage.removeItem("authToken"); } catch { /* ignore */ }
        token = await silentLogin();
        r = await fetch("/api/system/download-pc", {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}) as { error?: string });
        alert(d.error || "الحزمة غير جاهزة — اضغط 'إنهاء الجلسة' مرة واحدة ثم أعد المحاولة.");
        return;
      }
      await r.body?.cancel(); // don't stream the big body twice
      // native download — the httpOnly cookie from silent login
      // authenticates it; the browser shows its own progress bar.
      const a = document.createElement("a");
      a.href = "/api/system/download-pc";
      a.download = "AI-Studio-v5.5.0.tar.gz";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        alert(
          "⬇️ التحميل بدأ (يكمل في شريط التنزيلات)…\n\n" +
            "بعد اكتماله لتشغيل المشروع مباشرة:\n" +
            "1. فك الضغط عن الملف\n" +
            "2. اضغط START-AI-STUDIO.bat (ويندوز) — يفتح المتصفح ويعمل\n\n" +
            "الماك: START-AI-STUDIO.command — لينكس: start-ai-studio.sh"
        );
      }, 600);
    } catch {
      alert("فشل التحميل — أعد المحاولة.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={compact ? "flex items-center gap-1.5" : "w-full space-y-2"}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              onClick={runCurrent}
              className={
                compact
                  ? "h-9 px-2 gap-1.5 rounded-md text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "w-full h-11 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
              }
            >
              <Rocket className="h-4 w-4" />
              <span className={compact ? "text-xs hidden md:inline" : ""}>تشغيل من النظام الحالي</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>يفتح المشروع في المتصفح فوراً — النظام الحالي يعمل الآن</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              onClick={runFromGitHub}
              className={
                compact
                  ? "h-9 px-2 gap-1.5 rounded-md text-xs bg-slate-800 hover:bg-slate-700 text-white"
                  : "w-full h-11 gap-2 bg-slate-800 hover:bg-slate-700 text-white"
              }
            >
              <Github className="h-4 w-4" />
              <span className={compact ? "text-xs hidden md:inline" : ""}>تشغيل من GitHub</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>للحالة التي يكون النظام فيها معلّقاً — يفتح Codespaces ويجهّز ويشغّل كل شيء تلقائياً</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              onClick={runFromPC}
              disabled={downloading}
              className={
                compact
                  ? "h-9 px-2 gap-1.5 rounded-md text-xs bg-fuchsia-600 hover:bg-fuchsia-500 text-white"
                  : "w-full h-11 gap-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white"
              }
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className={compact ? "text-xs hidden md:inline" : ""}>
                {downloading ? "جارٍ التحميل..." : "تشغيل من الكمبيوتر"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>يحمّل النسخة الكاملة AI-Studio-v5.5.0 — فك الضغط واضغط START-AI-STUDIO.bat ويعمل فوراً</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {!compact && (
        <p className="text-center text-[11px] text-muted-foreground pt-1">
          AI-Studio v5.5.0 — ثلاث طرق تشغيل مباشر بدون أي ضبط
        </p>
      )}
    </div>
  );
}
