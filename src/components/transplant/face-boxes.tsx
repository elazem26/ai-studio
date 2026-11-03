"use client";

/**
 * FaceBoxes — المربعات المرقمة فوق الصورة.
 *
 * تُرسم فوق معاينة الصورة (absolute) وتعرض كل وجه برقمه (1، 2، 3…).
 * الضغط على المربع يختار ذلك الشخص (يُرسل رقمه للخادم كـ sourceIndex/faceIndex).
 * الترتيب مطابق لترتيب الخادم (الأكبر مساحةً أولاً) لذا الرقم 1 = الشخص الأبرز.
 */

export type FaceBox = {
  index: number;
  bbox: [number, number, number, number]; // x1,y1,x2,y2 — نسب من 0 إلى 1
};

export function FaceBoxes({
  faces,
  selected,
  tone,
  onPick,
}: {
  faces: FaceBox[];
  selected: number | null;
  /** cyan = صورة المصدر، fuchsia = صورة المرجع */
  tone: "cyan" | "fuchsia";
  onPick: (index: number) => void;
}) {
  if (!faces?.length) return null;
  const border =
    tone === "cyan"
      ? { sel: "border-cyan-400", bg: "bg-cyan-400/15", badge: "bg-cyan-500" }
      : { sel: "border-fuchsia-400", bg: "bg-fuchsia-400/15", badge: "bg-fuchsia-500" };
  return (
    <div className="absolute inset-0 pointer-events-none">
      {faces.map((f) => {
        const [x1, y1, x2, y2] = f.bbox || [0, 0, 0, 0];
        const isSel = selected === f.index;
        return (
          <button
            key={f.index}
            type="button"
            aria-label={`اختيار الشخص ${f.index + 1}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPick(f.index);
            }}
            className={`pointer-events-auto absolute rounded-md border-2 transition-all cursor-pointer ${
              isSel
                ? `${border.sel} ${border.bg} shadow-[0_0_0_2px_rgba(255,255,255,0.35)]`
                : "border-white/80 border-dashed hover:border-white bg-white/5 hover:bg-white/15"
            }`}
            style={{
              left: `${Math.max(0, x1) * 100}%`,
              top: `${Math.max(0, y1) * 100}%`,
              width: `${Math.max(0.02, x2 - x1) * 100}%`,
              height: `${Math.max(0.02, y2 - y1) * 100}%`,
            }}
          >
            <span
              className={`absolute -top-0.5 -translate-y-full start-0 min-w-[22px] h-[22px] px-1 rounded-full ${isSel ? border.badge : "bg-black/70"} text-white text-[12px] font-bold flex items-center justify-center border border-white/60`}
            >
              {f.index + 1}
            </span>
            {isSel && (
              <span className="absolute -bottom-0.5 translate-y-full start-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white border border-white/40 whitespace-nowrap">
                ✓ مختار
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
