# Muse 商店

账号与 Token 充值商店，包含个人收款二维码、订单链接、4 位付款备注码、订单数据库和店主管理工作台。

正式商店：https://muse-store.muse-site-study.workers.dev/

店主工作台：https://muse-store.muse-site-study.workers.dev/admin/

## 商品

| 商品 | 价格 |
| --- | ---: |
| Muse AI 成品账号 | ¥15 |
| 300 亿 Token | ¥79 |
| 200 亿 Token | ¥52 |
| 150 亿 Token | ¥45 |
| 100 亿 Token | ¥29 |

Token 商品不包含账号，账号邀请码必填。支持 QQ：3557785836。

## 本地运行

Node.js 24+。

```sh
npm ci
npm run setup:admin
npm run build:store
npm run db:local
npm run dev:store
```

商店：`http://127.0.0.1:8787/`，工作台：`http://127.0.0.1:8787/admin/`。
首次生成的管理密码保存在本地 `admin-access.local.txt`，不会提交到 GitHub。
本地数据保存在 `.wrangler/`，与线上数据库分离。

## 发布

代码保存在 GitHub。正式站由 Cloudflare Workers 提供页面和 API，D1 保存订单；不需要自购服务器或域名。

```sh
npx wrangler login
npm run deploy:store
```

发布脚本创建/复用 `muse-orders` 数据库、应用迁移、构建页面，并同步工作台密码摘要。执行前需要 Cloudflare 账号授权。密码明文仅在本地密码文件中，浏览器代码不包含管理凭据。

正式网址部署并验收后，运行 GitHub Actions 的 `Publish store address`，填入正式 HTTPS 地址。原 GitHub Pages 链接将跳转到正式商店。

## 订单流程

1. 买家填写邮箱或必填邀请码，选择商品、支付方式并确认须知。
2. 服务器确定价格、生成订单及 4 位订单码；每笔订单有带私密口令的查询链接。
3. 买家复制订单码，并勾选付款备注确认后，才可以弹出对应收款码。
4. 买家在微信/支付宝手动填写金额和 4 位备注，付款后点击“我已付款”。
5. 订单进入“待核实到账”；店主在工作台对照账单核对金额、备注和时间，填写支付交易单号并确认。
6. 确认后进入“待交付”，店主完成 Token 充值或填写账号资料，买家在订单链接中查看结果。

个人收款码不提供本系统可用的到账回调。系统轮询的是店主更新的订单状态；不会根据买家点击按钮自动认定到账，也不会自动执行 Muse 充值或发邮件。

## 校验

```sh
npm run check
npm run build:store
npm run test:orders
node tests/browser.mjs
```

浏览器测试需要本地服务运行及已安装 Chrome。测试只允许 localhost / 127.0.0.1，并在本地生成 `BROWSER-CHECK-INVITE` 测试订单。

详细部署与数据说明见 [docs/production-launch.md](docs/production-launch.md)。
