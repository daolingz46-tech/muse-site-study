const { app, BrowserWindow, shell, safeStorage, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const ADMIN_URL = "https://musetoken.store/admin/";
const STORE_URL = "https://musetoken.store/";
const LOGIN_URL = "https://musetoken.store/api/admin/login";
const LOGOUT_URL = "https://musetoken.store/api/admin/logout";
const pending = new Map();
const credentialFile = () => path.join(app.getPath("userData"), "owner-credentials.bin");
function clearCredential() { try { fs.unlinkSync(credentialFile()); } catch (e) { if (e.code !== "ENOENT") console.error("无法清除本机登录信息"); } }
function rememberLogin() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest({urls:[LOGIN_URL]}, (details, callback) => {
    try {
      if (details.method === "POST" && details.uploadData && safeStorage.isEncryptionAvailable()) {
        const raw = Buffer.concat(details.uploadData.filter(item => item.bytes).map(item => Buffer.from(item.bytes))).toString("utf8");
        const input = JSON.parse(raw);
        if (typeof input.password === "string" && input.password.length <= 256) pending.set(details.id, safeStorage.encryptString(input.password));
      }
    } catch { /* Normal login remains available. */ }
    callback({cancel:false});
  });
  ses.webRequest.onCompleted({urls:[LOGIN_URL,LOGOUT_URL]}, details => {
    if (details.url === LOGOUT_URL && details.method === "POST" && details.statusCode === 200) clearCredential();
    const encrypted = pending.get(details.id); pending.delete(details.id);
    if (encrypted && details.statusCode === 200) try { fs.writeFileSync(credentialFile(), encrypted, {mode:0o600}); } catch { console.error("无法保存本机登录信息"); }
  });
  ses.webRequest.onErrorOccurred({urls:[LOGIN_URL]}, details => pending.delete(details.id));
}
async function restoreLogin() {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const password = safeStorage.decryptString(fs.readFileSync(credentialFile()));
    const response = await session.defaultSession.fetch(LOGIN_URL, {method:"POST",headers:{"Content-Type":"application/json",Origin:"https://musetoken.store"},body:JSON.stringify({password}),signal:AbortSignal.timeout(10000)});
    if (response.status === 401) clearCredential();
  } catch { /* Offline or missing credentials: show normal login. */ }
}

function isAdminUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === new URL(ADMIN_URL).origin && ["/admin", "/admin/", "/admin/agents", "/admin/agents/"].includes(url.pathname);
  } catch {
    return false;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: "#f7f8fb",
    title: "Muse 店主工作台",
    icon: path.join(__dirname, "build", "muse.ico"),
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  });

  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === STORE_URL) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAdminUrl(url)) event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) void window.loadFile(path.join(__dirname, "offline.html"));
  });
  void window.loadURL(ADMIN_URL);
}

app.setAppUserModelId("com.muse.store.workbench");
app.whenReady().then(async () => {
  rememberLogin();
  await restoreLogin();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => app.quit());
