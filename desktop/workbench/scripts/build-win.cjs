const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const cache = path.resolve(__dirname, "../../../temp/electron-builder-cache");
fs.mkdirSync(cache, { recursive: true });
const cli = path.join(path.dirname(require.resolve("electron-builder/package.json")), "out", "cli", "cli.js");
const result = spawnSync(process.execPath, [cli, "--win", "portable", "--x64"], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_BUILDER_CACHE: cache }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
