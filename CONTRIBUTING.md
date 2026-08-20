# 贡献指南

感谢参与台球奇招。提交改动前请先搜索现有 Issue，较大的功能建议先开 Issue 说明需求与方案。

## 开发流程

1. Fork 仓库并从 `main` 创建分支。
2. 安装 Node.js 22.13 或更高版本，运行 `npm ci`。
3. 复制 `.dev.vars.example` 为 `.dev.vars`，仅填写开发环境值。
4. 完成改动并运行：

   ```bash
   npm run lint
   npm run test:all
   npm run test:e2e
   npm run build:production
   ```

5. 提交范围清晰的 Pull Request，说明改动、验证方式和界面截图（如适用）。

请勿提交真实账号、生产密钥、数据库导出、构建产物或用户数据。贡献即表示你同意按项目的 MIT License 发布所提交的代码。
