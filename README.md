# 台球奇招卡牌

当前正式版本：`v5.0.0`，已完成账号、Cloudflare D1 与跨设备同步。

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

## Vercel 部署

项目包含 `vercel.json`。在 Vercel 导入 Git 仓库，或在项目根目录运行 Vercel CLI，即可使用静态构建发布。
