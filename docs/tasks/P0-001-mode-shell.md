# P0-001：宿主契约与顶部模式工作区

状态：P0-A 调查验收通过（非功能验收）；P0-B 实现已放行，执行新指南 [P0-002-mode-shell-implementation.md](P0-002-mode-shell-implementation.md)。
执行：用户指定的 DSH Agent。评审/验收：Codex 主会话。
分支：`dsh/p0-mode-shell`。
worktree：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`。
base：Codex 从 `codex/project-foundation` 的本地准备提交创建；开工时将准确 SHA 记入本文件，不使用移动的 main 作为隐含基线。

前置阅读：AGENTS → STATUS → DEVELOPMENT → PRODUCT → 本任务。只按需读取参考包，不重复复制通用规则。

## P0-A：本轮明确授权的工作

目标：在运行中的 Desktop 0.2.0-rc.2 查清可实现顶部「普通｜视频」切换的真实契约；只做只读检查与本 worktree 的调查文档。

1. 读取归档官方 `cordis-plugin-development/SKILL.md`、practices、ui-plugin、user-actions 与 host-plugin；确认与运行时版本匹配。
2. 用 DSH `cordis_inspect_list` 和定向 `cordis_inspect_query` 检查需要的 Service、Slots、Theme、Config。查询按范围收窄，不枚举全量会话或私有内容。
3. 查主内容顶部可用 Slot、主视图导航/注册方式、Slot options/props、生命周期、Client loader 格式与依赖；区分全局和 session-scoped 位置。
4. 说明普通会话是否保持挂载、若被卸载怎样保留输入/选择/滚动位置；视频模式状态如何保持。不通过修改 app root、DOM 注入或猜 CSS 定位实现。
5. 查 UI→Host 已支持入口、Tool 注册与 effect 清理方式，只读核对，不安装任何插件。
6. 写 `docs/research/P0-001-runtime-contract.md`：版本、查询与脱敏结果、精确契约、建议组件边界、顶部切换方案、不可满足项与最小替代；不把猜测写成事实。
7. 在本文件开发记录填写 base、检查结果、问题与下一动作；可本地提交这两份任务文档供 Codex 评审。不 push，不创建 PR。

P0-A 验收：顶部位置和视图保持策略有运行时证据；不确定项明确；主会话能根据文件决定 P0-B 是否可开工。若顶部没有合适 Slot，报告证据与替代方案，不自行降级为侧栏入口。

## P0-B：原范围预告（已被 P0-002 的具体任务取代）

调查经主会话审阅并明确放行后，才建立最小可安装 bundle：

- 顶部「普通｜视频」切换，原有 DSH 普通模式不丢状态。
- 原生视频工作区基本框架与诚实的无工程状态；暂不伪造预览、时间线数据、生成或导出能力。
- 清晰的 manifest、Host/Client 入口、构建与安装说明、locale/theme、资源释放。
- 除非后续任务需要，不引入 HyperFrames 或自建视频模型。

P0-B 验收预告：真实目标宿主中反复切换；现有会话/输入保持；浅色/深色和窄窗口；停用后清理；真实页面无 Slot crash。无法运行的项标记未验证，不以语法通过代替。

## P0-A 原权限（历史记录；后续按 P0-002）

允许：目标 API 只读 inspection；读取项目证据与本机参考插件；在指定 worktree 写调查和任务记录；提交本地任务文档。
不包含：插件安装/启用、profile patch、全局依赖安装、功能实现、宿主改动、消息投递、push/PR/merge。需要下一阶段时交付可评审证据，不反复问已有授权的步骤。

## 开发记录（DSH 维护）

- base commit：`4d5572edf26dca619c861eae4fdfa0d7e4f2a9a7`（本 worktree 起点，等于 `codex/project-foundation` 的本地准备提交；未用移动的 main 作隐含基线）。
- runtime version / inspection：Desktop `0.2.0-rc.2`（`Info.plist` 与 `app.asar` 内 `dsh/package.json` 一致；`app.asar` sha256 `18d5036bbb58eaff41d351ede99314b8d06505aec06fb2e164c49874ada30f9e`）；`DSH_PROFILE=desktop`；Web GUI `http://127.0.0.1:19387`。归档官方 skill 16 文件与 `app.asar` 内原文逐字节一致（cmp 16/16）。本轮 22 次只读 `cordis_inspect_*`（Client Slots 拓扑与 10 个定向 Slot；Client/Host Service/Event；Theme；Builtin；Host Tool/Config 分页抽样）。未枚举会话内容，未安装/启用插件，未改 profile。
- 调查文件及 commit：`docs/research/P0-001-runtime-contract.md`，commit `a85308a`；本开发记录随其后的 docs 提交进入本分支。
- 实际验证：完成版本与官方 skill 一致性核对；用 inspection 确认 Slot 树、main/layout/sidebar 注册契约、Theme token、Client loader/manifest、Host `connection.fetch`/`tools` 契约；用随应用包只读源码核对 `main` keyed 分派（切换即卸载 Conversation）、会话头结构与拖拽标记、Conversation draft store 与 Chat 阅读位置的保存/恢复路径。**没有 live 插件运行验证**（P0-A 不安装），故凡涉及页面渲染、位置尺寸、切换前后状态的实际表现均未验证。
- 未验证/阻塞/建议：
  - 顶部事实：`conversation.header.leading` 是唯一空闲的顶部主列座位，位于会话头行、标题之前（靠左，非居中）；`shell.leading` 已占用且仅在 macOS 侧栏整列隐藏时挂载，不可用；`0.2.0-rc.2` 无「主列顶部居中」专用 Slot。
  - 视图保持：切到全局面板会卸载 Conversation（随应用包源码结构）。宿主可兜底「当前 Session 选择、输入草稿、聊天语义滚动位置、View 偏好」；DOM 文本选区/光标/焦点预计不保留（结构性推断，未 live 测试）。
  - 视频主面板无 Session binding，视频模式状态必须由插件自持（模块级 store 或浏览器持久化）。
  - 建议 P0-B 基线：注册 `main` key `dsh-video` + `ctx.layout.selectPanel`，开关组件挂 `conversation.header.leading`（普通模式）与视频面板自有顶栏（视频模式），共用状态；不注册侧栏入口、不加自定义 Remote、不覆盖宿主 UI。
  - 待主会话/用户决定：D-A 普通模式开关接受靠左还是要求居中（overlay/影子替换风险更高）；D-B 是否要求开关在其它全局面板也常驻；D-C 视频状态首版是否要浏览器持久化；D-D 工程内容 Host 持久化归属任务。见调查文件 §8。
  - 未验证：Slot 注册后的真实渲染/位置/拖拽带交互；`selectPanel` 在插件 Client 上下文的调用；切换前后草稿/滚动真机表现；停用清理；明暗主题/窄窗口；第三方 Remote 与 Host 存储域可用性。
- 下一动作：Codex 评审调查文件 `a85308a` 与本记录；对 §8 的 D-A~D-D 给出决定后放行 P0-B。P0-B 不得在未确认顶部位置方案前自行降级为侧栏入口。

## 评审记录（Codex 维护）

- 2026-10-17：已读 `a85308a` / `dcc0ae4` 实际提交与完整调查正文，变更仅为两份文档；`git diff --check` 通过。调查可作为实现依据，P0-A 通过；22 次 inspection 为 DSH 报告，Codex 未独立复跑，不把摘要当作插件真机验证。
- 独立源码核对：本机随包 ui-layout `MainPanelSlot` 只渲染 active key；`selectPanel` 校验主面板存在；`retainMainPanels` 可清理失效选中；ui-conversation `createConversationStore` 持久化 draft/view；README 指出 Lexical 维护引用身份与附件通道。支持主要机制结论，未证明全部输入内容可无损往返。
- 必须随 P0-B 验证的风险：草稿引用/附件不能仅凭纯文本 localStorage 推定保留；视频模式停用插件需验证安全回到普通；`conversation.header.leading` 是 single，需检测冲突且不覆盖其他条目。非要求补做整轮调查，已纳入下一任务。
- D-A：用户明确同意先用顶部靠左原生入口；D-B：其它全局面板首版不常驻；D-C：UI 偏好可持久化，跨面板用插件级 store，不持久化 activePanel；D-D：工程内容 Host 持久化归 P1/P2。见 D008–D010。
- 部分 API 字段与主题值目前仅有报告摘要，P0-B 在使用时补最小脱敏查询摘录，尤其 Slot props/locale/layout 注入；不需要提交全量含第三方信息的 inspection。
- 截图/光标/主题等尚无 live 证据，P0-A 通过不表示顶部切换、状态恢复或视觉已通过验收。
