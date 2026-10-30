"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Monitor, Tablet, Smartphone, Check, Loader2, Sparkles } from "lucide-react";

export type DeviceType = "computer" | "tablet" | "phone";

export const DEVICE_INFO: Record<DeviceType, { label: string; desc: string; icon: any; color: string }> = {
  computer: { label: "كمبيوتر", desc: "شاشة كبيرة — وضع كامل الميزات", icon: Monitor, color: "from-cyan-500 to-blue-500" },
  tablet: { label: "تابلت", desc: "شاشة متوسطة", icon: Tablet, color: "from-violet-500 to-fuchsia-500" },
  phone: { label: "هاتف", desc: "شاشة صغيرة — وضع مبسط", icon: Smartphone, color: "from-emerald-500 to-teal-500" },
};

export function DeviceSelector({ onSelected, mode = "after-login" }: { onSelected?: (d: DeviceType) => void; mode?: "after-login" | "switch" }) {
  const router = useRouter();
  const [selected, setSelected] = useState<DeviceType | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedDevice, setSavedDevice] = useState<DeviceType | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setSavedDevice(localStorage.getItem("userDevice") as DeviceType | null);
  }, []);

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      localStorage.setItem("userDevice", selected);
      await new Promise(r => setTimeout(r, 400));
      if (onSelected) onSelected(selected); else router.push("/");
    } finally { setSaving(false); }
  };

  if (mode === "switch") {
    return (
      <div className="flex items-center gap-1 p-1 rounded-md bg-muted/20 border border-border" dir="rtl">
        {(Object.keys(DEVICE_INFO) as DeviceType[]).map(d => {
          const info = DEVICE_INFO[d]; const Icon = info.icon; const isActive = savedDevice === d;
          return (
            <button key={d} onClick={() => { localStorage.setItem("userDevice", d); setSavedDevice(d); if (onSelected) onSelected(d); }} title={info.label}
              className={`p-1.5 rounded transition ${isActive ? `bg-gradient-to-br ${info.color} text-white` : "hover:bg-muted/40 text-muted-foreground"}`}>
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-2xl studio-panel border-cyan-accent/30">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-xl sm:text-2xl">اختر نوع الجهاز</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">لتحسين تجربتك. يمكنك تغييره لاحقاً من شريط الأدوات.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(Object.keys(DEVICE_INFO) as DeviceType[]).map(d => {
              const info = DEVICE_INFO[d]; const Icon = info.icon; const isSelected = selected === d;
              return (
                <button key={d} onClick={() => setSelected(d)}
                  className={`p-4 rounded-xl border transition text-center ${isSelected ? "border-cyan-accent bg-cyan-accent/10 ring-2 ring-cyan-accent/40" : "border-border hover:border-cyan-accent/50 hover:bg-muted/40"}`}>
                  <div className={`mx-auto mb-3 h-14 w-14 rounded-2xl bg-gradient-to-br ${info.color} flex items-center justify-center`}>
                    <Icon className="h-7 w-7 text-white" />
                  </div>
                  <div className="font-bold text-sm">{info.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{info.desc}</div>
                  {isSelected && <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-cyan-accent"><Check className="h-3 w-3" /> مُحدد</div>}
                </button>
              );
            })}
          </div>
          <Button onClick={handleConfirm} disabled={!selected || saving} className="w-full bg-cyan-accent text-black h-11">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />جارٍ الحفظ...</> : <><Check className="h-4 w-4 ml-2" />تأكيد والمتابعة</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function getSelectedDevice(): DeviceType | null {
  if (typeof window === "undefined") return null;
  return (localStorage.getItem("userDevice") as DeviceType) || null;
}

export default function SelectDevicePage() { return <DeviceSelector mode="after-login" />; }
