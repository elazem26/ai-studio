"use client";

import { useRef, useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EnhanceQualityButtons } from "@/components/shared/enhance-quality-buttons";
import { ProgressIndicator } from "@/components/shared/progress-indicator";
import { useImageStore, type UploadedImage } from "@/stores/image-store";
import {
  Loader2,
  Upload,
  X,
  ExternalLink,
  Download,
  Printer,
  ZoomIn,
  ZoomOut,
  Wand2,
  Sparkles,
  Layers,
  Users,
  RefreshCw,
  Link2,
  Trash2,
  Plus,
  ArrowLeft,
  ScanFace,
} from "lucide-react";

/**
 * FaceSwapPanel — face swap studio with NUMBERED FACE BOXES.
 *
 * When an image contains multiple people, every detected face gets a
 * numbered box (1 = largest face, 2 = next, ...) on BOTH the source and
 * the reference image. The user then maps which reference box merges
 * into which source box ("ربط الوجوه" section), and the swap is executed
 * accordingly (insightface/inswapper with per-face indices).
 */

/* ============================== Types ============================== */

type DetectedFace = {
  index: number; // 0-based; 0 = largest face (الأكبر)
  bbox: [number, number, number, number]; // normalized x1,y1,x2,y2 (0..1)
  area: number;
  score: number;
};

type FaceMapping = { faceIndex: number; sourceIndex: number; refImage: number };

/* ============================== Helpers ============================== */

/** Download a URL as a file (creates a temporary <a> element). */
function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * ActionBar — Open / Download / Print / Zoom buttons under each image.
 */
function ActionBar({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap p-2 bg-card/60 border-t border-border/50 rounded-b-md">
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => {
          const t = window.open("", "_blank");
          if (t) t.location.href = url;
        }}
      >
        <ExternalLink className="w-3.5 h-3.5 me-1" />
        <span className="text-xs">فتح</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => downloadUrl(url, `${label}-${Date.now()}.png`)}
      >
        <Download className="w-3.5 h-3.5 me-1" />
        <span className="text-xs">تنزيل</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => {
          const t = window.open("", "_blank");
          if (t) {
            t.document.write(
              `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff"><img src="${url}" style="max-width:100%;max-height:100vh"/></body></html>`
            );
            t.document.close();
            setTimeout(() => {
              t.focus();
              t.print();
            }, 250);
          }
        }}
      >
        <Printer className="w-3.5 h-3.5 me-1" />
        <span className="text-xs">طباعة</span>
      </Button>
      <div className="flex gap-1 ms-auto">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => {
            const t = window.open("", "_blank");
            if (t) {
              t.document.write(
                `<html><body style="margin:0"><img src="${url}" style="width:100%"/></body></html>`
              );
              t.document.close();
            }
          }}
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => downloadUrl(url, `${label}-${Date.now()}.png`)}
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * FaceBox — a numbered overlay box drawn on top of a detected face.
 * Coordinates are normalized (0..1) so they scale with the rendered image.
 * `mapped` boxes (participating in a merge) are green, others amber.
 */
function FaceBox({
  face,
  mapped,
  onClick,
  accent = "amber",
}: {
  face: DetectedFace;
  mapped: boolean;
  onClick: () => void;
  accent?: "amber" | "violet" | "fuchsia";
}) {
  const [x1, y1, x2, y2] = face.bbox;
  const borderCls = mapped
    ? "border-emerald-400 bg-emerald-400/10"
    : accent === "violet"
      ? "border-violet-400/80 bg-violet-400/5"
      : "border-fuchsia-400/80 bg-fuchsia-400/5";
  const badgeCls = mapped
    ? "bg-emerald-500"
    : accent === "violet"
      ? "bg-violet-500"
      : "bg-fuchsia-500";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`الوجه ${face.index + 1} — انقر للتعيين`}
      className="absolute z-20 group cursor-pointer transition-opacity hover:opacity-100 opacity-95"
      style={{
        left: `${x1 * 100}%`,
        top: `${y1 * 100}%`,
        width: `${Math.max(0, (x2 - x1) * 100)}%`,
        height: `${Math.max(0, (y2 - y1) * 100)}%`,
      }}
    >
      <span
        className={`absolute inset-0 rounded-md border-2 ${borderCls} group-hover:bg-emerald-400/25 transition-colors shadow-[0_0_0_1px_rgba(0,0,0,0.15)]`}
      />
      <span
        className={`absolute min-w-[22px] h-[22px] px-1 rounded-full text-[11px] font-extrabold text-white flex items-center justify-center shadow-md ${badgeCls} ${
          y1 < 0.06 ? "top-0.5 start-0.5" : "-top-2.5 -start-2.5"
        }`}
      >
        {face.index + 1}
      </span>
    </button>
  );
}

/* ============================== Main Component ============================== */

function FaceSwapApp() {
  const { toast: e } = useToast();
  const [u, m] = useState(""); // sourceUrl, setSourceUrl
  const [h, x] = useState(""); // faceUrl, setFaceUrl
  const [p, v] = useState(""); // resultUrl, setResultUrl
  const [b, y] = useState<string[]>([]); // multiResults, setMultiResults
  const [j, w] = useState(false); // busy, setBusy
  const k = useRef<HTMLInputElement>(null);
  const N = useRef<HTMLInputElement>(null);

  // ===== Numbered face boxes state =====
  const [sourceFaces, setSourceFaces] = useState<DetectedFace[]>([]);
  const [faceFaces, setFaceFaces] = useState<DetectedFace[]>([]);
  const [detecting, setDetecting] = useState<{ source: boolean; face: boolean }>({
    source: false,
    face: false,
  });
  // mapping rows: which reference face (in which reference image) merges
  // into which source face
  const [mappings, setMappings] = useState<FaceMapping[]>([]);
  const [activeRow, setActiveRow] = useState(0);
  const lastDetect = useRef<{ source: string; face: string }>({ source: "", face: "" });

  // ===== MULTI-REFERENCE face images =====
  // Several reference photos; every mapping row points at one of them via
  // refImage. faceFacesByImage caches the detected numbered faces per image.
  const [faceList, setFaceList] = useState<UploadedImage[]>([]);
  const [activeFaceImg, setActiveFaceImg] = useState(0);
  const [faceFacesByImage, setFaceFacesByImage] = useState<DetectedFace[][]>([]);
  const [addingFaces, setAddingFaces] = useState(0);
  const addFaceInputRef = useRef<HTMLInputElement>(null);
  const lastFaceDetectByImage = useRef<Record<number, string>>({});

  // ===== Image store hooks — keep source/face/result in the
  // global image store so they persist across tab navigation
  // AND can be viewed from the Garment Editor's "faceSwap" sub-tab.
  // =====
  const faceSwapSource = useImageStore((s) => s.faceSwapSource);
  const faceSwapFace = useImageStore((s) => s.faceSwapFace);
  const faceSwapFaceList = useImageStore((s) => s.faceSwapFaceList);
  const faceSwapResult = useImageStore((s) => s.faceSwapResult);
  const setFaceSwapSource = useImageStore((s) => s.setFaceSwapSource);
  const setFaceSwapFace = useImageStore((s) => s.setFaceSwapFace);
  const setFaceSwapFaceList = useImageStore((s) => s.setFaceSwapFaceList);
  const setFaceSwapResult = useImageStore((s) => s.setFaceSwapResult);
  const pushStudioHistory = useImageStore((s) => s.pushStudioHistory);

  // The ACTIVE reference image (preview target for the reference card).
  const activeFace = faceList[activeFaceImg] ?? null;

  // === Restore local state from the persisted image store on mount ===
  useEffect(() => {
    if (faceSwapSource?.url && !u) m(faceSwapSource.url);
    const restored = faceSwapFaceList?.length
      ? faceSwapFaceList
      : faceSwapFace
        ? [faceSwapFace]
        : [];
    if (restored.length && !faceList.length) {
      setFaceList(restored);
      setFaceFacesByImage(restored.map(() => []));
      x(restored[0].url);
    }
    if (faceSwapResult?.url && !p) v(faceSwapResult.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // C(blob, callback) — read a File/Blob as data URL
  const C = (file: Blob, callback: (dataUrl: string) => void) => {
    const a = new FileReader();
    a.onload = () => callback(a.result as string);
    a.readAsDataURL(file);
  };

  /* ============ Face detection (numbered boxes) ============ */

  // detectFaces(kind, serverPath) — POST /api/images/face-detect.
  // On success: store faces + (re)init the mapping table to the default
  // [ref 1 → source 1]. Both sides use the same largest-first ordering.
  const detectFaces = async (
    kind: "source" | "face",
    serverPath: string,
    imageIdx = 0
  ) => {
    if (lastDetect.current[kind] === serverPath && kind === "source") return; // already detected this exact image
    if (kind === "source") lastDetect.current[kind] = serverPath;
    setDetecting((d) => ({ ...d, [kind]: true }));
    try {
      const r = await fetch("/api/images/face-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: serverPath }),
      });
      const d = await r.json().catch(() => ({}));
      const faces: DetectedFace[] = r.ok && d.ok ? d.faces ?? [] : [];
      if (kind === "source") {
        setSourceFaces(faces);
        // Fresh SOURCE image → source indices invalid → reset rows.
        setMappings([{ faceIndex: 0, sourceIndex: 0, refImage: 0 }]);
        setActiveRow(0);
      } else {
        // MULTI-REFERENCE: store faces per reference image; mappings for
        // OTHER images stay untouched.
        setFaceFacesByImage((prev) => {
          const next = [...prev];
          next[imageIdx] = faces;
          return next;
        });
        setFaceFaces(faces); // active image's faces (legacy view)
      }
    } catch {
      if (kind === "source") setSourceFaces([]);
      else {
        setFaceFacesByImage((prev) => {
          const next = [...prev];
          next[imageIdx] = [];
          return next;
        });
        setFaceFaces([]);
      }
    } finally {
      setDetecting((d) => ({ ...d, [kind]: false }));
    }
  };

  // ensureServerPathFor — if the displayed image is a data URL (upload
  // failed earlier), upload it now so detection can run server-side.
  const ensureServerPathFor = async (url: string, kind: "source" | "face"): Promise<string | null> => {
    if (url.startsWith("/")) return url;
    try {
      const blob = await (await fetch(url)).blob();
      const fd = new FormData();
      fd.append("file", blob, `face-swap-${kind}.png`);
      const up = await fetch("/api/images/upload", { method: "POST", body: fd });
      const data = await up.json();
      return up.ok && data.url ? data.url : null;
    } catch {
      return null;
    }
  };

  // Re-detect faces on the source + EVERY reference image (manual button).
  const redetectBoth = async () => {
    lastDetect.current = { source: "", face: "" };
    lastFaceDetectByImage.current = {};
    if (u) {
      const sp = await ensureServerPathFor(u, "source");
      if (sp) await detectFaces("source", sp);
    }
    for (let i = 0; i < faceList.length; i++) {
      const fp = await ensureServerPathFor(faceList[i].url, "face");
      if (fp) await detectFaces("face", fp, i);
    }
    e({ title: "🔄 تم إعادة رصد الوجوه" });
  };

  // Auto-detect whenever the displayed image is a server URL (fresh upload
  // URL, enhanced result, "استخدم كمدخل" result, or restored store image).
  // Data URLs are handled explicitly after upload in handle*Picked.
  useEffect(() => {
    if (!u) {
      lastDetect.current.source = "";
      setSourceFaces([]);
      return;
    }
    if (u.startsWith("data:")) {
      // fresh pick — will be detected after the background upload finishes
      lastDetect.current.source = "";
      setSourceFaces([]);
      return;
    }
    detectFaces("source", u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u]);

  useEffect(() => {
    if (!h) {
      lastDetect.current.face = "";
      setFaceFaces([]);
      return;
    }
    if (h.startsWith("data:")) {
      // fresh pick — will be detected after the background upload finishes
      lastDetect.current.face = "";
      setFaceFaces([]);
      return;
    }
    detectFaces("face", h, activeFaceImg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, activeFaceImg]);

  // Keep the image-store mirror in sync (active reference image).
  useEffect(() => {
    const af = faceList[activeFaceImg] ?? null;
    if (af && faceSwapFace && af.path !== faceSwapFace.path) setFaceSwapFace(af);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFaceImg, faceList]);

  // Helper: when the user picks a source/face image, ALSO upload it
  // to the server and store the metadata in the image store so the
  // Garment Editor's "faceSwap" sub-tab can show it.
  const handleSourcePicked = async (dataUrl: string) => {
    m(dataUrl); // set local state for this panel
    // Upload to server in the background so we get a stable URL
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append("file", blob, "face-swap-source.png");
      const up = await fetch("/api/images/upload", { method: "POST", body: fd });
      const data = await up.json();
      if (up.ok && data.path) {
        pushStudioHistory("Face-swap: source uploaded");
        setFaceSwapSource({
          id: data.id,
          name: data.name,
          path: data.path,
          url: data.url,
          mime: data.mime,
          size: data.size,
          width: data.width,
          height: data.height,
          format: data.format,
          uploadedAt: Date.now(),
        });
        // Run numbered-face detection on the freshly uploaded file
        if (data.url) await detectFaces("source", data.url);
      }
    } catch {
      // ignore — local state still works
    }
  };

  /** Upload ONE file as a new reference image and return its metadata. */
  const uploadFaceImage = async (file: File): Promise<UploadedImage | null> => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const up = await fetch("/api/images/upload", { method: "POST", body: fd });
      const data = await up.json();
      if (up.ok && data.path) {
        return {
          id: data.id,
          name: data.name,
          path: data.path,
          url: data.url,
          mime: data.mime,
          size: data.size,
          width: data.width,
          height: data.height,
          format: data.format,
          uploadedAt: Date.now(),
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleFacePicked = async (dataUrl: string) => {
    x(dataUrl);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append("file", blob, "face-swap-face.png");
      const up = await fetch("/api/images/upload", { method: "POST", body: fd });
      const data = await up.json();
      if (up.ok && data.path) {
        pushStudioHistory("Face-swap: face uploaded");
        const img: UploadedImage = {
          id: data.id,
          name: data.name,
          path: data.path,
          url: data.url,
          mime: data.mime,
          size: data.size,
          width: data.width,
          height: data.height,
          format: data.format,
          uploadedAt: Date.now(),
        };
        // MULTI-REFERENCE: first image creates the list; otherwise this
        // replaces the ACTIVE slot (the card's drop zone only shows when
        // the list is empty).
        const next: UploadedImage[] = faceList.length
          ? faceList.map((g, gi) => (gi === activeFaceImg ? img : g))
          : [img];
        setFaceList(next);
        setFaceSwapFaceList(next, activeFaceImg);
        setFaceSwapFace(img);
        // Run numbered-face detection on the freshly uploaded file
        if (data.url) await detectFaces("face", data.url, activeFaceImg);
      }
    } catch {
      // ignore
    }
  };

  /** ADD one or MORE reference images (multi-reference feature). */
  const handleAddFaceFiles = async (files: FileList) => {
    setAddingFaces(files.length);
    const added: UploadedImage[] = [];
    for (const f of Array.from(files)) {
      const img = await uploadFaceImage(f);
      if (img) added.push(img);
    }
    setAddingFaces(0);
    if (!added.length) return;
    pushStudioHistory(`Face-swap: +${added.length} reference(s)`);
    const next = [...faceList, ...added].slice(0, 6);
    const newActive = faceList.length; // first newly added
    setFaceList(next);
    setFaceFacesByImage((pb) => {
      const pn = [...pb];
      for (let k = 0; k < added.length; k++) pn[faceList.length + k] = [];
      return pn;
    });
    setFaceSwapFaceList(next, newActive);
    setActiveFaceImg(newActive);
    x(added[0].url);
    e({ title: `تمت إضافة ${added.length} صورة وجه مرجعية` });
    // Detect the first newly added image right away.
    await detectFaces("face", added[0].url, newActive);
  };

  /** Remove reference image i (remap mapping rows that pointed at it). */
  const handleRemoveFaceAt = (i: number) => {
    pushStudioHistory("Face-swap: reference removed");
    const next = faceList.filter((_, di) => di !== i);
    setFaceList(next);
    setFaceFacesByImage((prev) => prev.filter((_, di) => di !== i));
    lastFaceDetectByImage.current = Object.fromEntries(
      Object.entries(lastFaceDetectByImage.current)
        .map(([k, v]) => [Number(k) > i ? Number(k) - 1 : Number(k), v])
        .filter(([k]) => Number(k) < next.length)
    );
    setMappings((ms) =>
      ms.map((mm) => {
        const ri = mm.refImage ?? 0;
        if (ri === i) return { ...mm, refImage: 0, faceIndex: 0 };
        if (ri > i) return { ...mm, refImage: ri - 1 };
        return mm;
      })
    );
    const nextActive = Math.max(0, Math.min(activeFaceImg > i ? activeFaceImg - 1 : activeFaceImg, next.length - 1));
    setActiveFaceImg(nextActive);
    x(next[nextActive]?.url ?? "");
    setFaceSwapFaceList(next, nextActive);
  };

  // M(t) — perform the face swap. t=false → single, t=true → multi
  //
  // MULTI-REFERENCE: mapping rows are GROUPED by refImage (the reference
  // image each row points at). Groups run SEQUENTIALLY — each API call
  // merges the faces of ONE reference image into the current result, and
  // the next group continues from that result (chained). A single group
  // (one reference image) behaves exactly like the old single-image flow.
  const M = async (t = false) => {
    if (!u || !h) {
      e({
        title: "⚠ ارفع صورة مصدر + وجه مرجعي أولاً",
        variant: "destructive",
      });
      return;
    }
    w(true);
    e({
      title: t ? "تبديل متعدد — جارٍ التنفيذ..." : "تبديل الوجه — جارٍ التنفيذ...",
      duration: 2000,
    });
    try {
      // Read the already-uploaded source path from the image store.
      let sourcePath = faceSwapSource?.path;
      if (!sourcePath) {
        const sourceBlob = await (await fetch(u)).blob();
        const sourceFd = new FormData();
        sourceFd.append("file", sourceBlob, "source.png");
        const sourceUp = await fetch("/api/images/upload", {
          method: "POST",
          body: sourceFd,
        });
        const sourceData = await sourceUp.json();
        if (!sourceUp.ok || !sourceData.path) {
          throw new Error("فشل رفع الصورة المصدر");
        }
        sourcePath = sourceData.path;
      }

      // Upload any reference image that has no stable server path yet.
      const refPaths: string[] = [];
      for (let i = 0; i < faceList.length; i++) {
        let p = faceList[i].path;
        if (!p) {
          const fp = await ensureServerPathFor(faceList[i].url, "face");
          if (!fp) throw new Error(`فشل رفع صورة الوجه المرجعية رقم ${i + 1}`);
          p = fp;
        }
        refPaths.push(p);
      }

      // Group the mapping rows by reference image (insertion order kept).
      const groups = new Map<number, Array<{ sourceIndex: number; faceIndex: number }>>();
      for (const mm of mappings) {
        const ri = Math.min(mm.refImage ?? 0, Math.max(0, refPaths.length - 1));
        const arr = groups.get(ri) ?? [];
        arr.push({ sourceIndex: mm.sourceIndex, faceIndex: mm.faceIndex });
        groups.set(ri, arr);
      }

      /** Run the full grouped chain once; returns the final API result. */
      const runChain = async () => {
        let current = sourcePath!;
        let last: any = null;
        for (const [ri, pairs] of groups) {
          const r = await fetch("/api/images/face-swap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourcePath: current,
              facePath: refPaths[ri],
              // Send per-face indices when BOTH sides were detected so the
              // numbering is guaranteed consistent; otherwise defaults.
              ...(sourceFaces.length > 0 ? { mappings: pairs } : {}),
            }),
          });
          if (!r.ok) {
            const errBody = await r.json().catch(() => ({}));
            throw new Error(errBody.message ?? errBody.error ?? `HTTP ${r.status}`);
          }
          last = await r.json();
          // Chain: the next reference-image group edits THIS result.
          current = last.path ?? last.url;
        }
        return last;
      };

      if (t) {
        // Multi mode: repeat the whole chain 3 times
        const results: string[] = [];
        for (let i = 0; i < 3; i++) {
          const d = await runChain();
          if (d?.url) results.push(d.url);
        }
        y(results);
        e({ title: "✅ تم توليد النتائج المتعددة" });
      } else {
        const d = await runChain();
        if (d?.url) {
          v(d.url);
          // Save to image store so the Garment Editor's "faceSwap"
          // sub-tab can show it as the "result" target.
          pushStudioHistory("Face-swap: completed");
          setFaceSwapResult({
            id: `face-swap-${Date.now()}`,
            name: "face-swap-result",
            path: d.path ?? d.url,
            url: d.url,
            mime: "image/png",
            size: d.size ?? 0,
            width: d.width ?? 0,
            height: d.height ?? 0,
            format: "png",
            uploadedAt: Date.now(),
          });
          e({ title: "✅ تم تبديل الوجه" });
        } else {
          throw new Error("لم يتم إرجاع صورة النتيجة");
        }
      }
    } catch (t) {
      e({
        title: "فشل التبديل",
        description: String(t),
        variant: "destructive",
      });
    } finally {
      w(false);
    }
  };

  // Click a box → assign that face (of the ACTIVE reference image) to the
  // ACTIVE mapping row.
  const setInActiveRow = (kind: "face" | "source", idx: number) => {
    setMappings((ms) => {
      if (!ms.length) return ms;
      const i = Math.min(activeRow, ms.length - 1);
      const next = [...ms];
      next[i] =
        kind === "face"
          ? { ...next[i], faceIndex: idx, refImage: activeFaceImg }
          : { ...next[i], sourceIndex: idx };
      return next;
    });
  };

  // Box highlighting per reference image: a box is "mapped" when some row
  // points at THIS image with that face index.
  const mappedRefSetFor = (imgIdx: number) =>
    new Set(mappings.filter((mm) => (mm.refImage ?? 0) === imgIdx).map((mm) => mm.faceIndex));
  const mappedRefSet = mappedRefSetFor(activeFaceImg);
  const mappedSrcSet = new Set(mappings.map((mm) => mm.sourceIndex));
  const totalDetectedFaces = faceFacesByImage.reduce((acc, f) => acc + (f?.length ?? 0), 0);
  const bothDetected = sourceFaces.length > 0 && totalDetectedFaces > 0;
  const multiFace = sourceFaces.length > 1 || totalDetectedFaces > 1 || faceList.length > 1;
  const activeFaceFaces = faceFacesByImage[activeFaceImg] ?? faceFaces;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto w-full" dir="rtl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* ===== LEFT COLUMN ===== */}
        <div className="space-y-4">
          {/* Source card — violet gradient */}
          <Card className="p-4 space-y-3 border-violet-500/30 bg-gradient-to-br from-violet-50 via-white to-purple-50 dark:from-violet-950/20 dark:via-card dark:to-purple-950/20">
            <div>
              <div className="text-xs font-bold mb-1">الصورة المصدر</div>
              <div className="text-[10px] text-muted-foreground">
                الصورة المراد تغيير وجهها
              </div>
            </div>
            <div className="relative rounded-md bg-muted/30 border border-border/60 overflow-hidden" style={{ minHeight: "200px" }}>
              {u ? (
                <div className="relative w-fit max-w-full mx-auto">
                  <img
                    src={u}
                    alt="source"
                    className="block max-w-full max-h-[70vh] w-auto h-auto"
                  />
                  {/* Numbered face boxes (1 = الأكبر) */}
                  {sourceFaces.map((f) => (
                    <FaceBox
                      key={`src-${f.index}`}
                      face={f}
                      accent="violet"
                      mapped={mappedSrcSet.has(f.index)}
                      onClick={() => setInActiveRow("source", f.index)}
                    />
                  ))}
                  {detecting.source && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
                      <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => k.current?.click()}
                  className="absolute inset-0 min-h-[200px] flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Upload className="w-10 h-10" />
                  <span className="text-xs">
                    أفلت صورة المصدر هنا أو انقر للتصفح
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    PNG / JPG / WEBP
                  </span>
                </button>
              )}
              {u && (
                <button
                  onClick={() => m("")}
                  className="absolute top-2 end-2 w-6 h-6 rounded-full bg-background/80 flex items-center justify-center z-30"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {/* Detection status chip */}
            {u && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                {detecting.source ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>جارٍ رصد الوجوه...</span>
                  </>
                ) : sourceFaces.length > 0 ? (
                  <>
                    <ScanFace className="w-3 h-3 text-emerald-500" />
                    <span>
                      رُصد {sourceFaces.length} {sourceFaces.length === 1 ? "وجه" : "وجوه"} — انقر مربعاً لتعيينه
                    </span>
                  </>
                ) : (
                  <>
                    <ScanFace className="w-3 h-3" />
                    <span>لم يُرصد وجوه في هذه الصورة</span>
                  </>
                )}
              </div>
            )}
            {u && <ActionBar url={u} label="source" />}
            {/* 5-level Enhance Quality buttons — same pipeline as Image Tools */}
            {u && (
              <EnhanceQualityButtons
                sourcePath={u}
                onEnhanced={(result) => {
                  m(result.url);
                }}
                variant="compact"
              />
            )}
          </Card>

          {/* Face reference card — fuchsia gradient (MULTI-REFERENCE) */}
          <Card className="p-4 space-y-3 border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-50 via-white to-pink-50 dark:from-fuchsia-950/20 dark:via-card dark:to-pink-950/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold mb-1">الوجه المرجعي</div>
                <div className="text-[10px] text-muted-foreground">
                  الوجه المراد إدراجه {faceList.length > 1 ? `— ${faceList.length} صور مرجعية` : ""}
                </div>
              </div>
              {faceList.length > 1 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-500/10 text-fuchsia-500 ring-1 ring-fuchsia-400/40">
                  مرجع {activeFaceImg + 1} / {faceList.length}
                </span>
              )}
            </div>
            <div className="relative rounded-md bg-muted/30 border border-border/60 overflow-hidden" style={{ minHeight: "200px" }}>
              {h ? (
                <div className="relative w-fit max-w-full mx-auto">
                  <img
                    src={h}
                    alt="reference"
                    className="block max-w-full max-h-[70vh] w-auto h-auto"
                  />
                  {/* Numbered face boxes (1 = الأكبر) */}
                  {activeFaceFaces.map((f) => (
                    <FaceBox
                      key={`ref-${f.index}`}
                      face={f}
                      accent="fuchsia"
                      mapped={mappedRefSet.has(f.index)}
                      onClick={() => setInActiveRow("face", f.index)}
                    />
                  ))}
                  {(detecting.face || addingFaces > 0) && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
                      <Loader2 className="w-6 h-6 animate-spin text-fuchsia-500" />
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => N.current?.click()}
                  className="absolute inset-0 min-h-[200px] flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Upload className="w-10 h-10" />
                  <span className="text-xs">
                    أفلت الوجه المرجعي هنا أو انقر للتصفح
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    PNG / JPG / WEBP
                  </span>
                </button>
              )}
              {h && (
                <button
                  onClick={() => handleRemoveFaceAt(activeFaceImg)}
                  className="absolute top-2 end-2 w-6 h-6 rounded-full bg-background/80 flex items-center justify-center z-30"
                  title="حذف صورة المرجع"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* ===== Multi-reference thumbnail strip ===== */}
            {faceList.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {faceList.map((g, i) => (
                  <div
                    key={`${g.path}-${i}`}
                    className={`relative h-14 w-14 shrink-0 rounded-md overflow-hidden ring-2 cursor-pointer transition-all ${
                      i === activeFaceImg
                        ? "ring-fuchsia-400 opacity-100"
                        : "ring-transparent opacity-60 hover:opacity-100"
                    }`}
                    onClick={() => {
                      setActiveFaceImg(i);
                      x(g.url);
                    }}
                    title={`مرجع ${i + 1}`}
                  >
                    <img src={g.url} alt={`face-ref-${i + 1}`} className="h-full w-full object-cover" draggable={false} />
                    <span className="absolute top-0 start-0 bg-fuchsia-500 text-white text-[9px] font-bold px-1 rounded-br-md">
                      {i + 1}
                    </span>
                    <span className="absolute bottom-0 end-0 bg-black/70 text-white text-[8px] px-1 rounded-tl-md">
                      {(faceFacesByImage[i]?.length ?? 0) > 0 ? `${faceFacesByImage[i].length} وجه` : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        handleRemoveFaceAt(i);
                      }}
                      className="absolute top-0 end-0 h-4 w-4 bg-black/70 text-white flex items-center justify-center hover:bg-red-500"
                      title="حذف"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {faceList.length < 6 && (
                  <button
                    type="button"
                    onClick={() => addFaceInputRef.current?.click()}
                    className="h-14 w-14 shrink-0 rounded-md border border-dashed border-fuchsia-400/50 text-fuchsia-500 flex flex-col items-center justify-center gap-0.5 hover:bg-fuchsia-500/10 transition-colors"
                    title="إضافة صورة وجه مرجعية أخرى"
                  >
                    {addingFaces > 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    <span className="text-[8px] leading-none">إضافة</span>
                  </button>
                )}
              </div>
            )}
            {faceList.length > 1 && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                يمكنك إضافة عدة صور وجوه وربط كل شخص في المصدر بوجه من صورة مختلفة — كل مجموعة تُنفّذ بالتتابع.
              </p>
            )}

            {/* Detection status chip */}
            {h && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                {detecting.face ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>جارٍ رصد الوجوه...</span>
                  </>
                ) : activeFaceFaces.length > 0 ? (
                  <>
                    <ScanFace className="w-3 h-3 text-emerald-500" />
                    <span>
                      {faceList.length > 1 ? `مرجع ${activeFaceImg + 1}: ` : ""}رُصد {activeFaceFaces.length} {activeFaceFaces.length === 1 ? "وجه" : "وجوه"} — انقر مربعاً لتعيينه
                    </span>
                  </>
                ) : (
                  <>
                    <ScanFace className="w-3 h-3" />
                    <span>لم يُرصد وجوه في هذه الصورة</span>
                  </>
                )}
              </div>
            )}
            {h && <ActionBar url={h} label="reference" />}
            {/* 5-level Enhance Quality buttons */}
            {h && (
              <EnhanceQualityButtons
                sourcePath={h}
                onEnhanced={(result) => {
                  x(result.url);
                  const next = faceList.map((g, gi) =>
                    gi === activeFaceImg
                      ? { ...g, url: result.url, path: result.path, width: result.width, height: result.height, size: result.size }
                      : g
                  );
                  setFaceList(next);
                  setFaceSwapFaceList(next, activeFaceImg);
                }}
                variant="compact"
              />
            )}
          </Card>

          {/* ===== Face mapping (ربط الوجوه) ===== */}
          {bothDetected && (
            <Card className="p-3 space-y-2 border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-bold">ربط الوجوه</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[10px]"
                  onClick={redetectBoth}
                  disabled={detecting.source || detecting.face}
                >
                  <RefreshCw className={`w-3 h-3 me-1 ${detecting.source || detecting.face ? "animate-spin" : ""}`} />
                  إعادة الرصد
                </Button>
              </div>

              {!multiFace ? (
                <p className="text-[10px] text-muted-foreground">
                  ✅ تم رصد وجه واحد في كل صورة — سيتم الدمج تلقائياً (المصدر ① ← المرجع ①).
                </p>
              ) : (
                <div className="space-y-1.5">
                  {mappings.map((mm, i) => {
                    const rowRefImage = Math.min(mm.refImage ?? 0, Math.max(0, Math.max(faceList.length, 1) - 1));
                    const rowFaces = faceFacesByImage[rowRefImage] ?? [];
                    return (
                    <div
                      key={i}
                      onClick={() => setActiveRow(i)}
                      className={`flex items-center gap-1.5 p-1.5 rounded-md border cursor-pointer transition-colors ${
                        i === activeRow
                          ? "border-emerald-400 bg-emerald-400/10"
                          : "border-border/60 bg-background/40"
                      }`}
                    >
                      <span className="text-[10px] font-bold text-muted-foreground w-4 text-center">
                        {i + 1}.
                      </span>
                      {faceList.length > 1 && (
                        <select
                          value={rowRefImage}
                          onChange={(ev) =>
                            setMappings((ms) => {
                              const next = [...ms];
                              next[i] = { ...next[i], refImage: Number(ev.target.value), faceIndex: 0 };
                              return next;
                            })
                          }
                          className="h-7 rounded-md border border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300 text-[11px] px-1.5 w-[72px] shrink-0"
                          title="صورة المرجع"
                        >
                          {faceList.map((_, ri) => (
                            <option key={ri} value={ri}>مرجع {ri + 1}</option>
                          ))}
                        </select>
                      )}
                      <select
                        value={mm.faceIndex}
                        onChange={(ev) =>
                          setMappings((ms) => {
                            const next = [...ms];
                            next[i] = { ...next[i], faceIndex: Number(ev.target.value) };
                            return next;
                          })
                        }
                        className="h-7 rounded-md border border-fuchsia-300/60 bg-background text-[11px] px-1.5 flex-1"
                        title="وجه المرجع"
                      >
                        {rowFaces.length === 0 && (
                          <option value={mm.faceIndex}>لا رصد في هذا المرجع</option>
                        )}
                        {rowFaces.map((f) => (
                          <option key={f.index} value={f.index}>
                            {faceList.length > 1 ? `مرجع ${rowRefImage + 1} · ` : "مرجع "}{f.index + 1}
                          </option>
                        ))}
                      </select>
                      <ArrowLeft className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <select
                        value={mm.sourceIndex}
                        onChange={(ev) =>
                          setMappings((ms) => {
                            const next = [...ms];
                            next[i] = { ...next[i], sourceIndex: Number(ev.target.value) };
                            return next;
                          })
                        }
                        className="h-7 rounded-md border border-violet-300/60 bg-background text-[11px] px-1.5 flex-1"
                        title="وجه المصدر"
                      >
                        {sourceFaces.map((f) => (
                          <option key={f.index} value={f.index}>
                            مصدر {f.index + 1}
                          </option>
                        ))}
                      </select>
                      {mappings.length > 1 && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setMappings((ms) => ms.filter((_, di) => di !== i));
                            setActiveRow(0);
                          }}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-red-400 hover:bg-red-500/10 shrink-0"
                          title="حذف الربط"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    );
                  })}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-full text-[10px]"
                    onClick={() => {
                      setMappings((ms) => [...ms, { faceIndex: 0, sourceIndex: 0, refImage: 0 }]);
                      setActiveRow(mappings.length);
                    }}
                    disabled={mappings.length >= 6}
                  >
                    <Plus className="w-3 h-3 me-1" />
                    إضافة ربط آخر
                  </Button>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    كل صف = دمج وجه من صورة مرجعية (اختر "مرجع" عند تعدد الصور) في وجه مصدر. انقر على صف ثم انقر المربعات المرقمة
                    لتعيينه. الرقم ① دائماً الوجه الأكبر في الصورة.
                  </p>
                </div>
              )}
            </Card>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              onClick={() => M(false)}
              disabled={j || !u || !h}
              className="flex-1 h-10 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0"
            >
              {j ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 me-2" />
              )}
              <span className="text-xs font-medium">ابدأ التبديل</span>
            </Button>
            <Button
              onClick={() => M(true)}
              disabled={j || !u || !h}
              variant="outline"
              className="h-10"
            >
              {j ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Layers className="w-4 h-4 me-2" />
              )}
              <span className="text-xs font-medium">نتائج متعددة</span>
            </Button>
          </div>

          {/* Hidden file inputs */}
          <input
            ref={k}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => {
              const t = ev.target.files?.[0];
              if (t) C(t, handleSourcePicked);
              ev.currentTarget.value = "";
            }}
          />
          <input
            ref={N}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => {
              const t = ev.target.files?.[0];
              if (t) C(t, handleFacePicked);
              ev.currentTarget.value = "";
            }}
          />
          <input
            ref={addFaceInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(ev) => {
              const files = ev.target.files;
              if (files?.length) void handleAddFaceFiles(files);
              ev.currentTarget.value = "";
            }}
          />
        </div>

        {/* ===== RIGHT COLUMN: Preview ===== */}
        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-bold">المعاينة</h2>

          {p ? (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-medium">تبديل واحد</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date().toLocaleTimeString()}
                  </span>
                </div>
                <div className="relative rounded-md overflow-hidden bg-muted/30 ring-2 ring-violet-500/30" style={{ minHeight: "200px" }}>
                  <img
                    src={p}
                    alt="result"
                    className="block w-full h-auto mx-auto"
                    style={{ maxHeight: "70vh", objectFit: "contain" }}
                  />
                  {/* Close (X) button — same style as source/face cards */}
                  <button
                    onClick={() => v("")}
                    className="absolute top-2 end-2 w-6 h-6 rounded-full bg-background/80 flex items-center justify-center z-10"
                    title="إغلاق النتيجة"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <ActionBar url={p} label="result" />
                {/* Progress indicator — shows during swap + estimated time */}
                <ProgressIndicator
                  busy={j}
                  label="جارٍ تبديل الوجه..."
                  className="mt-2"
                />
                {/* 5-level Enhance Quality buttons for the swap result */}
                <EnhanceQualityButtons
                  sourcePath={p}
                  onEnhanced={(result) => v(result.url)}
                  variant="compact"
                  className="mt-2"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-violet-500 hover:bg-violet-500/10 w-full mt-2"
                  onClick={() => m(p)}
                >
                  <Wand2 className="w-3.5 h-3.5 me-1" />
                  <span className="text-xs">استخدم كمدخل</span>
                </Button>
              </div>
            </div>
          ) : b.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {b.map((url, i) => (
                  <div className="space-y-2" key={i}>
                    <div className="relative rounded-md overflow-hidden bg-muted/30 ring-2 ring-violet-500/30" style={{ minHeight: "150px" }}>
                      <img
                        src={url}
                        alt={`variation-${i}`}
                        className="block w-full h-auto"
                        style={{ maxHeight: "50vh", objectFit: "contain" }}
                      />
                    </div>
                    <ActionBar url={url} label={`variation-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-muted/30 border border-dashed border-border/60 flex flex-col items-center justify-center gap-2 text-muted-foreground p-4" style={{ minHeight: "300px" }}>
              {multiFace ? (
                <>
                  <Users className="w-10 h-10 opacity-50" />
                  <span className="text-xs">عدة أشخاص في الصور</span>
                  <span className="text-[10px] text-center">
                    استخدم «ربط الوجوه» لتحديد أي مرجع يدمج مع أي مصدر
                  </span>
                </>
              ) : (
                <>
                  <Layers className="w-10 h-10 opacity-50" />
                  <span className="text-xs">لا توجد نتائج بعد</span>
                  <span className="text-[10px]">
                    ارفع مصدراً + مرجعاً ثم اضغط ابدأ التبديل
                  </span>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export { FaceSwapApp as FaceSwapPanel };
