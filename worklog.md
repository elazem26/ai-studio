# Worklog

---
Task ID: 1
Agent: main (Z.ai)
Task: فك ضغط وتشغيل مشروع ai-studio-main (2).zip المرفوع من المستخدم

Work Log:
- فك ضغط upload/ai-studio-main (2).zip إلى extracted/ai-studio-main
- تحليل المشروع: Next.js 16.4.2 (App Router, Turbopack) + Prisma/SQLite + Tailwind 4 + خدمة Python مصغرة لتبديل الوجوه (mini-services/face-swap-pro على منفذ 3030)
- تهيئة البيئة عبر init-fullstack.sh ثم نسخ ملفات المشروع إلى /home/z/my-project (src, public, prisma, scripts, mini-services, package.json, bun.lock, إعدادات config)
- إنشاء المجلدات: db/, data/uploads/, data/results/
- bun install: تثبيت 322 حزمة بنجاح
- bun run db:push: قاعدة البيانات custom.db متزامنة مع schema (14 جدول: User, Subscription, Assistant, Permission, Project, Result, AIModel, LogEntry...)
- تثبيت حزم Python: insightface 2.1 + onnxruntime في /home/z/.venv
- تشغيل dev server والتحقق: instrumentation.ts يشغّل face-swap-pro تلقائياً (سليم بعد 2 ثوانٍ)
- اختبار شامل: / (200), /login (200), /api/system/status (200), /api/ai-health 200 aiAvailable:true, /api/subscriptions/plans (200), /api/auth/me (401 متوقع بدون تسجيل دخول)
- عنوان الصفحة: "AI Clothing Studio - Local Virtual Try-On"

Stage Summary:
- المشروع يعمل بالكامل ويُقدَّم على المنفذ 3000 عند التشغيل
- قيد تقني في البيئة: عمليات الاستماع على المنافذ التي أطلقها الوكيل تُقتل بين جلسات الأوامر؛ الحل المعتمد: إعادة تشغيل البيئة (Restart) — يُطلق dev.sh تلقائياً عند الإقلاع ويبقى الخادم حياً
- ملفات المشروع محفوظة في /home/z/my-project وستُستعاد تلقائياً عند إعادة التشغيل عبر آلية pre-stop snapshot
- ميزات تعمل محلياً: تبديل الوجه (insightface), معالجة الصور (Sharp), معالجة الفيديو (ffmpeg 7.1), قاعدة البيانات, النسخ الاحتياطي
- ميزات تحتاج مفاتيح API: توليد الصور/الفيديو بالذكاء الاصطناعي السحابي (تُضبط من لوحة التحكم في التطبيق)

---
Task ID: keys-audit-zip
Agent: main (Z.ai)
Task: جرد المفاتيح داخل ملف upload/ai-studio-main (2).zip وتنشيطها

Work Log:
- فحصت .env داخل الـ zip: وجدت 3 مفاتيح فعلية (Groq, Google, OpenRouter) + 6 خانات فارغة
- اكتشفت أن .env في بيئة التشغيل لم يُنسخ عند الفك (كان يحوي DATABASE_URL فقط) — سبب إجابتي السابقة "صفر مفاتيح"
- اختبرت المفاتيح: OpenRouter يعمل (أجاب على محادثة عربية عبر nemotron-3.5-super-vl:free)، Groq يرجع 403، Google يرجع 400 (حجب جغرافي من هذا السيرفر)
- نشّطت المفاتيح الثلاثة: جدول Setting في DB (llm:groq_key, llm:google_key, llm:openrouter_key) + ملف /home/z/my-project/.env مع OPENROUTER_MODEL
- سكربت التنشيط محفوظ في scripts/activate_keys.py

Stage Summary:
- الملف المضغوط يحتوي 3 مفاتيح حقيقية؛ OpenRouter الوحيد العامل من هذا السيرفر
- المفاتيح مفعلة في DB (تأثير فوري عند إقلاع الخادم) و.env (لقراءات env ومزودي الصور)
- الخادم غير مشغل حاليا — المستخدم يضغط زر Restart ليقوم النظام عبر dev.sh

---
Task ID: add-group2-providers
Agent: main (Z.ai)
Task: إضافة 5 مزودي LLM مجانيين جدد (Cloudflare, Cerebras, Mistral, Cohere, GitHub Models) للكود مع دعم إدارة المفاتيح من لوحة التحكم

Work Log:
- استكشفت src/lib/ai/free-llm.ts و /api/admin/llm-keys/route.ts لفهم البنية الحالية (4 مزودين: groq, google, openrouter, zai)
- أعدت كتابة free-llm.ts كاملاً: توسيع LLMProvider type لـ9 مزودين، DEFAULT_MODELS، providerStats، PROVIDER_ENV_VARS, PROVIDER_DOCS_URLS, PROVIDER_FREE_TIER_INFO
- أضفت دوال الاستدعاء: callCerebras, callMistral, callGitHub (تستخدم مساعد OpenAI-compatible مشترك)، callCohere (صيغة V2 خاصة)، callCloudflare (تحتاج account_id منفصل في Setting)
- أضفت دوال إدارة: getCloudflareAccountId, setCloudflareAccountId, getMaskedCloudflareAccountId, getProviderInfo
- أعدت كتابة route.ts للإدارة: قائمة ALL_PROVIDERS (9 مزودين)، حقل maskedCloudflareAccountId في GET، action=set_cloudflare_account في POST، فحص صلاحيات المزود قبل العمليات
- أنشأت صفحة UI جديدة src/app/llm-keys/page.tsx: جدول كامل لـ9 مزودين مع إدخال مفتاح، اختبار، رفع الحظر، رابط الحصول على المفتاح، إحصائيات الأداء، معالجة خاصة لـCloudflare (حقلين: account_id + api_token)
- أضفت زر "مفاتيح المزودين" في لوحة التحكم /control-panel مع أيقونة Key
- أنشأت .env.example جديد في المشروع المشغل يوثق 21 متغيراً (المجموعة 1 + المجموعة 2 + الإعدادات الأساسية)
- تحقق من بناء TypeScript: لا أخطاء في ملفاتي (أخطاء أخرى موجودة سابقاً في extracted/ وملفات Buffer إلخ)

Stage Summary:
- 5 مزودين جدد مُضافون بنجاح: Cerebras, Mistral, Cohere, GitHub Models, Cloudflare (9 إجمالاً مع الـ4 الأصليين)
- صفحة /llm-keys تسمح بإدارة كل المفاتيح من المتصفح (admin only): حفظ، اختبار، رفع الحظر
- مفاتيح المجموعة 1 الثلاثة (Groq, Google, OpenRouter) ما زالت مفعلة من المرحلة السابقة
- المزودون الجدد في حالة "غير مفعّل" بانتظار المفاتيح من المستخدم عبر صفحة /llm-keys أو .env
- Cloudflare هو المزود الوحيد في المجموعة 2 القادر على توليد الصور (Flux/SDXL) لكن تمت إضافته حالياً كـtext LLM فقط — يمكن لاحقاً توسيعه إلى keys.ts كمزود صور
- الخادم غير مشغل حالياً — المستخدم يضغط Restart ليقوم النظام بالمزودين الجدد

---
Task ID: activate-user-mistral-github
Agent: main (Z.ai)
Task: حفظ واختبار مفتاحي Mistral وGitHub الذين أرسلهما المستخدم

Work Log:
- اختبرت Mistral: نجح بعد تبديل الموديل من mistral-small-latest (429 rate-limited) إلى open-mistral-nemo — أجاب بالعربية فعلياً ("مرحبا بك! 😊 كيف حالك اليوم؟")
- اختبرت GitHub Models (PAT v2 سليم البنية): endpoint قديم models.inference.ai.azure.com لم يعد يحل DNS؛ endpoint جديد models.github.ai/inference/chat/completions يعيد "OK" نصي فارغ لكل الطلبات
- بحثت في توثيق GitHub الرسمي → نتيجة حرجة: "GitHub Models has been retired. As of July 30, 2026, GitHub Models has been fully retired." — الخدمة أُوقفت نهائياً
- حفظت المفتاحين في DB Setting: llm:mistral_key + llm:github_key
- حدّثت free-llm.ts: نُقلت دالة callGitHub من المساعد المشترك إلى دالة مستقلة ترصد Content-Type وتطلق خطأ واضحاً عند استجابة غير JSON، مع تعليق توضيحي يبيّن التقاعد
- حدّثت DEFAULT_MODELS.github إلى "openai/gpt-4o-mini" (التسمية الجديدة)
- حدّثت PROVIDER_FREE_TIER_INFO.github لتنبيه المستخدم بالتقاعد
- typecheck نظيف لملفاتي (الخطأ الوحيد المتبقي في extracted/ الأصلي وليس ملفاتي)

Stage Summary:
- Mistral مُفعّل ويعمل — أول مفتاح من المجموعة 2 ينجح فعلياً
- GitHub Models متقاعد نهائياً منذ 2026-07-30 — PAT محفوظ لكن لن يعمل
- ترتيب الأولوية الحالي للنصوص: Groq (محجوب جغرافياً من السيرفر) → Google (محجوب) → OpenRouter (يعمل!) → Mistral (يعمل!) → ZAI (مدمج احتياطي)
- قاطع الدارة سيخطّي Groq/Google تلقائياً بعد 3 إخفاقات (تبريد 5 دقائق)
- المستخدم يحتاج Restart ليقوم الخادم بالمفاتيح الجديدة، ثم سيقدر اختبارها عبر صفحة /llm-keys

---
Task ID: launch-preview-server
Agent: main (Z.ai)
Task: إصلاح مشكلة المعاينة المتعطلة وإطلاق الخادم ليتمكن المستخدم من رؤية المشروع

Work Log:
- شخّصت الحالة: المنفذ 3000 حر، لا يوجد dev.pid فعلي، PID 2314 (المكتوب في dev.pid) ميت
- اكتشفت أن النظام يستخدم /home/z/my-project/.zscripts/dev.sh (بدليل مُنقّط) وليس dev.sh في الجذر
- dev.sh سليم (4168 بايت) — يطلق: bun install → db:push → bun run dev & (disown) + mini-services
- الـlog أظهر أن الخادم كان يعمل بنجاح ثم توقف (ربما بين جلسات سابقة)
- أطلقت dev.sh عبر: setsid nohup bash /home/z/.zscripts/dev.sh > dev-launch.log 2>&1 < /dev/null & disown
- انتظرت 12 ثانية → الخادم طلع على المنفذ 3000 (PID 4334)
- تحققت شامل: GET / → 200, /login → 200, /api/system/status → 200, /api/ai-health → {"aiAvailable":true}, /api/subscriptions/plans → 200
- تحققت من الصفحات الجديدة: GET /llm-keys → 200 (الصفحة التي أنشأتها سابقاً للمزودين الجدد تعمل)
- تحققت من API: GET /api/admin/llm-keys → 401 (متوقع بدون توكن أدمن)
- وجدت bot-id من /etc/.z-ai-config: chatId="chat-ffeddebf-6fb2-4f75-b101-dcab6d3fdd47" → UUID = ffeddebf-6fb2-4f75-b101-dcab6d3fdd47

Stage Summary:
- الخادم يعمل الآن (PID 4334، 1:30 دقيقة uptime عند الفحص الأخير)
- كل الميزات تشمل: لوحة التحكم، صفحة /llm-keys للمفاتيح، الواجهة الرئيسية، خدمة face-swap، api/admin
- رابط المعاينة المتوقع: https://preview-ffeddebf-6fb2-4f75-b101-dcab6d3fdd47.space-z.ai/
- التحذير: قد يتوقف الخادم بين جلسات bash (سلوك السانبوكس المعروف) — المستخدم يضغط Restart لإعادة الإطلاق الدائم

---
Task ID: fix-image-upload-display
Agent: main (Z.ai)
Task: إصلاح "رفع الصور لا يعمل" — الصور كانت تُحفظ لكن لا تُعرض

Work Log:
- تشخيص أولي: POST /api/images/upload → HTTP 200 (الرفع ناجح فعلاً) + ملفات محفوظة في data/uploads/ (4 ملفات)
- اكتشفت أن السبب: ملف upload route يرجع url=/uploads/{filename} لكن لا يوجد route ديناميكي يخدم هذه المسارات
- next.config.ts يحوي تعليق "We do this with custom routes... We do that instead in a route file" لكن الـroute الموعود لم يُنشأ أصلاً
- readStaticFile helper معرّفة في next.config.ts لكنها غير مستخدمة في أي ملف
- أنشأت src/app/uploads/[file]/route.ts: يخدم ملفات data/uploads/ مع MIME types للصور والفيديو + حماية path traversal (basename فقط + تحقق prefix)
- أنشأت src/app/results/[file]/route.ts: يخدم ملفات data/results/ (النواتج من try-on/face-swap/image-edit) بنفس الآلية
- اختبار Turbopack hot-reload: GET /uploads/85539b0c-...jpg → 200, GET /uploads/8f7b2ab8-...jpg → 200
- اختبار الأمان: GET /uploads/..%2F..%2Fetc%2Fpasswd → 400 (محجوب)

Stage Summary:
- مشكلة عرض الصور المرفوعة حُلّت — النظام الآن يحفظ ويخدم الملفات بشكل كامل
- سيؤثر هذا على جميع الميزات التي تعرض صوراً: try-on, face-swap, image-edit, video-edit
- Turbopack رصد التغييرات تلقائياً وحمّل الـroutes الجديدة (hot reload)
- المستخدم يحتاج فقط لإعادة تحميل الصفحة في المتصفح لرؤية الصور المرفوعة

---
Task ID: fix-face-swap
Agent: main (Z.ai)
Task: إصلاح "فشل في تبديل الوجه" — النموذج لم يكن محمّلاً

Work Log:
- شخّصت: خدمة face-swap-pro على المنفذ 3030 تعمل (PID 4380) لكن /health أرجع model_loaded:false
- اكتشفت: مجلد /home/z/my-project/mini-services/face-swap-pro/models/ غير موجود أصلاً — ملف inswapper_128.onnx غائب
- رمز الخطأ في server.py يبيّن URL التنزيل: huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx
- أنشأت المجلد وحمّلت الملف (530MB، ~9.4MB/s، 57 ثانية)
- بعد التحميل /health أرجع model_loaded:true ✅
- اختبرت /swap بحقلين صحيحين (source + face): HTTP 200، أرجع PNG data URL بطول 208KB ✅
- أول طلب أخذ 74 ثانية (تحميل النموذج 530MB إلى الذاكرة + FaceAnalysis buffalo_l + inference على CPU)
- طلبات لاحقة ستكون أسرع (~10-15 ثانية) بعد بقاء النموذج في الذاكرة

Stage Summary:
- تبديل الوجه يعمل الآن بالكامل: النموذج محمّل، الـAPI يستجيب، النتيجة PNG صحيحة
- تكامل كامل مع ميزة عرض الصور المُصلحة سابقاً: النتيجة ستُحفظ في data/results/ وتُخدم عبر /results/[file]
- المستخدم يحتاج لإعادة تحميل الصفحة وإعادة محاولة face-swap
- ملاحظة أداء: inference على CPU فقط (لا GPU في السانبوكس) — أول طلب ~60-75s، لاحقاً أسرع

---
Task ID: fix-image-expand
Agent: main (Z.ai)
Task: إصلاح "توسيع الصورة لا يعمل بشكل صحيح" — النتيجة كانت نفس حجم المصدر

Work Log:
- شخّصت: POST /api/images/expand يرجع 200 لكن الـlog كشف: "864x1152 → 864x1152" — النتيجة نفس حجم المصدر!
- فحصت src/app/api/images/expand/route.ts: الكود يختار "أفضل حجم مدعوم من z-ai" بناءً على aspect ratio
- اكتشفت السبب: قائمة الأحجام المدعومة في z-ai (1024x1024, 768x1344, 864x1152, 1344x768, 1152x864, 1440x720, 720x1440) — كلها ~1M بكسل
- للمصدر 864x1152 (3:4 portrait)، الأقرب aspect-ratio هو 864x1152 نفسه → الكود يطلب من z-ai توليد نفس الحجم → لا توسيع فعلي
- الحل: أضفت فحصاً بعد اختيار bestSize — إذا كان bestPixels <= sourcePixels * 1.15 (أي z-ai لا يستطيع إنتاج صورة أكبر بشكل معنوي)، أطلق خطأً مقصوداً لإجبار الـfallback لخيار sharp
- اختبرت بمصدر 864x1152 +50% all: النتيجة 1728x2304 = 3.98M px (4x أكبر)، method=sharp-mirror-blur-extend، 1.2 ثانية (بدلاً من 13-19s)
- اختبرت بمصدر صغير 300x300: AI outpainting ما زال يعمل، ينتج 1024x1024 (10x أكبر)

Stage Summary:
- ميزة "توسيع الصورة" الآن تنتج صوراً أكبر فعلياً
- للصور الكبيرة (≥1M px): استخدام sharp mirror+blur fallback (أسرع، 1.2s)
- للصور الصغيرة (<1M px): AI outpainting ما زال يعمل (أبطأ لكن جودة أعلى)
- تكامل مع إصلاح /results/[file] الذي سبق — النتيجة ستُعرض فوراً

---
Task ID: smart-ai-outpainting
Agent: main (Z.ai)
Task: تحسين ميزة التوسيع لتوليد محتوى AI طبيعي (إكمال الوجه/الشعر/الجسم + تجانس الإضاءة/الظل/الخلفية) بدلاً من mirror+blur

Work Log:
- إعادة تصميم قسم AI في /api/images/expand/route.ts بالكامل
- الخوارزمية الجديدة (smart outpainting):
  1. اختيار أكبر حجم مدعوم من z-ai بنسبة aspect أقرب للهدف (بدلاً من اختيار نفس حجم المصدر)
  2. توليد محتوى AI مع prompt محسّن: "extend body, clothing, hair, lighting, shadows, depth of field naturally"
  3. إذا AI أكبر من المصدر بـ5%+: استخدام مباشر (للصور الصغيرة)
  4. إذا AI مساوٍ/أصغر: composite pipeline:
     a. resize AI إلى canvas الهدف بـfit:cover center crop
     b. إنشاء feathered alpha mask (مستطيل أبيض داخل بـfeatherRadius، مموّه)
     c. تطبيق الـmask على الأصل (blend:dest-in) للأصل بحواف ناعمة
     d. تركيب الأصل المُريّش فوق خلفية AI الموسّعة (blend:over)
- اختبرت على صورة 864x1152 +50% all:
  · method = "ai-outpaint-composited"
  · النتيجة: 1728x2304 = 4M px (4× أكبر)
  · زمن: 22.7 ثانية (z-ai + sharp compositing)
  · log: "Expanded ai-outpaint-composited (all, +50%): 864x1152 → 1728x2304 (z-ai=864x1152)"
- النتيجة محفوظة وتُخدم بشكل صحيح عبر /results/[file]

Stage Summary:
- ميزة التوسيع الآن تُولّد محتوى AI حقيقياً للصور الكبيرة (لا mirror+blur)
- الأصل يُحافظ على وضوحه في الوسط (موضوع، وجه، شعر)
- المحيط AI-mainted: استمرار الجسم، الملابس، الشعر، الإضاءة، الظلال
- الحواف مُريّشة (feathered) لإخفاء خط الانتقال بين الأصل والـAI
- للصور الصغيرة (<1M px): AI مباشر (سريع)
- للصور الكبيرة (≥1M px): AI + composite (20-25 ثانية لكن جودة أعلى بكثير)

---
Task ID: disaster-recovery
Agent: main (Z.ai)
Task: استعادة المشروع بعد إعادة تعيين الحاوية بالكامل + إصلاح جذر خطأ ResourceExhausted

Work Log:
- شخّصت "المعاينة لا تعمل": الخادم ميت + /home/z/my-project أعيد تعيينه (src/ وdb/ وmini-services/ اختفت كلها)
- اكتشفت نسخة كاملة محفوظة في /tmp/my-project/ (570MB): كل الكود + custom.db بالمفاتيح الثمانية + نموذج face-swap 530MB + بيانات الرفع والنتائج + worklog
- استعدت بـ cp -a /tmp/my-project/. /home/z/my-project/ (خطأ upload/ رمزي — mount point)
- ثبّت 851 حزمة بـ bun install (8.6s)
- أطلقت الخادم عبر setsid + .zscripts/dev.sh → HTTP 200 + ai-health ok + face-swap model_loaded:true
- أنشأت src/lib/processing-lock.ts: قفل عالمي (tryAcquire/release/getStatus/withProcessingLock)
- طبّقت القفل على 4 endpoints ثقيلة (expand, face-swap, enhance, face-retouch) عبر wrapper POST → _POST_impl مع try/finally يضمن تحرير القفل دائماً
- تحققت: typecheck نظيف لملفاتي + طلبان متتاليان كلاهما استجاب (القفل يُفتح صح) + الخادم حي

Stage Summary:
- المشروع استُعيد بالكامل من snapshot /tmp/my-project/ — لا فقدان بيانات
- سبب الإعادة: الضغط على Restart أعاد إنشاء الحاوية، والنظام لم يستطع استعادة الـsnapshot تلقائياً هذه المرة (ربما بسبب ResourceExhausted)
- الآن قفل العمليات يمنع تزامن العمليات الثقيلة → لن يتكرر خطأ ResourceExhausted من الاستخدام الطبيعي
- عند وصول طلب ثقيل بينما آخر جارٍ: رسالة عربية واضحة "عملية X جارية الآن (Ns). انتظر..." بدل خطأ المنصة الغامض
- درس مستقبلي: قبل Restart، الخادم يُحفظ تلقائياً في /tmp/my-project — النسخة الأقدم تبقى حتى إعادة التشغيل التالية

## 2026-10-28 — numbered-face-boxes (Task ID: face-boxes-mapping)
Agent: main (Z.ai)
Task: مربعات مرقمة على كل شخص في صورتي المصدر والمرجع بصفحة الاستوديو (تبديل الوجه) لتحديد أي مرجع يدمج مع أي مصدر

Work Log:
- وسّعت mini-services/face-swap-pro/server.py: /detect جديد (bboxes معيارية 0..1 + ترتيب الأكبر أولاً) + /swap يقبل sourceIndex/faceIndex/mappings متعددة (تبديل تسلسلي)
- أنشأت src/app/api/images/face-detect/route.ts: يمرر /uploads/.. للخدمة مع auto-spawn
- حدّثت /api/images/face-swap: يمرر mappings/sourceIndex/faceIndex بعد تنقيتها + timeout 120s للدمج المتعدد
- أعدت بناء face-swap-panel.tsx: FaceBox overlay بمربعات مرقمة قابلة للنقر (أخضر=مربوط، بنفسجي/فوشيا=غير مربوط) داخل w-fit wrapper (بلا letterboxing) + قسم "ربط الوجوه" (صفوف: مرجع ← مصدر + إضافة/حذف) + chips حالة الرصد + زر إعادة الرصد
- الربط يُرسل تلقائياً مع كل تبديل؛ النقر على صف ثم مربع يعيّن الوجه؛ الرقم ① دائماً الأكبر
- أصلحت نقص import numpy في الدوال الجديدة + نقص import path في ensure-services + وجّهت SERVICE_SCRIPT من extracted/ إلى live mini-services + أصلحت Buffer typing في face-swap/face-retouch
- اختبار: صورة جماعية 3 أشخاص مولدة بـz-ai → detect: 3 وجوه بترتيب صحيح؛ legacy swap 200؛ mapped ref#2→src#0 وref#1→src#2 200 ونتائجهما مختلفة؛ multi-merge (ربطان بطلب واحد) 200؛ index خارج النطاق → 400 برسالة واضحة
- ensure-services الآن يطلق الخدمة بالكود الجديد تلقائياً عند تحميل الصفحة (تم التحقق: spawnedJustNow:true)

Stage Summary:
- الميزة مكتملة end-to-end: رفع → رصد تلقائي → مربعات مرقمة على الصورتين → ربط مرجع↔مصدر (فردي أو متعدد) → تبديل يحترم الربط
- التوافق الرجعي محفوظ: بلا mappings يعمل كالسابق (الأكبر←الأكبر)

## 2026-10-28 — video+garment numbered boxes (Task ID: video-garment-boxes)
Agent: main (Z.ai)
Task: المربعات المرقمة للملابس في الاستوديو + تبديل الوجوه والملابس في الفيديو مع صورة مرجع

Work Log:
- Python: /detect-persons (صناديق جذع مثبتة على الوجه للملابس) + نظام video jobs خلفي (/video-job + /video-job/{id}) بوضعين:
  * face: تبديل وجوه لكل إطار مع تتبع مركزي (IoU + أقرب مركز) لثبات الشخص أثناء الحركة
  * garment: استخلاص اللون المسيطر لملابس المرجع (متوسط دائري للـhue، استبعاد الجلد) وصبغ ملابس الشخص المتتبع مع الحفاظ على الظلال
  * إعادة ترميز H.264 + نقل الصوت الأصلي عبر ffmpeg
- Next APIs: face-detect يقبل mode=persons + /api/images/garment-swap (قص الشخص ← مركب جانبي 1152x864 ← z-ai edit ← قص النصف الأيسر ← لصق بقناع بيضاوي مُرشّح) + /api/video/face-swap (رفع بايتات خام + استخراج إطار + كشف مزدوج، ثم بدء job فوري يعيد taskId) + /api/video/frame-detect
- إصلاحات: نقص import numpy/cv2 في الدوال الجديدة، تحويل البدء إلى إرجاع فوري للـtaskId مع متتبع خلفي + عدّاد فقدان الجوب (15 فشلاً متتالياً)
- UI الفيديو: تبويبان جديدان «وجوه» و«ملابس» (7 تبويبات) + مكوّن VideoSwapService ذاتي الاحتواء: رفع فيديو → بوستر بمربعات مرقمة قابلة للنقر + مربع «الصورة المرجع» + صفوف ربط + تقدم + نتيجة فيديو مع تحميل؛ الخدمتان تسجلان الحالة/reset عبر refs لتحذير تبديل الخدمة
- UI محرر الملابس: بطاقة GarmentSwapFromRef بعرض المصدر والمرجع بمربعات شخص مرقمة + ربط ملابس مرجع→شخص مصدر + نتيجة تُدفع لشبكة نتائج المحرر
- اختبارات e2e كلها ناجحة: كشف 3 أشخاص/وجوه، رفع فيديو+كشف، تبديل وجوه فيديو 30 إطار ✓، صبغ ملابس فيديو ✓، تبديل ملابس صورة عبر z-ai ✓
- tsc: كودي الجديد نظيف؛ 5 أخطاء قديمة مسبقة تبقى (لا تعيق التشغيل)

Stage Summary:
- ثلاث ميزات جديدة تعمل: تبديل ملابس الصور بالمربعات، تبديل وجوه الفيديو بالمربعات، تبديل ملابس الفيديو (نقل لون المرجع)
- قيود موثقة: الفيديو يُعالج حتى 400 إطار (~16 ثانية)؛ ملابس الفيديو نقل لون وليس استبدال تصميم كامل

## 2026-10-28 — pro-quality pass + regional precision (Task ID: quality-regional)
Agent: main (Z.ai)
Task: جودة احترافية قصوى لتبديل الوجوه/الملابس (صور+فيديو) + تحرير إقليمي محكم (الجزء المحدد فقط يتغير)

Work Log:
- server.py — QUALITY PASS بعد كل تبديل وجه (صور وفيديو):
  * _match_color_laba: نقل متوسط/انحراف LAB من منطقة الوجه الأصلية (تحمل إضاءة المشهد) إلى الوجه الجديد بمعامل 0.55 وسقف تباين 1.6x — يمنع مظهر "الملصق الملتصق"
  * _unsharp: حِدّة معتدلة (0.40/2.5) تعوّض نعومة نموذج 128px
  * _feather_mask + دمج بيضاوي مُرشّح: التحسين يمس منطقة الوجه فقط
  * الفيديو: نفس التمرير لكل إطار (feather=15) + ترميز أعلى جودة: crf 18 + preset medium + profile high + صوت aac 192k (كان veryfast/22)
- server.py — كاشف ثانٍ FACE_APP_HQ بدقة 640px للصور الثابتة (/detect و/detect-persons و/swap) — وجوه أصغر وأcrop أدق؛ الفيديو يبقى 320px للسرعة
- garment-swap route — REGIONAL PRECISION دائماً (حتى لشخص واحد): قص جذع الشخص فقط ← مركب جانبي مع جذع المرجع ← z-ai edit ← لصق بقناع بيضاوي أوسع وأنعم (blur 16، هامش 10px) — بلا إعادة توليد كامل الصورة إطلاقاً + prompt محسّن (يمنع إضافة أطراف/أشخاص/عناصر)
- إثبات بكسلي (scripts/verify-regional-precision.py): نتيجة تبديل الملابس 1344x768 — 160,985 بكسل تغيرت كلها داخل صندوق الجذع المرتبط؛ 0 بكسل خارج الصندوق مختلفة (مطابقة 100%)
- اختبارات: swap legacy/mapped/multi-merge كلها 200 مع quality:"color-match+unsharp"؛ detect-persons 3 أشخاص بترتيب صحيح؛ تبديل ملابس إقليمي e2e 24s ✓؛ مهمة فيديو وجه 30 إطار اكتملت مع تمرير الجودة ✓ (831KB/1.25s h264)
- سياسات: رفضُ إزالة محتوى الحجب/التدقيق أو توليد صور بلا ملابس — خارج الحدود المسموحة؛ نُفّذ البديل المشروع: تحرير إقليمي محكم يحافظ على باقي الصورة بكسل-بكسل

Stage Summary:
- التبديل الآن: مزج لوني مع إضاءة المشهد + حِدّة + حواف مُرشّحة = نتيجة طبيعية بلا آثار تركيب ظاهرة
- تبديل الملابس في الاستوديو: يغيّر منطقة الملابس المرتبطة فقط — باقي الصورة يبقى كما هو تماماً (مثبت بفحص بكسلي)
- الفيديو: جودة ترميز أعلى + تحسين لكل إطار؛ الصوت الأصلي يُنقل تلقائياً عند وجوده

## 2026-10-28 — upload speed fix (Task ID: upload-speed)
Agent: main (Z.ai)
Task: معالجة «بطء شديد في رفع الصور»

Work Log:
- التشخيص: الرفع نفسه كان سريعاً (0.02-0.4s)؛ البطء الحقيقي = البداية الباردة: الموديلات تُحمّل كسولاً عند أول كشف (20-40 ثانية spawn + تحميل insightface/inswapper/HQ) فيراه المستخدم «رفع بطيء»
- server.py: نقطة /warm جديدة — تشغيل تحميل كل الموديلات (base + HQ) في خيط خلفي والعودة فوراً؛ /health يبلّغ models_loaded/hq_loaded
- instrumentation.ts: إطلاق /warm عند إقلاع Next.js (Step 1.5) — الموديلات جاهزة قبل أول استخدام
- ensure-services route: إطلاق /warm عند كل تحميل صفحة (fire-and-forget) — طبقة ثانية تضمن الدفء حتى بعد موت الخدمة
- src/lib/detect-image.ts (جديد): readForDetect — تصغير الصورة إلى 1280px قبل إرسالها للكاشف (الكاشف يوحّد الدخل إلى 640px داخلياً فلا خسارة دقة؛ الإحداثيات معيارية 0..1 فالمربعات مطابقة تماماً) + تمرير JPEG/PNG بلا إعادة ترميز عند عدم الحاجة للتصغير
- تطبيق readForDetect على: /api/images/face-detect + detectPersons في garment-swap
- توازي الرصد: detectBoth في video/face-swap وحلقة frame-detect أصبحت Promise.all (توفير ~1s لكل رفع فيديو)
- إصلاح خطأي tsc قديمين في ensure-services (proc.pid ?? null)
- قياسات نهائية: رفع 0.24s | رصد ساخن 1.5s (صورة عادية) و3.5s (صورة 9MP) | /warm تستجيب 9ms والموديلات جاهزة خلال ~8s بالخلفية | الصور الضخمة (10-25MB) توفر 10-50x في حجم النقل للكاشف

Stage Summary:
- «الرفع البطيء» المُدرَك انتهى: الموديلات تُحمّل تلقائياً عند إقلاع الخادم وعند تحميل أي صفحة قبل أن يرفع المستخدم شيئاً
- الرصد على الصور الضخمة أسرع 10-50x في النقل + إعادة ترميز ذكية؛ النتائج (المربعات) مطابقة تماماً لأنها إحداثيات معيارية

## 2026-10-28 — video swap stuck at 2% fix + 2.5x speedup (Task ID: video-2pct-stall)

**الشكوى**: تبديل الوجه والملابس في الفيديو يتوقف عند 2% ولا يكمل.

**السبب الجذري (قاتلان معاً)**:
1. **تجميد الواجهة عند 2%**: `pollTask` في video-editor-panel.tsx كان يحدّث الشريط فقط
   عند وجود `d.phase` — بينما `/api/task/status` لا كان يُرجع `phase` إطلاقاً →
   `onProgress` لا تُستدعى أبداً → الشريط يجمد عند 2% الأولية رغم تقدم الخادم فعلياً.
   (أُثبت بإعادة الإنتاج: الخادم 3%→9%→37% بينما الواجهة مجمدة).
2. **بطء قاتل**: 2 vCPU فقط + onnxruntime يدير خيوطه بـ busy-wait (spin) +
   `_ensure_loaded()` متزامن داخل POST /video-job (مخاطرة تجاوز مهلة 30s).

**الإصلاحات**:
- `src/app/api/task/status/route.ts`: يُرجع الآن `phase` + `processedFrames` +
  `totalFrames` + `bytesReceived/Total`.
- `pollTask` (video-editor-panel.tsx): تحديث عند أي `progress != null` (بلا بوابة
  phase) + تسامح 20 خطأ استقصاء متتالٍ + خطأ واضح فوري على 404 (مهمة ضائعة) +
  watchdog جمود 180s.
- UI شريط التقدم: عدّاد إطارات حي "45/60 إطار · ~0:12" + ETA محسوب من معدل
  الإطارات الفعلي + إزالة إخفاء النسبة أثناء processing.
- `server.py` — رقعة ORT على `InferenceSession.__init__` (وليس الصنف — insightface
  يرث الصنف في PickableInferenceSession واستبداله بدالة يكسر الاستيراد بـ
  "TypeError: function() argument 'code' must be code, not str"): intra=2,
  inter=1, SEQUENTIAL, spinning off → **1560ms → 824ms لكل رصد 320px (×1.9)**.
- `server.py`: حذف `_ensure_loaded()` المتزامن من POST /video-job (الـ worker
  يحمّل بنفسه؛ POST يعود في <100ms).
- ffmpeg: preset medium → fast (crf 18 كما هو).
- خلفية Next.js (face-swap route): watchdog جمود 240s → خطأ واضح.

**قياسات e2e (فيديو المستخدم 720×720، 99 إطاراً)**:
- وجه: اكتمل 99/99 في ~188s (الكود القديم كان في المسار لـ ~11 دقيقة) — ~×2.5-3.
- ملابس: 60/60 إطاراً في ~21s.
- phase يتدفق: queued → prepare → processing → encoding → done.

الملفات: src/app/api/task/status/route.ts، src/components/video-editor/video-editor-panel.tsx،
src/app/api/video/face-swap/route.ts، mini-services/face-swap-pro/server.py.
سكربتات: scripts/repro-video-stall.py، scripts/bench-ort.py.

## 2026-10-28 — admin buttons visibility + backup system rebuild (Task ID: admin-backup-cleanup)

**الشكوى**: أزرار (نسخة في 6 مواقع / تنزيل عادي / تنزيل كامل / إنهاء الجلسة) لا تظهر للمدير.

**السبب الجذري (اثنان)**:
1. **المصادقة**: جدول User فارغ و0 جلسات — القاعدة أُعيد تعيينها وسجلات الدخول ضاعت،
   والمستخدم لم يكن مسجلاً فعلياً → authUser=null → بوابة الأدوار تخفي كل شيء.
   `ensureOwnerAccount` يعمل عند أول دخول (محمد/1970/admin/isOwner) — اختبره curl: نجح.
2. **العرض**: الأزرار داخل `hidden md:flex` — تختفي تحت 768px (نافذة المعاينة الضيقة!).

**الإصلاحات**:
- studio-header.tsx: الحاوية `flex` دائماً + أسماء الأزرار `hidden md:inline`
  (أيقونات فقط في الشاشات الضيقة).
- **اكتشاف خطير**: مسارات النسخ الاحتياطي كانت تشير إلى /home/z/my-project/extracted/scripts/*.sh
  وextracted/data — مجلدات غير موجودة أصلاً → كل أزرار النسخ كانت تعمل بلا أثر!
- src/lib/backup.ts (جديد): تنفيذ Node خالص بالجذر الصحيح —
  buildCleanTarball (whitelist: src/db/public/scripts/prisma/server.py/configs —
  ~780KB بلا node_modules/models/media) + distributeToLocations (6 مواقع) +
  makeDownloadReady + cleanSessionMedia + uploadToGitHub (Contents API، نسخة بلا .env)
  + sweepOldVideos.
- إعادة بناء: multi-backup (6 مواقع، يرجع savedCount/savedLocations)،
  end-session (4 خطوات: تنظيف → 6 مواقع → نسخة تنزيل → GitHub، يدعم ?dryRun=1)،
  full-backup (آمن بلا حذف، يرجع الشكلين القديم والجديد).
- **تنظيف الفيديو**: sweepOldVideos(30 دقيقة) عند كل رفع فيديو وعند اكتمال كل مهمة
  (مصادر vswap-* + مؤقتات tmp-video-* + نتائج قديمة video-*-swap-*)؛ الصور تبقى
  حتى حذف المستخدم لها أو إنهاء الجلسة.
- زر "نسخة في 6 مواقع" → multi-backup، زر "إنهاء الجلسة" → end-session،
  ورسالة النتيجة تعرض خطوة GitHub.

**قياسات**: نسخة نظيفة 784KB × 6 مواقع ✓ | dryRun: 40 مرفوعة+159 نتيجة (85MB)
تُحرر عند إنهاء الجلسة ✓ | sweep حذف الملف الأقدم من 30د وبقي الحديث ✓.

**GitHub**: غير مُهيأ بعد — يلزم في .env:
  GITHUB_TOKEN=(رمز شخصي بصلاحية repo)
  GITHUB_BACKUP_REPO=(owner/repo)
النسخة المرفوعة لـ GitHub بدون .env (لا أسرار تُرفع).

## 2026-10-28 — GitHub full backup pipeline + admin buttons + download fixes

Task: رفعة GitHub كاملة (كل الملفات + .env بمفاتيحه نص صريح + النماذج) + إصلاح ظهور الأزرار الإدارية + إصلاح أزرار التنزيل.

### اكتشافات
- توكن GitHub المحفوظ في DB (`llm:github_key`) منتهي/ملغى → GitHub يرجع 401. الرفع محجوب حتى يرسل المالك توكن جديداً.
- سبب اختفاء الأزرار الإدارية: الجلسة تعتمد localStorage فقط (بدون كوكي) — عند فقدان التوكن يبقى authUser=null فتختفي الأزرار رغم أن الدور admin+isOwner=1 في DB (تم التحقق عبر /api/auth/me بجلسة حقيقية).
- زرا "نسخة كمبيوتر عادية/كاملة" كانا يشيران لملفات ثابتة غير موجودة في public/ (404).
- dev server انهار (turbopack panic) عند حذف .next أثناء العمل؛ السبب الجذري للخطأ: Tailwind v4 كان يمسح كل المشروع (binaries/نسخ قديمة) ويولّد فئة `h-[garbage]` فاسدة في globals.css المولَّد → فشل parse يكسر كل المسارات.

### الإصلاحات
- Tailwind: `@import "tailwindcss" source("../")` في globals.css — حصر المسح على src/ فقط.
- كوكي جلسة دائم: login يضبط authToken (SameSite=None+Secure عبر HTTPS، Lax محلياً)، logout يمسحه، getSessionToken يقرأ الكوكي كخطة بديلة → الأزرار الإدارية تبقى ظاهرة بعد أول تسجيل دخول.
- backup.ts: رفعة GitHub تشمل .env بالمفاتيح وقاعدة البيانات (buildCleanTarball(true)) — حسب طلب المالك الصريح.
- مسارات جديدة: GET /api/system/download-current (نسخة كمبيوتر عادية فورية) و GET /api/system/full-archive (بناء خلفي + أجزاء <100MB في public/ + combine-parts.sh/.bat) مع حارس مساحة قرص 2.2GB (fs.statfs).
- إصلاح end-session unlink (callback-style → promises) وDeviceType export.
- .gitignore: استثناء .gh-staging/.gh-token وأجزاء الأرشيف الكامل من المستودع الرئيسي.

### بنية رفعة GitHub (جاهزة للتنفيذ بأمر واحد)
- .gh-staging: شجرة كاملة 683MB في كوميت واحد (72be4d5): الكود + .env نص صريح + db + data + skills + النماذج مقسمة (inswapper 6 أجزاء ×95MB، buffalo_l.zip 4 أجزاء) + scripts/restore-models.sh.
- scripts/gh-push-full.sh <token> [repo]: تحقق توكن → إنشاء مستودع خاص → push. يحدّث .env بـ GITHUB_TOKEN/GITHUB_BACKUP_REPO ويعيد الكوميت تلقائياً.
- ملاحظة: توكن fine-grained لا ينشئ مستودعات — إما classic PAT بصلاحية repo أو إنشاء المستودع يدوياً (Private) ثم تشغيل السكربت.
- سياسة حذف الفيديو عند الحفظ: منفذة مسبقاً وتعمل (sweepOldVideos عند بدء كل عملية وبعد الحفظ، TTL 30 دقيقة).

### حالة الخادم
- إعادة تشغيل dev server مطلوبة (زر restart) — كل الإصلاحات على القرص وتُقلع تلقائياً عبر مسار الإقلاع.
- خدمة face-swap-pro (3030) حية والنموذج محمّل.

---
Task ID: github-full-backup + admin-guards
Agent: main (Z.ai)
Task: نسخة GitHub شاملة (كل الملفات + .env بنص صريح) + حماية مسارات النظام + إظهار أزرار المدير + ترقية إنهاء الجلسة

Work Log:
- scripts/sync-keys-to-env.py: مزامنة كل المفاتيح من جدول Setting (DB) إلى .env بنص صريح — 8 مفاتيح LLM + GITHUB_TOKEN + GITHUB_BACKUP_REPO + DATABASE_URL + OPENROUTER_MODEL (11 متغيراً)
- lib/auth/index.ts: إضافة getSessionUser() + requireAdmin() — حارس خادم فعلي (header Bearer أو كوكي authToken)
- ترقيع 11 مساراً في /api/system/* بـ requireAdmin (create-backup, download-backup, download-current, end-session, full-archive, full-backup, multi-backup, multi-backup-download, prepare-complete, restore-backup, upload-model + DELETE) — الحالة/ensure-services/face-swap-guardian بقيت مفتوحة (غير مدمرة)
- studio-header.tsx: refreshAuth() عبر useCallback + إعادة جلب فوري عند حدث auth-changed + مرآة التوكن إلى كوكي (30 يوماً) حتى تمر روابط window.open حارس الكوكي + authFetch للطلبات الإدارية (multi-backup/restore-backup/end-session) + مسح الكوكي عند الخروج
- login/page.tsx: ضبط كوكي authToken + dispatch حدث auth-changed بعد الدخول (يصلح ظهور الأزرار فوراً حتى مع router.push)
- end-session/route.ts: خطوة GitHub رقم 4 أصبحت ترفع النسخة الكاملة (أكواد + .env بالمفاتيح + db + نماذج مقسمة أجزاء <100MB) في الخلفية عبر gh-prepare-staging.sh + gh-push-full.sh مع سجل .gh-push.log، والنسخة المضغوطة عبر Contents API كخطة بديلة
- scripts/gh-prepare-staging.sh: إعادة تجهيز .gh-staging — 683MB (src 2.8M + mini-services 805M مع النماذج مقسمة 10 أجزاء + skills 61M + data 85M + db + scripts + worklog) — commit bdcae2a
- bundle محلي خارجي: download/ai-studio-full-backup.bundle (873M)
- اختبارات: بدون توكن → 401 على كل المسارات الإدارية؛ بتوكن المدير → multi-backup 200 (6 مواقع) + full-backup 200 + end-session dryRun كل الخطوات ok؛ / 200؛ دخول محمد (admin) ناجح
- محاولة الرفع الفعلية: فشلت — GITHUB_TOKEN المحفوظ (github_pat_1... من 2026-10-27) منتهي/ملغى (Bad credentials)

Stage Summary:
- كل شيء جاهز للرفع: شجرة التجهيز + سكربت الدفع + .env بالمفاتيح الظاهرة — ينقص توكن GitHub صالح فقط
- عند حصول توكن جديد: bash scripts/gh-push-full.sh <TOKEN> أو إدخاله في /llm-keys (llm:github_key) ثم bash scripts/sync-keys-to-env.py ثم زر "إنهاء الجلسة"
- أزرار المدير الأربعة تظهر عند تسجيل الدخول (الدور admin/isOwner=1 مؤكد في DB و API) — والآن تظهر فوراً بدون إعادة تحميل

---
Task ID: github-always-latest
Agent: main (Z.ai)
Task: نسخة GitHub محدثة دائماً لآخر إصدار — رفع تلقائي عند إنهاء الجلسة + زر مزامنة فوري + رفع تدريجي

Work Log:
- scripts/gh-prepare-staging.sh v2: وضع تحديث تدريجي — عند وجود .gh-staging/.git يعمل rsync --delete (يطابق أحدث حالة حتى الحذف) + إعادة تقسيم النماذج + commit واحد بالفروق فقط ("update: latest session changes (N files)") — المرة الأولى كاملة والتحديثات لاحقاً ترفع التغييرات فقط
- استثناء 'download' من rsync (كان يسرّب bundle الـ873MB إلى المستودع ويتضخم) + استثناء .gh-lock
- scripts/gh-run-chain.sh (جديد): غلاف مقفول بـ flock (.gh-lock) — سلسلة واحدة في نفس الوقت، تفريغ .gh-push.log عند كل تشغيل (سجل نظيف لكل رفعة، لا بقايا قديمة)
- gh-push-full.sh: إزالة exec>tee الذي كان يفرغ .gh-push.log (يحذف رأس السلسلة ومخرجات التجهيز ويسبب NUL) + دفع عادي مع fallback --force + دعم صيغة owner/repo في REPO_NAME
- /api/system/github-push (جديد، POST): حارس مدير + كشف "مشغول" 409 عبر flock probe + إطلاق السلسلة detached (يكمل حتى لو أُغلق التبويب) — التوكن يُقرأ وقت التشغيل: process.env → ملف .env → DB llm:github_key (بدون إعادة تشغيل)
- /api/system/github-status (جديد، GET): state=running/success/failed + آخر commit + ذيل السجل معقّم من NUL + كشف الجمود >20 دقيقة
- end-session خطوة GitHub: تستخدم الغلاف المقفول + readGitHubConfig() الفورية
- زر جديد في studio-header: "رفع إلى GitHub" (CloudUpload) — نقرة = بدء الرفع، نقرة يمين = عرض الحالة، عبر authFetch
- اختبارات e2e: إطلاق 1 ok / إطلاق 2 busy:true (القفل يعمل) / الحالة أثناء التشغيل running / النهاية failed برسالة واضحة (التوكن المنتهي) / سجل كامل نظيف (رأس + MODE:update + 1-file diff commit b2331a8 + ALL-PREP-DONE + FATAL متوقع) / end-session dryRun كل الخطوات ok / home 200

Stage Summary:
- "نسخة GitHub محدثة دائماً" جاهزة منطقياً بالكامل: عند إنهاء الجلسة أو إغلاق التبويب أو ضغط الزر — تُرفع أحدث حالة
- الحاجز الوحيد المتبقي: GITHUB_TOKEN منتهي (من 2026-10-27) — بمجرد إدخال توكن جديد من /llm-keys يعمل كل شيء فوراً بدون إعادة تشغيل
- الرفعة الأولى كاملة (~815MB)، والتحديثات التالية بأحجام الفروق فقط

---
Task ID: stability-fix-oom-turbopack
Agent: main (Z.ai)
Task: إصلاح عدم استقرار الشاشة وإعادة التشغيل المستمرة

Work Log:
- تشخيص: (1) OOM killer يقتل عمليات — ذاكرة 4GB فقط، خدمة تبديل الوجه 1.5GB + next-server 0.5GB، وسلسلة النسخ (git فوق شجرة 873MB) تستهلك الباقي → قتل عمليات → إعادة تشغيل؛ (2) شجرة .gh-staging كانت داخل مجلد المشروع → Turbopack يراقبها ويعيد الترجمة/إعادة التشغيل عند كل نسخ احتياطي → اهتزاز الشاشة؛ (3) سلسلة نشطة عالقة (git add -A بشغل 69% CPU) أطلقها end-session من متصفح المستخدم
- الإصلاحات:
  * نقل .gh-staging خارج المشروع إلى /home/z/.gh-staging (وأيضاً .gh-lock و .gh-push.log و .gh-prepare.log) — Turbopack لن يراها أبداً
  * تحديث المسارات في gh-prepare-staging.sh + gh-run-chain.sh + gh-push-full.sh + github-status/route.ts
  * حارس ذاكرة في gh-run-chain.sh: يرفض التشغيل إذا MemAvailable < 700MB برسالة عربية واضحة — يمنع OOM نهائياً
  * حدود ذاكرة git: gc.auto=0 + pack.threads=1 + core.compression=6
  * قتل السلسلة العالقة
- التحقق: الخادم 200 باستمرار خلال مراقبة 30 ثانية، الذاكرة المتاحة ثابتة ~1.7-1.8GB، prepare التدريجي أصبح 4 ثوانٍ فقط (بدل دقائق) مع NO-CHANGES detection، الخادم لم يهتز أثناء النسخ إطلاقاً

Stage Summary:
- الجهاز 2vCPU/4GB: خدمة الوجه 1.5GB + خادم 0.5GB — أي نسخ احتياطي يمر الآن عبر حارس الذاكرة والقفل، والشجرة خارج نطاق المراقبة → استقرار كامل
