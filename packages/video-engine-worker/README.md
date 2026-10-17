# 独立视频引擎 worker v1

P1-002 受控 fixture 的独立 Node/ESM 进程。HyperFrames SDK / CLI 固定 0.8.167；不依赖 DSH 根插件，不提供 UI、HTTP 或任意代码执行服务。父进程通过 stdio JSON Lines 调用。

## 启动与复现

从仓库根运行；Node >=22、现有 FFmpeg/ffprobe 和 Chrome/Chromium，当前仅验证 macOS arm64 / POSIX。

```sh
npm ci --prefix packages/video-engine-worker --ignore-scripts --no-audit --no-fund --cache "$PWD/packages/video-engine-worker/.cache/npm"
npm run prepare-fixture --prefix packages/video-engine-worker
node packages/video-engine-worker/src/worker.mjs --registry packages/video-engine-worker/artifacts/registry.json
```

prepare-fixture 会重置本包 artifacts/projects/demo，复制本地 GSAP、MotionPathPlugin 和系统字体。字体默认 `/System/Library/Fonts/STHeiti Medium.ttc`，可用 `VIDEO_FONT_PATH` 指定；启动配置 `browserPath` 可指定 Chrome，prepare-fixture 可读取 `VIDEO_BROWSER_PATH`。默认浏览器路径仅用于当前 macOS 实测，其他机器由父进程明确配置；Node 使用父进程选定的 executable，子进程沿用 `process.execPath`，没有把系统 Node 路径写死为分发契约。

registry 是可信父进程的启动配置，非协议请求：

```json
{"root":"/absolute/controlled/projects","projects":{"demo":"/absolute/controlled/projects/demo"},"outputRoot":"/absolute/worker-output","browserPath":"/absolute/chrome"}
```

仅把本仓库自有 fixture 放入 registry；不注册不可信用户 HTML/JS。project.json：

```json
{"entry":"index.html","assets":["assets/gsap.min.js","assets/MotionPathPlugin.min.js","assets/Heiti.ttc"]}
```

v1 固定 index.html、30fps、H.264；frame 精确时间 PNG。项目根、入口、manifest 和资产使用 realpath 检查，禁止符号链接逃逸、绝对/URL/上级路径；项目内指向内部文件的链接允许。快照只复制入口与声明资产的字节，不复制历史、缓存、node_modules 或原工程产物。SDK 字体不入 Git。

## 协议

每行一个 UTF-8 JSON 对象，行长/响应均 <=65536 bytes（不含换行）；顶层及 params 拒绝额外字段。id 为非空字符串 <=128 字符，整个 worker 生命周期不得重复。坏 JSON/超长行的响应 id=null；超长行丢弃到换行后继续。错误统一 `{code,message,stage}`，不回传磁盘路径、源码或原始引擎日志。

```json
{"v":1,"id":"a1","method":"doctor","params":{}}
{"v":1,"id":"a1","ok":true,"result":{"node":"v24.14.0","hyperframes":"0.8.167"}}
{"v":1,"id":"a2","method":"open","params":{"projectId":"demo"}}
{"v":1,"id":"a2","ok":true,"result":{"projectId":"demo","revision":"<64 lowercase hex>","elements":[]}}
{"v":1,"id":"a3","method":"edit","params":{"projectId":"demo","expectedRevision":"<revision>","operationId":"edit-title-1","ops":[{"type":"text","target":"hf-title","text":"每一帧，都可编辑"},{"type":"timing","target":"hf-title","start":1,"duration":3}]}}
{"v":1,"id":"a4","method":"render","params":{"projectId":"demo","revision":"<saved revision>","timeoutMs":120000}}
{"v":1,"id":"a5","method":"status","params":{"jobId":"<returned jobId>"}}
{"v":1,"id":"a6","method":"cancel","params":{"jobId":"<returned jobId>"}}
{"v":1,"id":"a7","method":"shutdown","params":{}}
```

以上响应是字段节选，尖括号需替换成实际值。完整请求/响应 envelope schema 在 protocol.schema.json。未来 Host 父进程需持续读 stdout、独立生成 request id、按 id 对应响应，不假定响应顺序。

| 方法 | params | result |
|---|---|---|
| doctor | {} | 启动时实际 Node/SDK/CLI/GSAP、Chrome、FFmpeg/ffprobe 版本；缺工具显示 unavailable |
| open | projectId | 已注册工程的 inspect；未知映射拒绝，无 path/URL 参数 |
| inspect | projectId | revision、尺寸、时长、stableId、文本、原生 timing、capabilities、路径/字节/hash 清单 |
| edit | projectId, expectedRevision, operationId, ops | 保存/读回成功后的 revision；ops 限 text 与 timing，最多32项 |
| frame | projectId, revision, time, timeoutMs? | 立即返回异步 PNG job；time 位于 [0,duration−1/30] |
| render | projectId, revision, timeoutMs? | 立即返回异步 MP4 job，queued；不等待渲染完成 |
| status | jobId | 当前状态、阶段、进度、projectId/revision/jobId、工具版本；成功时 artifact |
| cancel | jobId | 非终态立即 ack cancelling；终态幂等返回；清理完成才 cancelled |
| close | projectId | 取消/排空该工程任务和编辑，再释放 handle；保留本 worker 的幂等记录 |
| shutdown | {} | 取消/排空全部任务、写队列，响应后退出 |

frame/render 后台通过同一工程队列取得快照。若源已变化，作业 failed + E_REVISION_CONFLICT，不能取最新文件冒充旧 revision。状态 queued→running→succeeded/failed/timed_out，或 queued/running→cancelling→cancelled。frame 超过实际场景末尾在快照阶段 failed + E_PARAMS；请求本身的负数、类型等立即返回错误。所有长作业有 100–120000ms deadline（默认120000）；范围检查、快照复制和文件哈希由受控大小限制，CLI deadline 从启动上游 CLI 开始。

stdout 仅协议，CLI stdout/stderr 通过管道捕获，不转发。捕获尾部最多64KiB；worker stderr 总量最多16KiB，仅固定阶段说明，既不写源码也不写凭据或路径。每进程最多10000个请求id、2048个成功 operationId、256个作业（最多4个活动），达到上限拒绝；父进程负责持续消费 stdout。

## 内容与修订

revision = SHA-256(JSON.stringify({entry,files}))；files 按声明相对路径排序，每项 `{path,bytes,sha256}`，sha256 对原始文件字节计算。manifest 的 entry 和声明资产集合影响 revision；manifest 排版、资产声明次序、未声明文件、.hf-versions/.hyperframes/产物均不进入清单。动态依赖发现不在 v1 范围，受控 fixture 必须声明所有本地依赖。

inspect 读取真实 data-duration，缺省才用 SDK 快照 duration（可能 null），不伪造0。capabilities 是当前实际可编辑范围：叶级 HTML 文本，已有显式 timing 的非 composition 元素。编辑单写者队列串行；两个不同 operationId 竞争相同 expectedRevision，只能一个保存。完整 batch 按顺序累计校验 timing，防止组合后越过场景末尾。SDK fs adapter 执行 batch、persist:error 监听、flush、磁盘 readback 全部成功后才发布 revision。

operationId 以 projectId 为作用域：同一规范化请求（JSON 对象键顺序无关，ops 数组顺序保留）返回首次成功结果而不再次写盘；不同内容拒绝 E_OPERATION_REUSED；失败操作不缓存。重试返回的是原结果，不代表当前工程仍处于该 revision。幂等表仅本进程内存，重启后由 expectedRevision 拦截过期修改；跨进程持久 operation journal 留给 Host 集成。

外部文件变化在编辑前重读两次与 revision 比较；私有快照保存已计算清单的字节，再核对源 revision，后续编辑/资产变化不影响已取得的快照。worker 内只有一条写队列；不声称能对不配合的外部写者提供跨文件原子 CAS，正式 Host 必须拥有唯一写入入口，外部编辑通过版本冲突/重新 open 协调。SDK adapter 如果写入后版本历史失败，不能把该错误视作成功；本轮验证真实目录无写权限失败且入口保持原样，其他存储故障恢复待扩展。

## 作业与清理

每次 CLI 只访问自己的私有快照与 tmp；使用固定参数数组，无 shell 命令拼接。进程跟踪沿用 P1 经验，覆盖 detached Chromium/helper，发信号前核对 PID、启动时间、命令，仅清理拥有的进程；TERM 宽限1.4秒后 KILL，确认清零后删除私有目录。不使用全局 kill-all。取消/超时不会发布半成品，成功产物使用独立 jobId 文件名，不覆盖已有成功文件。MP4 必须经 ffprobe -count_frames 核验 H.264、尺寸、30fps、帧数和时长（<=1帧容差），PNG 验证签名与尺寸，之后才发布 metadata/hash。

stdin EOF、shutdown、SIGINT/SIGTERM、未捕获异常路径均尝试排空并清理。EOF 和信号是真实行为测试；无法在 SIGKILL 或机器断电后执行用户态清理，P2 需父进程监督与重启恢复策略。采样式进程跟踪、路径 confinement 和独立进程均不是安全沙箱，不允许扩大到任意 Agent 生成代码。

错误码：E_JSON/E_LINE_LIMIT/E_OUTPUT_LIMIT/E_VERSION/E_DUPLICATE_ID/E_METHOD/E_PARAMS/E_LIMIT、E_PROJECT_NOT_FOUND/E_PROJECT_NOT_OPEN/E_PROJECT/E_PATH/E_ASSET_MISSING、E_REVISION_CONFLICT/E_OPERATION_REUSED/E_UNSUPPORTED_EDIT/E_PERSIST、E_JOB_NOT_FOUND/E_SHUTDOWN/E_SNAPSHOT/E_RENDER/E_METADATA/E_CLEANUP/E_INTERNAL。状态 failed 的 error 有 stage；cancelled/timed_out 为明确终态。

## 测试与证据

```sh
npm test --prefix packages/video-engine-worker
npm run test:real --prefix packages/video-engine-worker
```

测试父进程实际启动 worker，非内存 SDK/CLI mock。覆盖协议纯净、坏JSON/重复id/行和响应大小、参数边界、竞争编辑、跨 handle 重开、资产/外部入口变化、重复 operationId、真实 SDK 保存失败、符号链接越界、合并 timing 越界；真实抽帧、H.264导出、渲染期间改源仍保持旧快照、取消/超时/EOF/shutdown/SIGTERM 清理且无关 sentinel 存活。真实产物 artifacts/worker.mp4 与 worker.png，元数据 artifacts/evidence/；可提交摘要在 evidence/，不提交字体、媒体、node_modules 或缓存。研究报告见 ../../docs/research/P1-002-engine-worker.md。
