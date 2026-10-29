# AI Studio — دليل إنشاء أيقونة على سطح المكتب

## للويندوز:

### الخطوة 1: تحميل الملفات
1. اضغط زر "تنزيل النسخة الحالية" (الأخضر) في البرنامج
2. حمّل أيضاً ملف `AI-Studio-Launcher.bat` من:
   ```
   https://preview-chat-8a1e925e-0ac6-402e-9573-b6a9229282b0.space-z.ai/AI-Studio-Launcher.bat
   ```
3. حمّل أيضاً `AI-Studio-Silent.vbs` من:
   ```
   https://preview-chat-8a1e925e-0ac6-402e-9573-b6a9229282b0.space-z.ai/AI-Studio-Silent.vbs
   ```

### الخطوة 2: استخراج المشروع
1. استخرج `ai-studio-current.tar.gz` في مجلد مثل `C:\AI-Studio`
2. انسخ `AI-Studio-Launcher.bat` و `AI-Studio-Silent.vbs` إلى نفس المجلد

### الخطوة 3: إنشاء اختصار على سطح المكتب
1. انقر بالزر الأيمن على `AI-Studio-Silent.vbs`
2. اختر **"إنشاء اختصار"** (Create Shortcut)
3. انقل الاختصار إلى سطح المكتب
4. انقر بالزر الأيمن على الاختصار → **"تغيير الأيقونة"**
5. اختر أيقونة البرنامج (حمّل `icon-256x256.png` من المعاينة، ثم حوّلها لـ .ico)

### الخطوة 4: التشغيل
- انقر مرتين على الاختصار في سطح المكتب
- سيشغّل البرنامج تلقائياً ويفتح المتصفح على `http://localhost:3000`

---

## للماك (Mac):

### الخطوة 1: تحميل الملفات
```bash
# حمّل النسخة الحالية
curl -O https://preview-chat-8a1e925e-0ac6-402e-9573-b6a9229282b0.space-z.ai/ai-studio-current.tar.gz
curl -O https://preview-chat-8a1e925e-0ac6-402e-9573-b6a9229282b0.space-z.ai/AI-Studio-Launcher.sh
```

### الخطوة 2: الاستخراج والتثبيت
```bash
tar -xzf ai-studio-current.tar.gz -C ~/AI-Studio
cd ~/AI-Studio
npm install
pip3 install insightface onnxruntime opencv-python-headless
chmod +x AI-Studio-Launcher.sh
```

### الخطوة 3: إنشاء اختصار
1. افتح **Automator**
2. اختر **Application**
3. أضف **Run Shell Script**
4. اكتب: `~/AI-Studio/AI-Studio-Launcher.sh`
5. احفظ كـ `AI Studio.app` على سطح المكتب

---

## للينكس (Linux):

### الخطوة 1: تحميل
```bash
mkdir ~/AI-Studio
cd ~/AI-Studio
# حمّل الملفات هنا
tar -xzf ai-studio-current.tar.gz
chmod +x AI-Studio-Launcher.sh
```

### الخطوة 2: إنشاء ملف .desktop
```bash
cat > ~/.local/share/applications/ai-studio.desktop << EOF
[Desktop Entry]
Name=AI Studio
Comment=AI Face Swap & Video Editor
Exec=/home/$USER/AI-Studio/AI-Studio-Launcher.sh
Icon=/home/$USER/AI-Studio/public/icon-256x256.png
Terminal=false
Type=Application
Categories=Graphics;Video;
EOF
```

### الخطوة 3: التشغيل
- ستجد "AI Studio" في قائمة التطبيقات
- انقر عليها لتشغيل البرنامج
