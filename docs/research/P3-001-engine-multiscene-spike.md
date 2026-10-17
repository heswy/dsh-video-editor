# P3-001 多 Scene 工程与人工/AI 修订合并引擎可行性 spike

日期：2026-10-17。执行：程序员 1；工作树 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`，分支 `codex/p1-engine-spike-b4bf`；开工 HEAD `54f4671`（P2-003 已验收）。本轮只新增 `spikes/p3-multiscene/**` 与文档，未改 `packages/video-engine-*`、根插件或全局规则；固定 HyperFrames 0.8.167，未升级依赖、未运行 postinstall；不调模型 API，AI 重写由受控模板脚本生成；未安装/重启 DSH、未 merge main。结论与提案严格区分。

## 结论（先行）

1. **Q1 推荐 B：单 HTML 文档 + Scene 区段 + 单一 master timeline。** A（嵌套 composition）与 B 都能被官方 CLI/Player 正确渲染、seek（各 450 帧 / 15.000s / 1280×720 / 30fps，场景颜色在边界与中点正确），但 A 的根文档在 SDK 中只有 5 个元素（4 个 host + 根），现有 inspect/edit 看不到也无法编辑子 Scene 元素（真实 worker 编辑返回 `E_UNSUPPORTED_EDIT`）；A 要可用必须新增逐 Scene 文件路由。B 的 SDK 直接看到 29 个元素、4 个 Scene，现有 typed edit 可作用于 Scene 内对象，是 Q5 与 P3-003 成本最低的路线。C（多入口 + manifest）**被官方 CLI 直接拒绝**：`No composition found … No index.html file found`，`-c` 单独指定 composition 也不能绕过；没有聚合渲染命令，不满足单一工程/单一 revision/seek 语义。
2. **Q5 三方合并可在 B 上端到端验证。** 人工用现有 worker typed edit 修改 Scene2 标题；受控脚本基于 baseRevision 重写 Scene2 候选；按 stableId 三方合并：不同对象改动自动合并并渲染成帧；同对象双改返回 `BOTH_MODIFIED`；AI 删除人工改过对象返回 `AI_DELETE_HUMAN_MODIFY`；AI 新增被采纳、人工新增被保留；Scene 级时间/顺序、tag/parent/嵌套变化与改动其它 Scene 一律显式返回结构化冲突，不静默覆盖。
3. **Q3 Scene 生命周期不能靠 SDK 结构 API 单独完成。** `addElement`/`removeElement` 能改 DOM 并持久化，但根 `data-duration` 与手写 master timeline 不会同步；`setAttribute("data-start")` 被 SDK 拒绝（提示改用 typed `setTiming`），而 `setTiming` 会启发式改 timeline，实测把 Scene2 reveal 从 4 改成 12 同时留下 hide@8，语义矛盾。推荐 **模板模型 → 受控整文件重写（HTML + master timeline 一起重新生成）→ SDK 重开校验 → 原子写入 → revision 重算**；单写者队列内串行，校验失败不发布。
4. **Q7 现有静态 registry 必须重启 worker 才能看到新工程**：运行中改写 registry 文件无效（`E_PROJECT_NOT_FOUND`），重启 + open 本机约 377ms；root 外工程被 `E_PATH` 拒绝；重启后注册持久。推荐 worker 管理 `projectsRoot` + 持久 registry + 新 `project.create`（未实现，提案），Host 重启作为回退。
5. **Q6 操作日志/撤销可跨进程恢复**，但需注意 revision 是内容哈希：undo 恢复旧内容时 revision 回到旧值而不是新值；历史另行追加 undo/redo 动作。若 P3 契约要求“undo 产生新 revision”，需新增单调 revision 序号（提案）。
6. **Q8 15 秒成片已通过真实 worker**：render succeeded 16388ms，H.264 1280×720 30fps、450 帧、15.000s；Scene 边界/中点帧颜色正确；乱序 seek 与重启后 reopen 帧字节完全一致；取消在 700ms 后 ack `cancelling`，最终 `cancelled`（清理约 6.5s），无产物、输出目录不变、client 仍可用。
7. **Q2 扩展 inspect 原型可用**：仅从内容 HTML 重建 4 个 Scene（sceneId/order/start/duration、每 Scene 6 个对象、stableId/capabilities），文件被手改后下一次 inspect 反映新文本与新 revision，不依赖第二份内容真相；现有 `capabilities()`（text/timing）在 B 上按预期工作（标题 `[text,timing]`、图片 `[]`、Scene section 仅 `timing`）。

推荐工程形态（提案，供 P3-002 冻结）：

- 单 `index.html` 权威：`#main[data-composition-id][data-duration=15]`，4 个 `<section data-scene-id data-scene-order data-start data-duration>`，每 Scene 内对象 `data-hf-id="sceneId-elementId"`；一个手写/生成的 master GSAP timeline 按全局时间控制 section 可见性与对象动画。
- Scene 内容模型保存 **Scene 局部时间**；生成单文档时把 `data-start` 换算为 `scene.start + localStart`（本轮踩到的关键实现规则）。
- 所有 Scene 结构变化（create/remove/reorder/时长变化）由同一生成器重新生成整个文档 + timeline，再校验；元素级人工/AI 修改走 stableId 三方合并后只替换目标 Scene 区段。

## 环境与可追溯

| 项目 | 值 |
|---|---|
| Node / npm | v24.14.0 / 11.9.0（PATH） |
| HyperFrames | `hyperframes` 0.8.167、`@hyperframes/sdk` 0.8.167、GSAP 3.15.0（`spikes/p3-multiscene/package-lock.json`） |
| Chrome / FFmpeg | 本机 Google Chrome；ffmpeg/ffprobe 在 PATH（沿用 P1 约定） |
| 真实 worker/client | `packages/video-engine-worker` / `packages/video-engine-client`（已验收，未改） |
| 安装 | `npm install --prefix spikes/p3-multiscene --ignore-scripts --no-audit --no-fund --cache spikes/p3-multiscene/.cache/npm`；esbuild 等安装脚本未运行 |

所有 fixture 由 `scripts/lib/scene-templates.mjs` 生成：1280×720、30fps、15 秒、4 个 Scene（4/4/4/3 秒），每 Scene 含中文标题、副标题、徽标、Logo、截图、底线、局部 GSAP 动画。素材为自造纯色 PNG（Logo `#facc15`，截图 `#22d3ee/#a3e635/#f472b6/#c084fc`），无真实用户素材。

## Q1 多 Scene 权威表示

| 候选 | 实现 | CLI `compositions` | SDK 从根文档可见 | 渲染 15 秒 | 结论 |
|---|---|---|---|---|---|
| A 嵌套 composition | `index.html` master + 每 Scene 一个 `compositions/scene-N.html`，host `div[data-composition-src]` + `data-start/duration/track-index` | 通过：main(15s) + 4 个子 composition（含 source） | **只有 5 个元素**：根 + 4 个空 host；子 Scene 文件单独可编辑（7 元素、4s） | H.264 450 帧、15.000s、1280×720、30fps；渲染 16927ms；SHA-256 见证据 | 渲染可行，但现有 inspect/edit 不能编辑子 Scene；要支持需逐 Scene 文件路由（新工作） |
| **B 单文档 Scene 区段** | 单 `index.html`，4 个 section + master timeline | 通过：main(15s)、4 个 section | **29 个元素**、4 个 scene section，现有 typed edit 直接可用 | H.264 450 帧、15.000s、1280×720、30fps；渲染 17667ms；**worker 渲染 SHA 与 CLI 渲染完全一致** | **推荐** |
| C 多入口 + manifest | 每 Scene 一个 composition 文件 + 自定义 manifest，无聚合入口 | 失败：`✗ No composition found … No index.html file found` | 只能逐文件打开 | `render` 与 `render -c compositions/scene-1.html` 均同样失败 | 不推荐：官方 CLI 无聚合入口，需自建拼接渲染，破坏单一工程/revision/seek 语义 |

单 Scene 重写隔离（B）：仅替换 Scene2 section（改标题与主色）后，Scene1/3/4 的 section HTML **逐字节相同**；渲染帧 1.5/9.5/13.5 秒 SHA 不变（`d47469e61434…`、`577e28f338ab…`、`0cec6d7ff08b…`），5 秒帧 SHA 由 `62581c963418…` 变为 `76c4c4716a42…`。这满足“单 Scene 可单独重写而不破坏其它 Scene”，且保持 revision 覆盖整份文档。

关键失败证据（A）：真实 worker `open("nested")` 只返回 5 个元素（`hf-main` + 4 个 host）；`edit({target:"scene-1-title"})` 返回 `E_UNSUPPORTED_EDIT`（stage `edit`）。A 的子 composition 文件本身可被 SDK 打开（7 元素、duration 4），因此逐 Scene 编辑是可行的，但属于 P3-003 新路由工作。

B 的实现注意：单文档内元素的 `data-start/data-duration` 是**全局合成时间**。本轮最初把 Scene 局部时间直接写进 section 子元素，导致第 2 秒后文字/线条因时间窗口过期不渲染；改为 `scene.start + localStart` 后帧内容正确（帧 4/4.1/6 的 SHA 随之不同：`7830f1d5…`/`cd71e1e6…`/`37f8457d…`）。这正是 Scene 模型需保存局部时间、生成时换算的证据。

## Q2 稳定 ID 与 inspect 扩展

- 现有 worker inspect（B）：29 个元素、`stableId` 为 data-hf-id、4 个 `*-section`；**没有 Scene 元数据**（`hasSceneMetadata: false`）。元素 capability 正确：`scene-2-title` → `["text","timing"]`（start 4/duration 4），Logo/截图 → `[]`。
- 原型扩展 inspect（`scripts/lib/doc.mjs`）：从内容 HTML 解析 4 个 Scene：`scene-1/2/3/4` order 0..3，start 0/4/8/12，duration 4/4/4/3，每 Scene 6 个对象；输出 `{sceneId, order, start, duration, elements:[{stableId, tag, text, timing, capabilities}]}`。文件被手改后，下一次 inspect 的 revision 由 `bed025a7…` 变为 `f9c127d5…`，Scene3 标题同步变化，说明索引从内容重建、没有第二份真相。
- 稳定 ID 方案（提案）：对象 ID 沿用现有 `data-hf-id`，要求全局唯一且带 Scene 前缀（`sceneId-elementId`，如 `scene-2-title`）；Scene ID 由 section `data-scene-id` 提供；inspect 同时返回元素所属 `sceneId`。重写 Scene 时 AI 只能复用已有 ID 或新增带该 Scene 前缀的 ID；新增/删除/改 ID 不能自动合并（见 Q5），由显式 Scene 操作或人工协调。Scene 索引不进入 revision；revision 仍为 `entry + assets` 清单哈希，Scene 结构变化通过整文件重写自然进入 revision。
- 嵌套 A 下 capabilities 的边界：从根文档只能看到 host（空 div 有 `data-composition-id` → 无 timing；无文本），子 Scene 的 text/timing 必须在逐文件 inspect 中计算；不能把根 inspect 当作完整能力清单。

## Q3 Scene 操作可行边界

SDK 公开结构面板（0.8.167）：`addElement(parent,index,html)`、`removeElement(id)`、`setAttribute`、`setStyle`、`setText`、`setTiming`、`batch/flush/serialize`；**没有 Scene/timeline 级 API**，master timeline 是文档文本。

| 操作 | SDK 实测 | 问题 |
|---|---|---|
| `addElement` 新 Scene | DOM 插入成功，minted id `scene-5-section`，`flush` 无 persist:error，磁盘存在新 section | 根 `data-duration` 仍 15，master timeline 无新 Scene 的可见性/时间契约 |
| `removeElement` 删除 Scene4 | DOM 删除成功、持久化成功 | 根 duration 仍 15，timeline 仍引用 `#scene-4`，留下空档 |
| `setAttribute("data-start","8")` | **被拒绝**，SDK 要求用 typed `setTiming` | 结构属性不能随意改 |
| `setTiming(scene-2-section,{start:8})` | data-start 变为 8；但 timeline 条目被启发式改写：`scene-2:1@4,0@8` → `scene-2:1@12,0@8`（reveal 与 hide 矛盾） | 场景时间变化必须整文件重新生成 timeline |
| 受控整文件重写（交换 Scene1/2 时间） | SDK `buildDocument` 校验通过（15s/1280×720/Scene 集合），CLI 帧颜色在 0s/4s 变为新顺序（`#0f766e`/`#1d4ed8`），worker revision 由 `bed025a7…` 变为 `ba6ff282…` | 推荐路径 |
| 无效重写（重复 sceneId） | `validateDocument` 拒绝（`missing scenes: scene-1`），未调用原子写入，项目文件 SHA 不变 | 失败不发布 |

建议写入模型（提案）：`scene.create/update/remove/reorder` 只改 Scene 模型集合 → 模板生成完整 HTML（section 顺序、全局 data-start/duration、master timeline）→ SDK 重开校验（尺寸、总时长、Scene ID 集合、ID 唯一、capability/时长边界）→ 原子写 `index.html` → 重算 revision 并返回变更摘要；`expectedRevision` 不匹配、校验失败或 persist 失败均不发布，旧 revision 保持可读。同一工程单写者串行队列（沿用现有 worker 工程队列）。元素级 text/timing 可继续用现有 typed edit；Scene 结构操作不能混在元素编辑里。

## Q4 素材

- 自造 Logo PNG 430B（SHA-256 `e6e04d26ab9f…`），4 张 250×150 截图（SHA-256 `4066b3e7…`、`b2f5eb58…`、`c4e2514a…`、`14bfb799…`）。
- 8 个声明资产（gsap、字体、Logo、4 截图）进入 `project.json` → worker revision；把 Logo 字节替换为红色后 revision 由 `bed025a7…` 变为 `babe18bd…`，恢复原字节后 revision 回到 `bed025a7…`。
- 渲染/抽帧中 Logo 采样 `#f7cb14`（源码 `#facc15`，Chrome 截图色彩管理偏差约 3/255），截图采样 `#a1e533`（源码 `#a3e635`），证明素材真实进入成片。
- 限额建议（提案）：仅 PNG/JPEG，Logo/单截图 ≤8MiB，单工程 ≤16 个资产、≤64MiB；文件大小/签名/尺寸校验后进入 manifest 与 revision；字体不入 Git/外包，沿用部署配置。现有 worker 上限是 manifest ≤64 资产、单文件 ≤64MiB、工程 ≤128MiB。

## Q5 人工/AI 修订合并（最重要）

### 场景与方法

1. 单文档 B 工程，base revision `bed025a7…`；人工用**现有 worker typed edit** 修改 Scene2 标题 text 与 timing（`start:4,duration:3.75`，全局时间），新 revision `59e1bbfa…`，inspect 确认标题与 timing 生效。
2. 受控脚本基于 base revision 的同一模板生成 AI 候选文档（模拟 AI 重写 Scene2），不调模型。
3. 合并原型：对 base/human/AI 三份文档解析出每 Scene 的元素快照（`stableId`、tag、text、start/duration、attributes、classNames、inlineStyles、parent/depth），按 stableId 三方比较；签名包含结构字段与顺序检测，target Scene 之外的 Scene 不允许被 AI 改动。输出合并后的 Scene section HTML，替换 human 文档中的目标 section，其余 section 原样保留；再用 SDK 校验整文档（尺寸/总时长/Scene 集合/ID 唯一）后原子写入。

### 分支结果（真实 worker + 成帧）

| 场景 | AI 相对 base | 人工相对 base | 结果 |
|---|---|---|---|
| S1 不同对象 | 改 Scene2 subtitle | 改 Scene2 title/timing | **合并成功**，标题保留人工值、副标题采用 AI；新 revision `5a94164b…`，帧 5s 为合并后文档（SHA `8db9e9fb…`） |
| S2 同一对象 | 改 title | 改 title | **冲突** `BOTH_MODIFIED`，返回 `{sceneId,stableId,reason,human,ai}` 双方摘要；不写入 |
| S3 AI 删除人工改过对象 | 删除 badge | 改 badge 文本 | **冲突** `AI_DELETE_HUMAN_MODIFY`（human summary 为“人工改徽标”） |
| S4 AI 新增 | 新增 `scene-2-note` | 改 title | **合并成功**，新增元素被采纳、人工标题保留；新 revision `0b26e2fd…`，渲染帧含新对象 |
| S5 Scene 级时间 | Scene2 duration 改 3 | 改 title | **冲突** `SCENE_META_CHANGED`（需显式 Scene 操作） |
| S6 结构变化 | 改 `<h1>` → `<div>` | 改 title | **冲突** `STRUCTURAL_TAG`；tag/parent/嵌套变化交人工 |
| S7 人工新增 | 改 subtitle | 新增 `scene-2-human-note` | **合并成功**，人工新增保留、AI 改动采纳 |
| 单元补充 | AI 删除未被人工改的对象 | — | 合并成功（删除被接受） |
| 单元补充 | AI 改动未请求的其它 Scene / 整场景重排 | — | `STRUCTURAL_OTHER_SCENE` / `STRUCTURAL_ORDER` 拒绝，避免 AI 越权改其它 Scene |

单元测试 12/12 通过（`test/doc.test.mjs`、`test/merge.test.mjs`），覆盖上述自动合并、显式冲突、删除/新增、顺序位移不产生假冲突、其它 Scene 保护与校验拒绝。

### 合并算法（最小实现，提案）

```
parse(base), parse(human), parse(ai) → targetScene elements keyed by stableId
for id in union:
  if id only in base: deleted by both → absent
  if in base and human, absent in ai:
      human == base ? delete : CONFLICT(AI_DELETE_HUMAN_MODIFY)
  if in base and ai, absent in human:
      ai == base ? delete : CONFLICT(HUMAN_DELETE_AI_MODIFY)
  if in all three:
      structural change (tag/parent/depth) → CONFLICT(STRUCTURAL_*)
      no side changed → base/human
      only human changed → human
      only ai changed → ai
      both changed and equal → that value
      both changed differently → CONFLICT(BOTH_MODIFIED)
  if added by human & ai: equal → add; different → CONFLICT(ADD_ADD)
  if added by human only: keep;  if added by AI only: adopt
serialize merged section (template-constrained, flat element depth) with human order + additions
splice into human document; other sections byte-identical
validate document (SDK) → atomic write → recompute revision
```

冲突返回固定结构：`{sceneId, stableId, reason, human:{present,text,timing,tag}, ai:{...}, hint?}`；不允许“取最新 revision 强写”。当前实现受模板约束（Scene 内一层元素、由生成器序列化）；通用 DOM 级合并、保留手工格式/未知样式不在本轮实现范围。

## Q6 操作日志、撤销/重做与重开

原型：工程 `.dsh-video/history/` 下 `entries.jsonl`（内容 revision 快照链）、`ops.jsonl`（动作，含 actor/kind/sceneId/summary/from/to）、`snapshots/<revision>.html`、`state.json`（cursor）；历史目录不在 `project.json` 声明清单内，**不进入 revision**。

实测：人工 typed edit 与 AI 合并各记一条；`entries=3, ops=2, snapshotBytes=21096`；undo 返回人工 revision、redo 返回 AI revision，worker inspect 与历史返回一致；进程重启后可重新 open（revision 一致）、历史仍在、重启后 undo 仍恢复到人工 revision；AI 与人工操作均可撤销（undo 两次回到初始 revision，redo 回到 AI revision）。

重要语义：revision 是内容哈希，**undo 恢复旧内容后 revision 等于旧 revision 值**，历史只新增一条 undo 动作（本轮实测 revision 从 AI 值回到 human 值再回到初始值）。“undo 产生新 revision”若按字面要求，需要新增单调 revision 序号或 operation seq 作为契约字段（提案），不能篡改内容哈希定义。日志上限建议（提案）：保留最近 64 条/快照总量 ≤8MiB（原型常数），超出裁剪最旧；snapshot 按内容哈希去重；日志只作历史/撤销辅助，不是内容第二真相。

## Q7 工程创建与动态注册

- 运行中的 worker 只读启动时 registry：未知 `late` → `E_PROJECT_NOT_FOUND`；Host 在运行中创建目录并改写 registry 文件后再次 `open("late")` 仍 `E_PROJECT_NOT_FOUND`（内存配置未重载）。
- 重启 worker 后 open 成功；重启+open 本机约 **377ms**；同一注册在第二次重启后仍可 open。
- registry 指向 projectsRoot 之外的工程 → `E_PATH`（root containment 生效）。
- 两方案（提案）：**worker 管理 `projectsRoot` + 持久 registry + `project.create`**（复制模板、校验 projectId/realpath、原子写 registry、启动 reload、单写者；推荐，`project.create` 本身未实现）或 **Host 重启 worker**（实测可行，代价 ~377ms、丢失暖 worker 与内存 operationId 缓存、不能打断渲染，回退方案）。Host 不应直接改写 worker 文件。

## Q8 渲染与检查

真实 worker（非 CLI 直调）15 秒链：

- render：`succeeded`，16388ms，H.264 **1280×720 / 30fps / 450 帧 / 15.000s**，MP4 SHA-256 `8f7046d85e8f…`；该 SHA 与 Q1 直接 CLI 渲染 B 完全相同，证明固定快照+引擎输出可复现。
- Scene 边界与中点 PNG（worker frame，13 个时间点）：1.5/3.9 秒 Scene1，4.1/6/7.9 秒 Scene2，8.1/9.5/11.9 秒 Scene3，12.1/13.5 秒 Scene4 背景色正确；恰好 4.0/8.0/12.0 秒时新 Scene 已显示但其入场动画从边界开始（如 4.0 时标题尚未出现），边界归属“下一 Scene”语义明确。帧耗时约 4.2–4.8s。
- 乱序 seek：另一 worker 实例按 [13.5,0.5,8.1,4.1,12.1,6,3.9,9.5,12,7.9,4,11.9] 请求，与顺序请求的 12 个帧 **SHA 全部一致**；重启 worker 后 reopen 的 6s/13.5s 帧也与顺序一致。
- 取消：render 启动约 700ms 后 cancel → ack `cancelling`，最终 `cancelled`（含清理约 6524ms），`artifact: null`，输出目录文件集合不变，随后 frame 仍 succeeded、client 可用。符合现有“不发布半成品、只清理自有进程”语义；本轮未新增实现。

## 已验证 vs 提案

- **已验证（本轮本机证据）**：A/B/C 结构与 CLI/SDK 行为；B 的整文件渲染、seek、单 Scene 重写隔离；真实 worker 的 typed edit、15 秒 render/帧/取消；scene 结构 SDK 能力与失败；三方合并主要分支及冲突结构；历史/undo/redo/重启；静态 registry/重启/路径约束；素材进入 revision 与成片；扩展 inspect 从内容重建。
- **提案（未实现，供 P3-002/003 冻结）**：单文档 Scene 模型与生成器规则；扩展 inspect schema；`scene.create/update/remove/reorder`、`project.create`、`project.revise/merge`、`history/undo/redo`、`asset.put` 方法与错误码（可沿用 `E_REVISION_CONFLICT/E_CONFLICT/E_PARAMS/E_TEMPLATE/E_SCENE_NOT_FOUND/E_PERSIST/E_LIMIT`）；merge 冲突 schema；内容哈希 + 单调 revision/operation seq；worker 管理 projectsRoot 的动态 registry；素材限额。
- **未验证/风险**：嵌套 A 的逐 Scene 编辑路由未实现（子文件单独 SDK 编辑已证明可行，但 root→scene 的 inspect/edit/frame 路由、revision 覆盖仍需实现）；未测试真实 Studio UI 的连续 seek/播放交互（本轮用官方 CLI/Player capture 验证）、未在多浏览器/GPU/跨平台验证；B 的 exact-boundary 帧语义已记录但未定义 UI 策略；StaticGuard 对 master timeline 初始 opacity 给出警告（`Full-frame overlay "#scene-1" starts visible before its first GSAP opacity tween`），需要生成器调整初始状态；本轮合并实现只覆盖受控模板的一层元素与已知属性，**任意 Agent 生成的 HTML/JS 不是安全输入**，未扩大沙箱或网络/文件边界；多写者并发、跨进程 operation journal、AI 生成失败回滚后的历史一致性未验证；未接入 DSH、未安装、未 merge。

## 证据路径与哈希

提交内证据（`spikes/p3-multiscene/evidence/`）：`q1-structures.json`、`q1-sdk-model.json`、`q2-inspect.json`、`q3-scene-ops.json`、`q4-assets.json`、`q5-merge.json`、`q6-history.json`、`q7-register.json`、`q8-render.json`（内容与大小见 `git show --stat`；均为可提交 JSON）。

本机大产物（spike `artifacts/` 下，gitignored）：

- `artifacts/q1/A-nested.mp4`：342384 B，SHA-256 `60c30599f04bfe9d4e71d724900a17e15f9a0766e2e3c821ca1b978cc6ab460e`（450 帧 / 15.000s，见证据）。
- `artifacts/q1/B-single-doc.mp4`：293697 B，SHA-256 `8f7046d85e8fad38559796e4caa6fdc18193f08f692f298f3719f31ae6a19af5`。
- `artifacts/q8/output/8d9f382a-8e76-4954-8da5-6c5f8ffa3849.mp4`：293697 B，SHA-256 `8f7046d85e8f…`（与 CLI 渲染相同）。
- `artifacts/q1/snapshots/`、`artifacts/q8/output/*.png`：Scene 边界/中点帧；逐帧 SHA 在 `q1-structures.json`/`q8-render.json`。
- 自造素材：`artifacts/q1/images/logo.png`（430B，`e6e04d26…`）、`shot-1..4.png`（`4066b3e7…`/`b2f5eb58…`/`c4e2514a…`/`14bfb799…`）；字体只复制运行，不入 Git。

复现命令见 `spikes/p3-multiscene/README.md` 与任务记录。
