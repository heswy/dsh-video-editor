# P3-009 复审：完整 Scene template 读取契约

日期：2026-10-18。对象：p1-engine / PR#2，功能 **d383e3d53a9401285519ee578d993081c3cb4b51**、交付 **c31fde5**，client/worker **0.3.2**。结论：**本任务通过，可作为 p0 最终整合的固定引擎基线。** 不代表 p0 的 R1–R5 已修复或新界面已安装验收。

## 代码与兼容边界

独立 fetch 后核对 p1 树干净。相对已审 82f6219，生产改动集中于统一 Scene summary/template 投影、模板文本长度对齐，以及阻止受控 Scene title 通过 text edit 变成空值；client 生产代码、jobs/render、覆盖与合并源码保持原样。JSONL v1、22 方法、scene.update 完整替换语义未改变。已有黑带适配保留。

投影来自权威受控 HTML 的解析模型，冻结字段为 `{title,duration,subtitle?,badge?,color?,accent?,logo?,shot?}`，不带 sceneId/order/start/elements 或绝对路径。schema 的 summary/inspectScene 与 sceneTemplate 输入一致。模板中真实存在的空 badge 可返回空串，不虚构缺失的 subtitle/logo/shot。legacy scenes=[] 保持。

原 typed text 允许 2048 字符，而模板 title/subtitle/badge 的旧输入上限为 200/300/48；对齐到 2048 是保持人工文本可往返所需的边界修正。空/纯空白受控 title 返回 E_PARAMS，不写入；legacy 的原行为通过独立全套回归。scene.update 仍不是 partial patch，前端必须从当次 inspect 的完整 template 复制，只改目标字段并携带对应 expectedRevision；缺失 template 时明确拒绝，不猜默认值。

## 独立验证

命令级 PATH 包含 /opt/homebrew/bin，显式 Node24.14.0，worker/client 串行运行，未改源码或依赖：

- worker：`node --test --test-concurrency=1 test/*.test.mjs`，**44/44**，约13.3s。包含完整字段、color/shot 保留、快照 HTML、人工覆盖、历史、重开、schema 与旧协议回归。
- client：相同 test 命令，**20 pass + 1 opt-in skip**，约18.2s；包括真实 worker、显式 env/cwd、打包与 Scene template 透传。跳过项是配置指定 Desktop runtime 的 opt-in 用例，不写成21项全通过。
- 额外公共 JSONL 探针：2048字人工 title 投影；只改 color 保留完整模板与人工 logo 布局；混合批次先改 badge 再写空白 title，整批 E_PARAMS、revision/badge 不变；整 worker 重启后 open 返回同一完整模板。**4/4** 通过。
- 固定 tarball 全部条目逐文件比对 `git show d383e3d:<path>`，client3/3、worker14/14 一致；摘要与交付一致，见下表。

| 包 | bytes | SHA-256 |
|---|---|---|
| client 0.3.2 | 7494 | `0830ab717ac2ef2572faf95aacace0778d5dc379cdfcc4546b48e6fa851311a5` |
| worker 0.3.2 | 57022 | `e4e161418c252e6973760ca20d8aff890eabcf26a0bce5e93e0bfb6bef3716c3` |

原包位于 p1-engine 的 artifacts/engine/d383e3d/。总调度日志、独立 probe/result 与 package-check 位于同级共享 artifacts/reviews/2026-10-18/P3-009/；未覆盖交付产物。开发者真实链12/12和干净 archive 重复 pack 作为开发交付证据，本轮未重复全部长渲染或再次 archive pack。只读契约变更无需重复已验收黑带定位；p0 新 staging 仍需验证完整导出。

## 后续与权限

p1 本任务收口，不扩大到 Host/UI。p0 固定 d383e3d/两包0.3.2，集中解决联合复审 R1–R5，补实际 CanvasWorkspace 浏览器交互、Host Tool→worker 续改与新 staging 证据。不能从移动 HEAD 取包，不能因为投影通过就关闭前端丢字段问题。未安装、未启停/重启、未改 profile/用户工程、未调模型、未 merge；当前 alpha.1 安装保持。
