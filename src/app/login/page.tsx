"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Shield } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register" | "otp">("login");
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [otpShown, setOtpShown] = useState("");

  const handleLogin = async () => {
    setLoading(true); setError("");
    try {
      const isEmail = contact.includes("@");
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEmail ? { email: contact, password } : { phone: contact, password }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      localStorage.setItem("authToken", d.token);
      localStorage.setItem("userName", d.user.name || "");
      document.cookie = `authToken=${d.token}; path=/; max-age=2592000; SameSite=Lax`;
      window.dispatchEvent(new Event("auth-changed"));
      const hasDevice = localStorage.getItem("userDevice");
      router.push(hasDevice ? "/" : "/select-device");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    setLoading(true); setError("");
    try {
      const isEmail = contact.includes("@");
      const r = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEmail ? { email: contact, name, password } : { phone: contact, name, password }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      setUserId(d.userId); setOtpShown(d.otp || ""); setMode("otp");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleVerifyOTP = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/auth/verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, otp }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      localStorage.setItem("authToken", d.token);
      localStorage.setItem("userName", d.user?.name || "");
      document.cookie = `authToken=${d.token}; path=/; max-age=2592000; SameSite=Lax`;
      window.dispatchEvent(new Event("auth-changed"));
      router.push("/select-device");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md studio-panel border-cyan-accent/30">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-xl">
            {mode === "login" ? "تسجيل الدخول" : mode === "register" ? "إنشاء حساب جديد" : "تأكيد الحساب"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="p-3 rounded-md bg-red-500/10 text-red-400 text-sm text-center">{error}</div>}
          {mode === "login" && (
            <>
              <div className="space-y-1.5">
                <Label>البريد الإلكتروني أو رقم الهاتف</Label>
                <Input value={contact} onChange={e => setContact(e.target.value)} placeholder="example@mail.com أو 05xxxxxxxx" />
              </div>
              <div className="space-y-1.5">
                <Label>كلمة المرور</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" onKeyDown={e => e.key === "Enter" && handleLogin()} />
              </div>
              <Button onClick={handleLogin} disabled={loading} className="w-full bg-cyan-accent text-black">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                دخول
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                ليس لديك حساب؟{" "}
                <button onClick={() => { setMode("register"); setError(""); }} className="text-cyan-accent font-medium hover:underline">أنشئ حساباً</button>
              </p>
              <div className="p-2 rounded-md bg-amber-500/10 text-amber-400 text-xs text-center">حساب المدير: mohamed / 1970</div>
            </>
          )}
          {mode === "register" && (
            <>
              <div className="space-y-1.5">
                <Label>الاسم</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="اسمك" />
              </div>
              <div className="space-y-1.5">
                <Label>البريد الإلكتروني أو رقم الهاتف</Label>
                <Input value={contact} onChange={e => setContact(e.target.value)} placeholder="example@mail.com أو 05xxxxxxxx" />
              </div>
              <div className="space-y-1.5">
                <Label>كلمة المرور</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
              </div>
              <Button onClick={handleRegister} disabled={loading} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                إنشاء حساب
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                لديك حساب؟{" "}
                <button onClick={() => { setMode("login"); setError(""); }} className="text-cyan-accent font-medium hover:underline">سجل دخول</button>
              </p>
            </>
          )}
          {mode === "otp" && (
            <>
              {otpShown && <div className="p-3 rounded-md bg-emerald-500/10 text-emerald-400 text-sm text-center">رمز التأكيد (للتجربة): {otpShown}</div>}
              <div className="space-y-1.5">
                <Label>رمز التأكيد</Label>
                <Input value={otp} onChange={e => setOtp(e.target.value)} placeholder="000000" maxLength={6} className="text-center text-2xl tracking-widest" onKeyDown={e => e.key === "Enter" && handleVerifyOTP()} />
              </div>
              <Button onClick={handleVerifyOTP} disabled={loading} className="w-full bg-emerald-500 text-white">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                تأكيد
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
