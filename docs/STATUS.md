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

[P3-012 对话优先MVP](tasks/P3-012-conversation-first-mvp.md)，唯一交接[video-studio](handoffs/video-studio.md)。交付 **1175596** / 固定root **d49be12** / engine **0deef8f**；根alpha.4 / 两包0.4.0，PR#4。未安装该候选，用户当前安装最近只读确认为alpha.3。

总调度[第二轮复审](reviews/P3-012-review-02.md)：基础178/178+版本10/10、worker46/46、compose6/6、client22pass+1skip；正常链261/261、原预览压力68/68；R1历史降级结算通过，同id重试一致。开发浏览器不是实际DSH模型验收。

**唯一当前补修：R2 active预览尺寸/时长隔离。** 真实Chrome新增断言：旧720×1280/5s作品，在新1280×720/6s候选失败时被套上新viewport和时长。需要每实例元数据及成功ready后统一切换。不是新产品功能、不恢复手动编辑；旧R1不重复修。

候选暂不安装；同一会话集中补此项，新root提交/staging交回，engine可保持已审0deef8f。开发副本验证/普通push允许；安装/模型/重启、profile/用户工程修改、merge main未授权。

## 当前验收口径

对话生成→自动播放预览→同一工程连续对话修改→自动更新是当前目标。P3-012正常开发链已有独立证据；先补原范围失败恢复，再按具体候选安排真实DSH/模型验收。开发模拟不当作用户对话已通，也不恢复此前手动编辑关口。
