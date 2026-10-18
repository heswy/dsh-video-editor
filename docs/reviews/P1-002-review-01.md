# P1-002 独立 worker 复审

日期：2026-10-17。评审提交 `b59dbbb`，位置为引擎会话自己的 b4bf worktree。主会话只读源文件并运行受控验证，未改该树跟踪文件、分支或依赖，未操作 DSH。

## 结论：需修复 R1 后复审

受控工程的独立 worker 路线成立；本轮未发现需要改架构的问题。发现一项关闭工程的并发缺陷，在 DSH Host 接入前修复。不以现有测试全部通过替代这项生命周期验收。

### R1 [P2，接入前阻塞] close 等待期间仍接收新作业，关闭后继续渲染并发布

位置：`packages/video-engine-worker/src/worker.mjs:93–98`，以及 `src/jobs.mjs:68–75`。

`close` 先调用 drain，再排队删 handle；drain 只取消并等待当时 Map 中的作业。close 期间没有工程级 closing 门禁，frame/render 仍可调用 start。若新作业在 handle 删除前取得快照，就不在原 drain 集合中，close 返回后仍可运行和发布产物。关闭编辑器工程后留下后台作业、占用资源并写出文件，违背 close 的排空语义。

主会话通过真实 worker、官方 CLI 独立复现：

1. open demo，render，等待第一个 job.state === running。
2. 发 close 请求，但不等待；紧接着为同一工程发第二个 render。
3. 等 close 响应成功；读取第二个作业状态，再等待终态。

Node 24.14.0 的实际结果：

```json
{"node":"v24.14.0","closed":{"projectId":"demo","closed":true},"accepted":true,"stateAfterClose":"running","eventualState":"succeeded","artifactPublished":true}
```

同一场景在 Node 22.15.0 也复现。复现使用测试 helper 的临时受控 fixture，无用户工程；完成后 shutdown 并移除自己的临时工程。

可在引擎工作树根运行以下片段（启动 Node 路径由开发环境选择）：

```js
import { fixture, client, waitJob } from './packages/video-engine-worker/test/helpers.mjs';
const f = await fixture(), c = client(f.registry);
try {
  const revision = (await c.call('open', {projectId:'demo'})).result.revision;
  const first = (await c.call('render', {projectId:'demo', revision})).result;
  await waitJob(c, first.jobId, j => j.state === 'running');
  const closing = c.call('close', {projectId:'demo'});
  const second = await c.call('render', {projectId:'demo', revision});
  const closed = await closing;
  const after = second.ok ? await c.call('status', {jobId:second.result.jobId}) : second;
  console.log({closed, second, after});
  if (second.ok) console.log(await waitJob(c, second.result.jobId));
} finally { await c.stop(); await f.cleanup(); }
```

修复要求：建立工程关闭的明确时序和准入边界。在开始排空前阻止该工程新 frame/render/edit 等内容操作；定义并发 open/close、重复 close、关闭完成后 reopen 的一致行为。也可采用等价的串行生命周期方案，但不能把整段 render 放到请求串行队列中阻塞 cancel/status。成功 close 返回时，该工程旧生命周期无活动作业、私有目录与拥有的子进程；随后不会再发布该生命周期的产物。其它工程不受影响。

补正式回归：running render + close + 并发新 render/frame/edit；两个 close 与 reopen 的顺序；关闭后状态稳定、没有新产物、无残留进程、无关 sentinel 存活。测试不得依赖很短的渲染窗口来碰运气，应有可靠的运行阶段/同步条件。既有成功产物应保留。只修原任务范围，追加回应，不改评审原文。

## 已独立验证

- `npm test --prefix packages/video-engine-worker`：7/7。
- `npm run test:real --prefix packages/video-engine-worker`：2/2，约 53.7 秒。真实抽帧、快照渲染、取消、超时、EOF、shutdown、SIGTERM 的现有用例通过。
- `ffprobe -count_frames`：H.264、1280×720、30/1、150 帧、5.000 秒。
- 复跑 MP4 SHA-256：`86a8ed261e76283da602de17e1e2aec8f61a7398d816c8bd160bef73d658a863`，与开发交付一致。
- 实读协议入口、工程 revision/队列/SDK persist/readback、私有快照、作业发布和进程拥有者清理实现。引擎 worktree 检查前后跟踪文件均干净。

复测重写了测试本来就会生成的忽略产物/evidence；这属于本次独立复跑，不将其冒充开发提交中的原始文件。R1 已在显式 Node 24.14.0 下复现；其它命令使用测试脚本选择的运行时，不扩大为全版本兼容验收。

## 范围限制与交接

接受当前受控 fixture 范围，不要求此轮补任意代码安全隔离、跨进程持久幂等、磁盘满原子回滚或跨平台分发；这些已明确未验证。DSH 接入、任意生成代码执行、真实用户工程依然未通过。本轮不 merge、不 push、不安装。

原引擎会话自行读取本评审并修 R1，返回修复提交、正式回归和验证证据再复审。DSH 的 P0-005 侧栏与界面精简继续并行，无需等待或修改 worker。
