"use client";

import { useEffect } from "react";

/**
 * SessionCleanup component — full session lifecycle:
 *
 * 1) HEARTBEAT (disconnect detection — "عند الانقطاع"):
 *    sends a beat to /api/system/heartbeat every 60s. If the beat gap
 *    ever exceeds 4 minutes (network drop / crash / laptop closed —
 *    cases where `beforeunload` never fires), the server-side detector
 *    runs the full end-session protocol automatically on the next beat.
 *
 * 2) UNLOAD (session exit — "عند الخروج من الجلسة"):
 *    listens for `beforeunload` / `pagehide` (tab close / reload / nav
 *    away) and fires the end-session protocol via sendBeacon:
 *
 *      1. CLEAN: delete all session images from server disk
 *         (uploads, results, temp)
 *      2. BACKUP: save a 6-location backup WITHOUT images
 *      3. DOWNLOAD-READY: drop a download-ready copy in download/
 *      4. GITHUB: clean upload (only if configured)
 *
 * Also clears the client-side localStorage cache (image metadata)
 * so the next session starts completely fresh.
 *
 * Notes:
 *   - Uses `navigator.sendBeacon` for reliable delivery during page unload
 *   - Falls back to `fetch` with `keepalive: true` if `sendBeacon` is unavailable
 *   - The button path ("زر إنهاء الجلسة") calls /api/system/end-session
 *     directly from studio-header with full result reporting.
 */

const HEARTBEAT_INTERVAL_MS = 60_000;

export function SessionCleanup() {
  useEffect(() => {
    // ---- 1) heartbeat loop (disconnect detection) ----------------------
    const beat = () => {
      try {
        const blob = new Blob([JSON.stringify({ t: Date.now() })], {
          type: "application/json",
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/system/heartbeat", blob);
        } else {
          fetch("/api/system/heartbeat", {
            method: "POST",
            body: blob,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // ignore — detection degrades gracefully
      }
    };
    beat(); // first beat marks this session active immediately
    const hb = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    // ---- 2) unload handler (session exit) ------------------------------
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
      clearInterval(hb);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, []);

  return null;
}
