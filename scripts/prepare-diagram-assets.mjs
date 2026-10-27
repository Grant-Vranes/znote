import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;

function run(args) {
  const result = spawnSync(node, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(["scripts/fetch-drawio.mjs"]);
run(["node_modules/typescript/bin/tsc", "--noEmit", "-p", "diagram-app/excalidraw/tsconfig.json"]);
run([
  "node_modules/vite/bin/vite.js",
  "build",
  "--config",
  "diagram-app/excalidraw/vite.config.ts",
]);
