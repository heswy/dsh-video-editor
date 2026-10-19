# 2026-10-18 统一开发工作区整合记录

用户明确授权合码与单DSH会话开发。新树video-studio / codex/video-studio，原p0/p1及PR不关闭、不删除、不改写；main保持初始提交。用户作品/安装staging只读，未归一化或迁移覆盖。

## 整合来源与冲突

- p0 head fdb6bc2，功能7d60312，根alpha.3。
- p1 head c31fde5，功能d383e3d，两包0.3.2。
- 原协调e01fb15，后续统一规则来自本轮协调提交。
- 引擎合并提交1d5039e；协调文档合并提交7e930f5，双方历史均为祖先。生产Client/Host/index/package/scripts与fdb6bc2逐文件git diff为空，packages与c31fde5为空，没有为合码改功能行为。
- 冲突均是规则/历史任务及research。产品/设计/全局记忆取最新协调，开发执行记录与部署README取最新feature。每个冲突路径和选择记于统一树docs/research/2026-10-18-integration-conflicts.json；未选版本仍完整保留在Git父历史，不reset/强推。

## 独立依赖与检查

统一树worker/client按各自锁npm ci --ignore-scripts --no-audit --no-fund，不执行未知postinstall、不链接旧树node_modules。建立任务自有ignored artifacts。

- npm run check：174/174（48静态、80Client、46Host）。
- 显式Node24.14.0运行worker单元/协议：44/44，约12.9s。
- 顺序运行client：20 pass+1 opt-in skip，约16.5s，包含真实worker和打包链；命令级PATH包含/opt/homebrew/bin。未重跑全部长渲染/浏览器或用户GUI。
- 日志保存在同级artifacts/reviews/2026-10-18/integration/。测试未改生产源码、用户工程、旧staging或profile。原两树干净状态在合并前确认，合并在新树内进行。

## 未完成的产品问题

合码没有修复用户报告的鹈鹕左画布空白、demo改色空转。已只读核实实际安装alpha.3、项目无Scene标记、前端Scene条件/轮询门禁及legacy球缺style能力。整体创作验收仍FAIL，统一会话按P3-011修复；候选测试数不能替代真实创作。

后续由用户在DSH打开video-studio并新建一个会话、转发当前handoff启动。不是由总调度自动创建/联系开发Agent。安装/真实模型/重启授权独立，不因合码自动执行。

统一分支已推送origin/codex/video-studio。草稿PR创建请求在GitHub API超时，结果未确认；后续先按head=codex/video-studio查询并复用，避免重复创建。此状态不影响打开统一工作区开发，原PR#1/#2/#3未关闭。
