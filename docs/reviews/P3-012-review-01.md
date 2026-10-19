# P3-012 复审：对话生成与自动预览候选

日期：2026-10-18。video-studio / PR#4，交付 **e4b8a07**；固定运行时 **d84ec5d0e3b01a292401527e9dba619fcb8440a8**，root alpha.4 / engine-client·worker 0.4.0。5956a93仅调整既有spawn-context测试握手预算，后续README/task/research亦非运行时变更。

**结论：正常通用闭环独立复测通过；需同一轮补修R1发布失败一致性、R2保留最后有效预览，当前候选不安装。** 不恢复手动编辑、不按特定题材加功能、不扩展产品范围。真实DSH/模型闭环尚未验收。

## 独立证据

- fetch后交付e4b8a07，树干净。npm run check **174/174**（50静态、71Client、53Host），版本门禁 **10/10**。显式Node24.14.0顺序运行worker **44/44**、compose.integration **5/5**、client **22 pass+1 opt-in skip**。测试去flake没有放宽负向超时用例。
- 原始 `scripts/test-conversation-chain.mjs` 对固定staging独立运行：**230/230，ok=true**；两个不同结构的作品经真实Tool/Session归属→worker提交、source与revision精确、继续修改保留未改内容、28项格式/版本/作用域失败矩阵、真实Chrome ready/seek/play、重开一致及清理通过。不是模型实际发起。
- 对原浏览器runner建立评审副本，只改测试库导入绝对路径与加入一条“失败时最后有效iframe仍存在”断言，产品/候选源码未改。原有 **41/41** 通过，新增断言 **FAIL**：snapshot失败后 `{iframes:0,phase:'error'}`；总42项41pass，runner按预期exit1。此结果不能写成整个失败恢复已通过。
- staging `staging-p3-012-d84ec5d-d84ec5d`，INTEGRITY **9b8aff4ba3f9afaec75d603ed5dc6652aac9e987b9c8e43bf5e37de9c15ba199**；bundle22/client18/worker37摘要全部独立匹配，版本/固定提交吻合。
- 两份engine固定包逐文件与d84ec5d对照通过：client3文件/8610 B/SHA **14b85c39e89e912d6ab0924c88967c85c83c43921420a8b44334f4a5f35ed513**；worker15文件/66733 B/SHA **f86b8639280b4c9f9d3dfefc4f11f41767f2912a228bafdb88a29e940ce7863b**。根未另提供tarball，本轮核对的是staging实际运行时，不虚构根包摘要。
- 证据在同级artifacts/reviews/2026-10-18/P3-012/：chain/、preview/、history-probe.mjs/result.json、preview-retention-probe.mjs、package-check.json与日志。浏览器使用测试react-dom-lite及inert宿主会话面，不能替代DSH原生React/Slot/真实模型测试。

## R1 [P1] 历史写入失败时已发布新内容，却返回普通失败

位置：packages/video-engine-worker/src/projects.mjs compose，约789–795。入口atomicWrite/回读及previewProof后，仅它们的错误会restoreEntry；随后的 `await recordWrite(...)` 不在失败恢复范围内。history读取或写盘失败直接变E_INTERNAL，没有publishedRevision/uncertain，也没有恢复入口。

独立公开JSONL复现（任务自有工程）：project.create→project.source保存初始revision；把其 `.dsh-video/history/entries.jsonl` 暂存并改为目录，模拟历史不可读写；调用合法genreA project.compose。结果 `ok:false E_INTERNAL(stage:worker)`，没有uncertain；再次project.source却得到**新revision且HTML精确等于被拒候选**。原合法作品已被换掉；这不是整个提交在写入口前拒绝。所有探针在临时工程，用户原作品未动。

要求：将历史阶段纳入发布结算语义，明确权威commit点。可采用失败时恢复入口及已变动历史，或将历史可恢复故障与作品已确认提交分开返回；不能已生效却返回“未生效”的普通失败。若选择失败恢复，entry/revision/history必须一致；无法确认或回滚失败须typed uncertain，不假称安全回退。若选择成功但历史降级，必须有真实publishedRevision和结构化降级信息，并更新schema/文档/Host上下文，不掩盖历史损坏。避免为了修复引入跨工程/任意路径或重做全部存储架构。

补公共API回归覆盖历史读、snapshot/entries/ops/state写入故障与同operationId重试，证明三态一致：**明确失败保留旧有效状态；明确提交返回真实新revision；未知结果显式uncertain**。恢复后source/inspect/后续compose一致。现有入口写失败、previewProof失败、限额/幂等/冲突用例保持。

## R2 [P2] 快照失败会卸载最后有效作品

位置：client.js loadSnapshot约2528、canvasBody约3252–3269。请求新snapshot之前保留旧snapshot state，但phase设error后canvasBody立即return错误div，原iframe因此从React树卸载。runtime失败同样进入此分支；只保留变量不等于保留可见作品。

独立真实Chrome：先提交并播放genreB，注入下一revision的preview.snapshot一次失败；沿用原B4的错误观察点，新增DOM断言得到iframes=0。原41项验证了错误与重试按钮，却没有验证本任务明确要求的“失败保留最后有效作品”。原截图也只剩错误面。

要求：最后ready的作品和当前目标/待加载revision分离。加载/失败时保持最后有效预览可见，在附近给克制错误/重试反馈；新候选加载且runtime ready后再替换，不能旧作品被标为新revision。初次无有效作品可显示空态/错误。保持老快照必要资源直到切换成功，再撤销旧实例，避免仅保留DOM却先删除其资源。不得改成图片截图冒充仍可播放或无声显示旧作品当新结果。

补真实组件浏览器断言：旧作品先可播放，snapshot请求失败与新runtime失败时旧作品仍在/版本明确，重试或后续正常revision自动切换；切换成功再释放旧实例/路由，旧消息不能影响新实例；初次失败仍可恢复。原零手动控件、零用户写请求及自动两轮更新保持。

## 收口方式

两项均属原P3-012失败保护，不是新增功能；统一会话同树/PR#4一次补修，不另派p0/p1、不重做长渲染或手动编辑套件。正常链230、原浏览器41及分项基础检查保留，按受影响处新增故障回归。新固定提交目录/新staging与完整摘要交回，旧候选/安装/用户作品不覆盖。未安装/启停/重启、未发模型请求、未改profile、未merge main。
