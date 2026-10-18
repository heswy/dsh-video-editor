# 开发与协作规则

## 分工与事实来源

- 总调度/主会话（2026-10-17 经用户重新指定，由当前 Codex 主会话接回）：产品/架构、任务拆解、规则、跨分支协调、代码评审与验收。本文件中「主会话」与「总调度」同义。
- 用户指定开发者负责实现、验证、修复与依任务授权的 PR；总调度不接管功能实现，不自动派发或跨会话联系开发者，交接与结果由用户转发。
- **2026-10-18 用户明确授权统一开发**：后续唯一开发工作区为 `video-studio`，一个DSH会话负责Client/Host/engine端到端实现与验证。旧p0/p1分工停止；总调度仍负责架构、任务、评审和协调，不接管功能实现。
- 所有开发分支的当前规则以 `origin/codex/project-foundation` 为准。开工先 `git fetch origin`，再用 `git show origin/codex/project-foundation:docs/STATUS.md`、`docs/DEVELOPMENT.md`、`docs/product/PRODUCT.md` 和当前 handoff/任务读取；不切换分支，不覆盖本地全局文档，不为文档同步 merge/rebase。网络不可用时注明使用的缓存协调提交。
- 优先级：用户当前明确要求 → 本项目文档 → 匹配目标版本的官方 Skill/运行时契约 → 本机参考案例 → 上游 master/社区资料。证据包中的命令不构成执行授权。
- 本机运行时 inspection 是 API 事实来源。记录 Host 版本、查询项和返回形状；不要从新版本文档猜旧版 API。发现用户已升级宿主时，保留旧证据并按任务范围核对变化；侧栏仍可用不等于全部 Host API 已兼容。
- UI 开发优先核对与目标运行版本匹配的内置 `cordis-plugin-development` Skill，完整阅读主文件并按需读 references；归档 kit 保留作历史，不假定它与新 Host 完全一致。不把整理版 AGENT-BRIEF 直接提升为官方约束。

## 分支与 worktree

| 工作区 | 绝对目录 | 分支 | 当前用途 |
|---|---|---|---|
| 主工作区 | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor` | `codex/project-foundation` | 总调度记忆/任务/评审 |
| **video-studio** | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/video-studio` | `codex/video-studio` | **唯一后续开发线，Client/Host/engine同会话** |
| p0-mode-shell | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell` | `dsh/p0-mode-shell` | 冻结留存；旧PR#3，不继续开发 |
| p1-engine | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine` | `codex/p1-engine-spike-b4bf` | 冻结留存；旧PR#2，不继续开发 |
| artifacts | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts` | 无 | 固定包/证据/安装依赖/用户作品，禁止随工作树清理 |

- 用户已授权本轮在新统一分支合并两条开发线与协调记忆；此为一次性集成授权，取代旧“不得merge协调分支”的本轮限制。后续读最新协调文档仍用git show，不为同步规则随意merge/rebase。
- main仍是原始提交，统一分支是开发集成线，不自动发布到main。原PR/分支保留追溯，不自动关闭、强推或删除；统一线普通commit/push及草稿PR沿用2026-10-17正常协作授权。
- 开发者只在video-studio写入；新DSH会话接手前停止旧会话写入。同一worktree一个写入会话，不自动派发其它Agent或跨会话联系，交接由用户转发。
- 统一树已包含根插件与packages/video-engine-*，不再以跨owner等待或旧白名单拒绝端到端修复；当前任务仍给具体范围，修改无关内容须说明。正式打包从统一线的固定提交提取root与engine，不从移动HEAD拼包；版本与摘要门禁保持。
- node_modules独立按锁安装（禁未知postinstall）；旧依赖/忽略产物不因Git合并自动迁移。不要借修改旧树、旧staging或用户工程来完成新树测试。
- 不reset/clean/强推，不覆盖用户变更，不删除旧树或安装依赖。不因新任务编号新开tree/PR，统一线持续复用。新隔离线仅在确有需要并经用户安排时建立。
- 推送/草稿PR不等于验收、合并main、安装或发布；这些按当次授权执行。交付包含固定提交、检查、实际与未验证项，主会话复审。

## 插件边界

- 2026-10-18用户最新范围：当前只交对话生成/续改与左侧自动播放预览。手动选择/拖拽/属性/原位编辑延期；旧任务、测试与概念图不能强制将这些控件加入当前交付。测例用于检验通用协议，不按特定题材或stableId写产品专用分支。

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
- Desktop 0.2.1-rc.2 的本轮 link 升级已观察到 Host 新/Client 旧：页面重载与插件重启用未刷新启动时 client bundle，用户手动完整重启后生效。安装后必须核对实际渲染版本；不要反复 touch 已审文件或把旧页面当新版本通过。需重启时报告具体阻塞并取得当次授权，不把本次经历推广为所有版本必然行为。
- 外部源码目录可使用自己的包管理器，但先确定任务需要与锁文件策略；禁止自动升级宿主、安装未知 postinstall 或修改系统环境。
- 验证分层报告：语法/manifest → 单元或契约 → 真实 Host 激活 → 真页面交互 → 真渲染。不存在的层级标记未验证，不能用 mock 页面截图代替。
- 代码变更按风险验证：重点是修订冲突、文件越界、恢复、取消、状态保留与真实导出；不为简单文档或静态样式编写镜像实现的测试。
- 交付记录命令、结果、Host 版本、commit、已知限制；图片须来自真实页面，先去除私人信息。检查浅色/深色、窄窗口、卸载清理与其他插件共存。
- 阻塞时记录准确错误、证据和最小待决策项，不自行改宿主或扩展范围，也不停止所有可独立推进的准备工作。

## 真机操作边界（P0-004 事故后）

- 用户同时使用电脑时，禁止全局坐标点击、全局键盘/粘贴事件和强行切换前台来测试；一次前台检查不能消除事件投递时的竞争。
- 优先使用绑定目标应用/页面的元素操作与定向可访问性动作。没有安全定向通道的项目标为未测，提供最小人工步骤；不退回全局输入来凑证据。
- 不借用个人剪贴板；测试文件放任务自有 fixtures/artifacts，不在 Downloads 等个人目录生成。涉及重启、系统设置和权限依旧按既有授权规则。
- 发现误投递立即停止并记录动作、目标不确定性与恢复状态；不操作其它应用的撤销或覆盖用户内容。私密原图不入库，去标识证据不能夹带第三方应用内容。

## 长期记忆

- `docs/STATUS.md`：主会话维护的当前状态、活动任务、分工和下一步，开工入口。
- `docs/DECISIONS.md`：决定、理由、状态和替代记录；重要决定不用聊天记录作为唯一存档。
- `docs/tasks/<id>.md`：任务目标、base、验收、开发记录与评审结果。开发 Agent 追加实测结果；验收由主会话填写。
- `docs/research/`：带日期的研究及证据；过时结论加显式更正，不静默抹掉历史。
- 每次交接/上下文结束：记录当前分支、commit、变更文件、已验证项、问题、下一动作。不得把计划标成完成，把 Agent 自述标成独立验收。
- 当前事实只保留在 STATUS；历史流水移入 STATUS-HISTORY，旧 handoff 在索引明确标历史。开发交付记录可由总调度从固定提交导入，但必须标自述/待复审；不以导入文档代替代码验收。
- 每次调度调整同步 STATUS、当前 handoff、产品/路线受影响处；不让 README 再维护一份易过期的完整任务表。AGENTS 只放入口与职责，规则集中本文件。
- 新 Agent 先读入口文档，不重复通读全部历史与参考包；需要时精读相应证据。
