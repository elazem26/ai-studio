/** Rebuild the 2 clean backups (1 outside + 1 inside) after cleanup. */
import { buildCleanTarball, distributeToLocations, cleanJunk } from "../src/lib/backup";

const junk = await cleanJunk(false);
console.log("junk-clean:", JSON.stringify(junk));
const tar = await buildCleanTarball(true);
const saved = await distributeToLocations(tar.file);
console.log("saved:", saved.map((s) => `${s.location} (${Math.round(s.sizeBytes / 1024)}KB)`).join(" | "));
const { unlink } = await import("fs").then((m) => ({ unlink: m.promises.unlink }));
await unlink(tar.file).catch(() => {});
console.log("done");
