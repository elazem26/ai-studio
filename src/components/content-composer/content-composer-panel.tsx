"use client";

import { ComposerImageBox } from "./image-box";
import { ComposerChat } from "./composer-chat";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useComposerStore } from "./store";

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
 * تبويب «إضافة محتوى إلى الصورة» — وكيل دمج ذكي:
 * صورة مصدر (رجل) + صورة مرجع (امرأة) + دردشة نصية وصوتية
 * ← يبني صورة واحدة للمشهد المطلوب (مثل حفل الزفاف) مع المحافظة على الملامح.
 */
export function ContentComposerPanel() {
  const size = useComposerStore((s) => s.size);
  const setSize = useComposerStore((s) => s.setSize);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* رأس الصفحة */}
      <header className="studio-panel rounded-2xl border border-border bg-muted/20 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold">➕ إضافة محتوى إلى الصورة</h1>
          <p className="text-xs text-muted-foreground">
            اجمع شخصين في صورة واحدة لأي منظر تطلبه — عبر وكيل ذكي يفهم ويحلل ويطبّق، مع المحافظة على ملامح الوجه الحقيقية
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
