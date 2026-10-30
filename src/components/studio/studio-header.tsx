"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { useUIStore } from "@/stores/ui-store";
import { useModeStore } from "@/stores/mode-store";
import { useUndoRedoStore } from "@/stores/undo-redo-store";
import { useTheme } from "next-themes";
import { CompleteDownloadDialog } from "@/components/studio/complete-download-dialog";
import { QuickLaunch } from "@/components/shared/quick-launch";
import {
  Shirt,
  Sparkles,
  Languages,
  Moon,
  Sun,
  Cpu,
  Shield,
  Code2,
  Cloud,
  HardDrive,
  Wand2,
  Bot,
  Users,
  Video,
  Undo2,
  Redo2,
  History,
  Save,
  DatabaseBackup,
  Download,
  Menu,
  X,
  UserCircle,
  LogOut,
  Crown,
  UserPlus,
  FileText,
  Monitor,
  CloudUpload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DeviceSelector, getSelectedDevice, type DeviceType } from "@/components/device-selector/device-selector";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "studio", icon: Shirt, label: "nav.studio", desc: "navDescriptions.studio", section: "studio", adminOnly: false },
  { key: "imageTools", icon: Wand2, label: "nav.imageTools", desc: "navDescriptions.imageTools", section: "image-tools", adminOnly: false },
  { key: "faceSwap", icon: Users, label: "nav.faceSwap", desc: "navDescriptions.faceSwap", section: "studio", adminOnly: false },
  { key: "garmentEditor", icon: Sparkles, label: "nav.garmentEditor", desc: "navDescriptions.garmentEditor", section: "garment-editor", adminOnly: false },
  { key: "videoEditor", icon: Video, label: "nav.videoEditor", desc: "navDescriptions.videoEditor", section: "video-editor", adminOnly: false },
  { key: "modelManager", icon: Cpu, label: "nav.modelManager", desc: "navDescriptions.modelManager", section: null, adminOnly: true },
  { key: "agents", icon: Bot, label: "nav.agents", desc: "navDescriptions.agents", section: null, adminOnly: true },
  { key: "system", icon: Shield, label: "nav.system", desc: "navDescriptions.system", section: null, adminOnly: true },
  { key: "developer", icon: Code2, label: "nav.developer", desc: "navDescriptions.developer", section: null, adminOnly: true },
] as const;

/** Inline studio logo SVG — identical to /icon.svg, scaled to fit header brand */
function StudioLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="hdr-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0a0e1a" />
          <stop offset="55%" stopColor="#0d1a2e" />
          <stop offset="100%" stopColor="#1a0d2e" />
        </linearGradient>
        <linearGradient id="hdr-cyan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id="hdr-shirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
        <radialGradient id="hdr-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0891b2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#hdr-bg)" />
      <circle cx="256" cy="256" r="120" fill="url(#hdr-core)" opacity="0.6" />
      {/* Shirt */}
      <path
        d="M 166,206 L 201,166 L 226,178 Q 256,198 286,178 L 311,166 L 346,206 L 326,224 L 326,336 Q 326,348 314,348 L 198,348 Q 186,348 186,336 L 186,224 Z"
        fill="url(#hdr-shirt)"
        stroke="#67e8f9"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path
        d="M 226,178 L 256,212 L 286,178 L 256,198 Z"
        fill="#0d1a2e"
        stroke="#67e8f9"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* AI sparkle */}
      <path
        d="M 256,208 L 266,244 L 302,256 L 266,268 L 256,304 L 246,268 L 210,256 L 246,244 Z"
        fill="#ffffff"
        stroke="#67e8f9"
        strokeWidth="3"
      />
      <circle cx="256" cy="256" r="8" fill="url(#hdr-cyan)" />
    </svg>
  );
}

export function StudioHeader() {
  const t = useI18n((s) => s.t);
  const toggleLocale = useI18n((s) => s.toggle);
  const locale = useI18n((s) => s.locale);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();
  const [authUser, setAuthUser] = useState<{ name: string | null; isOwner: boolean; role: string } | null>(null);
  const [currentDevice, setCurrentDevice] = useState<DeviceType | null>(null);

  const refreshAuth = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null;
    if (token) {
      fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(d => setAuthUser({ name: d.name, isOwner: d.isOwner, role: d.role }))
        .catch(() => { localStorage.removeItem("authToken"); localStorage.removeItem("userName"); setAuthUser(null); });
    } else {
      setAuthUser(null);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null;
    // Mirror the auth token into a cookie so that window.open downloads
    // (which cannot send Authorization headers) pass the server-side
    // admin guard via the cookie fallback in getSessionToken().
    if (token) document.cookie = `authToken=${token}; path=/; max-age=2592000; SameSite=Lax`;
    refreshAuth();
    setCurrentDevice(getSelectedDevice());
    const onStorage = (e: StorageEvent) => { if (e.key === "userDevice") setCurrentDevice(e.newValue as DeviceType | null); };
    // Instant refresh when login/logout happens via client-side navigation
    // (the login page dispatches "auth-changed" after storing the token).
    const onAuthChanged = () => {
      const t = localStorage.getItem("authToken");
      if (t) document.cookie = `authToken=${t}; path=/; max-age=2592000; SameSite=Lax`;
      refreshAuth();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("auth-changed", onAuthChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("auth-changed", onAuthChanged);
    };
  }, [refreshAuth]);

  const handleLogout = async () => {
    const token = localStorage.getItem("authToken");
    if (token) { try { await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }); } catch {} }
    localStorage.removeItem("authToken"); localStorage.removeItem("userName");
    document.cookie = "authToken=; path=/; max-age=0; SameSite=Lax";
    setAuthUser(null); router.push("/login");
  };

  /** fetch with the session token attached (system APIs require admin). */
  const authFetch = (url: string, init?: RequestInit) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null;
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);

  // ===== Undo/Redo (context-aware — uses active tab's section) =====
  const undo = useUndoRedoStore((s) => s.undo);
  const redo = useUndoRedoStore((s) => s.redo);
  const canUndo = useUndoRedoStore((s) => s.canUndo);
  const canRedo = useUndoRedoStore((s) => s.canRedo);
  const sections = useUndoRedoStore((s) => s.sections);

  // Map active tab → section ID
  const activeSection = useMemo(() => {
    const tab = TABS.find((x) => x.key === activeTab);
    return tab?.section ?? null;
  }, [activeTab]);

  const undoable = activeSection ? canUndo(activeSection) : false;
  const redoable = activeSection ? canRedo(activeSection) : false;

  const handleUndo = () => {
    if (!activeSection) return;
    const entry = undo(activeSection);
    if (entry) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("undo-redo", {
            detail: { section: activeSection, action: "undo", entry },
          })
        );
      }
    }
  };

  const handleRedo = () => {
    if (!activeSection) return;
    const entry = redo(activeSection);
    if (entry) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("undo-redo", {
            detail: { section: activeSection, action: "redo", entry },
          })
        );
      }
    }
  };

  // Global keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey;
      const isRedo =
        ((e.ctrlKey || e.metaKey) && e.key === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z");
      if (isUndo && undoable) {
        e.preventDefault();
        handleUndo();
      } else if (isRedo && redoable) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoable, redoable, activeSection]);

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileMenuOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileMenuOpen]);

  // ESC key closes the drawer
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  const historyCount = activeSection
    ? (sections[activeSection]?.past.length ?? 0) +
      (sections[activeSection]?.future.length ?? 0)
    : 0;
  const pastEntries = activeSection ? sections[activeSection]?.past ?? [] : [];
  const futureEntries = activeSection
    ? sections[activeSection]?.future ?? []
    : [];

  // ====== Selecting a tab from any surface (desktop tabs or mobile drawer) ======
  const selectTab = (key: string) => {
    setActiveTab(key as never);
    setMobileMenuOpen(false); // auto-close the drawer when a page is picked
  };

  return (
    <>
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-panel-border">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 h-14">
        {/* ===== Brand + Universal Menu Button (all devices) ===== */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Universal Project Menu Button — visible on ALL screen sizes.
              Opens the same drawer as the mobile hamburger, but always
              available so desktop/tablet users can also browse all pages
              via a slide-in menu. */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="relative h-10 w-10 rounded-md flex items-center justify-center bg-cyan-accent/15 hover:bg-cyan-accent/25 text-cyan-accent ring-1 ring-cyan-accent/40 transition shrink-0"
            aria-label={t("nav.navHint") || "Open menu"}
            title={t("nav.navHint") || "Open menu"}
          >
            <Menu className="h-5 w-5" />
            {/* Notification badge showing # of pages available */}
            <span className="absolute -top-1 -right-1 bg-cyan-accent text-background text-[9px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center ring-1 ring-background">
              {TABS.length}
            </span>
          </button>

          <button
            onClick={() => selectTab("studio")}
            className="flex items-center gap-2.5 sm:gap-3 group"
            aria-label="AI Clothing Studio"
          >
            <div className="relative h-9 w-9 rounded-lg overflow-hidden ring-1 ring-cyan-accent/40 group-hover:ring-cyan-accent/70 transition cyan-glow">
              <StudioLogo className="h-full w-full" />
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-semibold tracking-tight leading-none">
                {t("app.title")}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 tracking-wider">
                {t("app.subtitle")}
              </div>
            </div>
          </button>
        </div>

        {/* ===== Mode toggle ===== */}
        <TooltipProvider>
          <div className="hidden md:flex items-center gap-0.5 p-0.5 rounded-md bg-muted/40">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setMode("cloud")}
                  className={cn(
                    "flex items-center gap-1 h-7 px-2 rounded text-[10px] font-medium transition-colors",
                    mode === "cloud"
                      ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Cloud className="h-3 w-3" />
                  <span>Cloud</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t("system.modeCloudDesc")}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setMode("local")}
                  className={cn(
                    "flex items-center gap-1 h-7 px-2 rounded text-[10px] font-medium transition-colors",
                    mode === "local"
                      ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <HardDrive className="h-3 w-3" />
                  <span>Local</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t("system.modeLocalDesc")}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* === Undo / Redo / History === */}
          <div className="hidden md:flex items-center gap-0.5 mr-2 ml-1 px-1.5 py-0.5 rounded-md border border-panel-border bg-muted/20">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-md disabled:opacity-30"
                  onClick={handleUndo}
                  disabled={!undoable}
                  aria-label={t("common.undo")}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t("common.undoTooltip")}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-md disabled:opacity-30"
                  onClick={handleRedo}
                  disabled={!redoable}
                  aria-label={t("common.redo")}
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t("common.redoTooltip")}</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-md relative"
                      aria-label={t("common.history")}
                    >
                      <History className="h-4 w-4" />
                      {historyCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold bg-cyan-accent text-background rounded-full h-3.5 min-w-3.5 px-1 flex items-center justify-center">
                          {historyCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    {t("common.history")} ({historyCount})
                  </p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  {t("common.history")}{" "}
                  {activeSection ? `· ${activeSection}` : ""}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {historyCount === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {t("common.noHistory")}
                  </div>
                )}
                {pastEntries.slice(-10).reverse().map((e, i) => (
                  <DropdownMenuItem
                    key={e.id}
                    className="text-xs cursor-pointer"
                    onClick={() => {
                      if (!activeSection) return;
                      const stepsToUndo = i + 1;
                      for (let s = 0; s < stepsToUndo; s++) {
                        const entry = undo(activeSection);
                        if (entry && typeof window !== "undefined") {
                          window.dispatchEvent(
                            new CustomEvent("undo-redo", {
                              detail: {
                                section: activeSection,
                                action: "undo",
                                entry,
                              },
                            })
                          );
                        }
                      }
                    }}
                  >
                    <Undo2 className="h-3 w-3 ml-2 text-muted-foreground" />
                    <span className="truncate">{e.label}</span>
                    <span className="text-[10px] text-muted-foreground mr-auto">
                      {new Date(e.at).toLocaleTimeString(
                        locale === "ar" ? "ar-SA" : "en-US"
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
                {futureEntries.slice(0, 10).map((e, i) => (
                  <DropdownMenuItem
                    key={e.id}
                    className="text-xs cursor-pointer opacity-60"
                    onClick={() => {
                      if (!activeSection) return;
                      const stepsToRedo = i + 1;
                      for (let s = 0; s < stepsToRedo; s++) {
                        const entry = redo(activeSection);
                        if (entry && typeof window !== "undefined") {
                          window.dispatchEvent(
                            new CustomEvent("undo-redo", {
                              detail: {
                                section: activeSection,
                                action: "redo",
                                entry,
                              },
                            })
                          );
                        }
                      }
                    }}
                  >
                    <Redo2 className="h-3 w-3 ml-2 text-muted-foreground" />
                    <span className="truncate">{e.label}</span>
                    <span className="text-[10px] text-muted-foreground mr-auto">
                      {new Date(e.at).toLocaleTimeString(
                        locale === "ar" ? "ar-SA" : "en-US"
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>

        {/* ===== Tabs — Visible on screens >= 640px (sm:flex) =====
            Previously hidden on md< (768px), which meant small laptops and
            tablets in portrait mode didn't see the tabs at all — only
            the hamburger button. Now we show tabs from 640px up.
            Below 640px (true phones), the hamburger button appears instead. */}
        <nav className="hidden sm:flex items-center gap-0.5 overflow-x-auto max-w-full">
          {/* Tabs filtered by role: admin-only tabs (modelManager, agents, system, developer) hidden for regular users */}
          {TABS.filter(tab => !tab.adminOnly || authUser?.role === "admin" || authUser?.role === "assistant" || authUser?.isOwner).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <Button
                key={tab.key}
                variant="ghost"
                size="sm"
                onClick={() => selectTab(tab.key)}
                className={cn(
                  "h-9 px-2 sm:px-3 gap-1.5 rounded-md text-xs whitespace-nowrap",
                  active &&
                    "bg-cyan-accent/10 text-cyan-accent hover:bg-cyan-accent/15 hover:text-cyan-accent ring-1 ring-cyan-accent/30"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">{t(tab.label)}</span>
              </Button>
            );
          })}
        </nav>

        {/* ===== (Mobile-only hamburger removed — the universal menu
            button next to the brand logo now opens the drawer on
            ALL screen sizes, so a separate mobile-only button is
            redundant.) ===== */}

        {/* ===== Right actions ===== */}
        <div className="flex items-center gap-1">
          {/* Backup / Restore / Download buttons — visible on ALL screen sizes
              (icon-only below md) — only for admin/assistant/owner */}
          {(authUser?.role === "admin" || authUser?.role === "assistant" || authUser?.isOwner) && (
          <div className="flex items-center gap-1">
            {/* === 6-Location Backup button (multi-backup) === */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const r = await authFetch("/api/system/multi-backup", {
                        method: "POST",
                      });
                      const d = await r.json();
                      if (d.ok) {
                        const count = d.savedCount ?? 0;
                        const locs = (d.savedLocations ?? [])
                          .map((l: { location: string }) => `• ${l.location}`)
                          .join("\n");
                        alert(
                          `✅ تم إنشاء نسخة نظيفة في ${count} مواقع:\n\n${locs}\n\nحجم كل نسخة: ${Math.round(
                            (d.savedLocations?.[0]?.sizeBytes ?? 0) / 1024
                          )} KB`
                        );
                      } else {
                        alert("فشل إنشاء النسخة الاحتياطية");
                      }
                    } catch (e) {
                      alert("خطأ في الإنشاء");
                    }
                  }}
                  className="h-9 px-2 gap-1.5 rounded-md text-xs bg-indigo-500 hover:bg-indigo-600 text-white"
                >
                  <Save className="h-4 w-4" />
                  <span className="text-xs hidden md:inline">نسخة في 6 مواقع</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>حفظ نسخة احتياطية في 6 مواقع مختلفة على القرص</p>
              </TooltipContent>
            </Tooltip>

            {/* === Restore backup === */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const r = await authFetch("/api/system/restore-backup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ force: true }),
                      });
                      const d = await r.json();
                      if (d.ok) {
                        alert("تم الاسترجاع");
                        setTimeout(() => location.reload(), 2000);
                      } else alert("فشل");
                    } catch (e) {
                      alert("خطأ");
                    }
                  }}
                  className="h-9 px-2 gap-1.5 rounded-md text-xs bg-amber-500 hover:bg-amber-600 text-white"
                >
                  <DatabaseBackup className="h-4 w-4" />
                  <span className="text-xs hidden md:inline">استرجاع نسخة</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>استرجاع نسخة</p>
              </TooltipContent>
            </Tooltip>

            {/* === Download CURRENT version (fresh clean copy: code + db + .env keys) === */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={() =>
                    window.open("/api/system/download-current", "_blank")
                  }
                  className="h-9 px-2 gap-1.5 rounded-md text-xs bg-green-500 hover:bg-green-600 text-white"
                >
                  <Download className="h-4 w-4" />
                  <span className="text-xs hidden md:inline">نسخة كمبيوتر عادية</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>نسخة كمبيوتر عادية — الكود + قاعدة البيانات + المفاتيح (بضعة ميغا، تحميل مباشر)</p>
              </TooltipContent>
            </Tooltip>

            {/* === Download COMPLETE version (everything incl. models, ~900MB) === */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={() => setCompleteDialogOpen(true)}
                  className="h-9 px-2 gap-1.5 rounded-md text-xs bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white font-semibold"
                >
                  <Download className="h-4 w-4" />
                  <span className="text-xs hidden md:inline">نسخة كمبيوتر كاملة</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>نسخة كمبيوتر كاملة — كل الملفات والمفاتيح والنماذج (~900MB مقسمة لأجزاء)</p>
              </TooltipContent>
            </Tooltip>

            {/* === GitHub sync (always-latest full copy incl. .env keys + models) === */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const r = await authFetch("/api/system/github-push", { method: "POST" });
                      const d = await r.json();
                      if (d.ok) {
                        alert(
                          "🐙 بدأ رفع أحدث نسخة إلى GitHub في الخلفية\n\n" +
                          `المستودع: ${d.repo}\n` +
                          "النسخة تشمل: كل الأكواد + .env بالمفاتيح ظاهرة + قاعدة البيانات + النماذج\n" +
                          "التحديثات التالية ترفع التغييرات فقط (سريع)\n\n" +
                          "اضغط الزر مجدداً بعد دقيقتين لعرض حالة الرفع."
                        );
                      } else {
                        alert("⚠️ " + (d.error || "فشل بدء الرفع"));
                      }
                    } catch (e) {
                      alert("خطأ في الاتصال: " + e);
                    }
                  }}
                  onContextMenu={async (e) => {
                    // right-click = show status instead of starting a push
                    e.preventDefault();
                    try {
                      const r = await authFetch("/api/system/github-status");
                      const d = await r.json();
                      if (d.ok) {
                        alert(`🐙 حالة الرفع إلى GitHub: ${d.state}\n\n${d.message}\n\n${d.logTail || ""}`);
                      }
                    } catch {}
                  }}
                  className="h-9 px-2 gap-1.5 rounded-md text-xs bg-slate-800 hover:bg-slate-700 text-white"
                >
                  <CloudUpload className="h-4 w-4" />
                  <span className="text-xs hidden md:inline">رفع إلى GitHub</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>رفع نسخة محدثة إلى GitHub (أكواد + مفاتيح .env ظاهرة + قاعدة بيانات + نماذج) — نقرة يمين لعرض الحالة</p>
              </TooltipContent>
            </Tooltip>

            {/* === End Session (clean + backup + download-ready) === */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (
                      !confirm(
                        "إنهاء الجلسة؟\n\nسيتم:\n" +
                          "1. حذف كل الصور والفيديوهات والنتائج\n" +
                          "2. نسخة نظيفة في 6 مواقع\n" +
                          "3. نسخة جاهزة للتنزيل على الكمبيوتر\n" +
                          "4. رفع نسخة إلى GitHub (إن كان مُهيأً)\n\n" +
                          "اضغط موافق للمتابعة."
                      )
                    ) {
                      return;
                    }
                    try {
                      const r = await authFetch("/api/system/end-session", {
                        method: "POST",
                      });
                      const d = await r.json();
                      if (d.ok) {
                        const clean = d.steps?.find(
                          (s: { step: string }) => s.step === "clean"
                        );
                        const backup = d.steps?.find(
                          (s: { step: string }) => s.step === "backup"
                        );
                        const dl = d.steps?.find(
                          (s: { step: string }) => s.step === "download-ready"
                        );
                        const cleanInfo = clean
                          ? `${clean.details?.deletedUploads ?? 0} مرفوعة + ${clean.details?.deletedResults ?? 0} نتيجة + ${clean.details?.deletedTemp ?? 0} مؤقتة (${clean.details?.freedKB ?? 0}KB)`
                          : "—";
                        const backupInfo = backup
                          ? `${backup.details?.savedCount ?? 0}/6 مواقع`
                          : "—";
                        const dlInfo = dl?.ok
                          ? `✅ جاهزة (${dl.details?.sizeKB ?? 0}KB)`
                          : "❌ فشل";
                        const gh = d.steps?.find(
                          (s: { step: string }) => s.step === "github"
                        );
                        const ghInfo = !gh
                          ? "—"
                          : gh.ok
                            ? `✅ رُفعت: ${gh.details?.url ?? ""}`
                            : `⚠️ ${gh.details?.error ?? "فشل"}`;
                        alert(
                          "✅ تم إنهاء الجلسة بنجاح!\n\n" +
                            `🧹 تنظيف: ${cleanInfo}\n` +
                            `💾 نسخ احتياطي: ${backupInfo}\n` +
                            `⬇️ نسخة التنزيل: ${dlInfo}\n` +
                            `🐙 GitHub: ${ghInfo}\n\n` +
                            "اضغط زر 'تنزيل النسخة الحالية' لتحميل النسخة على جهازك."
                        );
                      } else {
                        alert(
                          "⚠️ تم تنفيذ الجلسة مع بعض التحذيرات. تحقق من السجلات."
                        );
                      }
                    } catch (e) {
                      alert("خطأ في إنهاء الجلسة: " + e);
                    }
                  }}
                  className="h-9 px-2 gap-1.5 rounded-md text-xs bg-rose-500 hover:bg-rose-600 text-white"
                >
                  <X className="h-4 w-4" />
                  <span className="text-xs hidden md:inline">إنهاء الجلسة</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  حذف صور الجلسة + إنشاء 6 نسخ احتياطية + تجهيز نسخة للتنزيل
                </p>
              </TooltipContent>
            </Tooltip>

            {/* === Quick Launch: 3 one-click run buttons (v5.5.0) === */}
            <QuickLaunch compact />
          </div>
          )}

          {/* ===== Device selector (visible to all logged-in users) ===== */}
          {authUser && currentDevice && (
            <DeviceSelector mode="switch" onSelected={(d) => setCurrentDevice(d)} />
          )}
          {authUser && !currentDevice && (
            <Button variant="ghost" size="icon" onClick={() => router.push("/select-device")} title="اختر نوع الجهاز" className="h-9 w-9 rounded-md">
              <Monitor className="h-4 w-4" />
            </Button>
          )}

          {/* ===== Account menu (login/subscriptions/admin pages/logout) ===== */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-md relative" aria-label="الحساب">
                    <UserCircle className="h-4 w-4" />
                    {authUser?.isOwner && <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold bg-amber-500 text-black rounded-full h-3.5 min-w-3.5 px-1 flex items-center justify-center">★</span>}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>الحساب والاشتراك</p></TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              {authUser ? (
                <>
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{authUser.name || "مستخدم"}</span>
                      <span className="text-[10px] text-muted-foreground">{authUser.isOwner ? "مالك دائم" : authUser.role === "admin" ? "مدير" : authUser.role === "assistant" ? "مساعد" : "مستخدم"}</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/subscriptions")}>
                    <Crown className="h-4 w-4 ml-2 text-amber-500" /><span>الاشتراكات</span>
                  </DropdownMenuItem>
                  {(authUser.role === "admin" || authUser.role === "assistant" || authUser.isOwner) && (
                    <>
                      <DropdownMenuItem onClick={() => router.push("/control-panel")}>
                        <Shield className="h-4 w-4 ml-2 text-cyan-accent" /><span>لوحة التحكم</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push("/reports")}>
                        <FileText className="h-4 w-4 ml-2 text-emerald-500" /><span>التقارير</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push("/admin-assistant")}>
                        <Bot className="h-4 w-4 ml-2 text-violet-500" /><span>وكيل أوامر المدير</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push("/assistants")}>
                        <Users className="h-4 w-4 ml-2 text-cyan-accent" /><span>إدارة المساعدين</span>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-400 focus:text-red-400">
                    <LogOut className="h-4 w-4 ml-2" /><span>تسجيل الخروج</span>
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuLabel>الحساب</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/login")}>
                    <UserCircle className="h-4 w-4 ml-2" /><span>تسجيل الدخول</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/login")}>
                    <UserPlus className="h-4 w-4 ml-2" /><span>إنشاء حساب</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/subscriptions")}>
                    <Crown className="h-4 w-4 ml-2 text-amber-500" /><span>الباقات والأسعار</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* ===== Mobile drawer tabs filtered by role ===== */}

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-md relative"
            onClick={toggleLocale}
            title={t("language.toggle")}
          >
            <Languages className="h-4 w-4" />
            <span className="sr-only">{t("language.toggle")}</span>
            <span className="absolute text-[9px] font-bold bottom-1 right-1 text-cyan-accent">
              {locale === "ar" ? "AR" : "EN"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-md"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={t("theme.toggle")}
          >
            {mounted && theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ====== Mobile Drawer (phone only — slide-in from side) ====== */}
      {/* ============================================================ */}
      {/* IMPORTANT: Render via portal to document.body so the `position: fixed` */}
      {/* drawer is positioned relative to the viewport, not constrained by the */}
      {/* header's `backdrop-filter` (which creates a containing block for fixed  */}
      {/* descendants and would trap the drawer inside the 56px-tall header).     */}
      {mobileMenuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100]"
            aria-modal="true"
            role="dialog"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[drawer-fade_0.2s_ease-out]"
              onClick={() => setMobileMenuOpen(false)}
            />

            {/* Drawer panel — slides from right (RTL primary side) */}
            <aside
              className={cn(
                "absolute top-0 right-0 h-full w-[85vw] sm:w-80 md:w-96",
                "bg-background border-l border-panel-border shadow-2xl",
                "flex flex-col",
                "animate-[drawer-slide_0.25s_ease-out]"
              )}
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between p-4 border-b border-panel-border">
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-10 rounded-lg overflow-hidden ring-1 ring-cyan-accent/40 cyan-glow">
                    <StudioLogo className="h-full w-full" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-tight">
                      {t("app.title")}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t("nav.navHint")}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="h-9 w-9 rounded-md flex items-center justify-center bg-muted/40 hover:bg-muted/60 text-foreground ring-1 ring-panel-border"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Drawer body — list of pages */}
              <nav className="flex-1 overflow-y-auto p-3">
                <ul className="space-y-1.5">
                  {TABS.filter(tab => !tab.adminOnly || authUser?.role === "admin" || authUser?.role === "assistant" || authUser?.isOwner).map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.key;
                    return (
                      <li key={tab.key}>
                        <button
                          onClick={() => selectTab(tab.key)}
                          className={cn(
                            "w-full flex items-start gap-3 p-3 rounded-lg text-start transition-colors",
                            "min-h-[64px] touch-manipulation",
                            active
                              ? "bg-cyan-accent/10 text-cyan-accent ring-1 ring-cyan-accent/30"
                              : "text-foreground hover:bg-muted/50 active:bg-muted/70"
                          )}
                        >
                          <div
                            className={cn(
                              "h-10 w-10 rounded-md flex items-center justify-center shrink-0",
                              active
                                ? "bg-cyan-accent/15 text-cyan-accent"
                                : "bg-muted/50 text-foreground"
                            )}
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold leading-tight">
                              {t(tab.label)}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                              {t(tab.desc)}
                            </div>
                          </div>
                          {active && (
                            <div className="h-2 w-2 rounded-full bg-cyan-accent shrink-0 mt-2 cyan-pulse" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {/* Drawer footer — mode toggle for mobile */}
              <div className="border-t border-panel-border p-3 space-y-2">
                <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/40">
                  <button
                    onClick={() => setMode("cloud")}
                    className={cn(
                      "flex items-center justify-center gap-1.5 h-9 flex-1 rounded text-xs font-medium transition-colors",
                      mode === "cloud"
                        ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Cloud className="h-4 w-4" />
                    Cloud AI
                  </button>
                  <button
                    onClick={() => setMode("local")}
                    className={cn(
                      "flex items-center justify-center gap-1.5 h-9 flex-1 rounded text-xs font-medium transition-colors",
                      mode === "local"
                        ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <HardDrive className="h-4 w-4" />
                    Local
                  </button>
                </div>
                <div className="text-[10px] text-center text-muted-foreground">
                  {t("app.tagline")}
                </div>
              </div>
            </aside>
          </div>,
          document.body
        )}
    </header>
    <CompleteDownloadDialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen} />
    </>
  );
}
