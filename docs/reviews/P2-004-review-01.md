# P2-004 复审：R1–R4 修复、固定包与真实引擎链

日期：2026-10-17。总调度（DSH 继任会话）独立复审。结论：**P2-004 通过复审（受控本地/staging 范围）**，具备进入用户安装授权阶段的条件；真实 DSH 激活与真页面验收仍未做，安装后另验。

评审对象：`e595d4e` 之后的 3 个提交（`387cdc5` R1–R4 主体、`fa7b0e2` staging 完整性加固与 README、`346a45b` 记录），分支 `dsh/p0-mode-shell`，PR #3 head `346a45b9c0cc44636a54a57e479ad5445bcbc963`。

## 独立核对（不采信开发者自述）

- **范围**：`e595d4e..346a45b` 共 13 个文件，全部在根插件白名单（`client.js`、`host/**`、`scripts/**`、README、P2-004 记录）；未改 `packages/video-engine-*`、`spikes/**`、全局规则/决策、锁文件。工作树干净，远程与本地一致。
- **检查**：独立复跑 `npm run check` 全通过——静态 33/33、Client smoke 39/39、Host 契约 20/20，合计 **92/92**（含 R1–R4 新增回归）。
- **固定包**：`artifacts/p2-b/fa7b0e2/dsh-video-0.2.0.tgz`，38,984 B / 17 files，SHA-256 `d7d0b40ce4ff92da6c9955c360572c65b3cbbd8839d1889eddd96aa32d4752de`；解包后 **17/17 文件与 `fa7b0e2` 逐字节一致**；旧包 `artifacts/p2-b/dsh-video-0.2.0.tgz`（`791639ef…`）未被覆盖。
- **staging**：`artifacts/p2-b/staging-54f4671-fa7b0e2`。`INTEGRITY.json` root `fa7b0e2…`、engine `54f4671…`、版本 bundle/client/worker `0.2.0/0.1.1/0.1.1`、`rootDirty:false`；bundle 16 / client 12 / worker 15 个源文件；config SHA `6e84a49f…`、staged patch SHA `306dc966…`、staged Host `bundle/host/bridge.js` SHA-256 `07442c86…`；包解析路径均在 staging 内；`npm ci --ignore-scripts`、`esbuildAvailable:true`、无 pendingBuilds。
- **真实链独立复跑**：`node scripts/test-host-engine.mjs --staging <staging>` 通过（evidence `artifacts/p2-b/evidence/engine-run-2026-10-17T09-11-23-225Z.json`）。实际执行的 Host 是 **staging 内** `bundle/host/bridge.js`（sha 与 INTEGRITY 一致，`integrityVerified:true`），不是开发工作树；`edit` 目标为 `hf-title`（text+timing 同一 stableId），revision 变化；frame PNG 282,572 B/hash 与文件一致；render 成功 MP4 129,050 B、hash 与文件一致，独立 ffprobe 为 **H.264、1280×720、30/1、150 帧、5.000000s**，PNG 为 1280×720；第二次 render cancel `cancelling`→`cancelled`；close/dispose 完成、无 host warning。
- **安装状态未变**：profile 仍为 `dsh-video 0.1.3`（依赖仍指向 `…/p0-mode-shell/51c82a9/dsh-video-0.1.3.tgz`），0.2.0 未安装、未启停/重启、未改 profile。
- **回滚可用**：0.1.3 固定包仍在 `artifacts/p0-mode-shell/51c82a9/dsh-video-0.1.3.tgz`。

## R1–R4 判定

- **R1 通过**：删除 textElement/timingElement 两套 first-capability 扫描；`targetFor` 单一目标（受控契约 `hf-title` 优先 → 同时具备 text+timing → 单个可编辑元素），UI 有显式 target 选择器，标题/timing/保存 ops 共用同一 stableId；眉题在前结构有 smoke 回归；真实链也编辑同一 `hf-title`，不再只改眉题。
- **R2 通过**：`host/limits.js` 的 64 KiB 原始 UTF-8 字节预算同时约束 Bridge Tool 结果、execute wrapper 与 render；移除 8000 字符截断；超限明确 `E_RESULT_LIMIT`；覆盖 9000 字符、中文/emoji 跨字节、超限与 Bridge 前置拒绝。
- **R3 通过**：真实链改为 `scripts/lib/staged-host.mjs` 先按 INTEGRITY 校验 bundle/config/patch/engine 源文件字节、版本、完整文件集合与包解析，再动态 import staging 的 Host；证据记录实际执行路径/摘要、root/engine commit；篡改 Host/config、engine 源、混入未记录源文件均有拒绝回归；固定原 staging 不被修改。
- **R4 通过**：严格完整 semver；拒绝 `0.1.0`/`0.1`/`0.1.1.0`/未知/缺失，接受 `0.1.1` 与 `0.2.0`；运行时预检回归通过。

## 非阻塞观察（不要求本轮修）

1. **R4 prerelease**：严格 semver 正则接受 `0.1.1-beta` 且比较按核心版本视为 ≥0.1.1。当前只有 0.1.1/0.2.0 发布，风险低；后续可改为拒绝 prerelease 或做能力探测。
2. **R2 wrapper 余量**：内层结果 ≤64 KiB 但 Tool wrapper 字节超限时，在 execute 阶段报 `E_RESULT_LIMIT`。行为符合“明确错误、不截断”，只是模型可用预算略小于 64 KiB，README 已有说明。
3. **真实链 worktree 字段**：`test-host-engine.mjs` 用当前 cwd 的 `git rev-parse HEAD` 记录工作树状态；从非仓库根运行会记录误导值。权威字段仍是 `executedHost`，建议后续显式记录 `cwd`。
4. **fixture 是可变业务数据**：任何真实链复跑都会继续编辑 demo 工程（本轮 1 次开发者 + 1 次复审，把示例标题追加了两次 ` · Host`）。INTEGRITY 不覆盖 fixture 是正确的；**安装前应由程序员 2 重建干净 staging 或恢复 fixture**，避免演示页面带测试后缀。
5. **staging 仅开发 link 快照**：相对 `file:` 依赖/软链只对该目录有效，移动或删除即失效；可移植发行 tarball 与依赖分发仍属后续任务。

## 仍未验证（安装后按清单验收）

真实 DSH 安装/加载/激活、路由鉴权与浏览器字节读取、Tool 模型可见性与结果体验、真页面视觉/键盘/明暗/窄窗/草稿保持、加载卸载重启与 HMR、worker 真实启停与孤儿清理；安全隔离仍不承诺。

## 下一步

1. 用户单独授权安装后，由程序员 2 先重建干净 staging；用户按 README「安装」步骤从 `bundle/` 链接安装并 Enable。
2. 安装后真机验收：侧栏入口、打开示例、真实标题/尺寸/时长、target 选择、编辑→帧→导出、取消、错误就近显示、明暗/窄窗、卸载重启、Tool。
3. 验收中发现缺陷再按线派任务；不自动 merge/发布；0.1.3 回滚包保留。
