"use client";

import { ComposerImageBox } from "./image-box";
import { ComposerChat } from "./composer-chat";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useComposerStore, POSE_OPTIONS } from "./store";

const SIZE_OPTIONS = [
  { value: "auto", label: "تلقائي — الوكيل يختار الأنسب" },
  { value: "1024x1024", label: "مربع — 1024×1024" },
  { value: "768x1344", label: "عمودي طويل — 768×1344" },
  { value: "864x1152", label: "عمودي — 864×1152" },
  { value: "1344x768", label: "أفقي عريض — 1344×768" },
  { value: "1152x864", label: "أفقي — 1152×864" },
  { value: "1440x720", label: "بانورامي — 1440×720" },
  { value: "720x1440", label: "ستوري — 720×1440" },
];

/**
 * تبويب «إضافة محتوى إلى الصورة» — وكيل دمج ذكي متعدد (v2):
 *  - عدة صور مصدر + عدة صور مرجعية (دمج أكثر من شخص من كل جهة).
 *  - شخصيات بالاسم: اذكر الرئيس/الفنان في طلبك وسأبحث عن صورته الحقيقية.
 *  - وضعيات جاهزة (تبادل الأحضان، القبلات، المصافحة...) + أي وضعية تكتبها.
 *  - اختيار حجم الصورة + دردشة كتابة وصوت + قفل ملامح الوجوه الحقيقية.
 *  - الأزرار السبعة تحت كل مربع مع إظهار كامل الصور دائمًا (fit-to-box).
 */
export function ContentComposerPanel() {
  const size = useComposerStore((s) => s.size);
  const setSize = useComposerStore((s) => s.setSize);
  const poses = useComposerStore((s) => s.poses);
  const togglePose = useComposerStore((s) => s.togglePose);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* رأس الصفحة */}
      <header className="studio-panel rounded-2xl border border-border bg-muted/20 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold">➕ إضافة محتوى إلى الصورة</h1>
          <p className="text-xs text-muted-foreground">
            دمج عدة أشخاص من عدة صور — أو مع أي شخصية تذكرها بالاسم — في صورة واقعية لأي منظر ووضعية، مع قفل ملامح الوجوه الحقيقية لكل شخص
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:inline">حجم الصورة:</span>
          <Select value={size || "auto"} onValueChange={(v) => setSize(v === "auto" ? "" : v)}>
            <SelectTrigger className="w-[210px] h-9 text-xs" aria-label="اختيار حجم الصورة">
              <SelectValue placeholder="حجم الصورة" />
            </SelectTrigger>
            <SelectContent>
              {SIZE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* الوضعيات الجاهزة */}
      <section className="studio-panel rounded-2xl border border-border bg-muted/20 px-3 py-2.5" aria-label="اختيار الوضعية">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold shrink-0">وضعية الأشخاص:</span>
          {POSE_OPTIONS.map((p) => {
            const active = poses.includes(p.id);
            return (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                className={`h-7 px-2.5 text-[11px] rounded-full ${active ? "" : "text-muted-foreground"}`}
                onClick={() => togglePose(p.id)}
                aria-pressed={active}
                title={active ? "إلغاء اختيار الوضعية" : "اختيار الوضعية"}
              >
                <span aria-hidden="true">{p.emoji}</span>
                {p.label}
              </Button>
            );
          })}
          <span className="text-[10px] text-muted-foreground">أو اكتب أي وضعية بنفسك في الدردشة</span>
        </div>
      </section>

      {/* المربعات الثلاثة */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ComposerImageBox box="source" />
        <ComposerImageBox box="reference" />
        <ComposerImageBox box="result" />
      </div>

      {/* الدردشة مع الوكيل */}
      <ComposerChat />
    </div>
  );
}
