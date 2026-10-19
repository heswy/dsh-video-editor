# P2-001 R1–R3 复审与真实断管补验

日期：2026-10-17。提交 `51f562a`，相对 `1f45f15`。结论：**原 R1–R3 已关闭；新增 R4 阻塞 Host 接入。**

## 本轮通过项

实读字节 Buffer 组行、pending.method 的 uncertain/jobUnknown 传播、退出等待 clearTimeout；独立 `npm test --prefix packages/video-engine-client` 9/9 通过（约 7.93 秒），包含真实 worker 成功与冲突/取消链，以及新增 UTF-8、退出/坏帧不确定性、独立父进程自然退出回归。stderr 按原始 bytes 截断，未重复采用会放大 replacement bytes 的字符串计数。

这些修复不需要改 worker 或 DSH。主会话未修改开发树跟踪文件，未安装 DSH。新增编辑退出用例验证未响应标记，但子进程没有先写可观察标记；本轮根据实现确认标记传播，不额外要求扩展存储故障测试。

## R4 [P1，阻塞接入] stdin 的 EPIPE error 事件未处理，父进程异常退出

位置：`packages/video-engine-client/src/index.mjs` 的 start（只为 ChildProcess 绑定 error）及 request 的 `child.stdin.write`（约 229 行）。ChildProcess 的 error 与 stdin Socket 的 error 是不同事件。write callback 处理错误并不等于消费 Socket 的 error；目前后者没有监听器。

主会话使用隔离父进程和受控子进程独立复现：子进程读取 doctor 请求并正常应答，然后关闭 fd 0，但仍存活；父进程等待 100ms 后调用 client.edit。结果父进程 **exit code=1**，未进入用户 catch，也未执行完 finally/dispose，stderr 为：

```text
node:events:496
  throw er; // Unhandled 'error' event
Error: write EPIPE
...
WorkerClient.request (.../src/index.mjs:229:24)
Emitted 'error' event on Socket instance
```

子进程为 /tmp 自有 Python fixture，用于可靠关闭 stdin 的 fd，无用户工程或应用。原首审的“断管”路径现在仍不能安全传播错误；现有 edit-exit 用例让 worker 整体退出，未覆盖这个“输入管道先关闭、进程仍存活”的窗口。将来如果导入 Host，会把引擎传输故障升级为调用方进程未捕获错误，不能以 uncertain 标记已增加就视为完整修复。

复现核心（子进程收到 doctor 后）：

```python
import os, sys, time, json
r = json.loads(sys.stdin.readline())
sys.stdout.write(json.dumps(dict(v=1, id=r['id'], ok=True, result={})) + '\n')
sys.stdout.flush()
os.close(0)
time.sleep(1)
```

调用方使用 WorkerClient 启动该受控 fixture，await start()，等待其关闭 stdin 后 await edit()；隔离父进程应捕获结构化错误且正常结束，而不是依赖主进程 uncaughtException 全局兜底。修复回归可使用等价的纯 Node/子进程 fixture，不新增生产依赖或依赖 Python。

## 修复验收

- 为拥有的 stdin/stdout/stderr 流错误提供有生命周期的处理，确认 error 和 write callback 并发到达时只结算一次；不能用空 listener 吞掉故障让 pending 悬挂。
- 断管后停止接收请求，所有 pending 得到结构化传输失败；已发 edit 保留 uncertain=true，frame/render 保留 jobUnknown=true，不自动重试或重放。
- 有界退出/清理自身 worker，dispose 幂等，清理监听/计时器。不要以“父进程没有崩溃”替代 pending 全部落定和子进程退出。
- 新增**隔离父进程**正式回归，覆盖 worker 只关 stdin 而未退出时发请求；父进程正常退出、错误可 catch、无未捕获事件、pending=0、无无关进程受影响。沿用原 P2-001 白名单，不改 worker、DSH 根代码或已提交评审原文。

原三项已通过，不要求重构架构。修复 R4 并补回归后再交复审；DSH 的 0.1.3 包本地已通过，可独立等待用户安装授权。
