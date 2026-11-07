/* اختبار دوال إزالة التكرارات (وسائط + سكربتات) — dryRun آمن */
import { dedupeSessionMedia, dedupeScripts } from "../src/lib/backup";

async function main() {
  const media = await dedupeSessionMedia(true);
  console.log("mediaDedup dryRun:", JSON.stringify(media));
  const scripts = await dedupeScripts(true);
  console.log("scriptsDedup dryRun:", JSON.stringify(scripts));

  // اختبار فعلي في مجلد مؤقت داخل results: ملفان متطابقان + ملف مختلف
  const { promises: fs } = await import("fs");
  const { createHash } = await import("crypto");
  const dir = "/home/z/my-project/data/results";
  const a = Buffer.from("dedupe-test-A".repeat(500));
  const b = Buffer.from("dedupe-test-B".repeat(500));
  await fs.writeFile(`${dir}/zz-dup-1.bin`, a);
  await fs.writeFile(`${dir}/zz-dup-2.bin`, a); // مطابق لـ 1 → يجب حذفه
  await fs.writeFile(`${dir}/zz-uniq.bin`, b); // مختلف → يبقى
  const real = await dedupeSessionMedia(false);
  console.log("mediaDedup real:", JSON.stringify(real));
  const remaining = (await fs.readdir(dir)).filter((f) => f.startsWith("zz-"));
  console.log("remaining zz-*:", remaining);
  for (const f of remaining) await fs.unlink(`${dir}/${f}`).catch(() => {});
  console.log("cleanup done");
}
main();
