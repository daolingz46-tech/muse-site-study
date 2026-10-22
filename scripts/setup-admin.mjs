import { randomBytes, createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".dev.vars") || existsSync("admin-access.local.txt")) {
  console.log("本地管理密码文件已存在，未覆盖。");
} else {
  const password = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(password).digest("hex");
  writeFileSync(".dev.vars", `ADMIN_PASSWORD_HASH=${hash}\n`, { mode: 0o600 });
  writeFileSync("admin-access.local.txt", `Muse 商店管理工作台\n本地地址：http://localhost:8787/admin/\n线上地址：发布后的网址加 /admin/\n管理密码：${password}\n请保管此文件，不要上传到 GitHub。\n`, { mode: 0o600 });
  console.log("管理密码已保存在 admin-access.local.txt（已排除 Git 提交）。");
}
