# 项目决策

状态：accepted 为已采纳，proposed 为待验证；变更通过新增替代记录保留原因。

| ID / 日期 | 决定 | 状态与理由 |
|---|---|---|
| D001 / 2026-10-17 | Codex 管产品/架构/任务/评审，用户指定 DSH Agent 实现/验证/修复 | accepted；遵循用户个人开发工作流 |
| D002 / 2026-10-17 | 顶部「普通｜视频」作为主入口，模式是工作区视图而非 Agent preset | accepted；来自用户截图与明确要求；具体 Slot 待核实 |
| D003 / 2026-10-17 | 当前以本机 Desktop 0.2.0-rc.2 及其官方内置 Skill 为宿主基线 | accepted；先前 master 调研不作为当前 API 契约 |
| D004 / 2026-10-17 | 原生 Slot 工作区，主题控件；不把整页编辑器做成独立 iframe 应用 | accepted；匹配宿主规范；视频画布隔离方式仍待验证 |
| D005 / 2026-10-17 | 优先验证 HyperFrames；UI/Tool 共享 Host 写入入口，内容权威来源唯一 | proposed；通过 P1 编辑/持久化/渲染验证后冻结接口 |
| D006 / 2026-10-17 | DSH 分支 dsh/p0-mode-shell；Codex 建立与维护同级独立 worktree；首轮不授权安装或 push | accepted；固定基线与职责，避免影响正在使用的 Desktop profile |
| D007 / 2026-10-17 | 用户要求精致、优美、优雅及丰富动效，考虑液态玻璃 | accepted（偏好）；具体「玻璃上的剪辑台」设计和数值为 proposed，见 design/FRONTEND-DESIGN.md；不覆盖原生主题、可读性与精确编辑 |
| D008 / 2026-10-17 | 首版顶部切换采用靠左原生入口，居中后续优化；不在其它全局面板常驻 | accepted；D-A 用户已明确选择靠左，D-B 按最小范围收敛；不使用 overlay 或影子替换宿主 header |
| D009 / 2026-10-17 | P0-B 用插件级内存保留跨面板界面状态；只对简化效果等已有 UI 偏好使用带版本的浏览器持久化 | accepted；不记住 activePanel 自动抢导航，不在 localStorage 放工程、媒体或提示词。持久化失败退回内存并告知限制，不影响模式切换 |
| D010 / 2026-10-17 | 工程内容 Host 权威持久化归 P1 验证、P2 固化；P0-B 无工程创建/保存能力 | accepted；解决 D-D，不提前选未验证 storageDomain API；跨刷新恢复项目不由 P0-B 承诺 |

未决：顶部公共 Slot、视图保持机制、宿主依赖解析、自定义 Host 通信、HyperFrames 固定版本与预览隔离。答案先进入任务实测记录，再形成新决定。
