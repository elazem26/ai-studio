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
const CODESPACES_URL = `https://github.com/codespaces/new?repo=${GITHUB_REPO}`;

export function QuickLaunch({ compact = false }: { compact?: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    try {
      setAuthed(!!localStorage.getItem("authToken"));
    } catch { /* ignore */ }
  }, []);

  // ---- 1) current system ----
  const runCurrent = () => {
    // same running system — just go to the app root
    window.location.href = "/";
  };

  // ---- 2) run from GitHub (Codespaces) ----
  const runFromGitHub = () => {
    window.open(CODESPACES_URL, "_blank", "noopener");
    setTimeout(() => {
      alert(
        "🚀 التشغيل من GitHub:\n\n" +
          "1. في صفحة GitHub التي فُتحت، اضغط زر أخضر: Create codespace\n" +
          "2. انتظر 3-5 دقائق — يُجهّز كل شيء تلقائياً\n" +
          "3. سيُفتح المشروع في المتصفح يعمل مباشرة\n\n" +
          "💡 استخدم هذه الطريقة عندما يكون النظام الحالي معلّقاً.\n" +
          "ملاحظة: تحتاج حساب GitHub (مجاني) — Codespaces مجاني 120 ساعة/شهر."
      );
    }, 300);
  };

  // ---- 3) run from computer ----
  const runFromPC = async () => {
    if (!authed) {
      alert("سجّل الدخول أولاً (المدير: mohamed / 1970) ثم اضغط الزر مرة أخرى لتحميل الحزمة.");
      return;
    }
    setDownloading(true);
    try {
      const token = localStorage.getItem("authToken") || "";
      const r = await fetch("/api/system/download-pc", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}) as { error?: string });
        alert(d.error || "فشل التحميل — أعد المحاولة بعد تشغيل 'إنهاء الجلسة' مرة واحدة لبناء الحزمة.");
        return;
      }
      // stream to a file download
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "AI-Studio-v5.5.0.tar.gz";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setTimeout(() => {
        alert(
          "✅ تم تحميل الحزمة الكاملة (AI-Studio-v5.5.0.tar.gz)\n\n" +
            "للتشغيل على جهازك:\n" +
            "1. فك الضغط عن الملف\n" +
            "2. اضغط مرتين على الملف المناسب:\n" +
            "   • ويندوز: START-AI-STUDIO.bat\n" +
            "   • ماك: START-AI-STUDIO.command\n" +
            "   • لينكس: start-ai-studio.sh\n" +
            "3. انتظر قليلاً — يفتح المتصفح ويشتغل تلقائياً\n\n" +
            "كل شيء داخل الحزمة: الأكواد + قاعدة البيانات + المفاتيح + النماذج."
        );
      }, 400);
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
