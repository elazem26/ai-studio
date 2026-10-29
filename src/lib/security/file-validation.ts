import path from "path";

/**
 * Security Layer - file validation utilities
 * Defends against: malicious uploads, path traversal, disguised files
 */

export const ALLOWED_IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "tiff"] as const;
export type AllowedImageExt = (typeof ALLOWED_IMAGE_EXTS)[number];

export const ALLOWED_MIME: Record<AllowedImageExt, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  tiff: ["image/tiff"],
};

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/** Magic bytes for each supported image format */
const MAGIC_BYTES: { ext: AllowedImageExt; bytes: number[]; offset?: number }[] = [
  // JPEG: starts with FF D8 FF
  { ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { ext: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
  { ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // TIFF: II*\0 (little-endian) or MM\0* (big-endian)
  { ext: "tiff", bytes: [0x49, 0x49, 0x2a, 0x00] },
  { ext: "tiff", bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  // WEBP: starts with RIFF....WEBP at offset 0 (RIFF) then WEBP at offset 8
  { ext: "webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
];

export interface FileValidationResult {
  valid: boolean;
  ext?: AllowedImageExt;
  mime?: string;
  errorKey?: string;
  errorMessage?: string;
}

/** Detect extension from filename - normalized lowercase */
export function detectExtension(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
  if (!ext) return null;
  return ext;
}

/**
 * Validate a file's extension against the allowed list.
 */
export function validateExtension(filename: string): FileValidationResult {
  const ext = detectExtension(filename);
  if (!ext) {
    return {
      valid: false,
      errorKey: "errors.unsupportedFormat",
      errorMessage: "No file extension",
    };
  }
  if (!ALLOWED_IMAGE_EXTS.includes(ext as AllowedImageExt)) {
    return {
      valid: false,
      errorKey: "errors.unsupportedFormat",
      errorMessage: `Extension .${ext} is not supported`,
    };
  }
  return { valid: true, ext: ext as AllowedImageExt };
}

/**
 * Validate MIME type matches the declared extension.
 * Disallow mismatches (e.g. .png declared but content-type: application/exe).
 */
export function validateMime(
  declaredMime: string | null,
  ext: AllowedImageExt
): FileValidationResult {
  if (!declaredMime) {
    // Browser may not supply MIME - skip and rely on magic bytes
    return { valid: true, ext };
  }
  const allowed = ALLOWED_MIME[ext];
  if (!allowed.includes(declaredMime.toLowerCase())) {
    return {
      valid: false,
      ext,
      errorKey: "errors.invalidImage",
      errorMessage: `MIME ${declaredMime} does not match extension .${ext}`,
    };
  }
  return { valid: true, ext, mime: declaredMime };
}

/**
 * Detect actual file type from the first few bytes.
 * This is the most reliable check — defeats disguised files.
 */
export function detectFromMagicBytes(buf: Uint8Array): AllowedImageExt | null {
  for (const def of MAGIC_BYTES) {
    if (buf.length < def.bytes.length) continue;
    let match = true;
    for (let i = 0; i < def.bytes.length; i++) {
      if (buf[i] !== def.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Special case for WEBP: also check "WEBP" at offset 8
      if (def.ext === "webp" && buf.length >= 12) {
        const webpTag = String.fromCharCode(
          buf[8],
          buf[9],
          buf[10],
          buf[11]
        );
        if (webpTag === "WEBP") {
          return "webp";
        }
        continue; // RIFF but not WEBP — keep searching
      }
      return def.ext;
    }
  }
  return null;
}

/**
 * Full file validation pipeline:
 *   extension -> MIME -> magic bytes -> size
 * Returns valid only if all checks pass.
 */
export function validateFileFull(opts: {
  filename: string;
  declaredMime?: string | null;
  buffer: Uint8Array;
  size: number;
}): FileValidationResult {
  const { filename, declaredMime, buffer, size } = opts;

  if (size > MAX_FILE_SIZE) {
    return {
      valid: false,
      errorKey: "errors.fileTooLarge",
      errorMessage: `Size ${size} exceeds ${MAX_FILE_SIZE}`,
    };
  }

  if (size < 16) {
    return {
      valid: false,
      errorKey: "errors.corruptedFile",
      errorMessage: "File too small to be a valid image",
    };
  }

  const extCheck = validateExtension(filename);
  if (!extCheck.valid || !extCheck.ext) {
    return extCheck;
  }

  const mimeCheck = validateMime(declaredMime ?? null, extCheck.ext);
  if (!mimeCheck.valid) {
    return mimeCheck;
  }

  const detected = detectFromMagicBytes(buffer);
  if (!detected) {
    return {
      valid: false,
      ext: extCheck.ext,
      errorKey: "errors.invalidImage",
      errorMessage: "File magic bytes do not match any supported image format",
    };
  }

  // Magic-byte detected format must match declared extension (modulo jpg/jpeg alias)
  const extAliases: Record<AllowedImageExt, AllowedImageExt[]> = {
    jpg: ["jpg", "jpeg"],
    jpeg: ["jpg", "jpeg"],
    png: ["png"],
    webp: ["webp"],
    tiff: ["tiff"],
  };
  if (!extAliases[extCheck.ext].includes(detected)) {
    return {
      valid: false,
      ext: extCheck.ext,
      errorKey: "errors.invalidImage",
      errorMessage: `Declared .${extCheck.ext} but content is .${detected}`,
    };
  }

  return { valid: true, ext: extCheck.ext, mime: mimeCheck.mime ?? declaredMime ?? undefined };
}

/**
 * Sanitize a user-provided filename. Strips path separators, control chars.
 */
export function sanitizeFilename(filename: string): string {
  // Strip any path components — defense against path traversal
  const base = path.basename(filename);
  // Remove control characters
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "_");
  // Collapse multiple dots (no hidden file trickery)
  return cleaned.replace(/^\.+/, "").replace(/\.{2,}/g, ".");
}

/**
 * Generate a safe, opaque storage filename. We don't leak user filename to disk.
 */
export function generateStorageFilename(ext: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${time}-${rand}.${ext}`;
}

/**
 * Resolve a target upload path safely under the upload root.
 * Returns the absolute path or null if it would escape the root.
 */
export function safeJoinUploadPath(uploadRoot: string, filename: string): string | null {
  const safe = sanitizeFilename(filename);
  const target = path.join(uploadRoot, safe);
  const normalizedTarget = path.resolve(target);
  const normalizedRoot = path.resolve(uploadRoot);
  if (!normalizedTarget.startsWith(normalizedRoot + path.sep) && normalizedTarget !== normalizedRoot) {
    return null;
  }
  return normalizedTarget;
}
