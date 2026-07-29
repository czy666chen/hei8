# 台球奇招卡牌

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
```

## 部署

构建产物可部署到兼容 Cloudflare Workers 的平台。项目已包含 Sites 托管配置，也可以通过 Codex Sites 直接发布。
