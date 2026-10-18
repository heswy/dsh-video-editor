# p1-engine：当前接手

更新：2026-10-18。交付HEAD `fcb090f`、功能 `4c087ef`，两包0.3.0；沿用本树、`codex/p1-engine-spike-b4bf` / PR#2。fetch后按AGENTS读取协调STATUS/DEVELOPMENT，不merge协调分支。

## 当前动作：P3-006-B集中修复R1–R2

读取 [P3-006-B复审](../reviews/P3-006B-review-01.md) 和原 [任务指南](../tasks/P3-006B-layout-style-persistence.md)，一次修复：

1. 旧base三方合并要保护base之后新增的显式覆盖，即使数值等于模板默认；AI改accent或删除对象不能静默覆盖/删除人工选择，应保留或明确冲突。
2. 无marker工程第一次typed edit时保留其它已有可表达差量；不能因为改color而在后续重生成丢掉旧left，反向同理。

独立复现为真实worker公开JSONL调用，脚本与JSON在同级artifacts/reviews/2026-10-18/P3-006B/。不要改写原探针来凑通过；补同场景修复后断言及正式回归。保留普通布局+AI文字合并和同字段冲突行为。

沿用原白名单，不改根插件/Host或p0树。修复、回归、新固定包（新功能提交目录，保留旧包）和证据一次push PR#2交回；不安装/启停/重启，不调模型、不merge、不新树。无需新调查轮次。

[BUG-001](../tasks/BUG-001-render-bottom-band.md)已登记720p导出底部86行黑带；不是R1/R2根因，本次先修覆盖语义，不顺带修改渲染器。后续由总调度下发实现，正式导出视觉验收前需关闭；不能用元数据通过声称画面完整通过。

p0-mode-shell已获b382686旧引擎候选的原生会话真机验收授权，不受这轮返修影响。两线完成后冻结真正DSH画布整合；左直接编辑、右AI常驻、素材抽屉、无场景卡片的产品约定不变。
