"use client";

import { useState, useEffect, useCallback } from "react";

type ModelStatus = {
  ok: boolean;
  exists: boolean;
  sizeBytes: number;
  sizeMB: number;
  path: string;
  expectedMinMB: number;
  expectedMaxMB: number;
  valid: boolean;
};

export default function UploadModelPage() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/system/upload-model");
      const data = await r.json();
      if (data.ok) setStatus(data);
      else setError(data.error || "Failed to load status");
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);

    // Client-side validation
    if (!file.name.toLowerCase().endsWith(".onnx")) {
      setError(`الملف "${file.name}" ليس صيغة ONNX. يجب أن ينتهي بـ .onnx`);
      return;
    }

    const sizeMB = file.size / 1024 / 1024;
    if (sizeMB < 100) {
      setError(`الملف صغير جدًا (${Math.round(sizeMB)} MB). النموذج عادةً ~555 MB`);
      return;
    }
    if (sizeMB > 700) {
      setError(`الملف كبير جدًا (${Math.round(sizeMB)} MB). الحد الأقصى 700 MB`)
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Use XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/system/upload-model");

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setUploadProgress(pct);
        }
      };

      xhr.onload = () => {
        setUploading(false);
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.ok) {
            setSuccess(`✅ تم حفظ النموذج بنجاح (${res.sizeMB} MB)`);
            fetchStatus();
          } else {
            setError(res.error || `فشل الرفع (HTTP ${xhr.status})`);
          }
        } catch (parseErr) {
          setError("استجابة غير صالحة من الخادم");
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        setError("خطأ في الشبكة أثناء الرفع");
      };

      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    } catch (e: any) {
      setUploading(false);
      setError(e?.message || "خطأ غير معروف");
    }
  };

  const handleDelete = async () => {
    if (!confirm("هل تريد حذف النموذج الحالي؟")) return;
    try {
      const r = await fetch("/api/system/upload-model", { method: "DELETE" });
      const d = await r.json();
      if (d.ok) {
        setSuccess("تم حذف النموذج");
        fetchStatus();
      } else setError(d.error);
    } catch (e: any) {
      setError(e?.message);
    }
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0e1a 0%, #0d1a2e 55%, #1a0d2e 100%)",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          padding: "2rem",
          backdropFilter: "blur(12px)",
          boxShadow: "0 24px 48px -12px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              margin: 0,
              color: "#67e8f9",
              marginBottom: "0.5rem",
            }}
          >
            رفع نموذج تبديل الوجه
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#94a3b8", margin: 0 }}>
            inswapper_128.onnx — لتشغيل ميزة تبديل الوجه محليًا
          </p>
        </div>

        {/* Status card */}
        <div
          style={{
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px",
            padding: "1rem",
            marginBottom: "1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.75rem",
            }}
          >
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
              الحالة الحالية
            </span>
            <button
              onClick={fetchStatus}
              disabled={loading}
              style={{
                background: "rgba(103,232,249,0.1)",
                border: "1px solid rgba(103,232,249,0.3)",
                color: "#67e8f9",
                borderRadius: "6px",
                padding: "0.25rem 0.75rem",
                fontSize: "0.75rem",
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "..." : "تحديث"}
            </button>
          </div>

          {status ? (
            <div style={{ fontSize: "0.8125rem", lineHeight: 1.6 }}>
              <div
                style={{
                  display: "inline-block",
                  padding: "0.15rem 0.6rem",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                  background: status.valid
                    ? "rgba(52,211,153,0.15)"
                    : status.exists
                    ? "rgba(251,191,36,0.15)"
                    : "rgba(239,68,68,0.15)",
                  color: status.valid
                    ? "#34d399"
                    : status.exists
                    ? "#fbbf24"
                    : "#f87171",
                }}
              >
                {status.valid
                  ? "✓ النموذج جاهز"
                  : status.exists
                  ? "⚠ النموذج موجود لكن غير صالح"
                  : "✕ النموذج غير موجود"}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                الحجم: <strong>{status.sizeMB} MB</strong> (المتوقع:{" "}
                {status.expectedMinMB}-{status.expectedMaxMB} MB)
              </div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: "0.6875rem",
                  marginTop: "0.25rem",
                  direction: "ltr",
                  unicodeBidi: "embed",
                  fontFamily: "ui-monospace, monospace",
                  wordBreak: "break-all",
                }}
              >
                {status.path}
              </div>
              {status.valid && (
                <button
                  onClick={handleDelete}
                  style={{
                    marginTop: "0.75rem",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#f87171",
                    borderRadius: "6px",
                    padding: "0.4rem 0.75rem",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  حذف النموذج
                </button>
              )}
            </div>
          ) : (
            <div style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
              جارٍ التحميل...
            </div>
          )}
        </div>

        {/* Upload zone */}
        <label
          htmlFor="model-file"
          style={{
            display: "block",
            border: "2px dashed rgba(103,232,249,0.3)",
            borderRadius: "12px",
            padding: "2rem 1.5rem",
            textAlign: "center",
            cursor: uploading ? "wait" : "pointer",
            background: "rgba(103,232,249,0.04)",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) =>
            !uploading && (e.currentTarget.style.borderColor = "rgba(103,232,249,0.6)")
          }
          onMouseLeave={(e) =>
            !uploading && (e.currentTarget.style.borderColor = "rgba(103,232,249,0.3)")
          }
        >
          <input
            id="model-file"
            type="file"
            accept=".onnx"
            disabled={uploading}
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          {uploading ? (
            <div>
              <div style={{ fontSize: "1rem", color: "#67e8f9", marginBottom: "0.75rem" }}>
                جارٍ الرفع... {uploadProgress}%
              </div>
              <div
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderRadius: "999px",
                  height: "8px",
                  overflow: "hidden",
                  marginTop: "0.5rem",
                }}
              >
                <div
                  style={{
                    background: "linear-gradient(90deg, #22d3ee, #0891b2)",
                    height: "100%",
                    width: `${uploadProgress}%`,
                    transition: "width 0.2s",
                  }}
                />
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📁</div>
              <div
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "#e5e7eb",
                  marginBottom: "0.25rem",
                }}
              >
                اضغط لاختيار ملف inswapper_128.onnx
              </div>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                الصيغة المطلوبة: .onnx — الحجم المتوقع: ~555 MB
              </div>
            </div>
          )}
        </label>

        {/* Error / Success messages */}
        {error && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
              fontSize: "0.8125rem",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              background: "rgba(52,211,153,0.1)",
              border: "1px solid rgba(52,211,153,0.3)",
              color: "#6ee7b7",
              fontSize: "0.8125rem",
              lineHeight: 1.5,
            }}
          >
            {success}
          </div>
        )}

        {/* Help section */}
        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            background: "rgba(0,0,0,0.2)",
            borderRadius: "8px",
            fontSize: "0.8125rem",
            color: "#94a3b8",
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 600, color: "#cbd5e1", marginBottom: "0.5rem" }}>
            💡 روابط تحميل النموذج (اختر واحدًا):
          </div>
          <div
            style={{
              direction: "ltr",
              unicodeBidi: "embed",
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              wordBreak: "break-all",
            }}
          >
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>المصدر 1:</strong>{" "}
              <a
                href="https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#67e8f9" }}
              >
                huggingface.co/ModelsLab/inswapper
              </a>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>المصدر 2:</strong>{" "}
              <a
                href="https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#67e8f9" }}
              >
                huggingface.co/ezioruan/inswapper_128.onnx
              </a>
            </div>
            <div>
              <strong>المصدر 3:</strong>{" "}
              <a
                href="https://drive.google.com/file/d/1krOLgjW2tAPaqV-Bw4YALz0xT5zlb5HF/view"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#67e8f9" }}
              >
                Google Drive (مشاركة من مجتمع insightface)
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
