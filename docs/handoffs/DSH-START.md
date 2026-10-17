# DSH 首次交接

## 用户建立 worktree

在主工作区完成准备提交后，先记录 `git rev-parse codex/project-foundation` 的 SHA。以下操作由用户执行，`codex/project-foundation` 必须仍指向已交接的准备提交；已有同名分支或目录时先检查，不覆盖：

```sh
cd '/Users/orange/Orange Field/Matterhorn/dsh-video-editor'
git rev-parse codex/project-foundation
git worktree add -b dsh/p0-mode-shell \
  '/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell' \
  codex/project-foundation
```

把 DSH 的项目目录设为该 worktree。建议使用 Creator/Cordis 预设，使 inspection 工具可用；不要改全局默认模式。

## 发给 DSH 的提示

> 你负责实现 DSH Video，Codex 主会话负责产品、架构、任务和验收。当前工作目录是 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`。先确认实际 Git/worktree 与起点，不切换到主工作区。
>
> 依次读 AGENTS.md、docs/STATUS.md、docs/DEVELOPMENT.md、docs/product/PRODUCT.md、docs/tasks/P0-001-mode-shell.md。当前仅执行 P0-A：使用运行中的 DSH 0.2.0-rc.2 的官方 inspection 工具，查顶部「普通｜视频」切换、主视图和状态保持所需的真实契约，写入任务要求的调查文档并本地提交。
>
> 开发包在 docs/reference/dsh-plugin-dev-kit-20261017，官方 skill 与整理材料分开使用。先读 cordis-plugin-development 的官方主技能与对应 references。原始截图在 docs/product/references/mode-switch-request.png。
>
> 本轮不写功能代码，不安装/启用插件，不改 profile，不 push/PR。调查结果交给 Codex 评审后再进入 P0-B。返回分支、base/结果 commit、调查文件路径、可行方案、已验证与未验证项，并更新任务开发记录。不要把调查完成表述为顶部切换已实现。

## 返回本会话

把 DSH 回复带回即可。工作区共享同一 Git 仓库，Codex 可以直接读取其分支上的实际文件，不需要手动复制代码。未经用户授权，不通过桥接插件自动给另一会话发消息。
