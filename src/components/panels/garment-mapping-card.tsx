"use client";

import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import {
  useGarmentMappingStore,
  type GarmentMapping,
} from "@/stores/garment-mapping-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Link2,
  Plus,
  RefreshCw,
  X,
  ArrowLeft,
  ScanFace,
  MousePointerClick,
  Images,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Studio tab — "ربط الأشخاص بالملابس" card.
 *
 * Appears between the 3-panel grid and the ControlBar whenever a source
 * image and/or a garment image is loaded. Shows:
 *   - a master toggle for the numbered-box swap mode
 *   - mapping rows (reference outfit N → source person M)
 *   - a re-detect button
 *
 * The actual swap runs when the user presses the main Generate button
 * (ControlBar routes to /api/images/garment-swap with these mappings).
 */
export function GarmentMappingCard() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const isAr = locale === "ar";
  const source = useImageStore((s) => s.source);
  const garment = useImageStore((s) => s.garment);
  const garmentList = useImageStore((s) => s.garmentList);
  const refList = garmentList.length ? garmentList : garment ? [garment] : [];

  const enabled = useGarmentMappingStore((s) => s.enabled);
  const setEnabled = useGarmentMappingStore((s) => s.setEnabled);
  const srcBoxes = useGarmentMappingStore((s) => s.srcBoxes);
  const refBoxesByImage = useGarmentMappingStore((s) => s.refBoxesByImage);
  const refBoxes = useGarmentMappingStore((s) => s.refBoxes);
  const detecting = useGarmentMappingStore((s) => s.detecting);
  const mappings = useGarmentMappingStore((s) => s.mappings);
  const setMappings = useGarmentMappingStore((s) => s.setMappings);
  const activeRow = useGarmentMappingStore((s) => s.activeRow);
  const setActiveRow = useGarmentMappingStore((s) => s.setActiveRow);
  const bumpDetect = useGarmentMappingStore((s) => s.bumpDetect);

  // Nothing to map until at least one image exists.
  if (!source && !garment) return null;

  const totalRefBoxes = refBoxesByImage.reduce((acc, b) => acc + (b?.length ?? 0), 0);
  const bothReady = srcBoxes.length > 0 && totalRefBoxes > 0;
  const anyDetecting = detecting.source || detecting.ref;

  const updateRow = (i: number, patch: Partial<GarmentMapping>) =>
    setMappings(mappings.map((m, mi) => (mi === i ? { ...m, ...patch } : m)));

  return (
    <div
      className={cn(
        "studio-panel p-3 sm:p-4 rounded-lg border transition-colors",
        enabled && bothReady
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-panel-border"
      )}
    >
      {/* Header: title + toggle + re-detect */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30 flex items-center justify-center text-xs font-bold">
          <Link2 className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold">
          {isAr
            ? "ربط الأشخاص بالملابس (مربعات مرقمة)"
            : "Person ↔ Outfit mapping (numbered boxes)"}
        </h2>

        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-bold ring-1 transition-colors",
            enabled
              ? "bg-emerald-500 text-white ring-emerald-400 hover:bg-emerald-600"
              : "bg-muted/50 text-muted-foreground ring-border hover:bg-muted"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              enabled ? "bg-white" : "bg-muted-foreground"
            )}
          />
          {enabled
            ? isAr
              ? "الوضع الممكّن"
              : "Enabled"
            : isAr
              ? "معطّل — التبديل العادي"
              : "Off — normal swap"}
        </button>

        <div className="flex-1" />

        {(source || garment) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[10px]"
            onClick={() => {
              bumpDetect("source");
              bumpDetect("ref");
            }}
            disabled={anyDetecting}
          >
            <RefreshCw
              className={cn("h-3 w-3 me-1", anyDetecting && "animate-spin")}
            />
            {isAr ? "إعادة الرصد" : "Re-detect"}
          </Button>
        )}
      </div>

      {/* Body */}
      {!enabled ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {isAr
            ? "الوضع معطّل — سيتم التبديل على الصورة كاملة. فعّله لتحديد الأشخاص بالمربعات المرقمة."
            : "Disabled — the swap runs on the full image. Enable it to pick persons with numbered boxes."}
        </p>
      ) : !bothReady ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          <MousePointerClick className="h-3.5 w-3.5 text-cyan-accent" />
          {anyDetecting ? (
            <span className="text-cyan-accent">
              {isAr ? "جارٍ رصد الأشخاص..." : "Detecting persons..."}
            </span>
          ) : !source || !garment ? (
            <span>
              {isAr
                ? "ارفع صورة المصدر وصورة الملابس المرجعية لظهر المربعات المرقمة."
                : "Upload both a source and a garment reference image to see numbered boxes."}
            </span>
          ) : srcBoxes.length === 0 && totalRefBoxes === 0 ? (
            <span>
              {isAr
                ? "لم يُرصد أي شخص في الصور — تأكد من وضوح الأشخاص أو جرّب إعادة الرصد."
                : "No persons detected in either image — make sure people are visible or re-detect."}
            </span>
          ) : (
            <span>
              {isAr
                ? `رُصد ${srcBoxes.length} شخص في المصدر و ${totalRefBoxes} ملابس في المراجع — بانتظار اكتمال الطرف الآخر.`
                : `${srcBoxes.length} source persons and ${totalRefBoxes} reference outfits detected.`}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {mappings.map((m, i) => {
            const rowRefImage = Math.min(m.refImage ?? 0, Math.max(0, refList.length - 1));
            const rowRefBoxes = refBoxesByImage[rowRefImage] ?? [];
            return (
            <div
              key={i}
              onClick={() => setActiveRow(i)}
              className={cn(
                "flex items-center gap-1.5 p-1.5 rounded-md border cursor-pointer flex-wrap",
                i === activeRow
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-border/60 bg-background/40"
              )}
            >
              <span className="text-[10px] font-bold text-muted-foreground w-4 text-center">
                {i + 1}.
              </span>
              {refList.length > 1 && (
                <select
                  value={rowRefImage}
                  onChange={(e) => updateRow(i, { refImage: Number(e.target.value), refIndex: 0 })}
                  className="h-7 rounded-md border border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-200 text-[11px] px-1.5 w-[74px] shrink-0"
                  title={isAr ? "صورة المرجع" : "Reference image"}
                >
                  {refList.map((_, ri) => (
                    <option key={ri} value={ri} className="bg-background text-foreground">
                      {isAr ? `مرجع ${ri + 1}` : `Ref img ${ri + 1}`}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={m.refIndex}
                onChange={(e) => updateRow(i, { refIndex: Number(e.target.value) })}
                className="h-7 rounded-md border border-fuchsia-300/60 bg-background text-[11px] px-1.5 flex-1 min-w-[110px]"
              >
                {rowRefBoxes.length === 0 && (
                  <option value={m.refIndex}>
                    {isAr ? "لا رصد في هذا المرجع" : "No detection"}
                  </option>
                )}
                {rowRefBoxes.map((b) => (
                  <option key={b.index} value={b.index}>
                    {isAr ? `ملابس مرجع ${b.index + 1}` : `Ref outfit ${b.index + 1}`}
                  </option>
                ))}
              </select>
              <ArrowLeft className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <select
                value={m.sourceIndex}
                onChange={(e) =>
                  updateRow(i, { sourceIndex: Number(e.target.value) })
                }
                className="h-7 rounded-md border border-cyan-300/60 bg-background text-[11px] px-1.5 flex-1 min-w-[110px]"
              >
                {srcBoxes.map((b) => (
                  <option key={b.index} value={b.index}>
                    {isAr ? `شخص مصدر ${b.index + 1}` : `Source person ${b.index + 1}`}
                  </option>
                ))}
              </select>
              {mappings.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMappings(mappings.filter((_, di) => di !== i));
                    setActiveRow(0);
                  }}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-red-400 hover:bg-red-500/10 shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            );
          })}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              onClick={() => {
                setMappings([...mappings, { sourceIndex: 0, refIndex: 0, refImage: 0 }]);
                setActiveRow(mappings.length);
              }}
              disabled={mappings.length >= 6}
            >
              <Plus className="h-3 w-3 me-1" />
              {isAr ? "إضافة ربط آخر" : "Add mapping"}
            </Button>
            {refList.length > 1 && (
              <Badge variant="outline" className="text-[10px] h-6 gap-1 border-fuchsia-400/40 text-fuchsia-300">
                <Images className="h-3 w-3" />
                {isAr
                  ? `${refList.length} صور مرجعية — اختر صورة لكل صف`
                  : `${refList.length} reference images — pick one per row`}
              </Badge>
            )}
            <p className="text-[10px] text-muted-foreground leading-relaxed flex-1 min-w-[200px]">
              {isAr
                ? "انقر مربعاً مرقماً على أي صورة لتعيينه للصف النشط، ثم اضغط زر التوليد بالأسفل لتنفيذ التبديل الدقيق."
                : "Click a numbered box on either image to assign it to the active row, then press Generate below."}
            </p>
          </div>
        </div>
      )}

      {/* Detection status chips */}
      {enabled && (source || garment) && (
        <div className="mt-2 flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <ScanFace
              className={cn(
                "h-3 w-3",
                srcBoxes.length ? "text-emerald-500" : "opacity-50"
              )}
            />
            {detecting.source
              ? isAr
                ? "جارٍ رصد المصدر..."
                : "Detecting source..."
              : isAr
                ? `المصدر: ${srcBoxes.length} شخص`
                : `Source: ${srcBoxes.length} persons`}
          </span>
          <span className="flex items-center gap-1">
            <ScanFace
              className={cn(
                "h-3 w-3",
                totalRefBoxes ? "text-emerald-500" : "opacity-50"
              )}
            />
            {detecting.ref
              ? isAr
                ? "جارٍ رصد المراجع..."
                : "Detecting references..."
              : refList.length > 1
                ? isAr
                  ? `المراجع: ${refBoxesByImage.map((b, i) => `${i + 1}:${b?.length ?? 0}`).join(" · ")} ملابس`
                  : `Refs: ${refBoxesByImage.map((b, i) => `${i + 1}:${b?.length ?? 0}`).join(" · ")} outfits`
                : isAr
                  ? `المرجع: ${refBoxes.length} ملابس`
                  : `Reference: ${refBoxes.length} outfits`}
          </span>
        </div>
      )}
    </div>
  );
}
