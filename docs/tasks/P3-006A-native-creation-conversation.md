# P3-006-A：右侧原生 AI、创作历史与会话范围接线

日期：2026-10-18。执行：**p0-mode-shell**；基线 `7daa039`，沿用当前树、`dsh/p0-mode-shell`和PR#3，开工先记实际HEAD/工作状态。依据 [P3-005-A复审](../reviews/P3-005A-review-01.md)。通用规则仅引用DEVELOPMENT，产品和设计读最新v0.3。

> 本文件由 p0-mode-shell 从协调分支存档，并在下方追加开发记录。本轮实际开工 HEAD 即 `7daa039`，工作树干净；`git fetch origin` 成功，使用协调提交 `4cecf857c6c49617f3ca426a928526e0caa015cf`（2026-10-18 10:22:08 +0800）读取本指南/复审/handoff。

## 目标与交付粒度

本轮进入实现，一次交付右侧真实原生Conversation、工程创作会话创建/历史/模型、Host映射持久化、Tool工程范围与动态上下文，以及可安装开发候选。不再另做长调查。不依赖尚未交回的P3-005-B画布spike；左侧暂保留诚实的实际PNG预览/导出，不新增假播放、假点选或未持久化拖动。

首版目标根包 **0.3.0-alpha.1**（开发候选，未发布）。本任务仍用已审 `54f4671` / engine-client+worker0.1.1，不在这里跨入多Scene引擎/画布资产路由；新引擎df4b74f0.2.1的接线随画布契约另发。`--bundle-version 0.3.0-alpha.1`应可直接生成staging，引擎固定不放松。

## 范围

允许：`client.js`、`index.js`、`host/**`、`package.json`/locale、scripts中相关check/smoke/Host/版本与stage/真实链检查（含必要lib与新增会话回归）、README、本任务和`docs/research/P3-006A-*.md`。不加运行时依赖，原生React来自模块表；manifest只按实际需要改，不为Slot调用随意加external。

不改两engine包、spikes、全局记忆/决策、其他树/PR；不自动安装/启停/重启、不改profile、不创建或编辑用户真实会话、不发模型请求、不merge。真实写入Session等仅在安装验收获明确授权后执行；本轮用受控adapter自动测试并交具体候选。不得改安装用旧staging，所有包和新staging放新提交目录。

### 关键实现约束（来自指南/复审）

- 私有 session-scope child 取得 kit；owned SessionReference + 原生 Conversation Factory（embedded、hero:false、Chat view、无宽把手/宿主Header），保留原生 Composer/模型/权限/审批/附件/Stop；phase 随 loading/error/active 正确表达。
- `source:'videoView'`；`reference.ready` 后检查 `openState/openError`；快速切换用 generation 防迟到；先卸载旧 occurrence 再 release；禁止释放后 Provider 仍读引用；新/旧 reference 不得共享 editable root。
- 单编辑根判断结合 main panel 可见性与挂载生命周期；mainView 保留计数不能单独锁死视频页；反向切回普通会话必须解除视频编辑根。
- 无绑定时提供真实“开始创作/新会话”动作；render/effect 重跑不得悄悄重复创建会话。
- Host 为映射唯一权威：`projectId/sessionIds/activeSessionId`，版本化、原子写、队列并发；可信 `sessionStatePath`/`sessionCwd`；只接纳 controller 返回的 id；双击/重试去重；重启恢复；坏文件/未知版本不静默清空。
- 历史只列本 Host 登记到工程的会话；已归档/删除显示不可用；不自动解归档；不创建独立 Workspace/不 archive 隐藏；标题可前缀。
- Tool 从可信 `exec.agent` 取 Session 身份，按映射校验 projectId 与 job 归属；无 agent/未绑定/跨工程拒绝；doctor 不受限；UI Fetch 路径不伪装 Agent；集中 adapter 核实 Agent 契约。
- 绑定期间经受支持 `systemPrompt.context` 提供新鲜工程 id/revision/能力摘要，生命周期可清理；上下文不是授权。
- 审批/权限沿用原生；首版不另造独立 Stop。
- 验证：受控 Slot/controller adapter 先验证 kit/Provider/Factory，再完成其余；回归覆盖切换/迟到/释放、mainView 可见性、双击创建、返回 id 写回、历史重开/跨工程/持久失败、模型 seat 未被替换、Tool 无身份/错工程/job 错归属、动态上下文清理、旧行为不回归。
- 交付：commit/push PR#3；新固定包/新 staging/INTEGRITY/源码摘要/自动检查/真实链/README；明示无真实 Session/模型/安装证据。

## 开发记录（p0-mode-shell）

见下方交付记录（实现提交、检查、包/staging/真实链摘要与未测项）。

## 开发记录（p0-mode-shell）

- **开工**：2026-10-18 11:05（Asia/Shanghai）。`git fetch origin` 成功，协调分支 `4cecf857…`（10:22:08）含本指南、P3-005A 复审与 handoff；实际开工 HEAD `7daa039`，工作树干净、与远端一致；未切换分支、未 reset。
- **实现提交**：`26bd4c1ab1f7faabc6cb8a6f067dc9de4d5744f9`（`feat(plugin): embed native creation conversation with host session scope`），改动 13 个文件、+2212/−74；未改 engine 包、spikes、全局文档、profile。根版本 `0.3.0-alpha.1`，引擎固定 `54f4671`/两包 `0.1.1`。
- **实现要点**：Host 新增 `host/session-state.js`（v1 版本化映射、原子写、队列、坏文件/未知版本 typed error 且不覆盖）与 `host/sessions.js`（controller 创建/列表/选择/诊断、requestId 去重+单飞、受信 cwd、prompt context contribution）；`host/bridge.js` 增加 session.* 方法、tool 范围的 `assertToolScope`（Agent/绑定/工程/job 归属）与有界 projectFacts；`host/tool.js` 集中 `agentSessionIdFromToolExec`（`exec.agent.session.id` 实测契约，兼容 `agent.id` 并要求一致）；`host/config.js` 增加 `sessionStatePath`/`sessionCwd`。`client.js` 改为左侧真实画面 + 右侧常驻原生 AI：私有 session child 取 kit、`videoView` owned reference、embedded/hero:false/Chat Factory、openState/迟到切换/卸载释放守卫、mainView 可见性提示、原生历史/新会话/创建单飞、只读预检 data 属性；README/check/smoke/Host/stage/版本回归同步。
- **检查**：干净提交上 `npm run check` **117/117**（静态 40、Client smoke 52、Host 契约 25；原 103 项全部保留），`node scripts/test-stage-version.mjs` **10/10**（0.3.0-alpha.1 版本门禁通过）。
- **固定包**：`artifacts/p2-b/26bd4c1/dsh-video-0.3.0-alpha.1.tgz`，**55,723 B / 19 files / SHA-256 `a5bbffa4f8dc65d131f42b479be313fb6d8c77b7676830fbf7a07ed91ccabd60`**；解包 19/19 与提交逐字节一致，scripts/spikes 不在包内；旧包保留。
- **新 staging**：`artifacts/p2-b/staging-54f4671-26bd4c1`，仓库原脚本 + `--bundle-version 0.3.0-alpha.1` 从干净 `26bd4c1` 生成；INTEGRITY SHA `c282cb11…4ee3af`、config `41e9d5e3…b720fb`、patch `3bc7333d…b827815`；bundle 18/client 12/worker 15 摘要一致，17 个未改 runtime 文件与提交一致，engine 27 文件与 `54f4671` 一致；staging 内含 `sessionStatePath`/`sessionCwd` 与 `session-cwd` 目录；旧 0.2.x 安装/staging 未动。
- **真实链**：新 staging 上 `test-host-engine.mjs` exit 0，证据 `artifacts/p2-b/evidence/engine-run-2026-10-18T03-15-52-552Z.json`（18,313 B / SHA `ad675cbe…faacac`）；ok=true、hostModuleSha `5a19e216…`、integrityVerified；PNG 279,463 B/`875b48c6…`、MP4 135,855 B/`fae2687e…`；cancel cancelled+cleaned、close/disposed；跑后 demo 恢复干净、INTEGRITY 未变。
- **未测**：未安装/启停/重启、未改 profile、未创建真实用户会话/发模型请求；真实 kit/Provider 渲染、模型/审批/附件/历史交互、HMR/停用/重连、侧栏可见性与 `sessionController.create` 真机直调均待安装验收。审批中 Stop 隐藏为已接受宿主行为；无独立 Stop。引擎多 Scene/画布/资产导入不在本轮。
