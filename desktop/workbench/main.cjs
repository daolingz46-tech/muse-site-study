const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

const ADMIN_URL = "https://musetoken.store/admin/";
const STORE_URL = "https://musetoken.store/";

function isAdminUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === new URL(ADMIN_URL).origin && url.pathname === new URL(ADMIN_URL).pathname;
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
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => app.quit());
