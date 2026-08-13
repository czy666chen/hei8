# GitHub 版本备份踩坑记录

更新时间：2026-08-11

适用仓库：`czy666chen/hei8`

## 成功基线

- GitHub 远端名称是 `github`，不是常见的 `origin`。
- 当前发布分支是 `codex/friends-match-v2`。
- v4.1.0 的提交是 `aef6fa2dc995311aeac0e414ed9eb25cb94f6ecb`。
- 注释标签 `v4.1.0` 已指向上述提交。

## 本次遇到的问题

### 1. `gh auth status` 显示账号存在，但令牌失效

`Active account: true` 不代表凭据可用。发布前必须检查命令退出码和是否出现：

```text
The token in default is invalid.
```

出现该提示时，不要继续假设 Git 推送一定可用。

### 2. 网页显示设备授权完成，不等于本机已经保存凭据

使用隐藏进程运行普通的 `gh auth login --web` 时，GitHub 网页端虽然完成授权，本机进程仍可能卡在 Windows 凭据保险库写入阶段。判断标准应是：

- 登录进程已经退出；
- `gh auth status` 返回成功；
- 显示正确账号和所需的 `repo` 权限。

不能只根据用户在网页上看到“授权成功”就开始推送。

### 3. Windows 凭据保险库卡住时的兜底方案

先清除已经失效的 GitHub CLI 凭据，再重新登录：

```powershell
gh auth logout -h github.com -u czy666chen
gh auth login -h github.com -p https -w --clipboard --insecure-storage
```

`--insecure-storage` 会把凭据以明文保存在当前 Windows 用户的 GitHub CLI `hosts.yml` 中。仅在系统凭据保险库无法正常写入时使用，并明确告知用户这一安全差异。不得把 `hosts.yml`、令牌、设备登录码或授权日志提交到 Git。

### 4. 沙箱用户与 Windows 用户会触发 Git 所有权检查

仓库可能由沙箱账号操作，但联网推送命令以 Windows 用户执行，从而出现：

```text
fatal: detected dubious ownership in repository
```

不要随意修改全局 Git 配置。对单次命令使用局部安全目录参数：

```powershell
git -c safe.directory=E:/hei8chouka push github codex/friends-match-v2
git -c safe.directory=E:/hei8chouka push github v4.1.0
```

### 5. GitHub CLI 登录和 Git HTTPS 凭据是两层配置

`gh auth status` 成功后，仍应运行：

```powershell
gh auth setup-git
```

否则 `git push` 可能继续报：

```text
could not read Username for 'https://github.com'
```

### 6. 分支和版本标签必须分别推送

仅推送分支不会自动备份本地标签。推荐顺序：

```powershell
git push github codex/friends-match-v2
git push github v4.1.0
```

只有第一步成功后才执行第二步，避免产生指向错误提交的远端版本标签。

### 7. 注释标签的 SHA 不等于提交 SHA

`git/ref/tags/v4.1.0` 返回的是注释标签对象 SHA，需要再读取标签对象的 `object.sha` 才能确认最终提交。远端核验可使用：

```powershell
gh api repos/czy666chen/hei8/git/ref/heads/codex/friends-match-v2 --jq '.object.sha'
gh api repos/czy666chen/hei8/git/ref/tags/v4.1.0 --jq '.object.sha'
gh api repos/czy666chen/hei8/git/tags/<tag-object-sha> --jq '.object.sha'
```

最终分支 SHA 和标签指向的提交 SHA 应完全一致。

## 推荐发布清单

1. 规范化版本号，例如把输入笔误 `v4,.1.0` 确认为 `v4.1.0`。
2. 运行 `git status -sb`，确认需要备份的文件范围。
3. 运行测试、lint、构建和 `git diff --check`。
4. 显式暂存属于本版本的文件，避免无条件 `git add -A`。
5. 创建提交并记录完整提交 SHA。
6. 创建注释标签：`git tag -a v4.1.0 -m "v4.1.0"`。
7. 检查 `gh auth status`，必要时完成设备登录。
8. 运行 `gh auth setup-git`。
9. 使用仓库实际远端名 `github` 推送分支，再推送标签。
10. 通过 GitHub API 分别核验分支、标签对象和最终提交。
11. 删除临时授权输出文件；任何令牌、登录码和认证日志都不得进入提交。

## 安全原则

- 不在命令输出、文档、提交或聊天总结中暴露完整 GitHub Token。
- 设备登录码是短期敏感信息，仅在用户明确请求登录时展示。
- 对 GitHub 的提交、标签和推送必须来自用户明确授权。
- `--insecure-storage` 只是凭据保险库故障时的兜底，不作为默认配置。
