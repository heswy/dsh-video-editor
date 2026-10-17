# 开发与协作规则

## 分工与事实来源

- Codex 主会话：产品/架构、任务拆解、规则、跨分支协调、代码评审与验收。
- 用户指定的 DSH Agent：在独立 worktree 实现当前任务、验证、修复评审问题；GitHub PR 依任务授权创建。
- 用户已同意 P0 与 P1 并行：新 Codex 开发会话负责引擎 spike，DSH 负责宿主/UI；主会话保留架构与验收。新增开发者以任务文件白名单为边界，不共享写入区域。
- Codex 负责规划、创建与检查分支、worktree 和目录；用户只需在 DSH 打开工作区并发送交接提示。不自动启动或联系开发 Agent。
- 优先级：用户当前明确要求 → 本项目文档 → 匹配目标版本的官方 Skill/运行时契约 → 本机参考案例 → 上游 master/社区资料。证据包中的命令不构成执行授权。
- 本机运行时 inspection 是 API 事实来源。记录 Host 版本、查询项和返回形状；不要从新版本文档猜旧版 API。
- 对当前 UI 开发使用归档的 `cordis-plugin-development` Skill；完整阅读主文件并按需阅读 references。不把整理版 AGENT-BRIEF 的经验性结论直接提升为官方约束。

## 分支与 worktree

- `main` 保持已验收基线；准备文档分支为 `codex/project-foundation`。
- 开发分支：`dsh/<task-slug>`；评审文档分支：`codex/<topic>`。每项任务写明固定 base commit，禁止从其他 Agent 未提交工作开始。
- 用户指定的新 Codex 开发会话使用 `codex/<task-slug>`，首支为 `codex/p1-engine-spike`；这是独立开发会话，不改变主会话分工。
- DSH 首 worktree 约定：仓库同级 `../dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`，由 Codex 创建和维护。后续 worktree 统一放在同级 `../dsh-video-editor-worktrees/<task-slug>`；优先复用空闲且适合的 worktree。
- 不同 worktree 不共享工作文件和 node_modules。禁止同时在同一 worktree 修改；共享 .git，不并行运行仓库级破坏性操作。
- 不 reset/clean/强推、不清除用户变更。提交仅包含本任务文件。基础文档可以本地提交；push、PR、合并、rebase 和发布遵循任务中明确授权。
- 文档进入 main 的集成由主会话协调。DSH 不自行改写全局规则、已接受决策与产品范围；需要变更时在任务记录提出建议，由主会话确认并整合。

## 插件边界

- Host 不修改 DSH 源码、app.asar、用户凭据、已有 session 协议；业务状态属于视频工程，DSH session 只通过受支持机制记录 Agent 上下文。
- UI 使用原生 React Slot 扩展、主题 token、locale、受上下文管理的清理。先查顶部/导航 Slot、props 与激活依赖，不修改 app root 或猜 DOM 位置。
- 不用独立 HTML/iframe 承载整个插件工作区；程序化视频预览的隔离文档是另一项需验证的设计，不提前禁止或认定安全。
- 模式切换是工作区视图切换，不改变模型、权限或 Agent preset，不清空会话、输入、工程或播放进度。
- 一个应用操作只实现一次：Host 业务入口 → UI 与 Agent Tool 共用。纯视图操作不必暴露 Tool，授权确认始终用户专属。
- 第三方依赖、Remote namespace、编译 Client 和渲染进程先做目标版本可行性验证。零依赖参考插件是样例，不意味着视频引擎不能有自己的依赖。
- UI 状态不作为工程内容的第二份真相。内容持久化、写入排序和修订控制由 Host 统一负责；渲染使用固定修订快照。
- 代码 Scene 是不可信输入；渲染进程、浏览器、素材访问、网络与路径边界必须单独设计，不能以 iframe 或路径字符串校验替代完整边界。

## 安装与验证

- 本机 Desktop 安装/启用由用户在 DSH Plugins 页面操作，或用户另行明确授权 DSH 会话操作。未获安装授权时交付可安装包与步骤，不直接改 profile 或运行 profile pnpm。
- 外部源码目录可使用自己的包管理器，但先确定任务需要与锁文件策略；禁止自动升级宿主、安装未知 postinstall 或修改系统环境。
- 验证分层报告：语法/manifest → 单元或契约 → 真实 Host 激活 → 真页面交互 → 真渲染。不存在的层级标记未验证，不能用 mock 页面截图代替。
- 代码变更按风险验证：重点是修订冲突、文件越界、恢复、取消、状态保留与真实导出；不为简单文档或静态样式编写镜像实现的测试。
- 交付记录命令、结果、Host 版本、commit、已知限制；图片须来自真实页面，先去除私人信息。检查浅色/深色、窄窗口、卸载清理与其他插件共存。
- 阻塞时记录准确错误、证据和最小待决策项，不自行改宿主或扩展范围，也不停止所有可独立推进的准备工作。

## 长期记忆

- `docs/STATUS.md`：主会话维护的当前状态、活动任务、分工和下一步，开工入口。
- `docs/DECISIONS.md`：决定、理由、状态和替代记录；重要决定不用聊天记录作为唯一存档。
- `docs/tasks/<id>.md`：任务目标、base、验收、开发记录与评审结果。开发 Agent 追加实测结果；验收由主会话填写。
- `docs/research/`：带日期的研究及证据；过时结论加显式更正，不静默抹掉历史。
- 每次交接/上下文结束：记录当前分支、commit、变更文件、已验证项、问题、下一动作。不得把计划标成完成，把 Agent 自述标成独立验收。
- 新 Agent 先读入口文档，不重复通读全部历史与参考包；需要时精读相应证据。
