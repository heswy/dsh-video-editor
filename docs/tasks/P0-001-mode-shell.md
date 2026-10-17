# P0-001：宿主契约与顶部模式工作区

状态：P0-A 待启动；P0-B 等主会话审阅调查后放行。
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

## P0-B：后续目标，本轮未授权实现

调查经主会话审阅并明确放行后，才建立最小可安装 bundle：

- 顶部「普通｜视频」切换，原有 DSH 普通模式不丢状态。
- 原生视频工作区基本框架与诚实的无工程状态；暂不伪造预览、时间线数据、生成或导出能力。
- 清晰的 manifest、Host/Client 入口、构建与安装说明、locale/theme、资源释放。
- 除非后续任务需要，不引入 HyperFrames 或自建视频模型。

P0-B 验收预告：真实目标宿主中反复切换；现有会话/输入保持；浅色/深色和窄窗口；停用后清理；真实页面无 Slot crash。无法运行的项标记未验证，不以语法通过代替。

## 本次权限

允许：目标 API 只读 inspection；读取项目证据与本机参考插件；在指定 worktree 写调查和任务记录；提交本地任务文档。
不包含：插件安装/启用、profile patch、全局依赖安装、功能实现、宿主改动、消息投递、push/PR/merge。需要下一阶段时交付可评审证据，不反复问已有授权的步骤。

## 开发记录（DSH 维护）

- base commit：待填写。
- runtime version / inspection：待填写。
- 调查文件及 commit：待填写。
- 实际验证：待填写。
- 未验证/阻塞/建议：待填写。

## 评审记录（Codex 维护）

- 待首次提交。
