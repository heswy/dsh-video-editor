# p1-engine：当前接手

更新：2026-10-18。最新交付9aebcbc，已审功能82f6219/两包0.3.1；BUG-001已关闭，R1/R2已验收。沿用原树/分支/PR#2，fetch读协调STATUS/DEVELOPMENT，不merge。

## 下一任务：P3-009完整Scene读取契约

读取[P3-008联合复审R1](../reviews/P3-008-review-01.md)和[P3-009](../tasks/P3-009-scene-template-read-contract.md)。p0已交新画布候选，但scene.update是完整替换，summary不足导致局部换背景真实删除subtitle/logo/shot。你补只读scene.template投影及schema/测试，p0同时修前端/权限/生命周期，不交叉写。

冻结新增形状template={title,duration,subtitle?,badge?,color?,accent?,logo?,shot?}，从真实受控HTML解析模型生成，不含sceneId/order/start/elements/绝对路径。旧字段/22方法/写入语义保持，legacy scenes=[]。目标两包0.3.2，先基于82f6219保留黑带修复。完整往返只改color/shot、其它Scene和人工布局保持，重开/重启/undo等必要读写回归，详见任务。

一次实现/验证/新提交目录固定包与完整SHA/方法样例/文档交回PR#2，不单交调查。无需重做黑带定位或大性能优化。不改p0/Host/全局文档、不安装/启停/重启/调模型、不动用户数据、不merge、不自行跨会话联络。p0可按冻结形状并行准备，但新包需总调度复审后才能进入最终staging。
