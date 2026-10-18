# 当前项目状态

更新：2026-10-18（Asia/Shanghai）。用户已决定结束p0/p1分线开发，统一为 **video-studio** 一个DSH开发会话；当前Codex继续总调度/评审，交接由用户转发。历史验收数字和旧状态见STATUS-HISTORY与各review，不代表用户闭环通过。

## 当前事实

- 产品：左侧随时可见、可播放并直接编辑作品；右侧原生AI常驻，模型选择/历史；素材抽屉；无底部Scene卡片。自然语言创意生成是核心，不以固定产品模板替代。
- 用户实测 **FAIL**：生成“鹈鹕骑自行车”后右侧有MP4/海报，左侧仍“画面尚未生成”；demo球改黄两分钟仍在查仓库。P3-007整体验收不通过，停止照旧走受控模板成功样例收口。
- 已只读核对实际profile依赖指向 **staging-d383e3d-7d60312/bundle，根alpha.3、引擎0.3.2**；安装目录client SHA与候选一致。未借此声称已直接核实浏览器内存中的模块版本，当前无运行时查询通道。
- 鹈鹕工程HTML 23,292 B，包含SVG和GSAP timeline，但无data-scene-id；demo同样无Scene。前端以scenes.length>0决定新画布及revision轮询，因此两者退回旧PNG/表单且不会自动跟进。demo的hf-orb背景#b1ebcd，legacy能力不含style，不能借已有托管模板样式能力宣称可改球色。
- 本轮只读诊断，未重置/改写作品，未安装/启停/重启、未发模型请求。证据在共享artifacts/reviews/2026-10-18/P3-011/incident-state.json。

## 统一代码与工作区

唯一后续开发工作区 **video-studio**，分支 **codex/video-studio**。绝对路径和唯一通用规则在[DEVELOPMENT](DEVELOPMENT.md)。用户在DSH打开该目录并新建一个会话；旧p0-mode-shell/p1-engine会话停止写入，旧树/分支/PR/忽略产物都保留，不删除。

整合来源：p0交付fdb6bc2（功能7d60312）；p1交付c31fde5（功能d383e3d、两包0.3.2）；协调记忆e01fb15。Git合并保留原历史；生产源码未经重写，文档冲突处理记录在统一树docs/research/2026-10-18-integration-conflicts.json。不是安装发布，不自动merge main。基线检查结果另见整合记录。

## 当前唯一任务

[P3-011 用户创作闭环修复](tasks/P3-011-real-creation-loop.md)，唯一交接[video-studio](handoffs/video-studio.md)。同一开发会话允许改Client/Host/engine，端到端负责两条真实样例，不再等待另一工作区。

1. 无模板Scene的合法composition也能进入经过验证的预览/播放路径；创作后左侧自动同步，失败给明确错误，不永久空白、不强迫用户重开。
2. demo球通过受支持typed工具改为黄色；AI一次inspect后使用准确能力，不查开发仓库。未知能力快速说明，不伪造完成。
3. 补模型实际获得的上下文、创作交付、预览状态的联动，保留人工编辑/版本/资产边界。能播放与逐对象可编辑分层验收，不把PNG或MP4播放冒充全结构编辑。

开发与任务自有副本本地验证/普通push已授权；安装/模型/重启按具体授权范围执行。旧alpha.3安装及用户鹈鹕/demo作品作为只读证据，不能prepare-fixture或覆盖。旧P3-007指南是被本次失败打断的验收计划，不自动重跑/消费模型额度。

## 当前验收口径

原受控候选P3-008代码回归通过（174、浏览器249断言），但未覆盖用户创意生成结构变化与旧demo改色。合码不代表这两个故障已修。后续验收优先真实故障样例，在开发副本重现；新候选复审后再走真机，不用测试数量替代用户能看见和修改作品。
