# BUG-001：管理模板MP4底部黑带

日期：2026-10-18。状态：**P3-006-B修复已验收，下一实施任务，待用户转发启动；正式导出视觉验收前必须关闭。** 执行p1-engine，基线74294e6/交付d926d10，沿用原树/分支/PR#2，不新建tree。

## 事实与证据

P3-006-B交付的product-launch-v1/1280×720/30fps/11s MP4，1.5s导出帧底部y=634–719共86行黑，worker同一时刻抽帧无该黑带。总调度已查看已提交PNG确认黑带可见；“未改layout/style的baseline同样复现”为开发者对照证据，本轮未独立重跑baseline。不要把根因先认定为某个viewport、模板或FFmpeg参数。

证据：p1-engine树spikes/editor-canvas/evidence/p3-006b/persistence-evidence.json（renderedFrame.knownIssue等字段）、rendered-1.5s.png及frame-after-1.5s.png；固定引擎4c087ef/两包0.3.0。MP4编码/尺寸/帧数通过不等于完整画面通过。

## 本轮实现与验收

用未改布局baseline和已改布局工程各自复现，定位worker抽帧与CLI render在视口/比例/根元素/输出处理上的实际差异。修复需对照同一revision、同一时间点的完整720p画面，并覆盖至少两个时刻及一次不同画布比例；保留原始工程构图，不以裁切、拉伸、放大画面或事后补色隐藏问题。若根因涉及上游，只在项目可控适配层作有证据的修正，不能直接改node_modules充当固定包交付。

允许packages/video-engine-worker/**、client的版本/锁根/必要打包兼容检查、相关spikes/editor-canvas的证据runner和新证据目录、本任务与对应research；不改根Host/插件/p0树/其它任务。两包目标0.3.1，保持JSONL v1、22方法和已审layout/style/覆盖/合并语义，不把上游升级当第一修复方案。先定位根因再实现，若需要SDK/CLI版本变化，给出最小差异和理由，不能静默升级依赖或执行未知安装脚本。

新增真实渲染回归必须识别当前86px缺陷，至少两个时间点、baseline与人工布局工程、另一种受支持画布比例，解码MP4帧与同revision worker frame对照，容差排除字形抗锯齿但不容忍整条缺失内容。用有色背景/可识别底部元素证明构图保持，不用纯黑背景掩盖。保留原始失败和修复后证据，颜色/时序/元素基座不应发生无关变化。

验证相关worker40项、真实render/取消/超时/清理链、client包兼容；新增故障回归不得靠删测试或放宽画面断言通过。既有200ms client fixture抖动如重现保留首跑与复跑结果，不混作渲染生产修复。新功能提交目录的两个固定包/完整SHA/条目/与Git字节一致/干净检出复pack、研究记录一次push PR#2交回复审。提交需附精确修复原因与未测项；不必再单交调查提案。

不安装/启停/重启DSH、不改profile、不调模型、不动当前用户工程、不merge。p0以74294e6先做Host画布整合，不等待本任务开始开发；你交付后由总调度复审固定提交再显式更新p0 staging，不自动引用移动分支。旧已安装54f4671候选未因本任务自动修复。

---

## 开发记录（p1-engine）

填写：2026-10-18。开工 `git fetch origin` 成功，协调记忆 `origin/codex/project-foundation` @ **`098638b`**；开工 HEAD **`d926d10`**，引擎基线 **`74294e6`** / 两包 0.3.0。实现提交 **`82f6219`**；本记录与研究记录另以 docs 提交。未改根 Host/插件/p0 树、未安装/启停/重启、未调模型、未 merge、未新 tree/PR；未修改 `node_modules` 作为交付内容。

### 根因与修复

- 根因：HyperFrames 0.8.167 static-frame dedup 会打开第二个验证页；验证页关闭后主捕获页丢失 `page.setViewport(1280,720)` device-metrics override（`window.innerHeight` 720→633），而 renderer 已因“内容适配视口”把 `captureBeyondViewport` 降为 false；CDP 只绘制 633 行视口，底部 87 行黑（旧证据按 86 行黑计为 y=634–719）。worker snapshot/frame 路径无此验证页，一直完整。
- 修复：worker 仅对 **render** job 注入 `HF_STATIC_DEDUP=false`（`Jobs.env(temp, kind)`），避免第二验证页；frame/snapshot 不变；同一 revision/HTML 完整 720p 输出，不裁切/拉伸/补色；未改上游 `node_modules`。代价是失去静帧去重优化（5s 单场景诊断约 9.3s→10.6s）；上游修复后可移除。

### 验证与证据

- worker 单元/契约 **40/40**（约 32.5s）；真实链 **12/12**（约 223.3s，含新增 `render-band.integration.mjs` 约 72s）；client **20 项：19 pass + 1 opt-in skip**（0.3.1 打包/兼容通过）。
- 新回归覆盖：baseline、人工布局（底部 logo 位于 y=580–700，证明旧黑带区域有真实内容）与 960×720 4:3 静态工程；0.5s/1.5s 两个时刻；解码 MP4 帧与同 revision worker frame 对照；断言 H.264 元数据、底部黑行=0、底部中心为场景背景色、整帧/底部带差异 ≤2%、底部 logo bbox 误差 ≤8px。旧实现（默认 dedup）会在这些断言下失败。
- 真实前后证据目录 `spikes/editor-canvas/evidence/bug-001/`（before/after MP4/PNG/JSON，旧 `evidence/p3-006b` 86 行黑带证据未覆盖）：同 revision 1.5s 帧 before 黑 86 行 → after 0 行；after 底部场景色距离 2；after MP4 与 worker frame changedPct 1.14%–1.42%（阈值 24）；三种工程一致。
- 复跑：`npm test --prefix packages/video-engine-worker`；`npm run test:real --prefix packages/video-engine-worker`；`npm test --prefix packages/video-engine-client`；`node spikes/editor-canvas/scripts/render-band-evidence.mjs`。

### 固定包（`artifacts/engine/82f6219/`，ignored，保留旧包）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.3.1.tgz | 3 | 7408 | `dcb939b023e351b4299e3789e8fbf2528083f726e74164da1c6f2fe42ce7e92b` |
| dsh-video-engine-worker-0.3.1.tgz | 14 | 55568 | `31c2ed850d445e588d8063cc95a1e57cde1a994cd732c4912bc6c4e9481be8a7` |

`package-verify.json`：逐文件与 `82f6219` 字节一致、重复 pack 一致、干净 `git archive` 检出重新 pack 一致；未安装、未发布；旧 `df4b74f/`、`4c087ef/`、`74294e6/` 包保留。

### 未测项 / 风险

- 仅 macOS 本机受控环境；未测音频/视频、任意 HTML/JS、非 macOS、GPU 路径；未改上游，上游 dedup/页面生命周期变化需重新回归。
- 禁用 dedup 会增加长片/高静帧渲染耗时；未做大工程性能/内存实测；render 120s 默认超时/取消/清理链按既有测试通过。
- 4:3 工程使用静态 fixture，不新增 `project.create` 画布比例 API。
