# P3-006-A 修复复审：R1–R4 关闭

日期：2026-10-18。对象：修复 `b382686`、交付 `831d275`，p0-mode-shell / PR#3。结论：**本轮代码与候选复审通过，R1–R4关闭；可以申请该固定候选的安装验收。尚未安装，原生交互尚未验收。**

## 独立验证与结论

- fetch成功、HEAD `831d275e827c092114e58b5524faa98c7fbc5597`，开发树干净。功能变更限三个Host模块和check-host；Client/engine未改。
- `npm run check`：静态40/40、Client52/52、Host31/31，共123/123；`node scripts/test-stage-version.mjs`：10/10。检查退出成功。
- 对原复现脚本建立修复后断言的独立副本，直接运行真实候选模块：rename的真实EISDIR失败后ghost=null且工程为空；跨工程同key各自返回正确工程、controllerCalls=2；create等待期间inFlight=1，dispose不提前完成，放行后成功并落盘；坏文件createCalls=0、原文件保留。结果在同级artifacts/reviews/2026-10-18/P3-006A/recheck-result.json，脚本为recheck.mjs；原始失败复现脚本未覆盖。
- R1：候选副本写入成功才发布，失败清临时文件；检查新增隔离读、失败后后续排队提交回归。R2：Session请求进入统一inFlight，bridge拒绝新请求并排空已接受操作后才dispose SessionService；延迟create/rename回归通过。R3：store状态/工程/上限预检前移，不吞错继续创建。R4：工程+requestId键隔离，跨工程去重问题关闭。
- 新tarball56,648 B、19/19文件与 `b382686` Git源码逐字节一致，SHA-256 `61e5743082652bfbd0da01d0a5bbacb6e831b84b72edfa781850cabb969f4a7a`。
- staging `staging-54f4671-b382686` 的INTEGRITY SHA-256 `167f4c419dfc9b2da2d33141845fdd433fca3bff5824160ca4c35a0a3f367ab8`；独立复核bundle18、engineClient12、engineWorker15文件字节/摘要，config与staged patch摘要一致。根0.3.0-alpha.1、引擎54f4671/0.1.1。
- 开发者真实链证据文件18,339 B与SHA-256 `b7251329ade019174e9171189b13826bfa178a3f0afc4b3881259602f80768a2`一致，记录ok/disposed及新staged Host身份。本轮核对记录，未重新运行该渲染链；不升级为总调度独立真实渲染证据。

## 验收边界与下一步

这里只接受代码修复和该开发候选；原生kit/Provider、真正Session创建、模型seat/审批/历史/附件、切回普通视图、停用/重连尚未真实验证。当前没有授权安装或调用模型，本轮未改profile/启停/重启/真实会话/模型，未merge。

进入 [具体候选安装与原生闭环验收](../tasks/P3-006A-live-validation.md)。任务已准备好，需用户明确授权后由p0-mode-shell执行；不新增同类调查，不为无关细节再次阻塞。p1-engine继续P3-006-B独立推进。底层快照/布局与该旧引擎候选仍是不同阶段，不能宣称整个v0.3已完成。
