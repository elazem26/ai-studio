"use client";
import { useEffect, useState } from "react";
export default function ResetCachePage() {
  const [log, setLog] = useState<string[]>([]);
  const [step, setStep] = useState<"running" | "done">("running");
  useEffect(() => {
    const run = async () => {
      try {
        const lsKeys = Object.keys(localStorage);
        for (const k of lsKeys) localStorage.removeItem(k);
        setLog(p => [...p, "Cleared " + lsKeys.length + " localStorage keys"]);
        const ssKeys = Object.keys(sessionStorage);
        for (const k of ssKeys) sessionStorage.removeItem(k);
        setLog(p => [...p, "Cleared " + ssKeys.length + " sessionStorage keys"]);
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.unregister();
          setLog(p => [...p, "Unregistered " + regs.length + " service workers"]);
        }
        if ("caches" in window) {
          const names = await caches.keys();
          for (const n of names) await caches.delete(n);
          setLog(p => [...p, "Deleted " + names.length + " caches"]);
        }
        setStep("done");
        setLog(p => [...p, "", "All caches cleared! Reloading..."]);
        setTimeout(() => { window.location.href = "/?_=" + Date.now(); }, 1500);
      } catch (e) {
        setLog(p => [...p, "Error: " + (e instanceof Error ? e.message : String(e))]);
      }
    };
    void run();
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f0b1e 0%, #1a152d 50%, #0f0b1e 100%)", color: "#fff", fontFamily: "'Segoe UI', Tahoma, sans-serif", padding: "20px" }}>
      <div style={{ background: "rgba(24, 24, 27, 0.7)", border: "1px solid #27272a", borderRadius: "12px", padding: "32px", maxWidth: "500px", width: "100%" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "16px", color: "#d946ef" }}>AI Clothing Studio — Cache Reset</h1>
        <p style={{ fontSize: "13px", color: "#a1a1aa", marginBottom: "20px" }}>Clearing browser caches to load the latest UI version...</p>
        <div style={{ fontSize: "12px", color: "#d4d4d8", fontFamily: "'Courier New', monospace", background: "rgba(0, 0, 0, 0.3)", padding: "12px", borderRadius: "8px", minHeight: "120px" }}>
          {log.length === 0 ? <span style={{ color: "#71717a" }}>Starting...</span> : log.map((line, i) => (<div key={i} style={{ marginBottom: "4px", color: line.startsWith("Error") ? "#ef4444" : line.startsWith("Cleared") || line.startsWith("Unregistered") || line.startsWith("Deleted") ? "#10b981" : line === "" ? "#71717a" : "#d4d4d8" }}>{line || "\u00a0"}</div>))}
        </div>
        {step === "done" && <p style={{ fontSize: "13px", color: "#10b981", marginTop: "16px", textAlign: "center" }}>Redirecting...</p>}
      </div>
    </div>
  );
}
