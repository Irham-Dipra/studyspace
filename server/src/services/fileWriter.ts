import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Replaces `target` with `bytes` atomically: writes a temp file in the same directory, fsyncs it,
 * then renames it over the original, so a crash never leaves a half-written PDF. Keeps the file mode.
 */
export async function writeFileAtomic(target: string, bytes: Uint8Array): Promise<void> {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.studyspace-${randomBytes(4).toString("hex")}.tmp`);
  const st = await fs.stat(target);
  const handle = await fs.open(tmp, "wx", st.mode & 0o777);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (err) {
    await handle.close();
    await fs.rm(tmp, { force: true });
    throw err;
  }
  await handle.close();
  try {
    await renameRetrying(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** On Windows a virus scanner or the search indexer can hold a file for a moment, so try again briefly. */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const busy = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (process.platform !== "win32" || !busy || attempt >= 8) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}
