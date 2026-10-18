# p0-mode-shell：当前接手

更新：2026-10-18。当前交付HEAD `eb8d2d8`，分支 `dsh/p0-mode-shell` / PR#3；继续本树。开工fetch后按AGENTS读取协调STATUS/DEVELOPMENT，不merge协调分支。

## 当前动作：P3-006-A集中修复

读取 [P3-006-A复审](../reviews/P3-006A-review-01.md)，按原 [任务指南](../tasks/P3-006A-native-creation-conversation.md) 的白名单一次修复R1–R4：

1. 映射候选状态写盘成功后才发布，失败不改变history/active/Tool授权；处理失败临时文件。
2. Session操作加入准入/排空，停用等待已接受create/rename收束，最后再清理store/context。
3. 损坏/未知版本/上限等已知错误在宿主创建Session前拒绝，不吞读取失败继续创建。
4. requestId去重隔离工程或明确冲突，不返回另一工程的Session。

独立117/117+版本10/10、19文件固定包和staging摘要通过，但故障探针四项复现，候选尚未验收。复现脚本位于同级artifacts/reviews/2026-10-18/P3-006A/repro.mjs，真实候选模块+受控controller，无真实Session。

修复、故障回归、原任务/研究记录、新提交目录固定包/staging与Host真实链一并交回；引擎仍固定54f4671/0.1.1，未发布alpha.1可保留版本。不新增调查轮次、不改p1-engine，不覆盖任何旧候选/安装staging。

普通commit/push更新PR#3；不安装/启停/重启、不改profile、不创建用户真实会话、不调模型、不merge。修复复审通过后才进入具体候选安装验收。左画布/右AI/历史/原生模型/素材抽屉、无底部场景卡片的产品方向不变。
