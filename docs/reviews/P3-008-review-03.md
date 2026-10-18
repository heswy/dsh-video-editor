# P3-008 第三轮复审：R1/R5 收口

日期：2026-10-18。对象：p0-mode-shell / PR#3，交付 **fdb6bc2**，固定功能 **7d6031280a5437a93b656e5af568872c1ab91043**，根 **0.3.0-alpha.3**，引擎 **d383e3d / 两包0.3.2**。

**结论：本轮两项补修通过，R1/R5关闭；前两轮R2/R3/R4/parent回归保持。候选可以进入安装验收，但未安装、未完成真实DSH页面/模型闭环验收。**

## 独立复审与验证

fetch成功，HEAD fdb6bc2，树干净。生产差异仅为Client/Host文本长度边界与原位文字attempt状态机；其余差异为必要回归、runner及文档。未改p1引擎、已审路由/布局或用户数据。

- `npm run check`：**174/174**（48静态、80Client、46Host），版本门禁 **10/10**。
- 实际CanvasWorkspace浏览器runner显式Node24.14.0 + 命令级工具PATH，读取固定staging，**13/13用例、249/249断言**。原175断言保留，新增T4A/B/C证明真实Host落盘后丢响应、原样幂等重试、改草稿结算后新id写入、并发revision真实409后显式恢复。外网0、非预期console0、teardown通过，不可变源75/75保持。预期冲突资源错误按runner单列。
- 另建公共JSONL+候选真实函数探针：三个模板字段2048 ASCII字符完整通过Client复制与Host校验到真实worker，2049逐字段拒绝；在父级revision已刷新情况下，未改草稿仍精确重放原body、revision只应用一次；改草稿先以同body结算旧操作，再用新id和结算revision提交成功。探针 **3/3**。
- 固定包 **104,913 B / 23文件**，23/23对Git7d60312逐字节一致，SHA-256 **7bccb425a926b335d735cc9c57c4288636769ccba73161a063626454c2cd46ab**。
- staging **staging-d383e3d-7d60312** 的INTEGRITY SHA-256 **b4fadefa265f3346f8ac8f640b5c42befd1f3219c1d71a676aac7a8830d0f69a**，bundle22/client16/worker35条摘要全部通过；固定commit与版本吻合。

R1：Client/Host均与冻结0.3.2的UTF-16长度语义对齐，保留2048上限、其它字段校验，不截断。Host Tool schema原为type-only，未另造冲突上限。

R5：attempt在显式发送前记录operationId/原expectedRevision/原ops/value，重试不从变化的props构造假同请求。修改草稿先结算旧attempt，返回结果才解锁新id；新请求仍受revision冲突保护。E_OPERATION_REUSED/REVISION_CONFLICT进入显式刷新与再次提交，不自动覆盖。只在用户显式提交时进入这些流程。此实现满足原复审问题与新增故障场景，不将手动重试误报为自动重放。

## 证据范围与限制

独立日志、browser JSON、probe及package-check位于同级 artifacts/reviews/2026-10-18/P3-008-r3/。浏览器运行真实组件源/Chrome/Host-worker，React调度为测试专用react-dom-lite，**不替代DSH宿主React/Slot、原生会话或真机输入验收**。

开发者完整Host Tool→worker长模板/换色/素材/人工后续改链与15s MP4黑带复核为交付证据，本轮未重跑完整渲染。独立浏览器及额外探针均使用真实worker。当前alpha.1安装未动。

已观察到现有总体输出字节限制：额外探针首次同时将title/subtitle/badge各写2048个汉字，随后inspect返回E_OUTPUT_LIMIT；字段长度合法不等于聚合响应一定在字节预算内。改用相同长度ASCII后上述边界链通过，无源码调整。此为已有worker响应预算边界，不是本轮Client长度回归，列作非阻塞限制；不宣称任意长度组合都可读取，后续应考虑给用户可恢复的超限提示或投影裁量。开发者300/400/60汉字正常创作链保持其交付证据口径。

## 下一步

固定7d60312候选，通过[P3-007安装验收指南](../tasks/P3-007-canvas-live-acceptance.md)进行实际安装与真实“一句话→多Scene→人工修改→AI续改→重开→MP4”检查。新候选安装/模型测试等待用户明确启动该具体指南；不得继承旧alpha.1任务的会话次数/安装授权，不擅自重启。p1无新增实现任务，p0不继续无目标加功能。未merge、未安装/启停/重启、未改profile、未调模型。
