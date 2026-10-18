> 当前状态：2026-10-18 总调度独立复审通过，见 [评审](../reviews/P2-007-review-01.md)。下文固定交付记录保留；不重新执行此已完成任务，当前下一任务读工作区handoff。

# P2-007：修复 staging 版本门禁与可复建交付

日期：2026-10-17。执行工作区：**p0-mode-shell**；沿用 `dsh/p0-mode-shell` / PR #3，开工基线 `2c46daa`（功能交付 `97c0609` / `16d60aa`）。若 HEAD 或工作状态变化，先记录实际差异，不 reset。依据 [P2-006 复审](../reviews/P2-006-review-01.md) R1。

> 本文件由 p0-mode-shell 从协调分支存档，并在下方追加开发记录。本轮实际开工 HEAD 即声明基线 `2c46daa`，工作树干净、与远端一致。

## 目标与边界

0.2.2 的客户端修复已通过 103/103 独立复核，本任务只让它可用仓库原脚本复建 staging。原脚本仍只接受根版本 0.2.1，开发者用了未提交临时副本。

通用规则、路径与授权读协调分支 DEVELOPMENT。本任务允许：`scripts/stage-dev.mjs`、相关版本回归脚本（可新增 `scripts/test-stage-version.mjs`，或更新现有 check-host/check）、README 中必要的构建步骤、本任务和 `docs/research/P2-007-*.md`。不改 client.js、host/**、engine 包、spikes、产品/全局状态、其他树与真实安装目录。根版本保持 **0.2.2**，无运行时变更、不新增依赖、不调模型、不安装/启停/重启/merge。

## 修复要求

1. 明确并提交根 bundle 版本门禁的来源：推荐显式 `--bundle-version <semver>` 与被固定的提交 manifest 比较；也可用当前固定版本作小修，但需说明后续版本维护方法。不要简单删掉版本校验。
2. 错配/非法预期版本必须明确失败，尽量在创建输出目录、安装依赖前失败；不能把任意版本隐式当已审版本。引擎仍固定采用已审 **54f4671 / client+worker 0.1.1**，不要为新版本门禁放松引擎导出/版本验证。
3. 补行为回归：0.2.2 与正确预期通过版本准入；显式错配/非法值拒绝；正常不可变输出与原有完整性门禁保持。测试区分“通过版本检查”与“完整 staging 成功”，不以源码 includes 断言代替行为。
4. 从干净、已提交的新固定提交，用仓库中的脚本直接生成**全新目录** `../artifacts/p2-b/staging-54f4671-<修复提交短SHA>`；不使用临时脚本、不覆盖已安装0.2.1或现有0.2.2目录。依赖安装仍 `--ignore-scripts`，保留严格 source/INTEGRITY 记录。
5. 用现有 runner 在该新 staging 跑真实 Host→worker 链，保留 PNG/MP4、取消、close/dispose 证据；结束保留可安装的干净 demo。记录实际执行的 Host 路径/摘要、源提交、INTEGRITY、Node/engine 版本、输出摘要与未测项。不把该链称为 DSH 真机激活。

## 交付与验收

- `npm run check` 原 103 项不回归，新增版本行为回归通过；报告分项。
- 源码/打包运行时没有变化时，允许复用 `97c0609` 的 0.2.2 tarball，但必须核对包内运行时与修复提交一致并明确其原提交来源；README 等打包内容若变化，则在新提交目录重新 pack，记录完整摘要，不覆盖旧包。
- 正常 commit/push 更新 PR #3，交回提交、原脚本命令、新 staging 与包摘要、真实链证据、未测项。无需新树或新 PR。
- 总调度复核门禁、源码/固定包/新 staging 一致性及真实链后，决定该候选是否通过；安装仍需用户授权。本任务通过不等于 v0.3 AI/画布已实现。

## 开发记录（p0-mode-shell）

- **开工**：2026-10-17 23:48（Asia/Shanghai）`git fetch origin` 后确认基线 `2c46daa` 即实际 HEAD，工作树干净、与 `origin/dsh/p0-mode-shell` 一致；未切换分支、未 reset。协调分支 `origin/codex/project-foundation` 的 STATUS/DEVELOPMENT/handoff/P2-006 复审/P2-007 已读。
- **修复提交**：`8c6bf26245e5a9a23c3b7657c83ba51ee2c3f593`（`fix(tooling): require explicit staging bundle version gate`）。改动仅 `scripts/stage-dev.mjs`、新增 `scripts/lib/stage-version.mjs`、新增 `scripts/test-stage-version.mjs`、`scripts/check.mjs`（未打包工具清单）、`README.md` 构建步骤；`client.js`、`host/**`、引擎包、spikes、版本号、依赖均未改。
- **门禁设计**：`--bundle-version <semver>` 变为必填，先做严格 semver 语法校验，再与 `rootCommit:package.json`（固定提交 manifest，即版本来源）逐字比较；非法值 exit 2，错配 exit 1，均发生在输出目录检查/创建、引擎解包与 `npm ci` 之前。未删除版本校验；引擎仍固定 `54f4671` 且保留 client/worker `0.1.1`、`private`、`./worker`/`./package.json` 导出校验。INTEGRITY 新增 `bundleVersionGate` 记录 expected/manifest/来源。后续升版本时同步传新 `--bundle-version`；不一致会明确失败，不隐式接受。
- **行为回归**：`node scripts/test-stage-version.mjs` **10/10**。覆盖：0.2.2 与正确预期通过准入；显式错配含双方版本报错；15 个非法预期值拒绝（不全用源码 includes）；非法 manifest 拒绝；semver 预发布/构建元数据语法与“精确同一版本”区分；CLI 非法/缺失参 exit 2 且不建输出目录；错配 exit 1 且不建输出目录并用 PATH 假 npm 证明未安装依赖；正确版本通过准入后仍触发原有非空输出目录不可变门禁且未跑 npm。脚本自带声明：只验证版本准入门槛，不代表完整 staging 成功。
- **检查分项**：`npm run check` 原 **103/103** 不回归——静态 **37/37**、Client smoke **46/46**、Host 契约 **20/20**，exit 0；新增版本行为回归 **10/10** 单独运行。
- **新固定包**：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/8c6bf26/dsh-video-0.2.2.tgz`，**40,426 B / 17 files / SHA-256 `3c034f2cc2fc5cdf4d84872f1a644df1c26917a832466bf9b17fd722f4f6c78d`**。因 README（打包内容）变化，未复用 `97c0609` 旧包，在新提交目录重新 `npm pack`；解包 17/17 个文件与 `8c6bf26` 提交逐字节一致，`scripts/` 不在包内，旧包保留未覆盖。
- **新 staging**：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-54f4671-8c6bf26`，用仓库原 `scripts/stage-dev.mjs` 直接从干净提交 `8c6bf26` 生成（无临时副本）。root `8c6bf26245e5a9a23c3b7657c83ba51ee2c3f593`、engine `54f467147ae2f61e118099c4947f55e8da877500`、bundle/client/worker `0.2.2/0.1.1/0.1.1`、`rootDirty:false`、`bundleVersionGate.expected=manifest=0.2.2`；INTEGRITY SHA-256 `2c615075e7c0b8bf6bb5828f621f95b541cff9d98ee91fc175bf6c54af19d76e`；config `ee2cb221…`、staged patch `5458a37b…`；bundle 16/client 12/worker 15 项源文件摘要、14 个 bundle 运行时源文件与 `8c6bf26` 逐字节一致、package.json 仅按预期加 `file:` 依赖、patch 注入 config 与 config.json 一致、engine 27 个源码文件与 `54f4671` 逐字节一致；`npm ci --ignore-scripts`、`esbuildAvailable:true`。已安装 0.2.1 的 `staging-54f4671-bdcfd72` 与现有 0.2.2 目录均未覆盖。
- **真实链**：`node scripts/test-host-engine.mjs --staging <新 staging>` exit 0，证据 `artifacts/p2-b/evidence/engine-run-2026-10-17T15-52-09-613Z.json`（18,297 B / SHA-256 `a5bc5704…`）。staging 内 Host（`07442c86…`）执行、INTEGRITY 校验通过；doctor Node v24.21.0 / Chrome 155.0.8059.84 / FFmpeg 8.0.1；open→inspect→title/timing edit revision `135a529…`→`f714e71…`；frame succeeded PNG **279,463 B / `875b48c6…`**；render succeeded H.264 MP4 **135,855 B / `fae2687e…`**；第二次 render cancel `cancelled` + `cleaned:true`；close/dispose 完成，无 host 警告。跑完用 staging 内 `npm run prepare-fixture`（保留 `VIDEO_BROWSER_PATH`）恢复 demo：`projects/demo/index.html` 与 `fixtures/index.html` 字节一致（`8080d8b0…`）、标题 `让创意成为影像`、无 `· Host`，`INTEGRITY.json` 摘要未变。
- **边界**：未安装/启停/重启、未改 profile、未 merge、未动已安装 0.2.1；该真实链不是 DSH 真机激活，也不是新画布/新 UI 验证。未测：0.2.2 安装后 R2/R3 交互、主题/窄窗/键盘、真实页面视觉、卸载回滚、Windows/Linux 与非受控素材。

## 总调度验收

2026-10-18 受控范围通过；开发者记录从 b204760 导入，独立命令/结果与限制以 P2-007-review-01.md 为准。未安装、未合并。
