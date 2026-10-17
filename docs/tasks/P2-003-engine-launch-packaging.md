# P2-003：引擎启动环境与可解析包入口

> Git 授权更新（2026-10-17）：用户已同意正常 feature 分支 push 与草稿 PR 流程；本指南旧“不 push”表述由该授权替代。见 DEVELOPMENT。安装/启停/重启、合并/发布边界不变。

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

开发记录：待填写。

## 主会话验收（2026-10-17）

`54f4671` 验收通过，Node22/24 各 15 pass + 1 opt-in skip，Desktop24.21 单项真实链 1/1。打包源码逐字节核对通过，固定包已另存主会话 artifacts/engine/54f4671，以 P2-003-review-01 中**新摘要**为准（与原交付消息摘要不同）。程序员 2 可固定引用；依赖闭包仍需其 staging 独立准备。
