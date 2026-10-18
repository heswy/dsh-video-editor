# P2-003：引擎启动环境与可解析包入口

执行：**程序员 1**，沿用 b4bf 工作树/原分支，自行管理。功能基线 `5b9032b`（P2-001 已验收）；先通过 git show 读取协调分支的本指南、ADR-0002 与 P2-002-review-01，只导入需要的指南，不 merge 整个分支。记录实际开工 HEAD。

## 白名单与并行约定

允许 `packages/video-engine-client/**`、`packages/video-engine-worker/package.json` 与该包自己的 package-lock 元数据、必要的**新增包入口/打包测试**，本任务记录及 `docs/research/P2-003-*.md`。worker src/protocol、原 worker 业务测试、spikes、根插件/锁、全局状态/规则不改。发现确需越界先交证据。

程序员 2 同时改根插件；双方不写对方目录。按现有 package 边界安装/测试，不升级依赖、不执行 postinstall，不安装 DSH、不 push/merge。主会话不自动迁移此 tree。

## 实现契约（供程序员 2 同步开发）

1. `WorkerClient(options)` 新增可选 **env**（完整子进程环境，Record<string,string>）和 **cwd**（绝对目录字符串）。存在时传给 spawn；env 不与 process.env 隐式再合并。未提供时保留原 standalone 行为。构造时验证/复制，调用方随后改原对象不改变启动配置；不修改父进程全局 env/cwd，不内置 Electron 或 DSH 逻辑。
2. env/cwd 构造/导入仍无启动副作用。空/不合法类型、NUL、非绝对 cwd 等尽早报参数错误，不留下 pending 或子进程；保持现有超时/断管/关闭契约。部署 Host 负责形成清理后的 env，这个库只是显式透传。
3. worker package exports：`./worker` → `./src/worker.mjs`；`./package.json` → `./package.json`。worker 入口仅用于 resolve，不应在 Host import 执行。client 保留根入口，增加 `./package.json` 供版本/打包核对。Host 将以包解析定位，而非拼接开发路径。
4. client/worker 版本均提升为 **0.1.1**，局部锁元数据一致；依赖版本不变。files 白名单包括全部 runtime src/相对模块、协议/必要文档，排除 node_modules、缓存、artifacts、测试与系统字体；fixture 准备所需资源是否打包要明确且实际验证，不含复制来的系统字体。

## 必须验证

- 控制子进程回报实际 cwd/env：显式值生效，未声明父变量不继承（传完整 env 时）；构造后修改原 env 不改变启动；未提供 env/cwd 的现有 10 项包测试仍通过。
- 用调用方显式选择的真实 Node + sanitized env 启动真实 worker，至少 doctor/open/inspect + PNG/取消路径可用；在当前 Desktop 提供的真实 Node **24.21.0** 上补一次受控链验证，路径仅用于测试配置，不写入生产默认。
- pack client/worker 为 ignored artifacts 中的新固定 tarball，核对文件、版本、导出与源码字节，记录 SHA；在独立 staging 消费端解析根 client、worker 子路径/manifest，不能只静态读 exports。离线缓存缺依赖就报告，不运行未知安装脚本。禁止改真实 profile。
- 对 env/cwd 的小改跑受影响测试与原 client 流程；不用重做 worker 所有视频回归，不为低风险 JSON 字段堆镜像断言。Node22/24 协议仍保持兼容，记录实际运行时。

## 交付

提交 SHA、公共 options 示例、包 exports、固定 tarball 路径/摘要、测试与未验证项；README 记录可选 env 是完整环境而非 merge。固定提交交主会话复审后供程序员 2 引用，禁止相互复制未提交文件。此前 5b9032b 成果保留。

## 开发记录

- 开工：HEAD `5b9032b`（P2-001 已验收），沿用 b4bf 工作树/分支；只通过 `git show` 读取协调分支 `6a33e7c` 的本指南并导入，另读 ADR-0002 与 P2-002-review-01；未 merge 协调分支、未改根插件/worker src/protocol/spikes/全局状态。
- env/cwd：`WorkerClient` 新增可选 `env`（完整的子进程环境，不隐式 merge `process.env`）与 `cwd`（绝对路径）。构造时校验并复制：非 plain object/空 env 对象/空或含 `=`、NUL 的键、非字符串或含 NUL 的值、非字符串/空/含 NUL/非绝对 cwd 均立即 `TypeError`，不 spawn、不产生 pending；只显式透传给 spawn，未提供时保留原 standalone 继承行为；不修改父进程全局 env/cwd，导入/构造仍无启动副作用。
- 包入口/版本：client 与 worker 均 0.1.1，局部锁根版本同步，依赖版本未变。client `exports` 为 `{".":"./src/index.mjs","./package.json":"./package.json"}`；worker `exports` 为 `{"./worker":"./src/worker.mjs","./package.json":"./package.json"}`。`files`：client `["src/","README.md"]`，worker `["src/","protocol.schema.json","README.md"]`；tests/fixtures/scripts/artifacts/node_modules/缓存/字体不打包。fixture 准备资源不进入 npm 包（受控工程由 Host staging 用固定提交中的 fixtures/scripts 另行准备，字体不入 Git/包），打包测试实际核对了排除项。
- 回归：新增控制 fixture 回报实际 cwd/env（显式值生效、父变量不继承、构造后改原 env 不影响启动）、无 env 时继承行为、非法 options 构造即抛；新增打包测试生成并复打包固定 tarball，核对条目/版本/导出/源码字节/SHA，解包到独立 staging 后真实 resolve 根 client、`worker` 子路径与 manifest 并 import client 根入口。
- 真实验证：显式 sanitized env（PATH/HOME/TMPDIR/LANG/LC_ALL/USER/SHELL/TZ，无 Electron/IPC/Node 注入）启动真实 worker，doctor/open/inspect/frame PNG/render+cancel 通过；Desktop primary-runtime Node 24.21.0（`/Users/orange/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node`，仅测试配置）opt-in 受控链通过；固定 tarball 解包后由 packaged client 在 Node 24.21.0 下启动 packaged worker 完成 doctor/open/inspect/PNG。
- 固定包（ignored artifacts，已在主会话可读的当前工作树中生成）：
  - `packages/video-engine-client/artifacts/dsh-video-engine-client-0.1.1.tgz`，SHA-256 `523b6ec6042be7dcb682f01bcf28e7fdf10d60b103e8dfedc62f43070e642029`，条目 package.json/README.md/src/index.mjs。
  - `packages/video-engine-worker/artifacts/dsh-video-engine-worker-0.1.1.tgz`，SHA-256 `3d7abcb2b2184169e2fda557e852267626f43f2991d00a6b23dbc2a41b2a29ec`，条目 package.json/README.md/protocol.schema.json/src/{errors,jobs,process,projects,worker}.mjs。
- 测试结果：显式 Node 22.15.0 与 Node 24.14.0 完整 client 包均 16 项（15 pass + 1 个 Desktop runtime opt-in skip），约 12.8s / 13.3s；默认 `npm test --prefix packages/video-engine-client`（Node 24.14.0）15 pass + 1 skip，约 13.2s；Desktop runtime opt-in 单测通过（Node24.21.0，约 4.7–9.1s）；`npm test --prefix packages/video-engine-worker` 7/7（约 3.1s，仅元数据 sanity）；重复打包 SHA 稳定。
- 未验证/限制：未在 DSH Host 内启动、未安装/启停/重启、未改真实 profile、未 push/merge；staging 中 packaged worker 的依赖以 dev `packages/video-engine-worker/node_modules` 符号链接提供，只作开发快照证据，不等于可移植 tarball 安装或依赖闭包已解决；其它 Node 小版本与平台未验证。公共 options/包入口示例与证据详见 `docs/research/P2-003-engine-launch-packaging.md` 与 client README。
- 结果提交：P2-003 交付提交（见交接回复 SHA）。
