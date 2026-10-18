# P3-006-B 直接编辑布局/样式持久化（引擎实现）

日期：2026-10-18。执行：p1-engine 工作区；分支 `codex/p1-engine-spike-b4bf` / PR #2；开工 HEAD **`ea2d1a4`**（P3-005-B spike 交付，引擎功能基线 `df4b74f` / 两包 0.2.1）；协调记忆读取自 `origin/codex/project-foundation` @ **`b69354e`**。实现提交 **`0296781`**（与本文记录分开提交）；两包升 **0.3.0**，JSONL 协议仍为 v1，原有方法/结果语义保持。只改两个引擎包、其测试/README/schema、`spikes/editor-canvas/**` 的必要能力探针与新增证据、本任务/研究记录；未改根插件/Host/其它 spike/全局记忆/profile；未安装/启停/重启、未调模型、未 merge、未新 tree/PR。

## 结论（先行）

1. **受控 layout/style typed ops 已落地并持久化。** 统一 `edit.ops` 新增 `layout`（composition CSS px 静态基座 patch，1/1000 px 规范化、画布边界/最小尺寸校验）与 `style`（color/fontSize/fontWeight/textAlign 白名单），可与 text/timing 同一原子批次；整批先校验后一次写入，非法批次不写、operationId 幂等、revision/单写者语义不变。
2. **单一权威：工程 HTML 的 inline style。** 不引入第二份覆盖数据库/隐藏元数据；revision 覆盖 HTML 字节，history 快照、preview snapshot、frame/render、close/reopen、worker 重启都直接看到同一结果。`inspect` 返回规范化 `layout`/`style` 及 `layout`/`style` capability，auto 尺寸与未设置属性为可区分的 `null`，不伪装浏览器计算矩形。
3. **重生成不再抹掉人工布局。** `scene.create/update/reorder/remove` 与 `project.revise` 生成新文档时，把当前文档相对模板默认值的人工 layout/style 差量移植到保留 stableId 上；`scene.update` 若会删除带人工覆盖的对象返回 `E_OVERRIDE_CONFLICT`，显式 `scene.remove` 允许并报告 `changeSummary.droppedOverrides`。
4. **三方合并按字段而非整对象。** text / timing.start / timing.duration / attributes / class / layout.* / style.* / 其余 inline style 分别三方比较：人工改位置/样式而 AI 只改文案 → 合并成功、两者保留；同字段双改不同 → `written:false + conflicts[{field,humanValue,aiValue}]`；AI 删除人工改过或 base 已有人工覆盖的对象 → `AI_DELETE_HUMAN_MODIFY`。其它 Scene 逐字节不变。
5. **真实链验证：** worker 单元 **36/36**、真实链 **11/11**、client **20（19 pass + 1 opt-in skip）**；真实帧在 0.5/1.5s 两个动画时刻显示静态基座与 GSAP transform 分离（红色标题基座 x 均为 403px，入场 y 偏移仍相对），改位置/颜色/字号后帧变化约 11.9%；11s 工程 MP4 仍为 H.264 1280×720/30fps/330 帧，渲染帧中标题位置与 worker 抽帧一致；undo/redo 恢复真实 HTML 输出。
6. **固定包：** 两包 0.3.0 在 `artifacts/engine/0296781/`，逐文件与 `0296781` 字节一致、重复 pack 一致（摘要见下）。未安装、未发布。

## 协议与数据模型

### 新增 edit ops（v1 统一 edit，不新增方法）

```json
{"type":"layout","target":"scene-1-title","unit":"composition-px","box":{"left":120,"top":240}}
{"type":"style","target":"scene-1-title","styles":{"color":"#ff0000","fontSize":48,"fontWeight":600,"textAlign":"center"}}
```

- `layout.box` 非空 patch，仅 `left/top/width/height`；有限数字；单位必须 `composition-px`；按 1/1000 px 取整；`left/top ≥ 0`、`width/height ≥ 1` 且不超过画布；已知宽高时校验 `left+width`/`top+height` 不越界；**以 Scene 静态布局基座为准，不是动画帧矩形，不写 transform**。
- `style.styles` 非空；`color` #RRGGBB（accept 大小写、存小写）、`fontSize` 8–256、`fontWeight` 100–900 的 100 倍、`textAlign` left/center/right；拒绝未知键、任意 CSS 字符串、url/expression、transform/animation/zIndex；字体族/旋转/多选/层级不在 v1。
- capability 严格来自受控模板叶子：stableId 后缀 `title/subtitle/badge/rule/logo/shot`、tag 匹配、父节点是该 Scene section。`layout` 覆盖全部叶子；`style` 仅文字类（title/subtitle/badge）。root/section/未知/嵌套元素 → `E_UNSUPPORTED_EDIT`；旧 P2 legacy fixture 无 layout/style 能力，原 text/timing 路径不变。
- 混合批次在写入前完成全部校验（包括同一 target 多个 patch 的累计 box 边界）；失败返回结构化错误且 revision/HTML 不变。

### inspect 扩展

每个元素新增：`layout: {left,top,width,height}|null`、`style: {color,fontSize,fontWeight,textAlign}|null`；`capabilities` 追加 `layout`/`style`；`scenes[].elements` 同步。不支持的模板元素为 `null`；auto 尺寸/未设置属性为 `null`（不伪造计算尺寸）。schema/x-methods/README 已同步，增补 schema 对 layout/style 的严格 params/result 校验。

### 单一权威与重生成

- 选择 **inline style 作为唯一真相**：生成器/解析器仍以受控 Scene 模型为模板来源；人工差量只存在于 HTML 行内样式。这样 revision（HTML 字节 hash）、history 快照、snapshot、frame/render 天然一致，无需 Host 第二份状态或用户不可见元数据。
- 重生成路径先用“当前 Scene 模型重新生成默认文档”与当前 HTML 对比，得到 **相对模板默认值的人工 layout/style 差量**；再把差量移植到新文档（经 SDK 受控 setStyle 序列化）后统一校验/原子写。
- `scene.update` 若模板删除带差量的对象 → `E_OVERRIDE_CONFLICT`；显式 `scene.remove` 执行并在 `changeSummary.droppedOverrides` 列出 stableId/属性影响；`scene.create`/`reorder` 保留既有差量（reorder 按 stableId 归属，布局为 Scene 内坐标）。
- `project.revise` 的 AI 候选在 base 上应用 base 的人工差量，再进行字段级三方合并；base 已被人工覆盖而 AI 删除 → `AI_DELETE_HUMAN_MODIFY`。
- layout/style 编辑不改 GSAP timeline 字节；静态 left/top/宽高为基座，y/scaleX/opacity 动画继续相对运行。真实帧证据同时验证两个动画时刻的基座 x 不变、入场 y 仍相对。
- 已知限制（v1 明确保留）：无“清除覆盖”语义（patch 只能设值）；无删除单元素方法；`scene.*` 重生成仍会重置元素级 timing（沿用既有行为）；模板范围外（字体族/旋转/层级/任意 CSS/多选）不开放；带差量的 scene 重生成经 SDK 规范化序列化，HTML 字节形态可能变化但语义一致、revision 按内容重算。

## 合并冲突字段

`conflicts[]` 保留既有 `{sceneId,stableId,reason,human,ai}`，新增可选 `field`、`humanValue`、`aiValue`；字段名如 `text`、`timing.start`、`layout.left`、`style.color`、`attributes.src`、`inlineStyles.background`。结构/条件不满足时仍返回 `written:false` 且不写盘；旧消费方可继续读 human/ai 摘要。

## 验证

| 项 | 命令 | 结果 |
|---|---|---|
| worker 单元/协议 | `npm test --prefix packages/video-engine-worker` | **36/36**（原 29 + layout/style 7），约 16.4s |
| worker 真实链 | `npm run test:real --prefix packages/video-engine-worker` | **11/11**（原 10 + 布局/样式真实帧/MP4），约 133.3s |
| client | `npm test --prefix packages/video-engine-client` | **20 项：19 pass + 1 opt-in skip**（原 19 + layout/style 透传 1），约 21.0s |
| 能力探针 | `node spikes/editor-canvas/scripts/capability-probe.mjs` | 新证据 `evidence/p3-006b/capability-evidence.json`；layout/style/位置/尺寸/合并均持久，未支持形状仍 E_PARAMS/E_UNSUPPORTED_EDIT |
| 持久化视觉证据 | `node spikes/editor-canvas/scripts/persistence-evidence.mjs` | 新证据 `evidence/p3-006b/persistence-evidence.json` + 前后帧/渲染帧 PNG |

关键真实数字（`persistence-evidence.json`）：

- 改 title `left=400,width=700,color=#ff0000,fontSize=96`、logo `240×240`：0.5s/1.5s 帧变化 **11.90%/11.91%**；红色标题像素 bbox minX **403/403**（基座稳定），minY **208/205**（入场 y transform 相对运行，未被烘焙进基座）；渲染帧同帧红色 bbox minX **404**（与 worker 抽帧差 1px）。
- 11s 工程 MP4：H.264、1280×720、30fps、**330 帧**、11.000s，SHA-256 `0da1be28…`。
- `scene.update` 改名/改时长后 title 位置/颜色/字号与 logo 尺寸保留；人工 layout/style + AI 文案 `project.revise` → `written:true`，文案为 AI、布局/字号/颜色为人工；undo→中间 revision、redo→合并 revision；close/reopen、worker 重启后从 revision/HTML 重建一致。
- 真实链（`layout-style.integration.mjs`）额外验证同场景两个动画时刻的入场 y 相对性、渲染帧与 worker 抽帧位置一致。

## 兼容性与决定

- JSONL v1 与全部原有方法不变；`project.create` 的结果 schema 因 `scenes[].elements` 增字段而扩展但向后兼容（新增字段，不改旧字段）。旧工程（无 layout/style 覆盖）可打开；legacy P2 fixture 的 inspect 仍输出 `layout/style:null`。
- 选择 inline style 而非侧表/元数据：revision 是 HTML 内容 hash，侧表会引入第二真相与并发/丢同步风险；模板生成器是受控的，差量识别可确定。
- 选择字段级三方合并而非放宽整对象 conflict：P3-006-B 要求人工位置+AI 文案同时保留；同字段双改仍显式失败，避免静默覆盖。
- 选择 `E_OVERRIDE_CONFLICT`（scene.update）而非静默恢复模板默认：符合“不静默丢人工调整”；删除整 Scene 仍可显式执行并报告影响。

## 固定包（`artifacts/engine/0296781/`，ignored artifacts）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.3.0.tgz | 3 | 7408 | `718de70fadbdf1c725695606efa4f599cdbd072b802b6eb60dd8bedd49b64d62` |
| dsh-video-engine-worker-0.3.0.tgz | 14 | 52738 | `a85e5ea741748ce76fc4b2ea69f3d4ce96c4bab3e2f29852171ef4baca8a36be` |

`package-verify.json`：两包每个文件与 `0296781` 逐字节一致、重复 `npm pack` 字节一致；worker 14 文件=README/package.json/protocol.schema.json + 11 个 src/*.mjs（新增 `src/layout.mjs`）。包未安装、未发布；旧 `artifacts/engine/df4b74f/` 保留不覆盖。

## 未测项 / 风险

- 未接入真实 DSH/Host/插件；未实现屏幕坐标→composition 静态基座的 Host 逆映射（P3-005-B 仅给契约），正式拖动/缩放 UI 仍属 Host/UI 任务。
- 仅受控 `product-launch-v1` 模板；任意 HTML/JS、不可信素材、音视频、多用户并发、非 macOS 未测；不做任意 CSS/transform/脚本执行。
- 未测性能（差量移植/字段合并对大工程的复杂度）、极值画布组合、长时间 undo 链；带差量的 scene 重生成经 SDK 序列化，HTML 字节形态变化（revision 变化符合内容 hash 契约），需 Host 以 revision 而非字符串比较为准。
- 未验证 UI 层拖动/对齐线/浮动工具条与 `style` 工具条的完整交互；不宣称最终画布已交付。
