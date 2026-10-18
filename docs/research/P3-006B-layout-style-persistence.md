# P3-006-B 直接编辑布局/样式持久化（引擎实现）

日期：2026-10-18。执行：p1-engine 工作区；分支 `codex/p1-engine-spike-b4bf` / PR #2；开工 HEAD **`ea2d1a4`**（P3-005-B spike 交付，引擎功能基线 `df4b74f` / 两包 0.2.1）；协调记忆读取自 `origin/codex/project-foundation` @ **`b69354e`**；R1–R2 修复轮 fetch 协调提交 **`12e3995`**（P3-006B 复审与 BUG-001 登记）。实现提交 **`0296781`**（第一版）经独立复核后以 **`4c087ef`** 修正覆盖表示与打包可复现性；P3-006-B 复审 R1–R2 后再以 **`74294e6`** 修复旧 base 覆盖意图与无标记差量并集，**最终交付为 `74294e6`**；两包升 **0.3.0**，JSONL 协议仍为 v1，原有方法/结果语义保持。只改两个引擎包、其测试/README/schema、`spikes/editor-canvas/**` 的必要能力探针与新增证据、本任务/研究记录；未改根插件/Host/其它 spike/全局记忆/profile；未安装/启停/重启、未调模型、未 merge、未新 tree/PR。

## 结论（先行）

1. **受控 layout/style typed ops 已落地并持久化。** 统一 `edit.ops` 新增 `layout`（composition CSS px 静态基座 patch，1/1000 px 规范化、画布边界/最小尺寸校验）与 `style`（color/fontSize/fontWeight/textAlign 白名单），可与 text/timing 同一原子批次；整批先校验后一次写入，非法批次不写、operationId 幂等、revision/单写者语义不变。
2. **单一权威：工程 HTML 的 inline style + 受控覆盖标记。** 不引入第二份覆盖数据库/隐藏元数据；显式人工属性用 `data-dv-managed="left top color ..."` 记录在元素上，因此“人工选了一个恰好等于当前模板默认的值”也能与模板默认区分；收集覆盖时**标记与差量取并集**，首次建立标记不会丢弃其它无标记的可表达差量（R2）；revision 覆盖 HTML 字节，history 快照、preview snapshot、frame/render、close/reopen、worker 重启都直接看到同一结果。`inspect` 返回规范化 `layout`/`style` 及 `layout`/`style` capability，auto 尺寸与未设置属性为可区分的 `null`，不伪装浏览器计算矩形。
3. **重生成不再抹掉人工布局。** `scene.create/update/reorder/remove` 与 `project.revise` 生成新文档时，把当前文档相对模板默认值的人工 layout/style 差量移植到保留 stableId 上；`scene.update` 若会删除带人工覆盖的对象返回 `E_OVERRIDE_CONFLICT`，显式 `scene.remove` 允许并报告 `changeSummary.droppedOverrides`。
4. **三方合并按字段而非整对象，并保护显式声明时机（R1）。** text / timing.start / timing.duration / attributes / class / layout.* / style.* / 其余 inline style 分别三方比较：人工改位置/样式而 AI 只改文案 → 合并成功、两者保留；**base 之后新增的显式覆盖即使值等于模板默认也按人工意图保护**——AI 仅改 Scene 默认值时保留人工字段并允许其它默认更新，AI 删除该对象 → `AI_DELETE_HUMAN_MODIFY`；同字段双改不同 → `written:false + conflicts[{field,humanValue,aiValue}]`；无变化 AI 不误冲突。其它 Scene 逐字节不变。
5. **真实链验证：** worker 单元 **38/38**、真实链 **11/11**、client **20（19 pass + 1 opt-in skip）**；真实帧在 0.5/1.5s 两个动画时刻显示静态基座与 GSAP transform 分离（红色标题基座 x 均为 403px，入场 y 偏移仍相对），改位置/颜色/字号后帧变化约 11.9%；11s 工程 MP4 仍为 H.264 1280×720/30fps/330 帧，渲染帧中标题基座 x 与 worker 抽帧一致（发现既有渲染器/模板底部黑带，见下）；undo/redo 恢复真实 HTML 输出。
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

- **显式覆盖标记**：layout/style edit 会在目标元素写入 `data-dv-managed="<managed props>"`（如 `left top color`）。它区分“人工显式设置”与“模板默认”：即使人工值恰好等于当前默认，后续 Scene 级默认变化（例如 accent 改色影响 badge/subtitle 默认色）也不会静默改写该属性；`scene.update` 删除该对象会显式冲突。重生成时标记随元素迁移；合并模型把该属性视为受控元数据、不参与内容冲突，保留 human 侧标记。无标记的文件（外部手改/旧数据）按“与当前模板默认值的差异”回退识别，仍能保留外部手改的可表达差量。
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
| worker 单元/协议 | `npm test --prefix packages/video-engine-worker` | **40/40**（原 29 + layout/style 7 + 覆盖标记/回退 2 + R1/R2 回归 2），约 29.1s |
| worker 真实链 | `npm run test:real --prefix packages/video-engine-worker` | **11/11**（原 10 + 布局/样式真实帧/MP4），约 132.3s |
| client | `npm test --prefix packages/video-engine-client` | **20 项：19 pass + 1 opt-in skip**（原 19 + layout/style 透传 1）。本轮首跑 18 pass + 1 fail + 1 skip（既有 200ms protocol fixture 超时），不改源码复跑 19 pass + 1 skip；与复审观察一致，作为既有测试稳定性记录，不是 R1/R2 生产差异 |
| 能力探针 | `node spikes/editor-canvas/scripts/capability-probe.mjs` | 新证据 `evidence/p3-006b/capability-evidence.json`；layout/style/位置/尺寸/合并均持久，未支持形状仍 E_PARAMS/E_UNSUPPORTED_EDIT |
| 持久化视觉证据 | `node spikes/editor-canvas/scripts/persistence-evidence.mjs` | 新证据 `evidence/p3-006b/persistence-evidence.json` + 前后帧/渲染帧 PNG |

关键真实数字（`persistence-evidence.json`）：

- 改 title `left=400,width=700,color=#ff0000,fontSize=96`、logo `240×240`：0.5s/1.5s 帧变化 **11.90%/11.91%**；红色标题像素 bbox minX **403/403**（基座稳定），minY **208/205**（入场 y transform 相对运行，未被烘焙进基座）；渲染帧同帧红色 bbox minX **404**（与 worker 抽帧差 1px）。
- 11s 工程 MP4：H.264、1280×720、30fps、**330 帧**、11.000s，SHA-256 `0da1be28…`。**已知既有问题：** 管理模板 720p 的 MP4 底部 86 行（y=634–719）为黑，worker 抽帧同帧无黑边（0 行）；该问题在未改 layout/style 的 baseline 渲染中同样存在，与本任务无关，证据 `knownIssue` 已记录，需要单独 ticket 修复；因此这里只声称 MP4 元数据/标题基座 x 与 worker 帧一致，不声称整帧像素 parity。
- `scene.update` 改名/改时长后 title 位置/颜色/字号与 logo 尺寸保留；人工 layout/style + AI 文案 `project.revise` → `written:true`，文案为 AI、布局/字号/颜色为人工；undo→中间 revision、redo→合并 revision；close/reopen、worker 重启后从 revision/HTML 重建一致。
- 真实链（`layout-style.integration.mjs`）额外验证同场景两个动画时刻的入场 y 相对性、渲染帧与 worker 抽帧位置一致。

## 兼容性与决定

- JSONL v1 与全部原有方法不变；`project.create` 的结果 schema 因 `scenes[].elements` 增字段而扩展但向后兼容（新增字段，不改旧字段）。旧工程（无 layout/style 覆盖）可打开；legacy P2 fixture 的 inspect 仍输出 `layout/style:null`。
- 选择 inline style 而非侧表/元数据：revision 是 HTML 内容 hash，侧表会引入第二真相与并发/丢同步风险；模板生成器是受控的，差量识别可确定。
- 选择字段级三方合并而非放宽整对象 conflict：P3-006-B 要求人工位置+AI 文案同时保留；同字段双改仍显式失败，避免静默覆盖。
- 选择 `E_OVERRIDE_CONFLICT`（scene.update）而非静默恢复模板默认：符合“不静默丢人工调整”；删除整 Scene 仍可显式执行并报告影响。

## 复审 R1–R2 修复（2026-10-18 第二轮）

复审结论 R1–R2 均属覆盖语义，按原任务范围一次修复，未新增调查、未改渲染器（黑带仍归 BUG-001）。

- **R1：旧 base 三方合并忽略 base 之后新增显式覆盖。** merge model 的字段分析新增每侧 `declared` 集合（由 `data-dv-managed` 映射到 layout./style. 字段）。合并时：人工在 base 之后新增声明、AI 候选只是模板默认漂移 → 人工显式值获胜，其它字段/默认照常接受 AI（不再静默改色）；AI 删除该元素 → `AI_DELETE_HUMAN_MODIFY`；双方都新增同字段且值不同 → `BOTH_MODIFIED`；AI 未变化 → `written:true` 无误冲突。普通“人工布局 + AI 文案”合并与同字段文字冲突行为保持不变。
- **R2：无 marker 工程首次 typed edit 后原差量失去保护。** `collectManualOverrides` 从“有 marker 只看 marker”改为 **marker ∪ 当前默认差量**：新增 marker（如改 color）不会让同一/其它元素上已有的无标记差量（如 left=240）在下次重生成丢失；反向“无标记样式 → typed layout → 重生成”同理。回归覆盖重开与 undo/redo。
- 回归全部走公开 worker JSONL 的 `project.create/edit/project.revise/scene.update/inspect`，未改写复审探针；新增 2 个公共 API 回归测试（R1 3 个场景、R2 双向 + 重开/撤销重做）。

## 固定包（`artifacts/engine/74294e6/`，ignored artifacts）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.3.0.tgz | 3 | 7408 | `718de70fadbdf1c725695606efa4f599cdbd072b802b6eb60dd8bedd49b64d62` |
| dsh-video-engine-worker-0.3.0.tgz | 14 | 54582 | `0aa1b820d622dda59b8407f7d037ebc5ffd5827b70b7fcad1cb300f50b525659` |

`package-verify.json`：两包每个文件与 `74294e6` 逐字节一致、重复 `npm pack` 字节一致，并且用 `git archive 74294e6` 的干净检出重新 `npm pack` 得到相同 SHA-256；worker 14 文件=README/package.json/protocol.schema.json + 11 个 src/*.mjs（新增 `src/layout.mjs`）。包未安装、未发布；旧 `artifacts/engine/df4b74f/`、`4c087ef/` 均保留不覆盖。

## 未测项 / 风险

- 未接入真实 DSH/Host/插件；未实现屏幕坐标→composition 静态基座的 Host 逆映射（P3-005-B 仅给契约），正式拖动/缩放 UI 仍属 Host/UI 任务。
- 仅受控 `product-launch-v1` 模板；任意 HTML/JS、不可信素材、音视频、多用户并发、非 macOS 未测；不做任意 CSS/transform/脚本执行。
- **既有渲染底部黑带**：管理模板 720p MP4 底部 86 行为黑（worker 抽帧正常；baseline 也可复现），与本任务无关，需另立 ticket；在此之前 MP4 视觉整帧 parity 不作为验收项。
- 未测性能（差量移植/字段合并对大工程的复杂度）、极值画布组合、长时间 undo 链；带差量的 scene 重生成经 SDK 序列化，HTML 字节形态变化（revision 变化符合内容 hash 契约），需 Host 以 revision 而非字符串比较为准。
- 无 `data-dv-managed` 标记的外部手改只能按“与当前模板默认值差异”识别：值恰好等于默认的外部改动无法与默认区分（edit op 写入的显式覆盖有标记，不受影响；R2 的并集规则只保证差异类外部差量不丢）。
- client 协议 fixture 的 200ms 超时在负载下偶发（复审已记录），本轮首跑复现一次、不改源码复跑通过；未归因/扩大生产超时。
- 未验证 UI 层拖动/对齐线/浮动工具条与 `style` 工具条的完整交互；不宣称最终画布已交付。
