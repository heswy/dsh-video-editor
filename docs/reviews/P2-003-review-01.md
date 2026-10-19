# P2-003 启动环境与包入口复审

日期：2026-10-17。程序员 1 提交 `54f467147ae2f61e118099c4947f55e8da877500`（父 `5b9032b`）。结论：**受控本机范围验收通过，可供程序员 2 的 staging 固定引用。** 本轮未修改开发树跟踪文件或真实 DSH 安装。

## 代码与独立验证

实读 env/cwd 选项与 spawn 差异、manifest/exports/files、对应行为和 pack 测试。env 是完整替换而非合并，构造时验证并以 null-prototype 对象复制；cwd 是绝对路径。父进程全局环境/目录不变，未提供时保留继承行为。拒绝空 env 对本轮部署需要明确环境的用途可接受，不要求放宽。worker 业务 src/协议未改，依赖版本未升级。

主会话独立执行：

- Node 24.14.0 完整 client 包：16 项，15 pass + 1 opt-in skip，约 12.28 秒。
- Node 22.15.0 完整 client 包：16 项，15 pass + 1 opt-in skip，约 13.12 秒。
- DSH_ENGINE_TEST_NODE 指向 Desktop bundled **24.21.0** 的单项真实链：1/1，通过，约 5.95 秒；doctor/open/inspect/PNG。

完整包测试含真实 SDK/worker、显式净化环境/cwd、PNG 和 render/cancel、原断管回归及真实 pack/消费端解析；不把 render/cancel 当作通过 client 新增成功 MP4 导出。未重做 worker 全部渲染矩阵，原因是这轮未改其业务代码。程序员 1 额外的 packaged-worker 依赖符号链接探针属于开发证据，不等于本轮独立验证或可移植依赖分发。

## 本次固定包与摘要纠正

完整包测试会重写原 ignored artifacts tarball。本轮生成包的摘要/大小与程序员 1 交付消息不同；但**每个打包文件（含 README/package.json）均独立与 git show 54f4671 对应文件逐字节核对一致**。未最终归因旧摘要差异，不继续沿用旧摘要，不能宣称原摘要的二进制包已经复核。

已复制到主会话独立固定目录，后续测试不覆盖：

`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/engine/54f4671/`

| 文件 | bytes / files | SHA-256 |
|---|---|---|
| dsh-video-engine-client-0.1.1.tgz | 6793 / 3 | bbd03fb740a6694204a76277774052ec0148fdf4796376b12f718233a4fedf1f |
| dsh-video-engine-worker-0.1.1.tgz | 17369 / 8 | cbed76287d61287a5ccbe7c22f47506d409edf1183803d2d68f7d250995c5941 |

同目录 REVIEW-MANIFEST.json 记录完整提交、成员文件与摘要。client 根与 package.json、worker 的 worker 子路径与 manifest 可在独立消费目录解析；不需要 import worker 触发副作用。fixtures/scripts/系统字体不在包内，程序员 2 从固定提交单独准备受控样例。

## 交接与限制

程序员 2 可引用上述固定包/提交；必须自行在 staging 按锁准备依赖闭包，不能使用指向程序员 1 node_modules 的链接作为最终交付。通过范围不包含真实 DSH Host 激活、可移植发行、任意生成代码隔离或 OS 级孤儿进程清理。

用户同轮授权常规 push/草稿 PR；主会话将已提交分支远端保存，后续开发者继续更新各自草稿 PR。现有 0.1.3 安装保持不变，不 merge main、不发布。
