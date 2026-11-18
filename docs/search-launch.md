# 搜索基础配置与上线交接

## 发布真源

核对日期：2026-11-15（北京时间）。正式网址为 https://musetoken.store/，Cloudflare Worker 为 muse-store。实际生产分支为 codex/workbench-supplier-stock（发布前 f6c402b），不是默认分支 main；main 的 GitHub Pages 工作流是旧入口。此次 PR 应合并到实际生产分支，避免覆盖已经发布的功能。

## 页面与收录

- sitemap.xml 列出首页、account、token、gpt、mail、gmail 及两篇 guides/muse-* 教程，共 8 个规范网址。
- 各公开页由 Next.js 导出完整 HTML，包含独立标题、描述、自指 canonical、可见介绍和商品/教程链接。商品选项卡导航到独立网址。
- robots.txt 允许抓取并声明 sitemap。Cloudflare 可在前方追加托管机器人规则，发布后必须检查最终响应。
- 不在 robots.txt 中屏蔽后台，以便搜索引擎读取 noindex。后台、代理页面有静态 robots meta；Worker 对非公开页面、敏感查询参数和所有 API 响应补充 X-Robots-Tag。鉴权仍由现有订单和管理接口执行，noindex 不替代权限控制。
- 订单链接使用 URL 片段，不生成公开订单 HTML，不进入 sitemap。打开订单/支付界面时浏览器另添加 noindex。
- API 子域及 workers.dev 的非 API 请求重定向到主域；API 功能保留。跟踪参数对应的公开页 canonical 不带参数。
- 自主商品公开接口当前为空；未来新增独立商品类别时应扩充页面与 sitemap，不把客户端加载当作静态商品介绍。

## 验证与发布

运行 npm run build:store、npm run typecheck、npm run test:orders、npm run test:delivery，以及 node --test tests/seo.test.mjs tests/traffic.test.mjs（SEO 测试使用订单测试生成的 temp/worker/index.js）。新增/修改代码单独通过 ESLint；全仓 lint 有 5 项既存工作台错误，未归入本次 SEO 改动。

部署使用当前工作区 wrangler.production.json（已忽略，沿用现有 D1 绑定），构建后执行 wrangler deploy --config wrangler.production.json。不运行初始化管理员或重写密钥的 setup/deploy 脚本，不修改数据库。发布前检查 Git 差异和可访问的 GitHub secret-scanning 告警；现有 #1 对应公开小程序 AppID，已核对其类型，不是访问密钥。不将告警值、客户信息或部署凭据写入文档。

## 站长操作

1. Google Search Console 新增“网域”资源 musetoken.store（不加协议/路径），复制其生成的 TXT 值。
2. 域名的权威 DNS 是 Cloudflare（sam / gene）。在 Cloudflare DNS 添加 TXT，名称 @，内容使用 Google 提供的原值，TTL 自动；不要替换已有记录。生效后回 Search Console 验证，保留该记录。
3. 在 Search Console 的站点地图提交 https://musetoken.store/sitemap.xml。用网址检查分别实时测试首页、/account/、/token/ 和两篇教程，再请求编入索引。检查规范网址和 robots 状态。
4. 登录 Bing Webmaster Tools，从已验证的 Google Search Console 导入站点；也可添加 https://musetoken.store/ 并按向导设置 DNS CNAME 验证（记录名、目标值完全使用 Bing 提供的内容，CNAME 仅 DNS）。提交同一 sitemap，用 URL Inspection 检查页面。
5. www.musetoken.store 在核对时不可用。若需启用，在 Cloudflare 添加代理状态的 www DNS 记录并配置重定向规则：www 全部请求 301/308 到 https://musetoken.store，保留路径与查询参数。确认 www 证书有效。不要改变现有主域及 api 绑定。检查 HTTP 到 HTTPS 重定向。
6. Cloudflare 安全设置保持 Googlebot、Bingbot 可抓取公开页；如站长工具报告挑战页，检查已验证机器人规则。不要全站关闭安全防护。检查搜索结果中若已有私密 URL，使用各站长工具临时移除，并保留站点 noindex 和接口鉴权。

提交 sitemap 不等于搜索引擎已收录，也不保证排名；实际索引状态须在已验证的站长账号中查看。
