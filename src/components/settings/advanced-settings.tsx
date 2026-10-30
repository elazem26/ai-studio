"use client";

import { useI18n } from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Dices, Lock, RefreshCw } from "lucide-react";

interface SliderRowProps {
  label: string;
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}

function SliderRow({ label, value, onValueChange, min = 0, max = 100, step = 1, suffix, disabled }: SliderRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <span className="text-[10px] font-mono text-cyan-accent">
          {value}
          {suffix ?? "%"}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onValueChange(v[0])}
        disabled={disabled}
        className="py-1"
      />
    </div>
  );
}

export function AdvancedSettings() {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const s = useSettingsStore();
  const setField = useSettingsStore((s2) => s2.setField);
  const setAutoMode = useSettingsStore((s2) => s2.setAutoMode);
  const applyPreset = useSettingsStore((s2) => s2.applyPreset);
  const reset = useSettingsStore((s2) => s2.reset);

  return (
    <div className="mt-2 pt-3 border-t border-panel-border grid md:grid-cols-2 gap-x-6 gap-y-3">
      {/* Auto mode toggle */}
      <div className="md:col-span-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch checked={s.autoMode} onCheckedChange={setAutoMode} />
          <Label className="text-xs cursor-pointer" onClick={() => setAutoMode(!s.autoMode)}>
            {t("settings.autoMode")}
          </Label>
          <span className="text-[10px] text-muted-foreground">— {t("controls.autoHint")}</span>
        </div>
        <div className="flex items-center gap-1">
          {(["balanced", "realistic", "creative", "conservative"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={s.preset === p && !s.autoMode ? "secondary" : "ghost"}
              className="h-7 px-2 text-[10px]"
              onClick={() => applyPreset(p)}
              disabled={s.autoMode}
            >
              {t(`settings.presets.${p}`)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[10px]"
            onClick={reset}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <SliderRow
        label={t("settings.garmentFidelity")}
        value={s.garmentFidelity}
        onValueChange={(v) => setField("garmentFidelity", v)}
        disabled={s.autoMode}
      />
      <SliderRow
        label={t("settings.identityPreservation")}
        value={s.identityPreservation}
        onValueChange={(v) => setField("identityPreservation", v)}
        disabled={s.autoMode}
      />
      <SliderRow
        label={t("settings.bodyPreservation")}
        value={s.bodyPreservation}
        onValueChange={(v) => setField("bodyPreservation", v)}
        disabled={s.autoMode}
      />
      <SliderRow
        label={t("settings.lightingMatch")}
        value={s.lightingMatch}
        onValueChange={(v) => setField("lightingMatch", v)}
        disabled={s.autoMode}
      />
      <SliderRow
        label={t("settings.colorMatch")}
        value={s.colorMatch}
        onValueChange={(v) => setField("colorMatch", v)}
        disabled={s.autoMode}
      />
      <SliderRow
        label={t("settings.textureFidelity")}
        value={s.textureFidelity}
        onValueChange={(v) => setField("textureFidelity", v)}
        disabled={s.autoMode}
      />
      <SliderRow
        label={t("settings.generationSteps")}
        value={s.generationSteps}
        min={10}
        max={80}
        step={5}
        suffix=""
        onValueChange={(v) => setField("generationSteps", v)}
        disabled={s.autoMode}
      />
      <SliderRow
        label={t("settings.guidance")}
        value={s.guidance}
        min={1}
        max={20}
        step={0.5}
        suffix=""
        onValueChange={(v) => setField("guidance", v)}
        disabled={s.autoMode}
      />

      {/* Resolution */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">{t("settings.resolution")}</Label>
        <ToggleGroup
          type="single"
          value={s.resolution}
          onValueChange={(v) => v && setField("resolution", v as never)}
          disabled={s.autoMode}
          className="justify-start"
        >
          <ToggleGroupItem value="standard" className="text-[10px] h-7 px-2">{t("settings.resolutionStandard")}</ToggleGroupItem>
          <ToggleGroupItem value="high" className="text-[10px] h-7 px-2">{t("settings.resolutionHigh")}</ToggleGroupItem>
          <ToggleGroupItem value="max" className="text-[10px] h-7 px-2">{t("settings.resolutionMax")}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Number of results */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">{t("settings.numResults")}</Label>
        <ToggleGroup
          type="single"
          value={String(s.numResults)}
          onValueChange={(v) => v && setField("numResults", Number(v) as never)}
          disabled={s.autoMode}
          className="justify-start"
        >
          {[1, 2, 4, 8].map((n) => (
            <ToggleGroupItem key={n} value={String(n)} className="text-[10px] h-7 px-3">
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Seed */}
      <div className="space-y-1.5 md:col-span-2">
        <Label className="text-[11px] text-muted-foreground">{t("settings.seed")}</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={s.seed ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setField("seed", v ? Number(v) : null);
            }}
            placeholder={t("settings.seedRandom")}
            disabled={s.autoMode}
            className="font-mono text-xs h-8"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px]"
            onClick={() => setField("seed", Math.floor(Math.random() * 1e9))}
            disabled={s.autoMode}
          >
            <Dices className="h-3.5 w-3.5" />
            {t("settings.seedRandom")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px]"
            onClick={() => setField("seed", null)}
            disabled={s.autoMode}
          >
            <Lock className="h-3.5 w-3.5" />
            {t("settings.seedFixed")}
          </Button>
        </div>
      </div>
    </div>
  );
}
