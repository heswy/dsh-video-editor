# P3-008 第二轮复审：画布整合修复候选

日期：2026-10-18。对象：p0-mode-shell / PR#3，交付 **c1e7aae**，固定功能 **5f2df96**，根 **0.3.0-alpha.3**，引擎 **d383e3d / client·worker 0.3.2**。

**结论：大部分原问题修复通过，但仍需集中补修两项：R1 的长文本契约对齐、R5 的不确定写入重试。当前候选暂不安装。** 不是要求重做已通过的画布或底层引擎，不给 p1 新任务。

## 独立检查与证据

- fetch 后核对交付 HEAD c1e7aae，开发树干净。独立 npm run check：**167/167**（48静态、75Client、44Host）；版本门禁 **10/10**。
- Node24.14.0、命令级 PATH 包含本机工具，独立运行 `scripts/test-canvas-workspace.mjs --staging <staging-d383e3d-5f2df96> --out <评审目录>/browser`：**10/10用例、175/175断言**。M1–M4 为两个动画时刻×两种letterbox移动，R1/R2为rule动画scale逆映射和auto-height缩放，F1拖动失败恢复，T1–T3真实双击文字失败/成功/Esc/冲突两阶段。外网请求0、非预期console错误0、page错误0；预期409资源错误单列，未声称console无任何错误。
- harness执行固定staging中提取的真实CanvasWorkspace与helpers、真实DOM/Chrome/Host→worker；React调度由测试专用react-dom-lite提供。因此这是实际组件浏览器回归，**不是DSH宿主React/Slot加载、原生AI或安装验收**。staging不可变文件75/75未变，teardown通过。
- 独立反向重放旧跨工程产物读取：绑定a的Session读取b的已登记PNG，现返回 E_PREVIEW_DENIED；本工程Session目录PNG允许。迟到snapshot探针：等待中inFlight=1，dispose等待，返回后发preview.release、请求E_WORKER_DISPOSED，最终路由/record=0。慢上传dispose取消body，响应503，receipt=0。这些原缺陷路径已修。
- 固定tarball：23/23文件与Git5f2df96逐字节一致，103,200 B，SHA-256 **b0af95b4c5087bc6446a65fcade8fd931b4d8b556b5dbed8feee865f4a260a45**。staging INTEGRITY **f00658039688b1c9453eb4d4d6c777a5722b34bb0f99e3a59164c68eb573b52d**，bundle22/client16/worker35记录摘要全部通过，固定版本/commit吻合。
- 独立日志/探针在同级 artifacts/reviews/2026-10-18/P3-008-r2/：probe.mjs、probe-result.json、lifecycle-probe.mjs、lifecycle-probe-result.json、package-check.json、browser/。原复审与原开发证据未覆盖。开发者Host Tool完整续改链、15s导出及黑带复核属于交付证据，本轮未重复渲染该MP4。

## R1-follow-up [P2] Client 与 Host 仍拒绝新引擎合法长模板

位置：client.js `canvasCopySceneTemplate` 约2027–2039，host/bridge.js `sceneTemplate` 251–258。两处仍把title/subtitle/badge限制为200/300/48；固定d383e3d已允许三者各2048，与原typed text编辑一致。

独立公共JSONL复现：创建真实受控工程，typed edit写300字title成功，inspect.template返回合法300字title。把此真实投影交给当前client helper，得到 `{ok:false,detail:'scene title is invalid'}`；同模板只改color传入Host校验，返回E_PARAMS，根本到不了worker。subtitle>300或badge>48同理。用户能在画布/AI改长文案，却再也无法换背景/shot或用project.revise完整模板续改，R1读取契约尚未完全接通。

要求：将Client复制校验、Host模板校验和相关文档/必要工具约束与**已冻结0.3.2**对齐；保留上限与其它校验，不截断合法文本，不改p1。回归title/subtitle/badge分别超过旧上限、2048边界、2049拒绝；至少真实Host→worker证明长文案后仅改color/shot和Tool revise仍保留其它字段。不是要求新增任意长文本能力。

## R5-follow-up [P2] 同一编辑器永久复用operationId，改变请求后无法恢复

位置：client.js submitText约2796–2828；openEditorForHit约3081；textarea onChange允许修改保留草稿。当前operationId以编辑器生命周期为单位，但worker幂等键绑定的是**完整请求签名**，包含expectedRevision与ops。

独立运行当前真实submitText函数，接真实worker：第一次请求成功持久化后，测试桥故意丢弃成功响应并返回E_TRANSPORT/uncertain。UI保留草稿正确；用户将保留草稿改成新文案再显式提交，代码复用同一operationId，worker必然返回 **E_OPERATION_REUSED**。草稿虽仍在，但“重试”不解决状态，继续提交仍同错。类似地，原操作已记录后，如果revision刷新而仍用该id，也不能算同一个幂等重试。当前浏览器T1只在发送前注入E_PERSIST，不能覆盖“已落盘但确认丢失”。

要求：以一次**不可变写入尝试**绑定operationId、原expectedRevision与原ops；原样重试必须发相同完整请求，不读取最新revision/变化的草稿来冒充原请求。草稿改动或显式刷新形成新意图时，先处理旧尝试的确定/不确定结果，再使用新operationId；不自动重放或自动覆盖，也不能仅在uncertain时直接换id。可选择清晰的显式恢复步骤，保持交互克制；用户无需Esc丢掉/重开编辑器来脱困。

新增正式回归：真实worker已写后丢确认；未改草稿的显式原样重试只应用一次；修改保留草稿后的恢复可最终提交新文案；并发revision变化/冲突后显式恢复；E_PERSIST失败/Esc/原冲突两阶段仍通过。至少一项实际CanvasWorkspace浏览器回归应模拟“写成功再丢响应”，不只返回假失败而跳过Host。

## 本轮认可与下一步

R2动画基座/letterbox、R3归属、R4准入排空与parent消息主要回归已通过；R1普通长度完整模板路径与R5明确失败保留草稿也已改善。只补上述两处，保留原正式回归；无需重做调查/黑带定位、无需跨树开发。额外范围若发现真实阻塞先记录，不扩大产品需求。

同树/同PR，新功能提交目录出包与新staging，继续固定d383e3d/两包0.3.2；根未安装alpha.3可沿用版本。复跑受影响检查/真实链与新增浏览器用例，交完整摘要和证据，旧目录/原探针不改。当前安装alpha.1不变；本轮未操作DSH、未改profile/用户工程、未启停/重启、未发模型请求、未merge。候选通过后再安排具体安装验收。
