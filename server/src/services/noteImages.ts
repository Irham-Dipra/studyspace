import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Pictures kept as notes. Each file is named by its content hash, so a picture added twice is stored
 * once, and a note that is deleted and brought back by undo (or copied into a new PDF) still finds
 * its picture. Files are never deleted. SVG is left out on purpose: it can carry scripts.
 */

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Content types the upload route accepts, and the extension each is stored with. */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const CONTENT_TYPES: Record<string, string> = Object.fromEntries(Object.entries(IMAGE_EXTENSIONS).map(([type, ext]) => [ext, type]));

const NAME = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/;

/** Which picture format the bytes really are (by their first bytes), or null. */
export function sniffImage(b: Uint8Array): "png" | "jpg" | "gif" | "webp" | null {
  const at = (i: number, s: string) => s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length > 8 && b[0] === 0x89 && at(1, "PNG")) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "gif";
  if (b.length > 12 && at(0, "RIFF") && at(8, "WEBP")) return "webp";
  return null;
}

const imageDir = (dataDir: string) => path.join(dataDir, "images");

/** Stores a picture; returns its file name (`<sha256>.<ext>`). Throws a plain message for non-pictures. */
export async function saveNoteImage(dataDir: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0) throw new Error("The picture is empty.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("The picture is too big (25 MB at most).");
  const ext = sniffImage(bytes);
  if (!ext) throw new Error("That is not a PNG, JPEG, GIF or WebP picture.");
  const name = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  const dir = imageDir(dataDir);
  const target = path.join(dir, name);
  await fs.mkdir(dir, { recursive: true });
  if (await fs.stat(target).then(() => true, () => false)) return name;
  // Temp file then rename, so a reader never sees half a picture.
  const tmp = path.join(dir, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmp, bytes, { flag: "wx" });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return name;
}

/** The stored file for a name from the URL, or null when the name is not one StudySpace made. */
export function noteImageFile(dataDir: string, name: string): { file: string; contentType: string } | null {
  if (!NAME.test(name)) return null;
  return { file: path.join(imageDir(dataDir), name), contentType: CONTENT_TYPES[name.split(".")[1]] };
}
