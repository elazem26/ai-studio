"use client";

import { useEffect, useRef } from "react";
import {
  useGarmentMappingStore,
  type PersonBox,
} from "@/stores/garment-mapping-store";

/**
 * Ask the detection service for face-anchored TORSO boxes
 * (normalized 0..1) via the existing /api/images/face-detect route.
 */
export async function detectPersonsRequest(
  imgPath: string
): Promise<PersonBox[]> {
  try {
    const r = await fetch("/api/images/face-detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: imgPath, mode: "persons" }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok ? (d.persons ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Auto-detect persons for one side of the Studio garment swap
 * ("source" = the person image, "ref" = a garment reference image).
 *
 * MULTI-REFERENCE: for the "ref" side pass `imageIndex` — the index of
 * this image in the reference list. Boxes are stored per image
 * (refBoxesByImage) and a replaced image only invalidates the mapping
 * rows that point at it (fixMappingsForImage) — adding image #2 never
 * wipes mappings for image #1.
 *
 * Mount this hook ONCE per side (in the corresponding panel) — it keeps
 * the shared garment-mapping-store in sync. Results push into the store
 * so the mapping card and the ControlBar can read them.
 */
export function usePersonAutoDetect(
  kind: "source" | "ref",
  img: { url?: string; path?: string } | null,
  imageIndex = 0
) {
  const enabled = useGarmentMappingStore((s) => s.enabled);
  const nonce = useGarmentMappingStore(
    (s) => s.detectNonce[kind === "source" ? "source" : "ref"]
  );
  const lastKey = useRef("");
  /** Last detected URL per reference-image index (replacement detection). */
  const lastUrlByIndex = useRef<Record<number, string>>({});

  useEffect(() => {
    const store = useGarmentMappingStore.getState();
    const url = img?.url ?? "";
    const key = kind === "ref" ? `${url}|${imageIndex}|${nonce}` : `${url}|${nonce}`;

    // No usable image (or feature off) → clear this side and stop.
    if (!enabled || !url || !url.startsWith("/") || (kind === "ref" && imageIndex < 0)) {
      if (lastKey.current) {
        lastKey.current = "";
        store.resetSide(kind);
      }
      return;
    }
    // Same image already detected (or currently detecting) → skip.
    if (lastKey.current === key) return;
    lastKey.current = key;

    const wasReplaced = kind === "ref" && lastUrlByIndex.current[imageIndex] !== undefined && lastUrlByIndex.current[imageIndex] !== url;
    if (kind === "ref") lastUrlByIndex.current[imageIndex] = url;

    if (kind === "source") {
      // Source changed → source indices invalid → reset mapping rows.
      useGarmentMappingStore.getState().resetSide("source");
    }
    const det = useGarmentMappingStore.getState().detecting;
    useGarmentMappingStore.getState().setDetecting({ ...det, [kind]: true });

    detectPersonsRequest(img?.path || url)
      .then((boxes) => {
        const s = useGarmentMappingStore.getState();
        if (kind === "source") {
          s.setSrcBoxes(boxes);
          // Fresh source image → reset mapping rows to a single 1↔1 row.
          s.setMappings([{ sourceIndex: 0, refIndex: 0, refImage: 0 }]);
          s.setActiveRow(0);
        } else {
          s.setRefBoxesForImage(imageIndex, boxes);
          if (wasReplaced) s.fixMappingsForImage(imageIndex);
        }
      })
      .finally(() => {
        const s = useGarmentMappingStore.getState();
        s.setDetecting({ ...s.detecting, [kind]: false });
      });
  }, [img?.url, img?.path, kind, enabled, nonce, imageIndex]);
}
