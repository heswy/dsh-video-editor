# BUG-001：管理模板MP4底部黑带

日期：2026-10-18。状态：**已登记，尚未下发实现；正式导出视觉验收前必须关闭。** 建议归属p1-engine，先完成P3-006-B复审修复，不另开tree。

## 事实与证据

P3-006-B交付的product-launch-v1/1280×720/30fps/11s MP4，1.5s导出帧底部y=634–719共86行黑，worker同一时刻抽帧无该黑带。总调度已查看已提交PNG确认黑带可见；“未改layout/style的baseline同样复现”为开发者对照证据，本轮未独立重跑baseline。不要把根因先认定为某个viewport、模板或FFmpeg参数。

证据：p1-engine树spikes/editor-canvas/evidence/p3-006b/persistence-evidence.json（renderedFrame.knownIssue等字段）、rendered-1.5s.png及frame-after-1.5s.png；固定引擎4c087ef/两包0.3.0。MP4编码/尺寸/帧数通过不等于完整画面通过。

## 后续实现任务需包含

用未改布局baseline和已改布局工程各自复现，定位worker抽帧与CLI render在视口/比例/根元素/输出处理上的实际差异。修复需对照同一revision、同一时间点的完整720p画面，并覆盖至少两个时刻及一次不同画布比例；保留原始工程构图，不以裁切、拉伸、放大画面或事后补色隐藏问题。若根因涉及上游，只在项目可控适配层作有证据的修正，不能直接改node_modules充当固定包交付。

当前文档仅登记缺陷和验收目标，不授权更改包/Host/安装。待总调度明确下发实现范围；p0当前原生会话验收仍使用54f4671，不能声称该旧候选导出已因本票解决。
