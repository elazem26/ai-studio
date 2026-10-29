"use client";

import { useEffect } from "react";

/**
 * ServiceWarmer — invisible component that calls /api/system/ensure-services
 * once on page load. This pre-warms the face-swap mini-service + guardian
 * so the user never sees "fetch failed" when they try to use face swap.
 *
 * Mounted in the root layout — runs on every page.
 */
export function ServiceWarmer() {
  useEffect(() => {
    // Fire and forget — we don't need to wait or show errors
    fetch("/api/system/ensure-services", { method: "GET" })
      .then(() => {
        // Silent success
      })
      .catch(() => {
        // Silent failure — don't bother the user
      });
  }, []);

  return null;
}
