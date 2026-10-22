# 用个人 Gmail 启用订单邮件提醒

此方案使用 Google Apps Script 的 `MailApp`，由你的 Google 账号发信，不需要购买域名或 Resend 账号。个人 Gmail 的 Apps Script 邮件额度有限；Google 当前列出的消费者账号额度为每天 100 个收件人，且可能调整。

## 1. 部署邮件桥接脚本

1. 用 `daolingz46@gmail.com` 登录 [Google Apps Script](https://script.google.com/) 并新建项目。
2. 将本目录 `Code.gs` 的完整内容粘贴到编辑器，保存。
3. 在项目设置的“脚本属性”添加 `BRIDGE_TOKEN`。生成随机令牌可在 PowerShell 执行：

   ```powershell
   [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

   把生成结果留在本机，之后同一个值会填入 Cloudflare Secret。不要发到聊天或提交到 GitHub。

4. 选择 **部署 → 新建部署 → 网页应用**；“执行身份”选你自己，“谁有权访问”选“任何人”。点击部署，并按提示授权发送邮件。
5. 复制以 `/exec` 结尾的网页应用 URL。

## 2. 在 Cloudflare 保存两个 Secret

打开 Cloudflare **Workers & Pages → muse-store → Settings → Variables and Secrets**，添加：

- `GMAIL_SCRIPT_URL`：刚才复制的 `/exec` URL
- `GMAIL_SCRIPT_TOKEN`：刚才生成的随机令牌

保存后回到店主工作台刷新；邮件状态应显示“已连接”。点“发送测试邮件”验证收件箱。

公开的 Apps Script URL 本身不能发送邮件；脚本还会检查随机令牌，并且只允许邮件发往店主邮箱。订单邮件先入队，发送失败会由 Worker 定时重试。
