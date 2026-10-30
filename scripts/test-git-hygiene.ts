/** Verify gitHygiene commits pending work without hook rejections. */
import { gitHygiene } from "../src/lib/backup";

const r = await gitHygiene();
console.log(JSON.stringify(r, null, 2));
