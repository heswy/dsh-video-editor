# p0-mode-shell：当前接手

更新：2026-10-18。当前HEAD `7daa039`、分支 `dsh/p0-mode-shell` / PR#3，继续本树。规则/路径读协调分支DEVELOPMENT。

P2-007与P3-005-A均已验收；A只代表契约调查完成，不代表嵌入真机通过。[评审](../reviews/P3-005A-review-01.md)已收敛产品选择并澄清mainView retain不是可见编辑根。

## 下一任务（待用户转发启动）

fetch后通过git show读最新STATUS/DEVELOPMENT/PRODUCT/设计、本handoff和 [P3-006-A](../tasks/P3-006A-native-creation-conversation.md)。**进入实际接线，不再新开一轮调查。** 一次交付右侧原生Conversation/历史/模型、Host工程会话映射、Tool工程范围与上下文、测试和可安装候选。

- videoView source、hero:false；ready后检查open状态。只有一个可编辑根，既避免抢占也不因mainView引用仍在就永久锁住返回视频页。
- 不新Workspace、不归档隐藏，允许工程会话被宿主搜索/历史发现。映射在插件Host自有存储，不改worker工程内容。
- 审批沿用原生takeover/拒绝/取消，首版不另造独立Stop。工具身份取可信exec.agent，不信工具参数sessionId。
- 候选根0.3.0-alpha.1，本任务保留已审引擎54f4671/0.1.1。左侧暂保持真实PNG，不装假播放/点选；无底部场景卡片，右AI常驻。画布新引擎接线等B后单独合入。

p1-engine继续B，有进行中的工作，不交叉写。普通commit/push更新PR#3后由用户交回；不安装/启停/重启、不创建用户真实会话或调模型、不merge。先交具体可审阅候选，后做授权安装验收。
