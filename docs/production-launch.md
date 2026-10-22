# 个人收款版部署与管理

## 正式部署记录（2026-10-22）

- 商店：https://muse-store.muse-site-study.workers.dev/
- 工作台：https://muse-store.muse-site-study.workers.dev/admin/
- Cloudflare D1 `muse-orders` 已创建并完成迁移，管理密码摘要已作为 Worker secret 发布。
- 已通过公网首页、工作台页面、浏览器表单渲染、收款码文件哈希匹配、管理接口未登录拦截、登录后数据库查询及退出验证。验收没有创建虚假收款或交付记录。
- 网站托管在 Cloudflare，访问不依赖本机服务。

## 架构及上线条件

- GitHub：源代码和 CI，Pages 入口在正式站发布后跳转。
- Cloudflare Workers：Next.js 导出的静态页面与订单 API 同域运行。
- Cloudflare D1：订单、管理会话、限流记录和操作审计。
- 正式上线需要注册 Cloudflare 并在 `npx wrangler login` 打开的页面授权。没有登录授权时，代码、本地验收和上线脚本可以完成，线上数据库和网址尚未创建。
- 使用免费计划提供的额度，未申请付费计划；流量超出额度时需要另行评估。参考 [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/) 和 [D1 免费额度](https://developers.cloudflare.com/d1/platform/pricing/)。

## 发布操作

1. `npm ci`。
2. `npm run setup:admin` 生成随机管理密码，保存到 `admin-access.local.txt`。`.dev.vars` 仅保存 SHA-256 摘要。
3. `npm run check`、`npm run build:store`、`npm run test:orders`。
4. `npx wrangler login`，在 Cloudflare 页面完成授权。
5. `npm run deploy:store`。脚本创建或复用 `muse-orders`，生成本地 `wrangler.production.json`，执行线上迁移并发布静态资源/API/密码摘要。
6. 打开发布结果的 HTTPS 网址及 `/admin/`，核对收款二维码、订单和后台；生产验收不要虚构真实付款或交付。
7. 在 GitHub Actions 运行 `Publish store address` 并传入正式网址。GitHub Pages 仅作为跳转入口，不运行订单后端。

GitHub Actions 的 CI 执行代码检查、构建和订单测试。Cloudflare 登录凭据、工作台密码文件、本地数据库均未提交。

## 订单及 4 位备注码

- 订单 ID 是随机 UUID，查询口令为高熵私密值。完整订单链接使用 URL fragment 保存口令，不会作为请求 URL 发给日志或 Referer。
- 4 位数字范围 `0000`–`9999`，保留前导零。数据库唯一索引防止同时占用相同代码；并发提交与网络重试使用幂等请求 ID。
- 订单码至少保留 30 天。只有已完成或已超时、且创建满 30 天的订单才释放代码。待核款或待交付订单不会释放。旧订单链接仍有效。
- 4 位码用于付款备注，不是查询密码。店主必须同时核对金额、支付方式、付款时间和支付交易单号；旧订单与新订单可能在 30 天后复用代码。
- 客户须复制订单码并确认备注提醒才能打开二维码。浏览器不能控制微信/支付宝的备注输入；因此最终以店主检查真实账单为准。
- 待付款订单 15 分钟后过期。已反馈付款的订单保留待核实，不因超时被自动认定未付款。过期订单也可以反馈迟到的付款，避免引导重复付款。
- 价格由服务器选择，不接受客户端提交金额。账号邀请码/邮箱在服务端再次校验。

## 工作台

- 入口 `/admin/`，使用独立管理密码。
- HttpOnly、SameSite=Strict 会话 cookie；HTTPS 下带 Secure；会话有效 8 小时，退出后立即撤销。
- 显示累计确认收款、北京时间今日确认收款、待核实、待交付和完成数。
- 按订单码、订单号、邮箱、邀请码搜索，按状态筛选，每页 50 笔，可导出当前页 CSV。
- 未核实订单不能直接完成交付；确认到账必须填写交易单号，同一支付方式下交易单号不能重复用于其他订单。
- 账号交付必须填写账号、密码、HTTPS 接码链接；Token 订单由店主实际充值后标记完成。
- 收款与交付变更写入 audit 表。买家反馈付款不计入收入。

## 数据及备份

本地数据库在 `.wrangler/`，线上数据在 Cloudflare 账号下的 D1，浏览器刷新不会清空。部署脚本只执行迁移，不删除订单。

备份示例：

```sh
npx wrangler d1 export muse-orders --remote --config wrangler.production.json --output orders-backup.sql
```

备份包含客户资料和账号交付信息，保存到受控目录，勿提交公共仓库。管理密码文件也不要公开。可用 Cloudflare D1 Time Travel 恢复误操作，保留时长以账号计划为准。

## 已有能力与边界

本系统已实现真实订单存储及人工核款管理，不连接个人微信/支付宝账单接口，不自动充值，不发送邮件。网站提示客户在订单中查看账号资料。供货、充值与到账核查由店主在平台完成后更新工作台。

Next.js 和可安全升级的依赖已经更新；若 npm audit 仍报告 braces/fast-glob 等构建工具链问题，它们不被打包进静态网页或 Worker，不能通过网站接口执行。避免对不可信仓库运行这些开发工具；待上游修复后再升级。
