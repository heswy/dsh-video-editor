# p0-mode-shell：当前接手

更新：2026-10-18。最新交付head **c1e7aae** / 功能 **5f2df96** / 根alpha.3；最终引擎固定 **d383e3d / 两包0.3.2**。当前安装仍alpha.1，不覆盖。沿用本树/分支/PR#3，fetch读协调STATUS/DEVELOPMENT，不merge协调分支。

## 当前动作：仅集中补修R1/R5两个后续问题

读取[P3-008第二轮复审](../reviews/P3-008-review-02.md)。总调度独立167/167+版本10/10，实际CanvasWorkspace浏览器10/10、175/175，包/staging摘要通过；旧跨工程读、慢上传停用、迟到快照已复测修复。R2/R3/R4及parent主要回归保留通过结论，不重做调查。

1. **R1-follow-up**：Client canvasCopySceneTemplate、Host sceneTemplate仍旧200/300/48限制。对齐冻结0.3.2的title/subtitle/badge各2048；不截断、不取消上限、不改p1。真实长文案后换color/shot与Tool revise要能保留其它字段，覆盖边界。
2. **R5-follow-up**：operationId绑定一次不可变请求，不是整个编辑器生命周期。真实worker已写但响应丢失后，用户改草稿再用旧id提交会E_OPERATION_REUSED；同id请求的expectedRevision也必须一致。原样显式重试保持原payload；新意图在旧尝试处理后用新id，不自动重放/覆盖。增加真实写后丢确认的worker与实际组件浏览器回归，保留E_PERSIST/Esc/冲突回归。

继续固定d383e3d53a9401285519ee578d993081c3cb4b51，两包摘要见P3-008指南及P3-009复审。不跟随移动HEAD、不merge/改p1；只修最新alpha.3，根版本可保留，新提交目录与新staging打包，保留所有旧候选/证据。复跑受影响检查与真实Host/worker链，新增浏览器用例后一次push PR#3交回。

不安装/启停/重启、不新增真实模型请求、不改用户工程/个人会话、不merge、不跨会话联络。禁止全局键盘/坐标/个人剪贴板；不对当前供用户创作的demo运行prepare-fixture。候选通过后再安排具体安装验收。
