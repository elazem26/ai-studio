// Create two simple test images (source person + garment reference) in data/uploads
import sharp from "/home/z/my-project/node_modules/sharp/lib/index.js";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";

const DIR = "/home/z/my-project/data/uploads";
mkdirSync(DIR, { recursive: true });

// SOURCE: a simple "person" on a plain background (head circle + body block)
const personSvg = `
<svg width="768" height="1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="768" height="1024" fill="#d8d4cc"/>
  <ellipse cx="384" cy="180" rx="95" ry="110" fill="#c8956c"/>
  <rect x="284" y="290" width="200" height="430" rx="40" fill="#3d5a80"/>
  <rect x="254" y="330" width="70" height="280" rx="30" fill="#3d5a80"/>
  <rect x="444" y="330" width="70" height="280" rx="30" fill="#3d5a80"/>
  <rect x="304" y="720" width="80" height="260" rx="24" fill="#2b3a55"/>
  <rect x="384" y="720" width="80" height="260" rx="24" fill="#2b3a55"/>
</svg>`;

// GARMENT REFERENCE: a yellow/green striped two-piece set on white
const garmentSvg = `
<svg width="768" height="1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="768" height="1024" fill="#ffffff"/>
  <g>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="204" y="${120 + i * 18}" width="360" height="9" fill="#e9c46a"/>`).join("")}
    <rect x="204" y="120" width="360" height="230" rx="26" fill="none" stroke="#e76f51" stroke-width="10"/>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="204" y="${430 + i * 18}" width="360" height="9" fill="#e9c46a"/>`).join("")}
    <rect x="204" y="430" width="360" height="230" rx="26" fill="none" stroke="#2a9d8f" stroke-width="10"/>
  </g>
</svg>`;

const a = `${randomUUID()}.jpg`;
const b = `${randomUUID()}.jpg`;
await sharp(Buffer.from(personSvg)).jpeg({ quality: 88 }).toFile(`${DIR}/${a}`);
await sharp(Buffer.from(garmentSvg)).jpeg({ quality: 88 }).toFile(`${DIR}/${b}`);
writeFileSync("/tmp/swap-test-paths.json", JSON.stringify({ source: `/uploads/${a}`, garment: `/uploads/${b}` }, null, 1));
console.log("SOURCE:", `/uploads/${a}`);
console.log("GARMENT:", `/uploads/${b}`);
