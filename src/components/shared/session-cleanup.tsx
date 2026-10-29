"use client";

import { useEffect } from "react";

/**
 * SessionCleanup component
 *
 * Listens for `beforeunload` (browser tab closing / page reload) and
 * runs the THREE-STEP end-of-session protocol via /api/system/end-session:
 *
 *   1. CLEAN: delete all session images from server disk
 *      (uploads, results, temp)
 *   2. BACKUP: save a 6-location backup WITHOUT images
 *   3. DOWNLOAD-READY: drop a download-ready copy in
 *      /home/z/my-project/download/ for the user
 *
 * Also clears the client-side localStorage cache (image metadata)
 * so the next session starts completely fresh.
 *
 * Notes:
 *   - Uses `navigator.sendBeacon` for reliable delivery during page unload
 *   - Falls back to `fetch` with `keepalive: true` if `sendBeacon` is unavailable
 *   - All three steps run synchronously server-side (the endpoint handles
 *     the orchestration; client just fires the trigger)
 */
export function SessionCleanup() {
  useEffect(() => {
    const handleUnload = () => {
      // Fire-and-forget — page is closing, we can't await
      try {
        const blob = new Blob([JSON.stringify({})], {
          type: "application/json",
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/system/end-session", blob);
        } else {
          // Fallback: fetch with keepalive
          fetch("/api/system/end-session", {
            method: "POST",
            body: blob,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // ignore
      }

      // Clear localStorage image cache so next session starts fresh
      try {
        localStorage.removeItem("ai-studio-images");
        localStorage.removeItem("ai-studio-ui");
      } catch {
        // ignore
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, []);

  return null;
}
