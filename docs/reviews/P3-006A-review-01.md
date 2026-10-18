# P3-006-A 复审：原生创作会话候选

日期：2026-10-18。对象：p0-mode-shell / PR#3，功能 `26bd4c1`、交付 head `eb8d2d8`。结论：**需要修复 R1–R4，暂不进入安装；产品路线与接线范围保持。** 四项集中一次交回，不新增调查任务。

## 独立验证

- fetch 成功；开发树 HEAD 为 `eb8d2d8`，工作树干净。
- 独立执行 `npm run check`：静态40/40、Client52/52、Host25/25，共117/117；版本门禁10/10。
- 固定包55,723 B、19个文件，逐个与 `26bd4c1` 的 Git 内容相同；SHA-256 `a5bbffa4f8dc65d131f42b479be313fb6d8c77b7676830fbf7a07ed91ccabd60`。
- staging INTEGRITY SHA-256 `c282cb11966a627eb4b816d5bd645399a903fff5cae9a3596e0e308b774ee3af`；bundle18、engineClient12、engineWorker15项文件摘要复核通过，引擎源码与固定 `54f4671` 一致。仍为根0.3.0-alpha.1 + 引擎0.1.1，不混淆版本。
- 随本机ASAR只读复核 `sessionController.create/rename` 和 `systemPrompt.context` 的入口形态；没有调用真实服务。原生kit/会话/模型/审批/渲染仍待安装验收，自动检查不代表真机通过。
- 自建临时目录、直接调用候选真实模块复现下列四项，无修改开发树、安装路径、profile或真实Session。复现脚本与JSON：同级 `artifacts/reviews/2026-10-18/P3-006A/{repro.mjs,repro-result.json}`；运行 `node <该目录>/repro.mjs`。脚本使用受控controller，不启动模型或worker。

## R1 [P2] 写盘失败仍发布内存映射与工具权限

位置：`host/session-state.js:198–207`（queueWrite）。`mutate(state)`先改权威内存，再等待write；rename/大小限制等失败不会回滚。不是仅留下一份UI草稿：`projectForSession`直接读取此内存，Tool范围检查会承认未持久化的绑定。

独立复现：空store加载完成后，在state文件目标位置创建目录，使真实rename返回 `EISDIR`；`addSession`拒绝，但随后 `projectForSession('session-one') === 'demo'`，history/active也包含该Session。重启将丢失它。

要求：串行队列中用隔离候选状态变更，持久写入成功后才发布；异常不得改变已提交内存。回归add/select失败、排队后续成功、读者在写入未完成期间看到的状态；临时文件失败清理一并处理。不要仅让UI隐藏失败结果。

## R2 [P2] Session请求绕过inFlight，停用提前完成

位置：`host/bridge.js:565–568`；`host/sessions.js:377–390`。Session分支直接return，未加入已有inFlight；SessionService.dispose也不排空creating。

独立复现：受控controller.create卡在可控Promise，调用bridge.invoke(session.create)；controller已进入时inFlight为0。await bridge.dispose立即完成并置disposed；此后放行controller，Session才创建完成，写映射遭 `E_SESSION_STATE_DISPOSED`。已接受操作留在旧插件生命周期之外，真实Host会遗留未绑定Session，HMR可能与新实例交错。

要求：Session操作纳入统一准入/排空，closing后不再接新请求；已开始且不可撤销的create应按明确策略收束并持久登记，清理必须在此之后完成，不能由停用关闭store制造失败。回归controller与rename各自延迟、list/select、重复dispose和晚到context；dispose完成后无旧实例写入或注册。

## R3 [P2] 已知映射损坏仍先创建宿主Session

位置：`host/sessions.js:299–320`。create先调用controller，随后才读取store；读取错误被吞成ordinal=1，最终addSession才失败。

独立复现：state文件内容`{broken`，调用create，controller.create实际被调用1次，最后返回 `E_SESSION_STATE_CORRUPT`，坏文件虽保留但已产生孤立会话；重试还会继续创建。

要求：不可恢复的已知前置错误（损坏/未知版本/工程归属/数量上限）在宿主create前拒绝，不吞成正常编号；磁盘在预检后才故障的情况仍诚实报失败，不能声称能事务回滚宿主Session。增加损坏与未知版本、上限的零create调用回归。

## R4 [P2] requestId去重跨工程返回错误Session

位置：`host/sessions.js:293–295`、rememberCreated。created仅按requestId缓存，没有工程范围或参数签名。

独立复现：允许工程a/b，create(a,same-key)后create(b,same-key)，返回projectId=a及a的Session，controller只调用1次。外层allowlist只检查b允许，不会纠正返回值。当前demo单工程不触发，但受支持多工程API与范围契约不能返回另一工程结果。

要求：去重按工程+requestId隔离，或相同key异工程明确冲突；不能成功返回不属于请求工程的Session。同工程重试与并发单飞保持，补异工程复用key测试。

## 修复后交付

沿用本树/PR#3与P3-006-A白名单、固定引擎54f4671；只修问题、补故障回归、更新原任务/研究记录。生成新提交目录的包/staging，不覆盖候选或当前安装。根候选可保持alpha.1（未安装发布），摘要按新提交重算；Host变更后按已有真实链复跑，不要求新增调查报告。用户转发后开发推进；总调度复审通过才进入具体候选安装授权。

本轮未安装/启停/重启、未改profile、未创建真实会话、未调用模型、未合并；开发者真实渲染链为交付证据，本轮未重跑该链。左PNG与右原生AI布局方向符合任务；本报告不宣称视觉或原生交互已验收。p1-engine的P3-006-B可继续独立开发。
