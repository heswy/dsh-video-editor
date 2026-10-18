# P3-009：完整 Scene 读取契约 scene.template

日期：2026-10-18。执行：p1-engine 工作区；分支 `codex/p1-engine-spike-b4bf` / PR #2；开工 HEAD **`9aebcbc`**（BUG-001 修复 `82f6219`、两包 0.3.1 已验收）。协调记忆读取自 `origin/codex/project-foundation` @ **`2400431`**（P3-008 联合复审 R1 指向本任务）。实现提交 **`d383e3d`**（首版 `6861036` 自查长文本往返后修正）；两包升 **0.3.2**。只改两个 engine 包源码/schema/README/版本/锁根、必要测试/打包与任务/research 文档；未改根插件/Host/client.js/p0 树/spike/全局文档，未安装/启停/重启、未调模型/改用户数据、未 merge、未新 tree/PR；HyperFrames 仍 0.8.167，无新运行时依赖。

## 结论

- 所有 **Scene summary** 新增只读字段 **`template`**，形状冻结为 `{title,duration,subtitle?,badge?,color?,accent?,logo?,shot?}`，从当前权威 HTML 的受控解析模型生成，**可直接作为 `scene.update.template` / `project.revise.template` 输入**；不含 `sceneId/order/start/elements`、目录或绝对路径，不伪造不存在的可选字段。
- 前端只改背景色或素材时，复制当次 `inspect` 的 `scenes[].template`、只改 `color`/`shot`，即可保留 subtitle/badge/accent/logo/shot、其它 Scene 及人工 layout/style；不需要解析工程 HTML 或缓存第二份真相。人工作出的 text 修改会反映在投影中。
- 覆盖 `inspect`/`open`、`project.create`、`scene.create/update/remove/reorder`、`project.revise` 成功结果，统一由 `sceneSummaries` 生成；legacy P2 单 composition 仍 `scenes: []`。schema 的 `sceneSummary` 与 `inspectScene` 均要求 `template`（引用既有 `$defs.sceneTemplate`）。
- **`scene.update` 仍是完整替换语义，没有偷偷改成 partial patch**；未设置/清空可选字段的既有规则、无变化提交的 `E_INTERNAL` 守卫、重生成/覆盖/合并/黑带修复均不变；JSONL v1、22 个方法、旧字段不删不改。

## 冻结契约与方法样例

`inspect`/`open`（`inspectScene`，含 `elements`）与 `project.create` 的 `scenes[]`、以及 `scene.*`/`project.revise` 的 `scenes[]`（`sceneSummary`）都带同一投影：

```json
{
  "scenes": [
    {
      "sceneId": "scene-1",
      "order": 0,
      "start": 0,
      "duration": 4,
      "title": "完整字段场景",
      "template": {
        "title": "完整字段场景",
        "duration": 4,
        "subtitle": "完整副标题",
        "badge": "FULL",
        "color": "#123456",
        "accent": "#abcdef",
        "logo": "assets/logo.png",
        "shot": "assets/shot.png"
      }
    }
  ]
}
```

仅换背景色的最小请求（expectedRevision 来自当次权威 inspect；整份 `template` 来自读取投影，只改 `color`）：

```json
{
  "v": 1,
  "id": "<request-id>",
  "method": "scene.update",
  "params": {
    "projectId": "<projectId>",
    "expectedRevision": "<64-hex revision>",
    "operationId": "<unique operation id>",
    "sceneId": "scene-1",
    "template": {
      "title": "完整字段场景",
      "duration": 4,
      "subtitle": "完整副标题",
      "badge": "FULL",
      "color": "#ff0000",
      "accent": "#abcdef",
      "logo": "assets/logo.png",
      "shot": "assets/shot.png"
    }
  }
}
```

成功结果中的 `scenes[].template` 保持 `subtitle/badge/accent/logo/shot` 与人工文本/布局，只有 `color` 变为 `#ff0000`；其它 Scene 的 `sceneId/order/start/duration/title/template` 不变。

可选字段语义：subtitle/logo/shot 只在当前文档存在时出现；受控模板始终渲染空 badge 元素，因此 `badge:""` 是真实值；颜色/accent 来自当前 HTML 的真实行内值（受控模板内的模板默认值也如实投影）；不会因为某个字段未设置而补出错误对象。投影可直接通过 `validateSceneSpec`（即 `scene.update` 的校验）并保留全部键值。

**文本边界对齐（自查后补充）**：既有 `edit {type:'text'}` 允许 2048 字符，而旧 Scene 模板 title/subtitle/badge 上限是 200/300/48；若人工长文案超过旧上限，读出的 template 会无法作为 `scene.update.template` 回写，违背“可往返”。因此本轮把 Scene 模板输入/投影的 title/subtitle/badge 上限统一对齐到 **2048**（原有更短范围请求完全兼容，旧工程内容不被拒绝），schema 的 `sceneTemplate`/`sceneCreateTemplate`/`sceneSummary.title`/`inspectScene.title` 同步；同时 title 是必填模板字段，空/纯空白 title 的 text edit 返回 `E_PARAMS`（而不是生成不可用投影）。其它元素 text/timing 与 `scene.update` 完整替换语义不变。

## 实现

- `packages/video-engine-worker/src/scenes.mjs`：新增 `sceneTemplate(scene)`（从 `parseDocument` 的 `specFromSection` 受控模型取 title/duration/真实 color/accent/logo/shot 与现有 text 值，按冻结顺序组装，可选字段 undefined 时省略）；`sceneSummary`/`sceneSummaries` 在旧字段之后追加 `template`。所有 Scene 结果都经过 `sceneSummaries`，包括 `inspect` 的 `scenes[]`（再补 elements）与 `project.create` 的 opened.scenes。
- `protocol.schema.json`：`$defs.sceneSummary` 与 `$defs.inspectScene` 增加必填 `template: $ref $defs.sceneTemplate`；不新增方法、不新增定义（复用已有 scene.update 输入定义）。协议版本注释更新为 1 (0.3.2)。
- 两包版本/lock 升 0.3.2；client 仅版本与 README/打包测试同步，无生产方法变化；README 记录契约与样例。
- 不修改 `scene.update` 实现：仍接收完整 template 并重生成；局部更新由调用方用读取投影构造，避免任何“猜测补洞”。

## 验证（自述，待独立复审）

| 项 | 命令 | 结果 |
|---|---|---|
| worker 单元/契约 | `npm test --prefix packages/video-engine-worker` | **44/44**（含新增 scene-template 4 项；schema 全量方法结果校验通过），约 16.4s |
| worker 真实链 | `npm run test:real --prefix packages/video-engine-worker` | **12/12**（历史/覆盖/合并/布局/渲染回归保持） |
| client | `npm test --prefix packages/video-engine-client` | **21 项：20 pass + 1 opt-in skip**（含新增 client 投影透传测试） |

新增 worker 回归 `test/scene-template.test.mjs` 覆盖：

- 创建带全部可选字段与自定义 color/accent 的工程，`inspect.scenes[].template` 键/值完整、通过 `validateSceneSpec`、无 `sceneId/order/start/elements`/绝对路径；旧 `sceneId/order/start/duration/title` 字段保持不变。
- 只改 `color`：subtitle/badge/accent/logo/shot、人工 title/subtitle 文本、人工 layout/style、其它 Scene 全部保留；只改 `shot` 同理。
- 人工 text/layout/style 编辑反映到投影；快照 HTML 同步携带只改的 color 与未改字段。
- `project.create`、`scene.create`、`scene.update`、`scene.reorder`、`open` 结果均带模板；close/reopen、worker 重启后模板一致；undo/redo 后读取契约一致。
- 可选字段缺失不生成对象（只含真实 badge 空值与模板 color/accent）；legacy P2 fixture `scenes: []`。
- schema 正/负：summary 缺 template、template 缺 title/多 sceneId/坏 color/绝对路径 logo 均拒绝；22 个 `request_*` 定义保持不变。
- 长文本：title 300 字/subtitle 600 字/badge 60 字的人工 text 编辑后，inspect.template 长度保留、通过 `validateSceneSpec`/schema、可被 `scene.update` 回写；空/纯空白 title 的 text edit 返回 `E_PARAMS` 且不写盘。
- client 测试验证 `projectCreate`/`inspect`/`sceneUpdate` 透传 `scenes[].template` 并可用其做局部换色。

## 兼容性与固定包

- 旧工程可打开：投影只读取现有受控模型，不改 HTML/历史；旧 JSONL v1 客户端忽略新字段不影响旧字段；P2 legacy 仍 `scenes: []`。
- 固定包（`artifacts/engine/6861036/`，ignored artifacts；保留旧 `df4b74f/`、`4c087ef/`、`74294e6/`、`82f6219/`）：

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.3.2.tgz | 3 | 7494 | `0830ab717ac2ef2572faf95aacace0778d5dc379cdfcc4546b48e6fa851311a5` |
| dsh-video-engine-worker-0.3.2.tgz | 14 | 57022 | `e4e161418c252e6973760ca20d8aff890eabcf26a0bce5e93e0bfb6bef3716c3` |

`package-verify.json`：每文件与功能提交逐字节一致、重复 pack 一致、干净 `git archive` 检出重新 pack 一致；未安装、未发布。

## 未测项 / 风险

- `template` 只覆盖受控 `product-launch-v1` 的冻结字段；任意 HTML/JS、额外 Scene 字段、字体/旋转等仍不支持，未扩展写入能力。
- 投影来自当前受控解析模型，手改 HTML 到无法解析的工程仍走 legacy `scenes: []`（既有边界）；不做任意 HTML 解析承诺。
- 未做真实 UI 局部换色/换素材的浏览器交互验收（属 p0）；本轮只提供引擎读取契约与真实 JSONL 回归。
- 不改变 `scene.update` 完整替换语义和无变化 `E_INTERNAL` 守卫；前端若只提交部分字段仍会丢字段（契约用于避免，而不是把写入改成 partial）。
- 未重新做长渲染/性能；黑带修复 `HF_STATIC_DEDUP=false` 与既有 0.3.1 行为保持。
- 验收状态：P3-009 的关闭与进入 staging 需总调度复审固定提交后确认；本文/测试为开发自述。
