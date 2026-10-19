# P3-012 第三轮复审：开发候选通过，进入真实对话验收

日期：2026-10-18。对象 video-studio / PR #4，交付 HEAD `19a7743`；运行时 root `a59fb13`，engine `0deef8f`；bundle `0.3.0-alpha.4` / 两引擎包 `0.4.0`。

## 结论

**开发候选通过。R1、R2 及 R2-follow-up 均关闭；没有本轮阻塞发现。** 这不是实际 DSH 安装或真实模型闭环通过。下一步仅执行 [P3-013](../tasks/P3-013-conversation-live-acceptance.md)，不再扩展功能或恢复手动编辑。

## 总调度独立复核

- 检查实际 client 差异：每个 snapshot instance 持有 width/height/duration；加载前捕获目标 revision 元数据；active 与隐藏 candidate 分别按自身尺寸渲染；可见舞台、seek、时间码使用 active；ready 后统一切换并按新时长 clamp。Host/engine 本轮未变。
- 本轮实跑 `npm run check`：**181/181**（52 静态 + 75 Client + 54 Host）；`test-stage-version.mjs`：**10/10**。
- 固定 staging 真实 Host/Tool/worker + Chrome 正常生成/续改链：**261/261，ok=true**。
- 固定 staging 浏览器 `DSH_R2_STRESS=1`：**159/159，B1–B5 全 true**。复测 snapshot 请求失败、candidate runtime 失败、延迟响应三种情况：旧 720×1280 / 5s 作品的 iframe、stage 比例、seek.max、时间码和可播放状态均保持；等待期间旧 snapshot 不释放；成功后统一切换 1280×720 / 6s，旧 snapshot 释放恰一次；旧消息隔离、记录有界、teardown 通过。
- INTEGRITY 实际 SHA-256：`c28b60adadd1fdb419651598220e0dddddb096663d0699f9112058c91bdfe46a`。逐文件重算 bundle **22**、engineClient **18**、engineWorker **38** 条记录的字节数与摘要全部一致。
- 本轮未重跑未变化 engine 的长套件。其 worker 46/46、compose 6/6、client 22 pass + 1 skip 是上一轮总调度复核证据，不冒充本轮新执行。

独立产物：同级 `artifacts/reviews/2026-10-18/P3-012-r3/` 的 chain/、preview/；分项日志 `/tmp/p3-012-r3-{check,version,chain,preview}.log`。浏览器 runner 使用测试 React 调度及 inert 原生会话接口；真实部分是 staged client/Host/worker、快照和 Chrome，**没有真实 DSH 原生 Conversation 或模型请求**。

本轮未安装、启停、重启、改 profile/用户工程、发模型请求或 merge main。旧候选和用户作品保留。候选安装步骤和真实模型请求由用户转发 P3-013 具体授权后，仍由同一个 video-studio 开发会话执行。
