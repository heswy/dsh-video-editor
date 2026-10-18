# P3-006-B：直接编辑的布局/样式持久化

日期：2026-10-18。执行：**p1-engine**；基线head `ea2d1a4`，引擎功能基线df4b74f/两包0.2.1；沿用原树、`codex/p1-engine-spike-b4bf` / PR#2。先记录实际HEAD/协调SHA，不reset。依据 [P3-005-B复审](../reviews/P3-005B-review-01.md)。通用规则只引用DEVELOPMENT。

## 一次交付的目标

让“拖动位置、缩放尺寸、改文字颜色/字号”等真正写入同一工程，并在AI续改、场景操作、撤销重做、重启和MP4导出后保持。直接实现已明确的缺口，不再单开spike/长调查。先做受控product-launch-v1的可编辑文字/图片，不承诺任意DOM/Canvas/WebGL。

两引擎包升 **0.3.0**，保持JSONL v1和原有方法；优先扩展统一`edit.ops`，无需为每个按钮另起方法。旧text/timing及P3方法语义保持，旧无布局覆盖的工程能打开。p0-mode-shell正在P3-006-A根插件接线，仍用旧已审引擎；本任务不触碰其树或替它升级。

## 允许范围

`packages/video-engine-worker/**`、`packages/video-engine-client/**`（源码/schema/测试/README/锁根版本）、本任务与`docs/research/P3-006B-*.md`。可更新`spikes/editor-canvas/**`的能力探针/测试和必要适配，以证明本轮真实可保存，不扩展为最终DSH界面。不要覆盖旧evidence；新输出到任务artifacts或新证据目录。

不改根插件/Host/manifest、其他spike、全局记忆或其他worktree；不安装/启停/重启DSH、不改profile、不调模型、不merge。不加运行时依赖/未知安装脚本，HyperFrames固定0.8.167。

## 1. 最小typed协议

统一edit继续使用projectId/expectedRevision/operationId/ops，批量原子校验与单写者队列不变：

```json
{"type":"layout","target":"scene-1-title","unit":"composition-px","box":{"left":120,"top":240}}
{"type":"layout","target":"scene-1-shot","unit":"composition-px","box":{"width":600,"height":320}}
{"type":"style","target":"scene-1-title","styles":{"color":"#ff0000","fontSize":48,"fontWeight":600,"textAlign":"center"}}
```

- layout.box是非空patch，只允许left/top/width/height，有限数字；以Scene静态布局基座为准（全幅Scene的composition CSS px），不是动画帧getBoundingClientRect，不直接写transform。允许1/1000px精度，统一规范化；初版left/top限制在画布内，width/height至少1px且不超过画布尺寸。实际已知尺寸可判断组合越界时明确拒绝，auto高度不能伪造为已测尺寸。边界/最小尺寸和精度在schema/README/worker一致。
- style.styles为非空受控patch，初版仅color（#RRGGBB，规范小写）、fontSize（8–256有限数，px）、fontWeight（100–900的100整数倍）、textAlign（left/center/right）。拒绝未知键、任意CSS字符串、url/expression/脚本、transform/animation/zIndex；字体族、旋转、多选/层级暂不扩展。
- 仅对可解析且明确支持的受控模板叶子文字/图片提供layout capability；style按文字等实际支持区分。root/section、未知/嵌套变换元素明确拒绝，不把已有text capability等同布局可写。原legacy text/timing不因新capability收紧而回归。
- inspect返回规范化静态layout/style与能力，未知auto尺寸用可区分的缺省/null，不伪装浏览器计算矩形。Client库保持通透，不读文件或缓存revision。schema/README/x-methods与真实返回更新；布局/样式和text/timing可以同一原子批次。

## 2. 持久化、重生成与AI合并

- 不能只改预览DOM或SDK旁路副本。受控生成/解析/持久化模型必须携带已接受的元素覆盖，参与真实revision与history；一次写后重新inspect、snapshot、frame/render都看到相同结果。
- 可以在单HTML内扩展受控覆盖表示，或从规范化元素模型保留差量；选择由实现决定，必须记录为何单一权威、如何校验渲染样式与覆盖记录一致、旧工程如何兼容。不要引入Host第二份工程真相或让用户手工改隐藏元数据。
- `scene.create/update/reorder/remove`、project.revise生成候选时不静默丢既有覆盖。更新同Scene普通文案/时长应保留原位置/字号；重排保持元素覆盖归属stableId；删除带人工变化的对象/结构要显式冲突/拒绝，或在明确的整Scene删除操作中给出删除影响，不悄悄“恢复模板默认”。
- **同一stableId，人工改layout/style而AI只改text可合并**，两者都保留；相同字段两边改仍written:false+conflicts，不静默覆盖。至少区分text、timing、布局/样式属性，不把整对象任何双改都一律丢弃人工内容；未知结构冲突仍保守拒绝。
- undo/redo/跨进程重开包含覆盖与实际HTML；遵循内容hash revision与historyCursor既有契约。operationId重试/键顺序不变，非法批次不写、失败不报告成功。
- layout/style edit不改GSAP timeline内容，以静态left/top/宽高作基座、动画transform继续相对运行。场景时序重生成可按原规则改timeline，但保留对应元素基座。不要把某一帧的动画偏移烘焙成永久位置。

## 3. 真实验证与交付

最少覆盖：

1. 严格params/schema/capability/范围/精度/未知键/不支持对象/混合批次原子性；operationId幂等、过期revision拒绝；旧方法回归。
2. 文字/图片位置及尺寸写回，颜色/字号/字重/对齐写回；inspect+HTML+新快照一致，旧快照不变；close/reopen与worker重启仍保持。
3. 人工位置+AI同标题文案合并成功；同属性双改冲突；scene.update更名/改时长和reorder后人工位置/样式不丢；undo/redo各恢复真实输出。
4. 受控真实浏览器/抽帧/MP4：同一工程改位置/字号后视觉确实改变，至少两个动画时刻验证基座与transform不叠加；渲染仍H.264、尺寸/fps/总时长正确。可以复用已审canvas spike驱动新能力，不能再把E_PARAMS探针当新功能通过。
5. 直接拖动的屏幕→composition→静态基座逆映射若由Host/UI负责，给必要数据与精确约定，验证代表性平移/缩放动画。不能在这里声称最终DSH拖动已接通；scope不含根插件。

版本0.3.0两包固定到`artifacts/engine/<功能提交>/`，记录完整SHA/大小/条目并逐文件对提交；新证据不覆盖旧交付。测试分项、兼容/格式决策与未测项写研究记录。普通commit/push更新PR#2，交用户转总调度复审；不自动安装/发布。

本轮交完整引擎能力与真实证据；若某项无法在现有模型安全持久化，带具体冲突/最小差异报告，不自行换成任意CSS/整文件覆盖方案。p0会话接线可持续独立推进，后续总调度整合画布与新引擎。

## 开发记录（p1-engine）

填写：2026-10-18。按本指南一次交付；开工 `git fetch origin` 成功，协调记忆使用 `origin/codex/project-foundation` @ **b69354e**。未切分支、未改全局规则、未 merge。

### 起点、范围与提交

- 工作树：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine`，分支 `codex/p1-engine-spike-b4bf`（PR #2）。
- 开工 HEAD **`ea2d1a4`**；引擎功能基线 **`df4b74f`** / 两包 0.2.1。实现提交 **`0296781`**（两包 0.3.0 + 测试 + schema/README + spike 必要适配与新证据）；本记录与研究记录另以 docs 提交。
- 范围：只改 `packages/video-engine-worker/**`、`packages/video-engine-client/**`、`spikes/editor-canvas/**` 的必要能力探针/新证据、本任务/研究记录；未改根插件/Host/其它 spike/全局规则/profile；未安装/启停/重启、未调模型、未 merge、未新 tree/PR；HyperFrames 固定 0.8.167，未加运行时依赖。
- 两包版本 0.3.0；JSONL v1 与全部原有方法保持；旧无覆盖工程可打开。

### 规范化与覆盖模型（选择与理由）

- **inline style 是唯一工程真相**：layout/style 写入受控模板叶子的行内样式；revision=HTML 字节 hash，history 快照/preview snapshot/frame/render/close/reopen/worker 重启天然一致；不引入 Host 第二份工程状态或用户不可见元数据。
- 写入走统一 `edit.ops` 单写者路径：整批先做结构/能力/范围/精度/累计 box 边界校验，再一次 SDK 受控写入（layout/style 用 SDK `setStyle`，text/timing 原有路径），flush/readback 成功后记录 history；layout/style 不修改 GSAP timeline 字节，动画 transform 保持相对。
- 重生成：用“当前 Scene 模型生成的默认文档”对比当前 HTML 得到人工差量，移植到新文档保留 stableId（scene.create/update/reorder、revise 的 AI 候选）；`scene.update` 删除带差量对象 → `E_OVERRIDE_CONFLICT`；`scene.remove` 显式执行并报告 `changeSummary.droppedOverrides`。
- 合并：`merge.mjs` 改为逐字段三方（text、timing.start/duration、attributes、class、layout.*、style.*、其余 inline style）；人工 layout/style + AI 文案合并保留双方；同字段双改不同 → `written:false + conflicts[{field,humanValue,aiValue}]`（保留旧 human/ai 摘要字段）；AI 删除人工修改或 base 已有人工覆盖对象 → `AI_DELETE_HUMAN_MODIFY`；其它 Scene 逐字节不变。
- inspect 增加规范化 `layout/style`（不支持/auto 为 null）与 `layout/style` capability；schema/x-methods/README 已同步。

### 验证与真实证据（自述，待独立复审）

- worker 单元/协议 **36/36**（16.4s）；真实链 **11/11**（133.3s，含新增布局/样式真实帧+MP4）；client **20 项：19 pass + 1 opt-in skip**（21.0s）。
- 真实视觉（`spikes/editor-canvas/evidence/p3-006b/persistence-evidence.json`）：改 title left=400/width=700/color=#ff0000/fontSize=96、logo 240×240 后，0.5s/1.5s 帧变化 11.90%/11.91%；红色标题基座 x=403/403（稳定），入场 y 仍相对（minY 208/205）；渲染帧红字 bbox minX=404 与 worker 抽帧 403 一致；11s MP4 H.264 1280×720/30fps/330 帧/11.000s。
- `scene.update` 改名/改时长保留 title 位置/颜色/字号与 logo 尺寸；人工位置/字号 + AI 文案 revise 合并成功（文案 AI、布局/字号人工）；undo→中间 revision、redo→合并 revision；close/reopen 与 worker 重启后从 revision/HTML 恢复一致。
- 能力探针（`evidence/p3-006b/capability-evidence.json`）：文字/timing/位置/尺寸/颜色字号字重对齐/人工+AI 合并持久；move/resize/color 形状、旋转/任意 CSS、字体族/多选/清除覆盖仍不支持（E_PARAMS/E_UNSUPPORTED_EDIT/README 限制）。

### 固定包（`artifacts/engine/0296781/`，ignored）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.3.0.tgz | 3 | 7408 | `718de70fadbdf1c725695606efa4f599cdbd072b802b6eb60dd8bedd49b64d62` |
| dsh-video-engine-worker-0.3.0.tgz | 14 | 52738 | `a85e5ea741748ce76fc4b2ea69f3d4ce96c4bab3e2f29852171ef4baca8a36be` |

`package-verify.json`：逐文件与 `0296781` 字节一致、重复 pack 一致；未安装、未发布；旧 `artifacts/engine/df4b74f/` 未覆盖。

### 复跑

```sh
npm test --prefix packages/video-engine-worker
npm run test:real --prefix packages/video-engine-worker
npm test --prefix packages/video-engine-client
node spikes/editor-canvas/scripts/capability-probe.mjs
node spikes/editor-canvas/scripts/persistence-evidence.mjs
```

### 未测项与风险

- 未接入真实 DSH/Host/插件；屏幕坐标→composition 静态基座的 Host 逆映射仍是 Host/UI 任务，不宣称最终拖动/缩放 UI 已接通。
- 仅受控 `product-launch-v1` 模板；任意 HTML/JS、音视频、多用户、非 macOS 未测；不支持清除覆盖/删除单元素/字体族/旋转/层级/任意 CSS。
- `scene.*` 重生成仍重置元素级 timing（既有行为）；带差量的重生成经 SDK 序列化，HTML 字节形态与 revision 会变化（内容 hash 语义正确）；未做性能与大工程压力验证。
