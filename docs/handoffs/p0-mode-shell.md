# p0-mode-shell：当前接手

更新：2026-10-18。最新交付head8b56304；C功能3310280/alpha.2，008功能8ab5f1a/alpha.3。当前安装仍alpha.1，不覆盖。沿用本树/分支/PR#3，fetch后读协调STATUS/DEVELOPMENT，不merge协调分支。

## 当前动作：C/008集中修复R1–R5

读取[P3-008联合复审](../reviews/P3-008-review-01.md)，按原C/008白名单一次修复：

1. Scene局部改色/换shot必须保留完整其它字段；当前只传title/duration等会真实删除副标题/Logo/shot。
2. 拖动/缩放从静态基座与动画逆映射计算patch，不把当前rect直接存HTML；移动不固定原auto尺寸。补真正CanvasWorkspace的浏览器手势回归。
3. 文件预览验证所读文件属于当前工程/Session，不只验证Session绑定及共享根。
4. 所有新Host操作/上传参与准入排空；停用后不再发布路由/文件/receipt；上传校验可信工程、过期/失败/停用清临时文件。
5. 原位保存失败/冲突保留草稿和目标，uncertain不自动重放。

独立136/136+版本10/10、候选/摘要一致，但以上场景已复现，两个候选均未验收，不安装。探针在同级artifacts/reviews/2026-10-18/P3-008/，原始探针不改，补修复后断言与正式回归。parent消息形状/序号/销毁pending也按复审说明在实际前端回归中补齐，不能只用runtime脚本冒充UI测试。

p1的[P3-009](../tasks/P3-009-scene-template-read-contract.md)已通过[独立复审](../reviews/P3-009-review-01.md)。最终引擎明确冻结 **d383e3d53a9401285519ee578d993081c3cb4b51 / client与worker 0.3.2**，采用p1树artifacts/engine/d383e3d/两包：client SHA-256 `0830ab717ac2ef2572faf95aacace0778d5dc379cdfcc4546b48e6fa851311a5`；worker `e4e161418c252e6973760ca20d8aff890eabcf26a0bce5e93e0bfb6bef3716c3`。不再等待引擎提交，不从移动HEAD取包、不merge p1。新scene.template是完整合法scene.update输入；复制当次inspect模板后仅改目标字段，expectedRevision一致；缺template明确拒绝，不读HTML/本地默认猜场景。此验收只解决读取前提，不自动关闭p0 R1。保留黑带修复，新staging仍需完整MP4画面复核。

只在最新alpha.3分支集中解决C和008，不必回旧分支重打一轮alpha.2。保留所有旧候选/staging，最新功能新提交目录打包；未安装的alpha.3可保留根版本。交新staging/完整摘要、真实Host Tool→worker的AI等价续改链和实际CanvasWorkspace浏览器交互证据，一次push PR#3交回。

不安装/启停/重启、不新增真实模型请求、不改用户工程/个人会话、不merge、不联系或修改p1树。不用全局键盘/坐标/个人剪贴板；不对已供用户创作的demo运行prepare-fixture。无安全定向通道则人工，不重复事故。
