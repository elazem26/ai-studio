/**
 * Rebuild ONLY the PC package (AI-Studio-v<version>.tar.gz) — no backups,
 * no git actions, no GitHub push. Used when code/env changed and the
 * package must carry the latest state (e.g. after .env restore).
 * Run: bun scripts/rebuild-pc-package.ts
 */
import { buildPCPackage } from "../src/lib/backup";

const r = await buildPCPackage();
console.log(
  `PC package rebuilt: ${r.file} (${Math.round(r.sizeBytes / 1048576)}MB, models=${r.hasModels})`
);
