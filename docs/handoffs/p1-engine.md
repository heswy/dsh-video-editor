# p1-engine：当前接手

更新：2026-10-18。当前head `ea2d1a4`，沿用本树、`codex/p1-engine-spike-b4bf` / PR#2。规则/路径读协调分支DEVELOPMENT。

P3-005-B已通过总调度[独立复审](../reviews/P3-005B-review-01.md)：Node10/10、真实Chrome41/41、能力探针通过，packages仍为df4b74f。此结论只验收受控独立试验，不是最终DSH界面。

## 下一任务（待用户转发启动）

fetch后git show读最新STATUS、DEVELOPMENT、PRODUCT、设计和 [P3-006-B](../tasks/P3-006B-layout-style-persistence.md)。**直接补持久化能力，不再做一轮同类spike。** 统一edit新增受控layout/style、inspect能力与基座值，接历史/撤销/重开/渲染，scene重生成不能抹掉人工布局，同对象人工位置+AI文案应保留两者。

两引擎包升0.3.0，原v1方法保持；只改两包与本任务相关spike/测试/研究，不改根插件/Host或p0的树。实际位置以composition静态基座为准，不把当前动画矩形直接存为left/top；拒绝任意CSS/transform/脚本路径。

p0-mode-shell继续P3-006-A原生AI/历史/模型接线，根alpha候选暂用旧引擎，不要求它现在跟随0.3.0。两线交付后总调度冻结DSH画布整合，保持左直接编辑、右AI常驻、素材抽屉、无场景卡片。

一次交付完整引擎能力、真实证据与固定包，正常commit/push原PR后由用户交回复审。不安装/启停/重启，不调模型，不merge，不新树/PR。
