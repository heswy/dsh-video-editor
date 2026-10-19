# 开发与协作规则

更新：2026-10-19。用户已授权本轮合并与清理；旧协调/分线规则由本页替代，历史记录保留。

## 事实来源与分工

- **main是唯一长期主分支，origin/main同时维护代码和最新项目记忆。** 不再维护独立project-foundation或长期video-studio分支。
- 主会话负责产品/架构/任务/规范/协调/评审/验收；用户指定开发Agent实现、验证、修复并交PR。主会话只有在用户明确指派时直接实现；不自动派发或跨会话联系，交接由用户转发。
- 开工先git fetch origin，然后git show origin/main:docs/STATUS.md、docs/DEVELOPMENT.md及docs/handoffs/README.md；产品读PRODUCT、设计读FRONTEND-DESIGN、决策读DECISIONS有效索引。离线注明缓存main提交。
- 用户当前要求优先于历史文档。任务指南只写特定范围与验收，本页维护通用规则，避免多份规则漂移。

## Git、工作区与PR

| 目录 | 当前用途 |
|---|---|
| `/Users/orange/Orange Field/Matterhorn/dsh-video-editor` | main标准入口；项目记忆、用户测试基线 |
| `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees` | 后续问题分支的隔离目录；旧p0/p1/video-studio/ui-polish树保留为分离HEAD历史/测试检出，不是活跃开发线 |
| 上述父目录下`artifacts/` | 固定包、不可变staging、证据与用户作品；不得随分支/工作树清理 |

- 用户测试发现具体问题后，从最新origin/main建立独立`codex/<问题名>`分支；按需在既定父目录建隔离worktree。同一tree一个写入会话，不复活已清理的长期分支。
- 不在main直接做功能开发。小范围修复、相关验证、普通push、PR回main；不把无关重构或新功能塞进问题修复。合并/安装/发布按用户授权，推送和草稿PR不等于验收或发布。
- 当前用户已授权清理旧分支/PR、把现有可用代码和记忆合入main；这是本轮集成授权，不自动授权未来所有PR合并。
- 合并优先保留历史；删除分支前确认所有提交已进入main，工作树干净。保留忽略产物/用户修改；不reset/clean/强推，不删已安装依赖或用户工程。旧分支SHA可从Git历史和清理记录追溯。
- 新tree依锁安装独立依赖，禁未知postinstall与无关升级；不借修改旧树、旧staging或用户工程完成测试。

## 产品与插件边界

- 当前只实现右侧原生对话生成/续改→左侧自动显示可播放作品→同工程更新。手动选择/拖拽/属性/原位编辑延期；鹈鹕/球等是回归样例，不写题材或stableId专用逻辑。
- UI走受支持React Slot、主题token、locale与资源清理；先核对实际宿主版本的官方cordis-plugin-development skill/运行时契约。不修改DSH源码/app.asar、宿主根DOM、会话协议或用户凭据。
- 原生模型/历史/Composer/权限复用宿主；一个Host业务入口供UI和Agent Tool共用。视图状态不能成为工程内容的第二真相；修订、保存、写入排序与冲突由Host/worker维护。
- 固定revision快照预览；失败保留最后有效作品，迟到结果不覆盖新作品。生成脚本不在Host主进程执行；iframe/CSP与路径校验不等于完整OS沙箱。
- 源码从固定提交打包，staging记录root/engine版本、摘要与干净状态，不跟随移动HEAD拼包、不热改已审候选；旧包/staging不覆盖。

## 验证、安装与真机操作

- 分层报告：语法/manifest→单元/契约→真实Host→真页面→真实模型/渲染。明确未测项；mock/组件浏览器不冒充DSH或模型验收，不用测试数量代替用户闭环。
- 按修改风险验证，重点保留项目/Session归属、文件边界、revision/幂等、失败恢复、取消与清理。简单文案/样式不增加镜像测试；回归复现和结果记录在任务文件。
- 本轮仓库清理不自动替换当前安装。用户测试前若需新候选，先给出精确包/staging/摘要、受支持Plugin Manager路径和实际回滚入口，再按具体授权安装；禁止手改profile或在profile跑pnpm。
- Desktop 0.2.1-rc.2曾出现link升级后Host新/Client旧；安装后核实实际Client，不反复touch已审文件。需要重启时报告具体阻塞，由用户授权/手动操作，不自动退出应用。
- 用户同时使用电脑时禁止全局坐标、键盘/粘贴、个人剪贴板与强切前台。只用绑定目标的DOM/AX通道；无通道则提供最少人工步骤，不借个人会话凑证据。
- 不修改/重置用户已有作品，不用prepare-fixture覆盖用户工程。截图去标识，原始个人聊天/凭据不入库；误投递立即停止并记录，不操作其它应用撤销用户内容。
- 真实模型请求、系统设置、重启、安装与发布按当次授权；缺授权不以历史测试指令推断放行。用户明确给出的授权持续有效，不重复确认同一已授权动作。

## 项目记忆

- STATUS维护当前事实、工作阶段与下一步；PRODUCT维护产品约定，DECISIONS维护有效索引与历史理由，FRONTEND-DESIGN维护设计方向。
- handoffs/README是当前任务入口；旧按工作区命名的handoff均标历史。任务记录开发自述、固定提交、检查、限制及评审；research保存可追溯证据。
- 每次交接记录base/head/范围/验证/未测/下一步；不能把计划标完成。全局记忆与开发记录随PR进入main，不再依赖已删除的协调分支。
