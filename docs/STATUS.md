# 当前项目状态

更新：2026-10-19。用户要求先完成仓库整合/分支PR清理，再自行实机测试；发现问题后单独建分支修复。

## 当前基线

- **main是唯一长期主分支，代码与项目记忆均读origin/main。** 标准入口 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor`；未来bugfix从最新main建立独立codex/<问题名>分支，PR回main。
- PR#5前端优化已合入原统一开发线；PR#4已把整套Client/Host/engine与UI优化合入main（合并提交1edb6aa）。GitHub同时将旧PR#2/#3标记为间接已合并；没有遗漏旧引擎/插件提交。
- 本文所在PR#1保留并整合项目规范、产品、任务、评审和研究记录；本轮授权包含该PR合并及已被main完整包含的冗余分支删除。原工作树及所有忽略产物保留，旧树为历史/测试检出，不再是长期开发线。
- 当前bundle **0.3.0-alpha.5**；engine **0.4.0**，本轮未改变Host/engine。产品范围仍为右侧对话生成/续改、左侧自动只读预览/播放；手动编辑延期，无底部场景卡片。

## 已验证与未验证

- P3-012开发候选第三轮复审通过，发布结算、失败保留、不同尺寸/时长隔离问题关闭；P3-014 UI优化已整合。
- 固定root **65dcac4** / engine **0deef8f**：基础 **184/184**、版本 **10/10**、组件布局/交互 **15/15**、真实Host/Tool/worker+Chrome生成续改链 **261/261**、预览压力 **159/159**，不可变源摘要审计通过。组件浏览器的原生对话为明确契约替身，不是真实DSH模型验收。
- 新UI候选：同级 `artifacts/ui-polish/staging-alpha5/bundle`，INTEGRITY `f25707f03eaf0b1e2a3f71df36162f9caa10d81d30dbfdb353948de3e79d9a82`；固定tgz在同级artifacts/ui-polish/65dcac4/，完整摘要见P3-014。
- **Git合并不等于插件已升级。** 本轮未安装、启停、重启、改profile/用户工程或发模型请求；当前实际安装版本本轮未重新查询。旧安装/候选/用户作品保持。
- 用户真实生成→左侧自动显示可播放→同工程连续两轮对话修改→左侧自动更新→重开一致，仍需实机验证，不把main整合当作整个产品已验收或发布。

## 下一步

用户开始实机测试。测试前先核对实际安装是否为目标候选；需要升级时按精确候选授权与Plugin Manager路径执行，不能拿旧安装表现评价新main。新问题记录现象、工程/revision及必要脱敏证据，从main单独拉分支，不继续旧p0/p1/video-studio/ui-polish/project-foundation分支。

规则：[DEVELOPMENT](DEVELOPMENT.md)；当前入口：[handoffs/README](handoffs/README.md)；产品：[PRODUCT](product/PRODUCT.md)；清理记录：[仓库收口](research/2026-10-19-repository-consolidation.md)。
