import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const CHUNK = 256 * 1024;

/**
 * Content fingerprint used to recognise a PDF after it is renamed or moved.
 * Hashes the size plus the first and last 256 KiB, which is fast even for large textbooks
 * and stable across renames (the path is not part of the hash).
 */
export async function fingerprintFile(file: string): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const hash = createHash("sha256");
    hash.update(`${size}:`);
    const head = Buffer.alloc(Math.min(CHUNK, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > CHUNK) {
      const tailLen = Math.min(CHUNK, size - CHUNK);
      const tail = Buffer.alloc(tailLen);
      await handle.read(tail, 0, tailLen, size - tailLen);
      hash.update(tail);
    }
    return `v1:${hash.digest("hex")}`;
  } finally {
    await handle.close();
  }
}
