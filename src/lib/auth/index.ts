/**
 * Auth utilities — password hashing, session management, OTP generation.
 */
import { createHash, randomBytes } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = createHash("sha256").update(salt + password).digest("hex");
  return computed === hash;
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export const PLANS = [
  { id: "trial", name: "تجربة مجانية", nameEn: "Free Trial", price: 0, durationDays: 3, features: "كل الميزات لمدة 3 أيام" },
  { id: "welcome", name: "اشتراك ترحيبي", nameEn: "Welcome Plan", price: 10, durationDays: 90, features: "$10/شهر لمدة 3 أشهر" },
  { id: "monthly", name: "اشتراك شهري", nameEn: "Monthly", price: 25, durationDays: 30, features: "$25/شهر" },
  { id: "semiannual", name: "اشتراك 6 أشهر", nameEn: "Semi-Annual", price: 130, durationDays: 180, features: "$130 لمدة 6 أشهر" },
  { id: "annual", name: "اشتراك سنوي", nameEn: "Annual", price: 250, durationDays: 365, features: "$250 لمدة 12 شهر" },
];

export const PERMISSION_KEYS = [
  { key: "studio", label: "الاستوديو (تبديل الملابس)", labelEn: "Studio" },
  { key: "face_swap", label: "تبديل الوجه", labelEn: "Face Swap" },
  { key: "image_tools", label: "أدوات الصور", labelEn: "Image Tools" },
  { key: "image_convert", label: "تحويل صيغة الصور", labelEn: "Image Convert" },
  { key: "video_enhance", label: "تحسين الفيديو", labelEn: "Video Enhance" },
  { key: "video_split", label: "تقسيم الفيديو", labelEn: "Video Split" },
  { key: "video_trim", label: "قص الفيديو", labelEn: "Video Trim" },
  { key: "video_merge", label: "دمج الفيديو", labelEn: "Video Merge" },
  { key: "video_convert", label: "تحويل صيغة الفيديو", labelEn: "Video Convert" },
  { key: "admin", label: "لوحة الإدارة", labelEn: "Admin" },
];

export function getSessionToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  // Cookie fallback — keeps the admin session alive even if
  // localStorage gets cleared (persistent login for the owner).
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)authToken=([A-Za-z0-9]{16,})/);
  return m ? m[1] : null;
}

/**
 * Resolve the session user from a request (token header or cookie).
 * Returns null when the token/session is missing or the user is gone.
 */
export async function getSessionUser(req: Request): Promise<any | null> {
  try {
    const { db } = await import("@/lib/db");
    const token = getSessionToken(req);
    if (!token) return null;
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return null;
    return await db.user.findUnique({ where: { id: session.value } });
  } catch {
    return null;
  }
}

/**
 * Server-side admin guard for destructive/system-management APIs.
 * Returns the user when authorized (admin / assistant / owner),
 * otherwise null — routes respond with 401/403.
 */
export async function requireAdmin(req: Request): Promise<any | null> {
  const user = await getSessionUser(req);
  if (!user) return null;
  if (user.isOwner || user.role === "admin" || user.role === "assistant") return user;
  return null;
}

export async function ensureOwnerAccount(db: any) {
  const existing = await db.user.findFirst({ where: { isOwner: true } });
  if (existing) return existing;
  const owner = await db.user.create({
    data: {
      email: "mohamed@ai-studio.admin",
      name: "محمد",
      passwordHash: hashPassword("1970"),
      role: "admin",
      isOwner: true,
      isVerified: true,
    },
  });
  console.log("[auth] Owner account created: محمد / 1970");
  return owner;
}
