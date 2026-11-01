import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { makeOwnerPasswordHash } from "../worker/owner-auth.ts";

// Run from the project root. Nothing is sent to Cloudflare or printed to the terminal.
const configPath = ".dev.vars";
const passwordPath = "owner-approval.local.txt";
const lockPath = ".dev.vars.owner-setup.lock";

function fail(message) { console.error(message); process.exitCode = 1; }

function ensureWindowsOwnerOnly(path) {
  if (process.platform !== "win32") return;
  const who = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = who.status === 0 ? who.stdout.match(/S-1-(?:\d+-)+\d+/)?.[0] : null;
  if (!sid) throw new Error("无法识别当前 Windows 用户");
  // Remove inherited access before writing the password. SYSTEM retains system maintenance access.
  const acl = spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(F)`, "*S-1-5-18:(F)"], { encoding: "utf8", windowsHide: true });
  if (acl.status !== 0) throw new Error("无法限制本地密码文件权限");
}

let lockFd;
let passwordFd;
let createdPasswordFile = false;
let configWriteStarted = false;
try {
  // Refuse to create a second secret, overwrite an old one, or operate outside a Git repository.
  if (!existsSync(".git") || !existsSync(configPath) || !lstatSync(configPath).isFile()) throw new Error("未找到已有的项目管理配置，请先检查项目目录和 .dev.vars。");
  for (const path of [configPath, passwordPath, lockPath]) {
    const check = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", path], { windowsHide: true });
    if (check.status !== 0) throw new Error("本地敏感文件尚未排除 Git 提交，已停止。");
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", path], { stdio: "ignore", windowsHide: true });
    if (tracked.status !== 1) throw new Error("本地敏感文件已被 Git 跟踪或无法确认状态，已停止。");
  }
  lockFd = openSync(lockPath, "wx", 0o600);
  if (existsSync(passwordPath)) throw new Error("店主审批口令文件已存在，未覆盖；请先核对现有配置。");
  const config = readFileSync(configPath, "utf8");
  if (/^\s*(?:export\s+)?OWNER_PASSWORD_HASH\s*=/m.test(config)) throw new Error("店主审批口令已配置，未覆盖；如需轮换请先妥善处理旧配置。");
  const password = randomBytes(32).toString("base64url");
  const passwordHash = await makeOwnerPasswordHash(password);
  passwordFd = openSync(passwordPath, "wx", 0o600);
  createdPasswordFile = true;
  ensureWindowsOwnerOnly(passwordPath);
  writeFileSync(passwordFd, `卡密大王店主审批口令\n${password}\n\n此口令用于店主审批，独立于工作台登录密码。请妥善保管，不要上传或转发。\n`, "utf8");
  closeSync(passwordFd); passwordFd = undefined;
  // Avoid replacing other settings or overwriting an OWNER_PASSWORD_HASH added meanwhile.
  if (readFileSync(configPath, "utf8") !== config) throw new Error("管理配置刚刚发生变化，已停止，请核对后重试。");
  configWriteStarted = true;
  appendFileSync(configPath, `${config && !config.endsWith("\n") ? "\n" : ""}OWNER_PASSWORD_HASH=${passwordHash}\n`, { encoding: "utf8", mode: 0o600 });
  console.log("店主审批口令已生成并写入本地配置。请在项目目录打开 owner-approval.local.txt 查看；尚未部署。");
} catch (error) {
  if (passwordFd !== undefined) { try { closeSync(passwordFd); } catch {} }
  // If config writing may have begun, preserve the password file for recovery.
  if (createdPasswordFile && !configWriteStarted) { try { unlinkSync(passwordPath); } catch {} }
  fail(configWriteStarted ? "本地配置写入未确认，请保留口令文件并检查 .dev.vars，确认后再操作。" : error instanceof Error ? error.message : "初始化失败，未部署任何配置。");
} finally {
  if (lockFd !== undefined) { try { closeSync(lockFd); } catch {} try { unlinkSync(lockPath); } catch {} }
}
