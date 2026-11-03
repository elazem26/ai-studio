// Loading placeholder served on :3000 while setup installs dependencies.
// The auto-opened browser tab lands here (instead of HTTP 502) and
// auto-refreshes into the real app the moment it is ready.
// Killed by start-server.sh right before the real server binds.
const http = require("http");

const PAGE = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="12">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Studio — جاري التجهيز</title>
<style>
 body{font-family:system-ui,'Segoe UI',Tahoma,sans-serif;background:#0f1222;color:#e8eaf6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
 .card{max-width:540px;text-align:center;padding:40px 32px;background:#171a30;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
 h1{font-size:22px;margin:0 0 12px}
 p{color:#a9b0d0;line-height:1.9;font-size:15px;margin:8px 0}
 .spin{width:44px;height:44px;margin:0 auto 22px;border:4px solid #2a2f55;border-top-color:#7c5cff;border-radius:50%;animation:s 1s linear infinite}
 @keyframes s{to{transform:rotate(360deg)}}
 .bar{height:8px;background:#23274a;border-radius:99px;overflow:hidden;margin-top:20px}
 .bar i{display:block;height:100%;width:40%;background:linear-gradient(90deg,#7c5cff,#4cc9f0);border-radius:99px;animation:b 1.6s ease-in-out infinite}
 @keyframes b{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
</style></head><body><div class="card">
<div class="spin"></div>
<h1>AI Studio — جاري التجهيز لأول مرة…</h1>
<p>يتم الآن تثبيت التطبيق داخل بيئة التشغيل (يستغرق 2 إلى 4 دقائق).</p>
<p>هذه الصفحة ستنتقل تلقائياً إلى التطبيق فجاهزه — لا تغلق التبويب.</p>
<div class="bar"><i></i></div>
</div></body></html>`;

const srv = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(PAGE);
});
srv.on("error", () => process.exit(0)); // port busy → real app is on its way
srv.listen(3000, "0.0.0.0", () => console.log("[placeholder] serving loading page on :3000"));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
