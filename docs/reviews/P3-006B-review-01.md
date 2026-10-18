# P3-006-B 复审：布局/样式持久化

日期：2026-10-18。对象：p1-engine / PR#2，功能 `4c087ef`、交付head `fcb090f`。结论：**需一次修复R1–R2后交回；本轮不冻结为Host画布整合基线。** typed op、静态基座、HTML单一权威与字段级合并路线符合任务，不新增调查或要求重写。

## 独立核对

- fetch成功，HEAD `fcb090f`，树干净；生产变更在两个引擎包，未改根插件/Host。
- worker单元/契约38/38独立通过；真实链11/11独立通过（约127.7s），包含新布局/样式的真实抽帧、MP4、相对动画与既有取消/生命周期/快照回归。完整画面仍保留黑带限制。
- Client首次完整执行18 pass、1 fail、1 skip：protocol.test中“client validates framing, response envelopes, limits and late writes”出现E_REQUEST_TIMEOUT。该fixture的启动/请求时限均为200ms；不直接归因生产代码，也不删除失败记录。真实链完成后，不改源码、重新执行同一完整npm命令，19 pass + 1 opt-in skip，约22.0s。保留首跑失败及复跑日志，未证明具体调度根因；当前client生产源码无本任务差异，因此作为既有测试稳定性观察，不新增阻塞修复项。后续增强同步证据优于删除用例或无依据扩大生产超时。
- 固定包逐文件与Git `4c087ef`一致：client3文件/7,408 B/SHA-256 `718de70fadbdf1c725695606efa4f599cdbd072b802b6eb60dd8bedd49b64d62`；worker14文件/53,734 B/`5518bf7ec0991af13eb7b5cb16466ff03cfd242558a84e1b79f95bcf1bf59b62`。本轮独立验证打包条目/内容；开发者干净git archive重新pack记录为其交付证据。
- 自建探针使用真实worker JSONL和受控managed fixture，走公开project.create/edit/project.revise/scene.update/inspect，不绕过队列和持久化。复现代码/JSON在同级artifacts/reviews/2026-10-18/P3-006B/{repro.mjs,repro-result.json}。只修改任务临时工程并finally清理，不改开发树已跟踪文件。
- 查看交付rendered-1.5s.png确认可见底部黑带；JSON明确86行。该图片与baseline口径仍是开发者证据，不冒充独立重跑baseline。单独记录 [BUG-001](../tasks/BUG-001-render-bottom-band.md)。

## R1 [P2] 旧base三方合并忽略新增显式覆盖意图，仍可覆盖或删除人工对象

位置：`packages/video-engine-worker/src/merge.mjs:119–127`、`:539–542`。fieldsOf排除data-dv-managed；合并只比较数值。AI删除保护只看fieldsDiffer或baseOverriddenIds，遗漏base之后新增但数值等于默认的人工标记。

独立公开协议复现：

1. 受控工程的scene-1副标题默认色为#bfdbfe，记录baseRevision。
2. 用户以style op显式设置副标题color=#bfdbfe，新增data-dv-managed=color及新的revision。
3. AI以第1步旧baseRevision + 第2步expectedRevision调用project.revise，将Scene accent设为#ff0000。
4. 当前返回written:true/conflicts=[]，副标题变红，人工显式颜色丢失。另一个新工程重复1–2，AI候选去掉subtitle，当前同样written:true且副标题消失。

要求：显式覆盖的“是否存在/何时增加”应参与每字段变更与删除保护，而非仅保留最终marker字符串。保留人工选择并允许其它默认变更，或返回明确冲突；不能成功静默覆盖/删除。回归必须走base落后于人工标记的真实公开API，覆盖同默认值的改色与删除、普通人工布局+AI文字仍合并、同字段双改仍冲突、无变化AI不误冲突。

## R2 [P2] 无标记工程增加首个typed覆盖后，原有差量不再受保护

位置：`packages/video-engine-worker/src/projects.mjs:552–558`、`:567–574`，及layout.mjs collectManualOverrides。无marker时识别全部相对默认差量；一旦出现marker，收集只信marker。但第一次typed edit只把本次patch字段加入新marker，未把已有可表达差量纳入，导致合法旧内容在下一次重生成丢失。

独立复现：与现有marker-less回归相同方式，将未带marker的title left从88改为240并inspect；通过公开style edit只改color=#ff0000；接着scene.update改标题。当前color保留，left恢复88。相同数据若不经过style edit，本轮已有fallback会保留240。

要求：首次建立marker时迁移/保留已有受支持差量，或采用能同时保留未标记差量的明确规则。不能因编辑不相关字段破坏原先已承诺的fallback。补“无marker布局→typed style→重生成”及反向“无marker样式→typed layout→重生成”，跨重开和undo/redo保持；不扩大任意CSS写权限。

## 收口范围

沿用P3-006-B白名单与原树/PR#2，两项一次修复、补回归、生成新功能提交目录固定包后交回；保留旧证据与包，普通push，不安装、不改根Host、不merge。无需再做同类spike。

黑带是另一个导出质量问题：不作为R1/R2根因、不要求本次覆盖语义修复顺带改第三方渲染器；在产品导出验收前必须处理，不能把MP4尺寸/帧数正确标成画面正确。p0-mode-shell已授权的旧引擎原生会话验收不受本复审影响。
