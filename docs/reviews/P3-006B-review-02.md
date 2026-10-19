# P3-006-B 修复复审：冻结布局/样式接口基线

日期：2026-10-18。对象：p1-engine功能74294e6、交付d926d10 / PR#2。结论：**R1–R2关闭；受控布局/样式与合并能力通过本轮代码验收，可供Host整合。导出黑带BUG-001仍未解决，不代表整个产品或MP4整帧视觉通过。**

- fetch成功，d926d10，树干净；生产修复集中layout.mjs、merge.mjs，无根Host/插件变更。marker声明进入字段分析与删除保护；旧差量按marker与默认差量并集保留。
- 独立worker单元/契约40/40通过（约20.9s）。新增正式回归覆盖旧base显式值等于默认的改色/删除/无变化，以及无marker差量双向、重开和undo/redo。
- 原复审真实JSONL探针另建修复后断言副本，未改原始复现：stale accent返回written:true且副标题仍#bfdbfe；AI删除返回written:false/AI_DELETE_HUMAN_MODIFY；旧left=240经typed style和重生成仍为240。副本与结果在同级artifacts/reviews/2026-10-18/P3-006B/recheck.mjs及recheck-result.json。
- 固定包逐文件对Git74294e6：worker14文件/54,582 B/SHA-256 0aa1b820d622dda59b8407f7d037ebc5ffd5827b70b7fcad1cb300f50b525659；client3文件/7,408 B/718de70fadbdf1c725695606efa4f599cdbd072b802b6eb60dd8bedd49b64d62。两包0.3.0，JSONL v1。本轮核内容与条目，开发者archive重复pack证据不冒充总调度重跑。
- 上轮4c087ef真实链11/11由总调度独立运行通过；本修复未改渲染路径，开发者报告74294e6真实链11/11，本轮不重复该整套渲染。基线本机受控模板范围不外推任意HTML/JS或跨平台安全。

本轮独立Client完整回归19 pass + 1 opt-in skip（约21.7s），无失败；既有200ms fixture的前轮/开发者首跑超时按历史记录保留，不删除失败。

## 两线继续推进

p1-engine执行[BUG-001](../tasks/BUG-001-render-bottom-band.md)独立提交修复，先复现对照再定位，不顺带改Host或覆盖语义。p0-mode-shell先完成[P3-006-C](../tasks/P3-006C-embedded-file-preview.md)，独立提交后直接进入[P3-008](../tasks/P3-008-canvas-ai-integration.md)真正画布/新引擎/受控工程接线，不需要再等待一轮“是否开始开发”。两条线白名单互不重叠；74294e6冻结为接线基线，BUG-001后续固定提交需复审后显式升级，不能自动追踪移动分支。

本轮不安装/启停/重启、不调模型、不修改用户工程、不merge。当前安装alpha.1/旧引擎的换色/文件预览缺口不因引擎接口验收自动消失。
