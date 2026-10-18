# 当前项目状态

更新：2026-10-18（Asia/Shanghai）。用户已决定结束p0/p1分线开发，统一为 **video-studio** 一个DSH开发会话；当前Codex继续总调度/评审，交接由用户转发。历史验收数字和旧状态见STATUS-HISTORY与各review，不代表用户闭环通过。

## 当前事实

- **最新产品范围：右侧对话→AI生成→左侧自动显示并可播放→继续对话修改→左侧自动更新同一作品。用户手动编辑全部延期。** 左预览、右原生AI/模型/历史；无底部Scene卡片。固定模板不是创意上限。
- 用户实测 **FAIL**：生成“鹈鹕骑自行车”后右侧有MP4/海报，左侧仍“画面尚未生成”；demo球改黄两分钟仍在查仓库。P3-007整体验收不通过，停止照旧走受控模板成功样例收口。
- 已只读核对实际profile依赖指向 **staging-d383e3d-7d60312/bundle，根alpha.3、引擎0.3.2**；安装目录client SHA与候选一致。未借此声称已直接核实浏览器内存中的模块版本，当前无运行时查询通道。
- 鹈鹕工程HTML 23,292 B，包含SVG和GSAP timeline，但无data-scene-id；demo同样无Scene。前端以scenes.length>0决定新画布及revision轮询，因此两者退回旧PNG/表单且不会自动跟进。demo的hf-orb背景#b1ebcd，legacy能力不含style，不能借已有托管模板样式能力宣称可改球色。
- 本轮只读诊断，未重置/改写作品，未安装/启停/重启、未发模型请求。证据在共享artifacts/reviews/2026-10-18/P3-011/incident-state.json。

## 统一代码与工作区

唯一后续开发工作区 **video-studio**，分支 **codex/video-studio**。绝对路径和唯一通用规则在[DEVELOPMENT](DEVELOPMENT.md)。用户在DSH打开该目录并新建一个会话；旧p0-mode-shell/p1-engine会话停止写入，旧树/分支/PR/忽略产物都保留，不删除。

整合来源：p0交付fdb6bc2（功能7d60312）；p1交付c31fde5（功能d383e3d、两包0.3.2）；协调记忆e01fb15。Git合并保留原历史；生产源码未经重写，文档冲突处理记录在统一树docs/research/2026-10-18-integration-conflicts.json。不是安装发布，不自动merge main。基线检查结果另见整合记录。

## 当前唯一任务

[P3-012 对话优先MVP](tasks/P3-012-conversation-first-mvp.md)开发候选已通过[第三轮复审](reviews/P3-012-review-03.md)。交付 **19a7743** / 固定 root **a59fb13** / engine **0deef8f**；根 alpha.4 / 两包 0.4.0，PR #4。R1/R2/R2-follow-up 均关闭，不继续扩展开发范围。

总调度本轮实跑：基础 **181/181** + 版本 **10/10**、正常链 **261/261**、真实浏览器压力 **159/159**。失败/等待保留旧作品的宽高比、时长、播放状态；成功后统一换新元数据。staging 的 78 条文件记录字节/摘要一致。上述仍为开发链，非实际 DSH/模型验收。

当前下一步：[P3-013 真机对话验收](tasks/P3-013-conversation-live-acceptance.md)，唯一交接 [video-studio](handoffs/video-studio.md)。具体 staging、INTEGRITY、安装/回滚及最多三次真实模型请求范围已准备；用户转发执行授权后由同一 DSH 会话操作。当前安装状态本轮未重新查询，不把新候选当作已安装。

## 当前验收口径

真实右侧生成一次→左侧自动出现并可播放→同一工程连续两轮对话修改→左侧自动更新；再重开保持最后作品。用户手动编辑延期，题材不限，不做测例专用分支。无需新 session/tree，不 merge main；旧作品和旧候选保留。尚未通过真实模型闭环，不能宣称整个 MVP 已验收。
