# SEO 内容与安全响应头复核

## 范围与基线

用户未能提供可读取的 SEOnaut 报告（附件被描述为 exe）。本次为根据用户列出的检查项执行的独立审计，不声称已复核报告全部告警，也不把扫描通过当作 Google 收录。

发布前核对：正式域名 musetoken.store；生产分支 codex/workbench-supplier-stock；提交 ebc0ac6（PR #103）；Worker 版本 68dc9d7d-901d-4c36-b160-a14fc11f3de2。未使用落后的 main 覆盖生产。

## 逐页结果与修改

| 页面 | 原始 HTML / 禁用 JS / 渲染对比 | 处理 |
| --- | --- | --- |
| 首页 / | 账号方案、价格、额度与介绍无需 JS；渲染后增加库存提示 | 保留独立首页标题简介；主图补商品 alt 和尺寸 |
| /account/ | 两种账号方案与 10 亿 Token 说明已在初始内容 | H1 明确为 Muse AI 账号；主图补 alt 和尺寸 |
| /token/ | 充值档次、金额、邀请码要求、不包含账号均可读；销量动态更新 | H1 明确充值含义；保留准确的独立标题简介 |
| /gpt/ | 固定商品方案和价格已静态输出；渲染后销量更新 | H1 从“全部商品”改为 GPT 账号与代充，补充介绍区区分资格号、Free、成品及代充 |
| /gmail/ | 价格和收件保障说明可直接读取 | 简介与正文明确仅保障收件、地区时间随机及检查/售后限制，移除无关 Muse 文案 |
| /mail/ | 价格、邮箱密码交付说明可直接读取 | 简介与正文明确邮件交付及缺货处理，移除无关 Muse 文案 |
| 两篇 /guides/muse-*/ | 六步教程在无 JS 与渲染后相同，标题简介与正文对应 | 保留，不添加无依据营销承诺 |

商品主图从 fill 改为显式内在尺寸，按实际 SVG/PNG 比例分别声明宽高，并用 object-fit: contain 防止拉伸。导航旁已有文字的装饰图保留 alt=""，不为消除提示而重复朗读名称。教程没有图片，因此不适用图片检查。_next 资源路径保留。

## 响应头

部署前公开页面三项响应头均缺失。Worker 统一为 HTML、静态资源、API、错误及重定向添加 nosniff；HTTPS 响应添加 HSTS max-age=31536000，不包含 includeSubDomains / preload。

HTML 启用 CSP，脚本限制为同源、逐响应 nonce 及现有 Cloudflare 统计脚本；禁用 eval、内联事件处理器、对象、框架嵌入和非本站表单提交。明确允许站内/API 图片、二维码 data/blob、音频、字体、manifest 及连接。React 布局和弹窗仍使用内联 style，故 style-src 保留 unsafe-inline，不能把此策略描述为完全消除所有内联样式风险。

Worker 使用 HTMLRewriter 将 nonce 加到受信任静态 HTML 的脚本上；HTML private,no-store 并移除旧 ETag/Content-Length，避免缓存复用 nonce。带指纹的 JS/CSS/图片缓存保持不变。原有 noindex、鉴权和私密订单链接规则保留。

## 验证方法

- scripts/audit-search.mjs：对八个公开页面读取原始响应、禁用 JavaScript 的可见正文及渲染后正文，记录图片、标题、简介、canonical、安全头和浏览器异常。输出仅含公开内容，不读取真实订单或登录后台。
- tests/security-browser.mjs：仅允许本机测试地址；拦截 API 使用虚构订单与登录资料，验证支付宝/微信下单、购买须知、二维码加载、订单 noindex 及管理员登录。不得将此测试改为向生产创建订单。
- tests/seo.test.mjs：验证规范网址、HTML 可读性、私密响应、HSTS/nosniff/CSP、nonce 一致性及每次响应随机性。
- 运行生产构建、类型检查、修改文件 ESLint、订单数据库和邮件交付测试。全仓已有工作台 lint 问题仍见前次交接文档。

安全参考：[MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)、[MDN HSTS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security)。Google 索引状态应通过 Search Console 查询。
