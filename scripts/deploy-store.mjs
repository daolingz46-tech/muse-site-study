import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const cli = "node_modules/wrangler/bin/wrangler.js";
function run(args, capture = false) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } });
  if (result.status !== 0) { if (capture) process.stderr.write(result.stderr || "Cloudflare 操作失败，请先运行 npx wrangler login。\n"); process.exit(result.status || 1); }
  return result.stdout || "";
}
if (!existsSync(".dev.vars")) { console.error("请先运行 npm run setup:admin。"); process.exit(1); }
const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
let databases = JSON.parse(run(["d1", "list", "--json"], true));
if (!databases.some(db => db.name === "muse-orders")) {
  run(["d1", "create", "muse-orders", "--location", "apac"]);
  databases = JSON.parse(run(["d1", "list", "--json"], true));
}
const database = databases.find(db => db.name === "muse-orders");
if (!database) throw new Error("未找到 muse-orders 数据库");
config.d1_databases[0].database_id = database.uuid;
writeFileSync("wrangler.production.json", JSON.stringify(config, null, 2) + "\n");
run(["d1", "migrations", "apply", "muse-orders", "--remote", "--config", "wrangler.production.json"]);
const build = spawnSync(process.execPath, ["scripts/build-store.mjs"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);
run(["deploy", "--config", "wrangler.production.json", "--secrets-file", ".dev.vars"]);
console.log("发布完成。管理入口为网站地址加 /admin/，密码见本地 admin-access.local.txt。");
