import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(await readFile(path.join(projectRoot, "resources/drawio.lock.json"), "utf8"));
const targetDirectory = path.join(projectRoot, "build/desktop-resources/drawio");
const target = path.join(targetDirectory, "draw.war");
const digest = (data) => createHash("sha256").update(data).digest("hex");

await mkdir(targetDirectory, { recursive: true });
try {
  const cached = await readFile(target);
  if (cached.length === lock.size && digest(cached) === lock.sha256) {
    console.log(`Verified cached Draw.io ${lock.version} archive.`);
    process.exit(0);
  }
} catch { /* No cache: fetch the pinned release below. */ }

const chunks = 4;
const chunkSize = Math.ceil(lock.size / chunks);
const parts = await Promise.all(Array.from({ length: chunks }, async (_, index) => {
  const start = index * chunkSize;
  if (start >= lock.size) return Buffer.alloc(0);
  const end = Math.min(lock.size - 1, start + chunkSize - 1);
  const response = await fetch(lock.url, {
    headers: {
      Range: `bytes=${start}-${end}`,
      "User-Agent": "ZNote desktop build",
    },
    signal: AbortSignal.timeout(240_000),
  });
  if (response.status !== 206) throw new Error(`Draw.io range ${index + 1} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== end - start + 1) throw new Error(`Draw.io range ${index + 1} size mismatch`);
  return bytes;
}));

const archive = Buffer.concat(parts);
if (archive.length !== lock.size) throw new Error(`Draw.io archive size mismatch: ${archive.length} != ${lock.size}`);
const actualSha256 = digest(archive);
if (actualSha256 !== lock.sha256) throw new Error(`Draw.io SHA-256 mismatch: ${actualSha256}`);
const temporary = `${target}.tmp`;
await writeFile(temporary, archive);
await rename(temporary, target);
console.log(`Fetched and verified Draw.io ${lock.version} (${archive.length} bytes).`);
