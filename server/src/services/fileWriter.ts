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
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
