# P2-002-B Host/Client/staging 首审

日期：2026-10-17。程序员 2 实现 `c553b1b` 及本地修复，评审快照 `e595d4e`。结论：**先修 R1–R4，再生成固定 staging 并运行真实引擎链；尚不安装。** P2-003 的 `54f4671` 已通过复审，不再是待确认前置。

## 已独立核对

- `npm run check`：静态 29/29、Client VM smoke 38/38、Host 契约 16/16，合计 83/83，通过。这些不代表真实 Host 激活、界面或真实引擎端到端通过。
- 根 0.2.0 tarball：37,335 B / 16 files，SHA-256 `791639ef5a16b97e5da539e9452744b12263014913e361096db157dc3336200c`；每个文件独立与 git show e595d4e 对应字节核对一致。
- 实读 bridge/config/env/engine/routes/tool、根 apply、Client 编辑/轮询与 stage/test-host-engine 脚本。核心单对象/惰性启动/allowlist/job归属/字节 hash 路线成立。
- 本轮未执行 staging/install，不改代码、profile、应用状态或其它会话的跟踪文件。定向复现均为 /tmp 自有数据或受控 fixture。

## R1 [P2] 标题和时间参数绑定了两个不同对象

位置：client.js 的 textElement/timingElement（约 829–844）及 applyInspected/saveEdit；scripts/test-host-engine.mjs 使用相同的两个独立 first-capability 查找。

主会话通过已验收的真实 worker inspect 复核原 fixture 顺序：首个 text 是 `hf-eyebrow` / `DSH VIDEO / ENGINE STUDY`，首个 timing 是 `hf-title` / `让创意成为影像`。因此界面所谓标题默认是眉题，文本修改写入 hf-eyebrow，而同一组 start/duration 修改 hf-title。现有 smoke fixture 第一项直接给标题，掩盖了这个差异。

请绑定明确的单一目标 stableId，标题与时间字段对同一个实际支持元素操作；受控 fixture 可按其明确标题契约选取，或从同时具备所需 capabilities 的元素选取。无能力时禁用/隐藏对应操作，不隐式对另一对象动手。补包含眉题在前、标题在后的实际结构回归，验证标题初值与所有 edit targets。真实引擎脚本也应编辑同一标题目标，不能只改眉题后宣称标题链通过。

## R2 [P2] Tool 成功结果会被静默截断

位置：host/tool.js:115–123，renderText 固定 8000 字符切片 + 省略号；Bridge 的 Tool result cap 却是 64KiB。

独立调用 createVideoTool，桥返回 `{text:'x'.repeat(9000)}`：execute 正常成功、完整 wrapper 为 9041 字符，但 output.render 只给 8001 字符、以省略号结尾，且无法再 JSON.parse。可出现结构化成功而模型看到截断内容，违反本任务“超限明确 E_RESULT_LIMIT，不截断后伪装完整成功”。

统一 execute/结果渲染的限额与单位（原始 UTF-8 bytes），完整成功内容才 render；超过可呈现预算时返回明确错误或经架构确认的显式摘要协议，本轮优先 E_RESULT_LIMIT，不临时创造隐式摘要。补跨越 8000 字符且低于桥限额、中文/emoji 字节边界和真正超限用例，不能只提高一个魔法常数。

## R3 [P2] 真实链脚本没有执行固定 staging 的 Host 实现

位置：scripts/test-host-engine.mjs:23 静态 import ../host/bridge.js；约 130–152 只从 staging 读取 config/INTEGRITY，再把其中 rootCommit 写入证据。

baseUrl 指向 staging 只影响 engine 解析，VideoBridge 本身仍是当前开发工作树代码。staging 创建后若工作树修过 Host，脚本可把新代码的结果记到旧 snapshot/rootCommit，无法证明将安装的 Host bytes 已验证。这是源码可确认的证据归属问题，本轮没有故意修改工作树或运行 staging 伪造对照。

改为实际 import staging/bundle/host/bridge.js（或由 staged entry 提供的正式 seam），并在运行前验证 INTEGRITY 中相关源文件/配置/解析包的实际摘要，拒绝被改动或错配快照。证据标记实际执行路径与 root/engine commit。正式回归用独立临时快照/可控模块验证，不改已固定原目录；当前工作树与 staging 不一致时不能静默借工作树实现通过。fixture 内容/输出目录是可变业务数据，不要把正常编辑误判为代码完整性破坏。

## R4 [P2] 版本门禁错误接受无 env/cwd seam 的 0.1.0

位置：host/bridge.js:248–256，仅解析 major/minor，`supportsExplicitSpawn` 对所有 0.1.x 都返回 true。旧 client 0.1.0 正是不支持显式 env/cwd 的版本，报告中的“旧包拒绝”目前不成立。

主会话用临时 registry、可控 engineLoader、clientVersion='0.1.0' 独立调用 prepareRuntime，正常返回 acceptedClientVersion=0.1.0，未触发配置错误。实际旧包会忽略 Host 传入 env/cwd，破坏已选定的部署启动环境契约。

至少按完整有效版本判断 0.1.1 seam 起点，或使用明确能力/已评审版本约束；拒绝 0.1.0、无效/未知版本，不靠解析失败强制归零。补 0.1.0 拒绝、0.1.1 接受的运行时预检回归。无需修改引擎生产代码或升级依赖。

## 固定引擎与后续阶段

P2-003 `54f467147ae2f61e118099c4947f55e8da877500` 已验收，参见 P2-003-review-01。固定包在：

`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/engine/54f4671/`

- client 0.1.1：`bbd03fb740a6694204a76277774052ec0148fdf4796376b12f718233a4fedf1f`。
- worker 0.1.1：`cbed76287d61287a5ccbe7c22f47506d409edf1183803d2d68f7d250995c5941`。

以新复核摘要/REVIEW-MANIFEST 为准，不引用原交付消息旧摘要。当前 stage-dev 从精确提交 archive 原始包并按锁准备完整自身依赖闭包也是已允许的开发路线，应记录来源是 commit snapshot，不能宣称其重新打出的包与上述 tarball 相同而未逐字节验证。不要链接到程序员 1 的 node_modules。

请沿用 P2-002-B 白名单修四项、补正式回归、提交后出新固定根包，放在以新提交命名的目录，不覆盖当前包。0.2.0 尚未安装/发布，本轮可保留该未发布版本号，用 commit+digest 标识审阅迭代。

修复完成后可用**修复提交 + 已接受的54f4671**运行 stage-dev 和 test-host-engine，准备不可变代码 staging/真实 PNG 与成功 H.264/取消/清理证据，明确这些仍不是实际 Host 激活。保持 ignore-scripts；缺依赖/二进制/pendingBuilds 则记录，不能自行批准构建。实际 DSH 安装仍另行授权，保持当前 0.1.3。

用户已授权普通 feature commit/push，继续更新 PR #3；此次首审不是合并/安装放行。不新增 PR、不 merge main、不改 program1 packages。
