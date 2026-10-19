# P3-009：完整Scene读取契约，支持安全的局部改色/换素材

日期：2026-10-18。执行p1-engine，基线已审82f6219/0.3.1，交付head9aebcbc；原树/分支/PR#2。用户转发后直接实现，不新tree/调查。依据[P3-008联合复审R1](../reviews/P3-008-review-01.md)。DEVELOPMENT为唯一通用规则。

## 问题与冻结接口

scene.update的template是完整替换；当前sceneSummaries只给title/order/start/duration/id等信息，UI无法构造保持其它字段不变的请求。前端仅改背景提交title/duration/color会丢subtitle/logo/shot。不能让前端解析任意工程HTML或缓存一份第二真相补洞。

给受控Scene summary新增 **template**，它是从当前权威HTML/受控解析模型得到的、可直接作为scene.update.template输入的完整合法值：`{title,duration,subtitle?,badge?,color?,accent?,logo?,shot?}`。不含sceneId/order/start/elements/目录/绝对路径，不伪造未知值。颜色与资产路径取当前工程真实值，文本含人工text修改；“未设置可选字段”和“需要清空/删除”的既有语义保持，不默认加回不存在元素。

central sceneSummaries所影响的inspect/open、project.create、scene.*、project.revise等结果保持一致，schema所有SceneSummary引用同步。legacy无受控Scene仍scenes=[]；JSONL v1与22个方法不变，旧字段不删不改；不把scene.update偷偷改成partial patch，也不更改重生成/覆盖/合并/黑带修复。

## 范围与版本

允许两engine包源码/schema/README/版本/锁根和必要测试/打包、本任务与对应research。两包 **0.3.2**。可增加真实JSONL回归，不改根插件/Host/client.js、p0树、spike、全局文档。HyperFrames保持0.8.167，不新运行时依赖。

## 验收

1. 创建带全部受支持可选字段与自定义背景/accent的工程，inspect.template可往返合法validateSceneSpec；只改color调用scene.update，subtitle/badge/logo/shot/accent保持，其它Scene和人工layout/style保留。
2. 只改shot同样保留其它字段；close/reopen与worker重启后template一致；人工text编辑后投影为新文本。可选字段缺失不生成错误默认对象。
3. schema正/负与旧结果兼容、22方法集、旧工程、历史/覆盖/合并回归通过。必要时检查一次snapshot/抽帧表明只改预期字段，不要求为只读投影变更重复整套长渲染。
4. 新固定提交目录两包/完整SHA/条目/源码字节一致与干净pack证据、方法结果样例和未测项一次交回PR#2。82f6219旧包保留。

不安装/启停/重启、不改profile、不发模型请求、不改当前用户工程、不merge、不联系或修改p0。p0按此冻结的template形状并行准备，新的具体提交需总调度复审后才能进入其最终staging，不依赖移动HEAD。

---

## 开发记录（p1-engine）

填写：2026-10-18。开工 `git fetch origin` 成功，协调记忆 `origin/codex/project-foundation` @ **`2400431`**；开工 HEAD **`9aebcbc`**，引擎基线 **`82f6219`** / 两包 0.3.1。实现提交 **`d383e3d`**（首版 `6861036` 自查长文本往返后修正）；本记录与研究记录另以 docs 提交。未改根插件/Host/client.js/p0 树/spike/全局文档，未安装/启停/重启、未调模型/改用户数据、未 merge、未新 tree/PR；HyperFrames 仍 0.8.167，无新依赖。

### 实现

- `sceneSummaries`/`sceneSummary` 追加只读 `template`（`scenes.js` 新 `sceneTemplate`），从权威 HTML 的 `parseDocument` 受控模型生成冻结形状 `{title,duration,subtitle?,badge?,color?,accent?,logo?,shot?}`；覆盖 inspect/open、project.create、scene.*、project.revise 成功结果的 `scenes[]`。
- schema 的 `sceneSummary` 与 `inspectScene` 增加必填 `template: $ref sceneTemplate`（复用既有 scene.update 输入定义）；两包版本/lock 0.3.2，README 记录契约与样例；client 无生产方法变化。
- 保持 `scene.update` 完整替换、无变化 `E_INTERNAL`、重生成/覆盖/合并/黑带语义；legacy P2 仍 `scenes:[]`。
- 自查补充：text edit 上限 2048 与旧模板上限 200/300/48 不一致，长文案会使读出的 template 无法回写；已将 title/subtitle/badge 模板输入/投影上限对齐 2048（旧范围兼容），空/纯空白 title text edit 返回 `E_PARAMS`；其它 text/timing 不变。

### 验证

- worker 单元/契约 **44/44**（约 16.4s）；真实链 **12/12**；client **21 项：20 pass + 1 opt-in skip**。
- 新增真实 JSONL 回归覆盖：长文本（300/600/60 字）投影可往返、空 title 拒绝；完整字段投影/validateSceneSpec 往返/旧字段保留/无泄漏字段；仅改 color 与仅改 shot 保留 subtitle/badge/accent/logo/shot、人工文本、人工 layout/style、其它 Scene；快照 HTML；project.create/scene.create/update/reorder/open 结果一致；close/reopen、worker 重启、undo/redo；可选字段缺失；legacy scenes:[]；schema 正负与 22 方法集；client 透传。
- 方法结果样例与契约见 `docs/research/P3-009-scene-template-read-contract.md`。

### 固定包（`artifacts/engine/d383e3d/`，ignored，保留旧包）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.3.2.tgz | 3 | 7494 | `0830ab717ac2ef2572faf95aacace0778d5dc379cdfcc4546b48e6fa851311a5` |
| dsh-video-engine-worker-0.3.2.tgz | 14 | 57022 | `e4e161418c252e6973760ca20d8aff890eabcf26a0bce5e93e0bfb6bef3716c3` |

`package-verify.json`：逐文件与功能提交字节一致、重复 pack 一致、干净 `git archive` 检出重新 pack 一致；未安装、未发布；旧 `df4b74f/`、`4c087ef/`、`74294e6/`、`82f6219/` 包保留。

### 未测项 / 风险

- 仅受控 `product-launch-v1` 冻结字段；任意 HTML/额外字段/字体旋转仍不支持，不扩展写入。
- 投影依赖受控解析模型；无法解析的手改工程仍 legacy `scenes:[]`（既有边界）。
- 未做真实 UI 局部换色/换素材交互验收（属 p0）；未重做长渲染/性能，黑带修复行为保持。
- `scene.update` 仍是完整替换，前端只传部分字段仍会丢数据；契约用于读取完整模板，不改变写入语义。
