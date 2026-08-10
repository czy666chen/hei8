# 项目交接文档

## 1. 我们在做什么

这是一个网页版“台球奇招卡牌”抽取应用，项目目录为：

```text
E:\hei8chouka
```

产品目标：

- 整副牌包含 50 种规则、51 张实体卡。
- “无懈可击”有两张实体卡，必须拥有不同的 `instanceId`。
- 两张同名“落井下石”效果不同，是两个独立规则。
- 卡牌状态按“未抽卡池 → 当前手牌 → 已使用卡牌”单向流转。
- 抽卡是不放回抽样，已抽到或已使用的卡不能再次抽到。
- 使用 `localStorage` 保存本局状态，刷新后不丢失。
- 支持确认后开始新一局。
- 网站需要能通过公网访问；用户最终选择 Vercel 作为正式发布平台。

## 2. 已经完成的工作

### 应用功能

- 卡牌数据、实体卡展开逻辑、随机抽卡、使用卡牌、重置状态均已实现。
- 页面已经实现卡池、手牌、已使用区，以及数量统计、输入校验、中文提示和移动端适配。
- 视觉采用黑色底色与粉、蓝、黄霓虹风格，并包含抽卡翻牌效果。
- 本局状态使用浏览器 `localStorage` 保存。

### 测试与构建

- 核心逻辑已有 7 项 Vitest 测试，最后一次运行全部通过。
- `npm run build` 已通过，用于原有 vinext/Cloudflare Worker 构建。
- `npm run build:static` 已通过，生成 Vercel 使用的 `dist-static`。
- `npm run dev` 启动原 vinext 开发模式。
- `npm run dev:static` 启动纯 Vite 静态版开发模式。

### Vercel 适配

为避免让 vinext 的 Cloudflare Worker 输出直接部署到 Vercel，已增加一条独立的静态构建路径：

- `index.html`：静态版入口。
- `src/main.tsx`：挂载现有 React 应用。
- `vite.static.config.ts`：输出到 `dist-static`。
- `vercel.json`：指定 Vite、静态构建命令、输出目录及 SPA rewrite。
- `.gitignore`：忽略 `.vercel`、`dist-static` 等生成目录。
- `README.md`：补充本地运行、测试、构建和 Vercel 部署说明。

### 正式部署

Vercel 已经成功创建项目并发布，固定公网地址为：

https://hei8chouka.vercel.app

部署后已用外部 HTTP 请求验证，返回：

```text
HTTP/1.1 200 OK
Server: Vercel
```

以后修改代码后，在项目根目录执行：

```powershell
npx vercel@latest --prod --yes
```

即可更新正式站点。

### Git 状态

已经完成的主要提交：

```text
90f9f9b Add Vercel static deployment
727becf Build billiards card draw app
```

交接文档创建前工作区是干净的。`HANDOFF.md` 本身创建后尚未提交，下一会话可按需提交。

## 3. 当前卡在哪里

目前没有阻塞项，网站已经发布且可以访问。

需要注意的“未完成”并不是发布阻塞：

- 当前没有确认项目是否已连接用户自己的 GitHub 仓库。
- Vercel CLI 部署时曾尝试连接已有的内部 Git remote，但自动连接失败；这不影响当前上线，只意味着暂时不能确认 GitHub push 后会自动部署。
- 四张带 `needsReview: true` 的卡牌文案仍需要用户以后对照实体卡复核。
- 项目仍保留 Cloudflare Worker 构建、Wrangler 配置和 `.openai/hosting.json`，它们属于之前的部署路径，不影响 Vercel 静态版。

## 4. 建议的下一步计划

按优先级执行：

1. 用手机流量和另一台设备打开 `https://hei8chouka.vercel.app`，完整测试抽卡、使用卡牌、刷新恢复和开始新一局。
2. 如需自动部署，将本地项目推送到用户自己的 GitHub 仓库，再在 Vercel 控制台为现有 `hei8chouka` 项目连接该仓库。之后每次 push 可自动部署。
3. 如果用户有自定义域名，在 Vercel 项目的 Domains 页面绑定域名，并按 Vercel 给出的 DNS 记录配置。
4. 对照实体卡复核所有 `needsReview: true` 文案。
5. 若后续修改功能，先执行：

   ```powershell
   npm run test
   npm run build:static
   ```

   两项都通过后再执行生产部署。

6. 若确认不再使用 Cloudflare，可以另开任务清理 Cloudflare 专属依赖和构建配置；不要在没有用户明确授权时贸然删除，因为当前 `npm run build` 仍能正常工作。

## 5. 绝对不要再踩的坑

### 不要把 vinext 的 Cloudflare 输出直接当成 Vercel 静态站

原来的 `npm run build` 执行 `vinext build`，产物包含 Cloudflare Worker/SSR 配置。Vercel 正式部署必须走：

```text
npm run build:static
```

对应输出目录：

```text
dist-static
```

不要把 `vercel.json` 的 `buildCommand` 改回 `npm run build`，除非准备完整迁移 SSR 运行时并重新验证。

### 不要破坏两条并存的构建路径

- Cloudflare/原项目：`npm run build`
- Vercel 静态站：`npm run build:static`

后续改动应至少保证 Vercel静态构建和测试通过；如果碰了共享入口或依赖，最好两种构建都跑。

### 不要把实体卡按规则 ID 去重

抽卡操作必须针对 `instanceId`，不能只使用规则定义的 `id`。否则两张“无懈可击”会被误认为同一张卡。整副牌必须始终展开为 51 个唯一实例。

### 不要采用“随机后过滤重复”的抽卡方案

必须从 `remaining` 中直接抽取并移除，保持不放回。否则可能少抽、重复或在卡池接近为空时行为异常。

### 不要只保存“剩余卡”和“已使用卡”

必须保留三个状态：

```text
remaining → hand → used
```

否则刷新、连续多次抽取或暂时不使用卡牌时会丢失正确状态。

### 不要把 `.vercel/project.json` 提交进 Git

`.vercel` 是本机与 Vercel 项目的链接元数据，已经加入 `.gitignore`。不要删除忽略规则，也不要在文档或提交中泄露账户、令牌、OAuth 代码或内部项目凭据。

### 不要误判 Vercel CLI 的 Git 连接报错

首次部署过程中出现过“无法连接现有 Git repository”的非致命提示，但部署本身随后成功并返回了生产 URL。判断是否上线应看最终的 `Production`、`Aliased`、`Ready` 状态以及 HTTP 验证结果，不要因这个非致命提示重复创建 Vercel 项目。

### 不要重复创建新的 Vercel 项目

本地 `.vercel` 已经链接到现有 `hei8chouka` 项目。后续直接在当前目录运行：

```powershell
npx vercel@latest --prod --yes
```

不要删除 `.vercel` 后重新部署，也不要随意更换项目名，否则可能生成多个站点和不同 URL。

### 网络代理问题要区别处理

此前 Wrangler 曾因网络或代理出现 `fetch failed`。发现代理环境变量后，Wrangler 能识别代理并继续。Vercel 当前已部署成功；如果未来 CLI 网络请求失败，先检查代理、防火墙和网络连通性，不要先改应用代码。

### Windows PowerShell 下注意编码显示

用旧版 PowerShell 的 `Get-Content` 查看 UTF-8 中文文件时，终端可能显示乱码，这不一定意味着源文件真的损坏。修改前应使用支持 UTF-8 的编辑器或明确指定编码验证，不能看到终端乱码就直接覆盖整份文件。

## 6. 新会话快速检查命令

```powershell
cd E:\hei8chouka
git status --short
git log -3 --oneline
npm run test
npm run build:static
```

检查正式站：

```powershell
curl.exe -I https://hei8chouka.vercel.app
```

发布新版本：

```powershell
npx vercel@latest --prod --yes
```

