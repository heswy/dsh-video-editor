# P1-002：独立视频引擎 worker

执行：原 Codex 引擎会话，自行管理其 worktree/分支；主会话不切换/同步该工作树。状态：已放行受控项目实现，不做 DSH 安装或任意代码执行。

P1-001 已通过本机单 Scene 可行性验收。读原研究与 [ADR-0001](../adr/0001-independent-video-worker.md)，沿用固定引擎版本与原生 HTML。无需重做全部 spike，不升级依赖追新。

## 文件归属

仅修改 `packages/video-engine-worker/**`（独立 package.json、锁、源码、测试、README）、`docs/research/P1-002-*.md` 与本任务开发记录。root Client/Host/manifest/锁文件、P0、全局状态/规则、原 spike 均不改。不可复制系统字体进 Git。

新文件/目录由本会话在自身 worktree 创建。主会话协调分支持有本指南；若自己的 tree 没有此文件，先通过 `git show codex/project-foundation:docs/tasks/P1-002-engine-worker.md` 读取，再只导入本指南和 ADR（不要 merge 主会话整个分支或覆盖自身开发成果）。

## 目标闭环

测试父进程启动 worker → doctor → 打开受控 fixture → inspect → edit(expectedRevision) → 读回重开 → frame → render(jobId) → status / cancel → shutdown；真实上游 SDK/CLI 后端，不以内存 mock 宣称完成。

## v1 协议与行为约束

- stdio JSON Lines，请求包含 `v:1,id,method,params`；响应按 id 对应 `{v,id,ok,result}` 或 `{v,id,ok:false,error:{code,message,stage}}`。stdout 禁止混入 CLI/诊断输出，stderr 有界且脱敏。设置并测试行长/输出大小、参数类型和时间范围边界。
- 方法先限 doctor/open/inspect/edit/frame/render/status/cancel/close/shutdown；无需增加创作 agent、UI、HTTP 服务或扩散模型调用。
- `open` 仅接受启动时 Host/测试父进程明确注册的 projectId→受控目录映射；不能让请求任意指定绝对路径或 URL。当前只允许 fixture 来自 P1 自有样例，实际路径 realpath 校验；符号链接不允许逃出受控根。不把该检查宣称为安全沙箱。
- `inspect` 返回 stableId、文本、真实 timing、supported capabilities 与 revision。适配 data-duration 与 SDK duration=null 的已知差异，不能返回伪造 0 时长。
- `edit` 暂仅文本与 timing 的 typed ops；要求 expectedRevision 与 operationId，工程级单写者队列；冲突不写盘；persist:error、flush、磁盘读回都成功才更新 revision。定义并测试重复 operationId 的幂等/拒绝语义，别让重试执行两次。
- revision 采用定义清楚的入口+本地声明资产路径/字节哈希清单，剔除缓存/历史/产物。编辑前重读以发现外部文件变化；render/frame 使用固定 revision 的私有快照，不能渲染“最新文件”后标成旧 revision。
- `render` 立即返回 jobId，不堵住读请求和 cancel。作业状态 queued/running/cancelling/succeeded/failed/cancelled/timed_out；只有元数据验证通过的完整 MP4 可 succeeded。失败/取消后不发布半成品为成功，不覆盖已有成功产物。
- cancel 幂等；收到请求先 ack cancelling，确认拥有子进程清零及临时清理后 cancelled。限定进程拥有者，不使用全局 kill-all；丢失父进程/stdin 关闭和 shutdown 都处理自己拥有的任务。先只支持本机 POSIX，明确限制。
- 状态和产物元数据返回 projectId、revision、jobId、hash、frame/time、工具版本；错误不泄露任意磁盘文件。不要设计与 DSH session 混淆的 worker sessionId，优先用 projectId/handleId。

## 验证与交付

优先真实行为测试：两个竞争 edits、外部修改导致 conflict、资产变化影响 revision、固定快照渲染、render 期间 cancel 仍可响应、取消不误杀无关进程、异常/stdin EOF 清理、stdout 协议纯净、越界/符号链接拒绝、SDK 保存失败、坏 JSON/未知 method/重复 id。

允许自身 package 的固定版本本地依赖安装和受控样例执行，检查 scripts 后保持 ignore-scripts；不全局安装、改宿主、付费调用、上传素材、push/merge 或发跨会话消息。长任务有超时、日志有上限。

产物与 node_modules 局部忽略。返回 commits、协议 schema/示例、父进程启动命令、版本/真实样例结果、失败用例与未验证项、产物绝对路径。DSH 启动/打包/生命周期集成留给 P2。

## 开发记录

- base / result commit：`e88615f` / 当前工作树交付提交（见交接回复）。协调指南来源
  `codex/project-foundation@5589add087349ea09137fb3340e6cd27fb129fbc`；仅以 git
  show 导入本指南和 ADR-0001。
- 实现文件与启动命令：`packages/video-engine-worker/**`；从仓库根使用
  `node packages/video-engine-worker/src/worker.mjs --registry
  packages/video-engine-worker/artifacts/registry.json`。包 README 和 JSON Schema 记录
  v1 stdio 协议、受控 registry 和各项限额。
- 协议/真实作业/修订与取消验证：`npm test --prefix
  packages/video-engine-worker` 为 7/7，`npm run test:real --prefix
  packages/video-engine-worker` 为 2/2。真实 SDK 编辑重开、revision conflict/资产变化、
  固定快照 PNG/H.264 MP4、cancel/timeout/EOF/shutdown/SIGTERM、stdout 纯净和仅清理拥有
  进程均有行为测试；完整事实和命令见 `docs/research/P1-002-engine-worker.md`。
- 产物与限制：忽略的真实产物位于
  `packages/video-engine-worker/artifacts/worker.mp4`（SHA-256
  `86a8ed261e76283da602de17e1e2aec8f61a7398d816c8bd160bef73d658a863`）和
  `worker.png`（`efca929677830434624a262bc13b2f6e1dd39af70619e3455c6753ac079441db`）。
  仅本机 POSIX 受控 fixture，非安全沙箱；DSH 生命周期集成留 P2。
- R1 首审修复：在 projectId 关闭开始时同步建立 lifecycle gate；并发 open/inspect/edit/
  frame/render 返回 `E_PROJECT_CLOSING`，重复 close 合并排空，close 完成后才可 reopen。新增真实
  官方 CLI 回归覆盖运行中 render、两个 close、并发内容请求、产物保留、进程 sentinel 和 reopen；完整
  结果为协议 7/7、真实作业 3/3（最终完整复跑分别为 7.35 秒、55.79 秒），细节见研究记录。
