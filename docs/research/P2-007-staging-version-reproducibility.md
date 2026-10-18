> 开发交付研究记录：从固定提交 b204760 同步。总调度独立验收见对应 reviews 文件；自述与独立结果分开。

# P2-007 staging 版本门禁与可复建交付：证据记录

日期：2026-10-17（Asia/Shanghai）。执行：p0-mode-shell（`dsh/p0-mode-shell` / PR #3）。开工 HEAD `2c46daa`；修复提交 `8c6bf26245e5a9a23c3b7657c83ba51ee2c3f593`；引擎固定 `54f467147ae2f61e118099c4947f55e8da877500`（两包 `0.1.1`）。本文件是开发者自述证据，不是总调度的独立验收，也不是 DSH 真机激活记录。本轮**未安装、未启停/重启、未改 profile、未 merge**，未改 `client.js` / `host/**` / 引擎包。

## 结论（先行）

- P2-006 复审 R1 已修：`scripts/stage-dev.mjs` 不再硬编码期望版本；`--bundle-version <semver>` 必填，并与**所固定提交根 `package.json`** 比较，非法/错配在创建输出目录、解包引擎、安装依赖之前失败。引擎 `54f4671` 与 `0.1.1` 版本/导出校验未放宽。
- 新增行为回归 `scripts/test-stage-version.mjs`：**10/10**；原 `npm run check` **103/103** 不回归（37/46/20）。
- 用仓库原脚本从干净提交 `8c6bf26` 直接生成新 staging `staging-54f4671-8c6bf26`，INTEGRITY SHA-256 `2c615075e7c0b8bf6bb5828f621f95b541cff9d98ee91fc175bf6c54af19d76e`；源码摘要、固定包与提交三方核对一致。
- 因 README 属打包内容且本轮更新了构建步骤，新固定包 `dsh-video-0.2.2.tgz` 在 `8c6bf26` 目录重新 pack：**40,426 B / 17 files / SHA-256 `3c034f2c…`**，解包 17/17 与提交逐字节一致；旧 `97c0609` 包保留。
- 新 staging 上真实 Host→worker 链通过：PNG **279,463 B / `875b48c6…`**、MP4 **135,855 B / `fae2687e…`**、取消终态 `cancelled`+cleaned、close/dispose 完成；跑后 demo 已恢复干净，INTEGRITY 未变。

## 1. R1 修复：版本门禁来源与失败时机

改动文件：`scripts/stage-dev.mjs`、新增 `scripts/lib/stage-version.mjs`、新增 `scripts/test-stage-version.mjs`、`scripts/check.mjs`（仅把新脚本加入“不得打包”的工具清单）、`README.md`（staging 命令与本地检查）。

设计：

- `--bundle-version <semver>` 必填；先按 SemVer 2.0.0 语法（含预发布/构建元数据）校验，拒绝 `0.2`、`0.2.2.0`、`02.2.2`、`v0.2.2`、前后空格、非字符串等，不做任何隐式补齐/强转。
- 版本来源明确为**被 stage 的固定提交 manifest**：`git show <rootCommit>:package.json`。显式声明值必须与它完全相等（回答“是不是这份提交的已审版本”，不做 semver 优先级比较）。`--allow-dirty` 不会放宽版本门禁。
- 失败顺序：参数解析（非法/缺失 → exit 2）→ 干净树检查 → 版本准入（错配 → exit 1）→ 引擎提交解析 → 输出目录存在性/不可变检查 → 解包/`npm ci`/fixture。因此错配不会创建输出目录，也不会调用 `npm`。
- 未删除校验、未改变引擎约束：`54f4671`、client/worker `0.1.1`、`private:true`、`./worker` + `./package.json` 导出仍逐项校验。
- 后续维护：根版本升级时在 staging 命令同步传入新 `--bundle-version`；manifest 与声明不一致会明确失败，不会把任意新版本隐式当作已审版本。`INTEGRITY.json` 新增 `bundleVersionGate: { expected, manifest, source, requirement }` 以固化来源。

## 2. 行为回归（`node scripts/test-stage-version.mjs`，10/10）

| # | 行为 | 结果 |
|---|---|---|
| 1 | 提交 manifest 仍固定已审 `0.2.2` | PASS |
| 2 | manifest 0.2.2 + 显式 0.2.2 通过版本准入 | PASS |
| 3 | 显式错配被拒且报出双方版本 | PASS |
| 4 | 15 个非法预期值被拒（不静默强转） | PASS |
| 5 | 4 个非法 committed manifest 被拒 | PASS |
| 6 | 合法 semver 预发布/构建元数据可解析，但只接受精确同一版本 | PASS |
| 7 | CLI 非法 `--bundle-version` → exit 2，未创建输出目录 | PASS |
| 8 | CLI 缺 `--bundle-version` → exit 2，未创建输出目录 | PASS |
| 9 | CLI 错配 → exit 1，未创建输出目录；PATH 假 `npm` 未被调用（未装依赖） | PASS |
| 10 | CLI 正确版本通过准入后，原有“输出目录非空则拒绝”的不可变门禁仍生效，且未跑 npm | PASS |

说明：这些测试只证明**版本准入与快速失败**；完整 staging 成功由第 4、5 节的交付物证明，脚本输出也明确标注这一点。测试用 `--allow-dirty` 解耦工作树状态；真实 staging 生成未使用该参数。

另：`npm run check` 保持原分项 **37（静态）+ 46（Client smoke）+ 20（Host 契约）= 103/103**，exit 0；`scripts/check.mjs` 的“本地工具不得被打包”清单加入两个新脚本后，仍为同一项 37 项之一。

## 3. 新固定包（独立目录，未覆盖旧包）

命令：于干净 `8c6bf26` 工作树执行 `npm pack --pack-destination ../artifacts/p2-b/8c6bf26`。

| 项 | 值 |
|---|---|
| 路径 | `artifacts/p2-b/8c6bf26/dsh-video-0.2.2.tgz` |
| 大小 / 文件数 | **40,426 B / 17 files** |
| SHA-256 | **`3c034f2cc2fc5cdf4d84872f1a644df1c26917a832466bf9b17fd722f4f6c78d`** |
| 包内字节 | 解包 17/17 与 `8c6bf26` 提交的对应文件逐字节一致（含 `package.json`、`README.md`） |
| 打包边界 | `scripts/**`、docs、引擎包均不在包内 |
| 旧包 | `97c0609` 的 0.2.2 包（40,220 B / `0dd8bcf2…`）保留未动 |

复用判断：客户端/宿主运行时未变，但 `README.md` 属 `files` 打包内容且更新了 staging 命令，故按任务要求在新提交目录重新 pack，而非复用旧包。

## 4. 新 staging（仓库原脚本直接生成）

命令（工作树干净，`HEAD=8c6bf26`，未用临时副本）：

```sh
node scripts/stage-dev.mjs --engine-commit 54f4671 \
  --bundle-version 0.2.2 \
  --node '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node' \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --out '/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-54f4671-8c6bf26'
```

脚本正常输出 `bundleVersionGate`：`expected=0.2.2`、`manifest=0.2.2`、来源为该提交；`esbuildAvailable:true`；`npm ci --ignore-scripts` 完成（122 packages），无 postinstall/未知构建脚本。

| 项 | 值 |
|---|---|
| 目录 | `artifacts/p2-b/staging-54f4671-8c6bf26`（254 MB，全新目录） |
| rootCommit / rootDirty | `8c6bf26245e5a9a23c3b7657c83ba51ee2c3f593` / `false` |
| engineCommit | `54f467147ae2f61e118099c4947f55e8da877500` |
| 版本 | bundle `0.2.2` / client `0.1.1` / worker `0.1.1` |
| 版本门禁 | `bundleVersionGate.expected=manifest=0.2.2`，source 为 committed root package.json |
| INTEGRITY.json SHA-256 | **`2c615075e7c0b8bf6bb5828f621f95b541cff9d98ee91fc175bf6c54af19d76e`** |
| config.json SHA-256 | `ee2cb221d321f881c3041c4630b966283761ac2cd9a34658d74971bcf7d2c7b1` |
| staged patch SHA-256 | `5458a37b8493cd97a1ff9a8de429851dd1999cfb39a64b46c499896e6f78baf5` |
| 文件摘要项 | bundle 16 / client 12 / worker 15，按 INTEGRITY 重算全部一致 |
| bundle 运行时源文件 | 14 个（client.js、index.js、host/*.js、locale、icon 等）与 `8c6bf26` 逐字节一致；README 也与提交一致 |
| bundle package.json | 与提交相比仅新增 staging 专属 `file:../engine-client` / `file:../engine-worker` 依赖与链接，其余键一致 |
| patch/config | 快照副本 patch 注入的 config 与 `config.json` 一致；根提交 patch 仍 `config: {}` |
| engine 源码 | 27 个 client/worker 源码文件与 `54f4671` 逐字节一致 |
| 与已审 0.2.2 staging 对比 | client.js/host/locale/icon 等运行时字节与 `staging-54f4671-97c0609` 完全一致；差异仅为 README（本次构建步骤）与每目录绝对路径（config/patch/INTEGRITY） |
| 保留 | 已安装 0.2.1 的 `staging-54f4671-bdcfd72`、现有 `staging-54f4671-97c0609` 等目录均未覆盖；无 profile 修改 |

## 5. 真实 Host→worker 链（新 staging，非 DSH 激活）

命令：`node scripts/test-host-engine.mjs --staging artifacts/p2-b/staging-54f4671-8c6bf26`，exit 0。

| 项 | 值 |
|---|---|
| 证据文件 | `artifacts/p2-b/evidence/engine-run-2026-10-17T15-52-09-613Z.json`（18,297 B / SHA-256 `a5bc570417ebf013717d54327c5c7822b1044c3661c06b61dff5cc396b0a9bef`） |
| 执行归属 | staging 内 Host `bundle/host/bridge.js`，`hostModuleSha256=07442c86…`，`integrityVerified:true`；未 import 开发树 Host |
| 环境 | Node **v24.21.0**；Chrome **155.0.8059.84**；FFmpeg/ffprobe **8.0.1**；hyperframes/sdk `0.8.167`、gsap `3.15.0` |
| 工程链 | open→inspect（demo，5s）→`hf-title` 文本+时序 edit revision `135a529…`→`f714e71…`→inspect 确认 |
| 帧 | frame succeeded，PNG **279,463 B / `875b48c679d1a58085c5d27203f9ae77c304da7d86e76ff5cc7bf514725c420b`**，与 staging `artifacts/output/` 内文件字节一致 |
| 导出 | render succeeded，H.264 MP4 **135,855 B / `fae2687eb39ef25a8a2f91bd6376473eea7814928c81bcaf4fe9c6f36833c3ce`**，与 staging `artifacts/output/` 内文件字节一致 |
| 取消 | 第二次 render cancel：`cancelling`→`cancelled`，`cleaned:true` |
| 生命周期 | `close.closed:true`、`disposed:true`、`hostWarnings:[]` |
| 确定性旁证 | PNG/MP4 摘要与 `97c0609` 上轮记录一致（引擎/输入未变），本轮为重新执行得到的新证据文件 |

跑完恢复：在 staging `engine-worker/` 执行 `VIDEO_BROWSER_PATH='…Google Chrome' npm run prepare-fixture`，使 `projects/demo/index.html` 与 `fixtures/index.html` 字节一致（`8080d8b0…`）、标题恢复 `让创意成为影像`、不含 `· Host`，`registry.json` 保留 `browserPath`；随后核对 `INTEGRITY.json` SHA-256 仍为 `2c615075…`（运行只写可变业务产物，不改快照源码摘要）。

## 6. 边界与未测项

- 本记录**不是** DSH 真机激活、安装或真页面验收：未安装 0.2.2、未启停/重启、未改 profile；真实链使用 staging 内 Host 与受控 fixture。
- 未测：0.2.2 安装后的 R2（取消无红色错误）与 R3（时序本地校验）真机交互、浅色/深色/窄窗/键盘、真实页面视觉与焦点、插件卸载/回滚、HMR、Windows/Linux、非受控素材与多用户权限。
- `INTEGRITY`/`config`/patch 含快照绝对路径，因而不同输出目录的 staging 不会逐字节相同；可复建性是“同一提交 + 同一脚本得到相同源码/引擎/版本与结构”，不是整目录哈希相同。
- 旧 0.2.2 候选包与旧 staging 保留；是否安装由用户另行授权，最终验收由总调度复核后决定。

## 7. 本轮内部只读复核（不等同总调度验收）

同一工作树内另起只读复核者，未采信开发自述，独立复跑了静态/行为检查并重算工件摘要，7/7 项 PASS、无差异：差异范围仅允许文件、`client.js`/`host/**` 无改动、`npm run check` 103/103、版本回归 10/10 与 CLI 快速失败、tarball 17/17 逐字节、staging 全部 INTEGRITY 摘要/引擎 27 文件与 `54f4671` 一致、真实链证据字段与当前 PNG/MP4 字节交叉一致、demo 干净且 INTEGRITY 未变。该复核**不能**重放真实链以证明证据 JSON 必由一次真实执行产生，也不能替代 DSH 真机安装/激活验收；本记录仍按“开发者自述 + 可追溯证据”交回总调度。
