# BUG-001：管理模板MP4底部黑带

日期：2026-10-18。状态：**P3-006-B修复已验收，下一实施任务，待用户转发启动；正式导出视觉验收前必须关闭。** 执行p1-engine，基线74294e6/交付d926d10，沿用原树/分支/PR#2，不新建tree。

## 事实与证据

P3-006-B交付的product-launch-v1/1280×720/30fps/11s MP4，1.5s导出帧底部y=634–719共86行黑，worker同一时刻抽帧无该黑带。总调度已查看已提交PNG确认黑带可见；“未改layout/style的baseline同样复现”为开发者对照证据，本轮未独立重跑baseline。不要把根因先认定为某个viewport、模板或FFmpeg参数。

证据：p1-engine树spikes/editor-canvas/evidence/p3-006b/persistence-evidence.json（renderedFrame.knownIssue等字段）、rendered-1.5s.png及frame-after-1.5s.png；固定引擎4c087ef/两包0.3.0。MP4编码/尺寸/帧数通过不等于完整画面通过。

## 本轮实现与验收

用未改布局baseline和已改布局工程各自复现，定位worker抽帧与CLI render在视口/比例/根元素/输出处理上的实际差异。修复需对照同一revision、同一时间点的完整720p画面，并覆盖至少两个时刻及一次不同画布比例；保留原始工程构图，不以裁切、拉伸、放大画面或事后补色隐藏问题。若根因涉及上游，只在项目可控适配层作有证据的修正，不能直接改node_modules充当固定包交付。

允许packages/video-engine-worker/**、client的版本/锁根/必要打包兼容检查、相关spikes/editor-canvas的证据runner和新证据目录、本任务与对应research；不改根Host/插件/p0树/其它任务。两包目标0.3.1，保持JSONL v1、22方法和已审layout/style/覆盖/合并语义，不把上游升级当第一修复方案。先定位根因再实现，若需要SDK/CLI版本变化，给出最小差异和理由，不能静默升级依赖或执行未知安装脚本。

新增真实渲染回归必须识别当前86px缺陷，至少两个时间点、baseline与人工布局工程、另一种受支持画布比例，解码MP4帧与同revision worker frame对照，容差排除字形抗锯齿但不容忍整条缺失内容。用有色背景/可识别底部元素证明构图保持，不用纯黑背景掩盖。保留原始失败和修复后证据，颜色/时序/元素基座不应发生无关变化。

验证相关worker40项、真实render/取消/超时/清理链、client包兼容；新增故障回归不得靠删测试或放宽画面断言通过。既有200ms client fixture抖动如重现保留首跑与复跑结果，不混作渲染生产修复。新功能提交目录的两个固定包/完整SHA/条目/与Git字节一致/干净检出复pack、研究记录一次push PR#2交回复审。提交需附精确修复原因与未测项；不必再单交调查提案。

不安装/启停/重启DSH、不改profile、不调模型、不动当前用户工程、不merge。p0以74294e6先做Host画布整合，不等待本任务开始开发；你交付后由总调度复审固定提交再显式更新p0 staging，不自动引用移动分支。旧已安装54f4671候选未因本任务自动修复。
