import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Derive expectations from the pinned upstream manifest independently of the
// build plugin, so a mistaken exclusion rule cannot make the check pass too.
const manifest = JSON.parse(fs.readFileSync("tests/vendor/zensical/manifest.json", "utf8"));
const referenceCss = new Set(manifest.files.map(({ variant, file }) => `zensical/${variant}/${file}`));

let excluded = 0;
function verify(root, directory, prefix, reference) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) verify(root, file, prefix, reference);
    else {
      const relative = path.relative(root, file).split(path.sep).join("/");
      const destination = path.join("dist", prefix, relative);
      if (reference && referenceCss.has(relative)) {
        assert(!fs.existsSync(destination), `Reference CSS must not ship: ${relative}`);
        excluded += fs.statSync(file).size;
      } else {
        assert(fs.readFileSync(file).equals(fs.readFileSync(destination)), `Public asset missing or changed: ${relative}`);
      }
    }
  }
}
if (fs.existsSync("public")) verify("public", "public", "", false);
verify("tests/vendor", "tests/vendor", "licenses", true);
const generated = fs.readdirSync("dist/assets").filter(name => /\.(css|js)$/.test(name)).map(name => fs.readFileSync(path.join("dist/assets", name), "utf8")).join("\n");
assert(generated.includes("znote-render-scope"), "Scoped document CSS must remain in the frontend bundle");

const drawioLock = JSON.parse(fs.readFileSync("resources/drawio.lock.json", "utf8"));
const drawioArchive = "build/desktop-resources/drawio/draw.war";
assert(fs.existsSync(drawioArchive), "Offline Draw.io archive is missing; run scripts/prepare-diagram-assets.mjs");
const drawioBytes = fs.readFileSync(drawioArchive);
assert.equal(drawioBytes.length, drawioLock.size, "Draw.io archive size differs from the lock file");
assert.equal(createHash("sha256").update(drawioBytes).digest("hex"), drawioLock.sha256, "Draw.io archive checksum differs from the lock file");

const excalidrawRoot = "build/desktop-resources/excalidraw";
const excalidrawIndex = path.join(excalidrawRoot, "index.html");
assert(fs.existsSync(excalidrawIndex), "Offline Excalidraw bundle is missing; run scripts/prepare-diagram-assets.mjs");
const html = fs.readFileSync(excalidrawIndex, "utf8");
for (const [, asset] of html.matchAll(/(?:src|href)="\.\/([^\"]+)"/g)) {
  assert(fs.existsSync(path.join(excalidrawRoot, asset)), `Excalidraw bundle asset missing: ${asset}`);
}

// The desktop bundle configuration must map the offline diagram resources into
// every packaged app, so the built output never fetches them at runtime.
for (const config of ["src-tauri/tauri.conf.json", "src-tauri/tauri.windows.conf.json"]) {
  const bundle = JSON.parse(fs.readFileSync(config, "utf8"));
  const resources = bundle.bundle?.resources ?? {};
  const values = typeof resources === "object" && !Array.isArray(resources) ? Object.keys(resources) : resources;
  const mapped = JSON.stringify(values);
  assert(mapped.includes("drawio/draw.war"), `${config} must bundle the pinned Draw.io archive`);
  assert(mapped.includes("desktop-resources/excalidraw"), `${config} must bundle the Excalidraw app`);
}
console.log(`Package assets verified: ${excluded.toLocaleString()} bytes of reference CSS excluded; notices and offline diagram editors retained.`);
