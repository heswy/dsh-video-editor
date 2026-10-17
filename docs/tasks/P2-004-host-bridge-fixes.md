# P2-004：P2-002-B 复审 R1–R4 修复与真实引擎链准备

> 2026-10-17 总调度继任后首项任务。依据 [P2-002B-review-01.md](../reviews/P2-002B-review-01.md)。用户已授权正常 feature 分支 commit/push 与草稿 PR（D016）；安装/启停/重启/merge 仍不授权。本指南只补充范围与验收，通用规则见 `docs/DEVELOPMENT.md`。

执行：**程序员 2**；工作树 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`。开工 HEAD 应为 `e595d4e`（评审快照）；若已变化，先报告实际 HEAD 与差异，不 reset、不覆盖。

## 0. 开工顺序

1. 读 AGENTS.md、`docs/STATUS.md`、`docs/DEVELOPMENT.md`、本指南、review-01 原文、[ADR-0002](../adr/0002-host-bridge-runtime-and-boundaries.md)。
2. 确认工作树干净、分支正确、HEAD 与基线一致；将本指南存档为本分支 `docs/tasks/P2-004-host-bridge-fixes.md` 并填写开发记录。
3. 本地有 4 个未推送提交（`50fe805`、`9396359`、`5c9487f`、`e595d4e`），确认属于本开发线；修复完成后一并 push，更新原 PR #3，不新开 PR。

## 1. 白名单与边界

- 允许修改：根 `index.js`、`client.js`、`host/**`、`scripts/**`、`package.json`（仅本插件自身）、相关测试、`docs/research/P2-002B-*.md`、本任务记录。
- 不要修改：`packages/video-engine-*`、`spikes/**`、`docs/STATUS.md`、`docs/DECISIONS.md`、`docs/DEVELOPMENT.md`、其它 worktree；不改 profile；不安装/启用/停用/重启插件；不 merge main；不升级依赖/宿主；不运行 postinstall。
- 已安装 `dsh-video 0.1.3` 与当前配置保持不变。根版本继续 `0.2.0`（未发布，用 commit + digest 标识迭代）。

## 2. 必须修复（R1–R4，全部来自 review-01）

### R1 标题与 timing 必须绑定同一明确目标

- 现状：`client.js` 的 textElement/timingElement（约 829–844）与 `scripts/test-host-engine.mjs` 用两个独立的 first-capability 查找；真实 fixture 首个 text 是眉题 `hf-eyebrow`，首个 timing 是标题 `hf-title`，导致“改标题”实际改眉题。
- 要求：标题与时间字段显式绑定同一个 stableId；不能用两个隐式的“第一个匹配”；无对应 capabilities 时禁用/隐藏该操作，不隐式对另一对象动手。真实引擎脚本也编辑同一标题目标。
- 回归：补“眉题在前、标题在后”的实际结构；验证标题初值与 text/timing 全部 edit target 一致。

### R2 Tool 结果限额

- 现状：`host/tool.js` 固定 8000 字符切片 + 省略号，桥上限 64KiB；9000 字符成功结果被截断且无法 JSON.parse。
- 要求：execute 与结果渲染使用同一限额和单位（原始 UTF-8 bytes）；超限返回明确 `E_RESULT_LIMIT`（或先经总调度确认的显式摘要协议），不截断后伪装完整成功。
- 回归：跨 8000 字符但低于桥限额、中文/emoji 字节边界、真正超限用例；不能只提高一个魔法常数。

### R3 真实链必须执行固定 staging 的 Host

- 现状：`scripts/test-host-engine.mjs` 静态 import 开发工作树的 `../host/bridge.js`，只从 staging 读 config/INTEGRITY，可能把工作树新代码的结果记到旧 snapshot/rootCommit。
- 要求：实际 import staging/bundle 的 Host 实现（或由 staged entry 提供的正式 seam）；运行前校验 INTEGRITY 中相关源文件/配置/解析包摘要，拒绝被改动或错配快照；证据记录实际执行路径与 root/engine commit。fixture 内容/输出目录是可变业务数据，不算代码完整性破坏。
- 回归：用独立临时快照/受控模块验证，不改已固定原目录；工作树与 staging 不一致时不能借工作树实现通过。

### R4 版本门禁

- 现状：`host/bridge.js` 只解析 major/minor，0.1.x 全部视为支持显式 env/cwd，0.1.0 被错误接受；0.1.0 实际没有该 seam。
- 要求：按完整有效版本/明确能力约束判断：拒绝 0.1.0、无效/未知版本；接受 0.1.1；不靠解析失败强制归零。
- 回归：0.1.0 拒绝、0.1.1 接受的运行时预检。

## 3. 交付与验证

1. `npm run check` 全通过，并包含上述新增回归；报告分项数字。
2. 新固定根包放到**新目录** `../artifacts/p2-b/<新提交短SHA>/dsh-video-0.2.0.tgz`（不覆盖 `artifacts/p2-b/dsh-video-0.2.0.tgz`），记录大小、文件数、SHA-256。
3. 用修复提交 + 已验收引擎 `54f4671` 运行 `scripts/stage-dev.mjs` 生成不可变 staging（记录来源 commit、清单/摘要/锁、ignore-scripts 与缺失项），再运行 `scripts/test-host-engine.mjs`，产出真实 doctor→open→inspect→text/timing edit→revision/frame/status→render/status/cancel 证据（至少一条成功 H.264）。这些不是真实 DSH 激活，需明确标注。
4. 提交并 push 分支、更新 PR #3；交回：commit SHA、tarball digest、staging 路径、检查结果、真实引擎结果、未测项、保持/回滚 0.1.3 说明。
5. 发现范围外问题或需改契约：记录后交回，不自扩范围、不改引擎生产代码。

## 4. 验收（总调度）

- 独立复跑 `npm run check` 与新增回归；重点核 R1 对象绑定、R2 字节限额、R3 staging 执行归属、R4 版本门禁。
- 独立核对新 tarball 文件与提交字节一致、staging 可复现、真实链证据非借用工作树实现。
- 通过后由用户单独授权安装；本轮不安装、不 merge、不发布。

## 开发记录（程序员 2）

- 起始：分支 `dsh/p0-mode-shell`，开工 HEAD `e595d4e`（工作树干净；本地领先 `origin/dsh/p0-mode-shell` 4 个提交）。本指南由 `origin/codex/project-foundation` 存档到本分支，未切换分支、未改其它工作树/全局规则。
- 修复内容：R1 Client 改为单一显式 target（`hf-title` 受控契约优先，其次同时具备 text+timing 的元素），标题/timing 共用 stableId，并新增目标选择器；真实链也编辑同一 `hf-title`。R2 Tool execute/render 共用 `host/limits.js` 的 64 KiB 原始 UTF-8 字节预算，超限明确 `E_RESULT_LIMIT`，移除 8000 字符截断。R3 真实链改为动态加载 staging/bundle 的 Host，`scripts/lib/staged-host.mjs` 先按 INTEGRITY 校验 Host/config/patch/engine 源文件摘要并解析包，再执行；新增临时快照篡改拒绝回归。R4 版本门禁改为严格完整 semver，拒绝 0.1.0/无效/未知，接受 >=0.1.1，并补运行时预检回归。
- 本地检查：`npm run check` 通过——静态 **33**、Client smoke **39**、Host 契约 **20**（含 R1 眉题在前回归、R2 9000 字符/中文 emoji/超限、R3 staged Host 与篡改拒绝、R4 0.1.0/无效/0.1.1）。
- 固定包/staging/真实链：待本提交后生成，结果将在本记录与 `docs/research/P2-002B-host-integration.md` 追加；未安装、未改 profile、未启停/重启。
