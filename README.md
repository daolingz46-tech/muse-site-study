# Muse 网站界面学习项目

这是 [Muse · GPTibo](https://muse.gptibo.com/) 首页的独立界面复刻，用于学习 Next.js 页面实现。项目与 GPTibo 无关联。

**[打开在线预览](https://daolingz46-tech.github.io/muse-site-study/)**

在线预览不接收邮箱或订单信息，不创建订单，也不处理付款。网页顶部会明确标注这一点。本地开发版保留界面流程，但同样不连接原站订单及支付服务。

## 本地运行

需要 Node.js 24 或更新版本。

```bash
npm ci
npm run dev
```

打开 http://localhost:3000/。提交前可运行 `npm run check`，它会执行 ESLint、TypeScript 和生产构建。

## 项目结构

- `src/components/sites/muse/`：页面组件和样式
- `public/sites/muse/`：页面使用的公开素材
- `docs/research/muse/`：原站与本地截图、观察记录
- `.github/workflows/deploy-pages.yml`：GitHub Pages 静态预览

本项目基于 [ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template) 建立。原站的名称、标识和内容属于各自权利人。
