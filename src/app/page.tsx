"use client";

import { useEffect, useState } from "react";
import { StudioHeader } from "@/components/studio/studio-header";
import { SourcePanel } from "@/components/panels/source-panel";
import { GarmentPanel } from "@/components/panels/garment-panel";
import { GarmentMappingCard } from "@/components/panels/garment-mapping-card";
import { ResultsPanel } from "@/components/panels/results-panel";
import { ControlBar } from "@/components/studio/control-bar";
import { ZoomModal } from "@/components/modals/zoom-modal";
import { ExportModal } from "@/components/modals/export-modal";
import { PrintModal } from "@/components/modals/print-modal";
import { ComparisonModal } from "@/components/comparison/comparison-modal";
import { ModelManagerPanel } from "@/components/models/model-manager-panel";
import { SystemPrivacyPanel } from "@/components/system/system-privacy-panel";
import { DeveloperPanel } from "@/components/system/developer-panel";
import { GarmentEditorPanel } from "@/components/garment-editor/garment-editor-panel";
import { ImageToolsPanel } from "@/components/image-tools/image-tools-panel";
import { FaceSwapPanel } from "@/components/face-swap/face-swap-panel";
import { VideoEditorPanel } from "@/components/video-editor/video-editor-panel";
import { AgentsPanel } from "@/components/agents/agents-panel";
import { useUIStore } from "@/stores/ui-store";
import { useImageStore, type StudioSnapshot } from "@/stores/image-store";

const ADMIN_TABS = ["modelManager", "agents", "system", "developer"];

export default function Home() {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const [authUser, setAuthUser] = useState<{ role: string; isOwner: boolean } | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null;
    if (token) {
      fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(d => setAuthUser({ role: d.role, isOwner: d.isOwner }))
        .catch(() => setAuthUser(null));
    } else { setAuthUser(null); }
  }, [activeTab]);

  // Reset tab to studio if a non-privileged user tries to access admin tabs
  useEffect(() => {
    if (authUser !== null && ADMIN_TABS.includes(activeTab) && authUser.role !== "admin" && authUser.role !== "assistant" && !authUser.isOwner) {
      setActiveTab("studio");
    }
  }, [authUser, activeTab, setActiveTab]);

  const restoreStudioSnapshot = useImageStore((s) => s.restoreStudioSnapshot);
  useEffect(() => {
    const onUndoRedo = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.section !== "studio") return;
      const entry = detail?.entry;
      if (!entry?.state) return;
      try { restoreStudioSnapshot(entry.state as StudioSnapshot); } catch (err) { console.warn("[studio] Failed to restore snapshot:", err); }
    };
    window.addEventListener("undo-redo", onUndoRedo);
    return () => window.removeEventListener("undo-redo", onUndoRedo);
  }, [restoreStudioSnapshot]);

  const isPrivileged = authUser?.role === "admin" || authUser?.role === "assistant" || authUser?.isOwner;

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background text-foreground">
      <StudioHeader />
      <main className="flex-1 flex flex-col p-3 sm:p-4 gap-3">
        {activeTab === "studio" && (
          <>
            <PrivacyBanner />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 flex-1 min-h-0">
              <SourcePanel />
              <GarmentPanel />
              <ResultsPanel />
            </div>
            <GarmentMappingCard />
            <ControlBar />
          </>
        )}
        {activeTab === "imageTools" && <ImageToolsPanel />}
        {activeTab === "faceSwap" && <FaceSwapPanel />}
        {activeTab === "garmentEditor" && <GarmentEditorPanel />}
        {activeTab === "videoEditor" && <VideoEditorPanel />}
        {isPrivileged && activeTab === "modelManager" && <ModelManagerPanel />}
        {isPrivileged && activeTab === "agents" && <AgentsPanel />}
        {isPrivileged && activeTab === "system" && <SystemPrivacyPanel />}
        {isPrivileged && activeTab === "developer" && <DeveloperPanel />}
      </main>
      <ZoomModal />
      <ExportModal />
      <PrintModal />
      <ComparisonModal />
    </div>
  );
}

function PrivacyBanner() {
  return (
    <div className="studio-panel p-2 sm:p-2.5 flex items-center justify-center gap-2 sm:gap-3 text-[10px] sm:text-xs text-muted-foreground text-center">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 cyan-pulse" />
        <span className="hidden sm:inline">Local AI</span>
        <span>·</span>
        <span>No image upload to cloud</span>
        <span>·</span>
        <span>Privacy-first</span>
      </span>
    </div>
  );
}
