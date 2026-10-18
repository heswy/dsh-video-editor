# p0-mode-shell：当前接手

更新：2026-10-18。沿用当前目录、`dsh/p0-mode-shell` / PR#3，当前head `b204760`；路径和规则读协调分支DEVELOPMENT。

P2-007已通过总调度[独立复审](../reviews/P2-007-review-01.md)：103/103+版本10/10、包17/17与提交一致；仓库原脚本独立复建及新staging真实链通过。P2-006的交付R1关闭；0.2.2可作受控候选，但本轮不安装，当前0.2.1和旧目录保持。

## 下一任务（待用户转发启动）

fetch后通过git show读最新STATUS、DEVELOPMENT、PRODUCT、FRONTEND-DESIGN，存档并执行 [P3-005-A](../tasks/P3-005A-native-conversation-contract.md)：只读核对当前Host原生Conversation Factory/SessionProvider、工程会话历史、模型选择、审批/附件与素材归属，给精确接入提案。

只写任务/研究记录和必要只读探针，不改根插件/Host/engine，不安装、不创建用户会话、不调模型。引擎新固定基础为已审df4b74f/两包0.2.1，但这不授权在旧staging直接替换引擎。p1-engine并行做受控画布验证，不交叉修改。

后续正式界面不再以目标下拉和右属性表单为主：左直接编辑、右AI常驻、素材抽屉、无场景卡片。原P2-006/P2-007任务不重开。普通commit/push更新PR#3后由用户交回复审。
