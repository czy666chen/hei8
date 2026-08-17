# 台球奇招卡牌

当前正式版本：`v5.2.0`，已完成账号、跨设备同步、基于 Durable Objects/WebSocket 的多人实时房间（全屏对局页）与云端战绩删除。

一个无需后端的台球卡牌抽取应用。整副牌包含 50 种规则、51 张实体卡，支持不放回随机抽取、手牌使用、已使用归档，并用 `localStorage` 自动保存本局进度。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开终端显示的本地地址。

## 测试与构建

```bash
npm run test
npm run build
npm run build:static
```

`npm run build` 生成 Cloudflare Worker 版本，`npm run build:static` 生成适用于 Vercel 等静态托管平台的 `dist-static`。

Cloudflare Vite 插件会在构建时固定目标环境，因此预览和生产发布必须使用对应脚本：

```bash
npm run deploy:preview
npm run deploy:production
```

不要在普通 `npm run build` 之后使用 `wrangler deploy --env production`；生成的部署配置已经在构建阶段展开，事后追加 `--env` 不会把本地绑定切换为生产绑定。

## Vercel 部署

项目包含 `vercel.json`。在 Vercel 导入 Git 仓库，或在项目根目录运行 Vercel CLI，即可使用静态构建发布。
