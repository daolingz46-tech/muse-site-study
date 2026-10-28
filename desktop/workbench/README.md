# Muse 店主工作台 Windows 版

双击 `Muse-店主工作台-1.0.1-x64.exe` 即可打开专用工作台窗口，无需安装。使用原有管理密码登录，订单与线上商店同步。电脑需要能访问 musetoken.store。

从源码重新构建：

```powershell
cd desktop/workbench
npm ci
npm run build:win
```

输出文件位于项目根目录的 `dist/workbench/`。窗口加载正式网站的工作台，因此网站更新后重新打开窗口即可获得最新工作台；“打开商店”在默认浏览器中打开。
