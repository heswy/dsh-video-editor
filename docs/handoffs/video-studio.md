# video-studio：唯一当前交接

更新：2026-10-18。当前任务仍[P3-012 对话优先MVP](../tasks/P3-012-conversation-first-mvp.md)，左只读预览/右对话生成续改，用户手动编辑延期。

最新交付e4b8a07 / 固定运行时d84ec5d，根alpha.4/引擎0.4.0；统一草稿PR为 **#4**（已确认），旧#1/#2/#3保留。总调度[复审](../reviews/P3-012-review-01.md)：正常链230/230、原浏览器41/41、基础174+版本10、worker44/compose5/client22+skip及包/staging通过；但还需补两项失败保护：

1. **R1** compose写入新entry后recordWrite失败返回普通E_INTERNAL，真实内容已变且不带uncertain。补权威commit点/历史阶段结算，失败回退或明确已发布/历史降级，不让接口与source/inspect矛盾。增加历史阶段故障+同id恢复回归。
2. **R2** snapshot失败时canvasBody错误分支卸载了旧iframe。真实Chrome新增断言失败iframes=0。保持最后ready作品直至新runtime ready才换，失败就近提示，显示版本真实；补snapshot/runtime失败、切换资源/旧消息与恢复回归。

这是原范围补修，不加功能/手动编辑，不重做全部渲染或调查。同一树/分支/PR#4一次交回新固定提交/staging/摘要；源代码与engine一起修，不等其它会话。原正常链和零手动控件验收保持。

代码路径/权限读DEVELOPMENT，开工fetch后git show协调STATUS与本交接；不要为读文档merge/rebase。更新自己的task/research，普通push允许。旧候选/安装与用户作品只读，不prepare-fixture/覆盖；未授权安装/启停/重启、真实模型请求、profile/用户工程写入、merge main。无安全定向输入时请用户短人工操作，禁止全局坐标/键盘/个人剪贴板。
