# P2-002-A 契约调查评审

日期：2026-10-17。程序员 2 提交 `afcf57d`。结论：**调查验收通过，按 ADR-0002 进入并行实现**；不把契约调查当作 Host 集成已通过。

主会话实读完整提案/任务记录，抽查当前官方 host-plugin 参考与 app-boot/Plugin Manager 解析源码。独立只读核对：Info.plist 0.2.1-rc.1、app.asar SHA-256 `f15cc450cf70f70d6d2de4d27f8919980ec88769f899901279e8ed4bb69589ee`、bundled primary-runtime Node v24.21.0，与报告一致。未进入 live Host 执行路由/Tool或修改安装；其余 Service inspection 作为程序员 2 的调查证据。

## 主会话收敛

- 选真实 Node 部署配置，拒绝依赖 Electron 私有启动约定；env/cwd seam 两条路线都需要，交程序员 1。Host 必须清理 IPC/Node 注入变量，不做全局环境突变。
- 接受单 VideoBridge + 精确 request/artifact Fetch 路由 + video_engine action Tool；依现有 peer 鉴权与必需 fixture project allowlist；job 相关请求也要回查所属 project。session ACL 和图片附件暂不做。
- 不采纳 §4.2 的 Host operationId 结果缓存建议；worker 已持有幂等逻辑，Host 只转发，避免第二份成功记录在重启/外部修改后误导。
- §5 的“debug() stderr 尾部”应更正：当前 client.debug() 只有状态/计数/截断标记，不返回原始 stderr。Host 使用有界摘要诊断，不依赖不存在的字段，也不向 UI/Tool 透传日志。
- staging/link 只作为固定开发快照，不视为正式可移植 tarball；不能把相对 file: 依赖在任意安装位置可用当作已证事实。需实际测试依赖闭包与包入口。
- 保持 ignore-scripts。若缺构建二进制或出现 pendingBuilds，记录阻塞项，不自行批准脚本，也不升级依赖。
- 首版交付真实静态帧与 typed 编辑、MP4任务/取消；不在这一轮铺开连续预览/时间线/任意生成代码。侧栏和简洁层级继续遵守设计 v0.2。

## 文件分工与验收顺序

程序员 1：P2-003，client env/cwd 与 worker exports/打包检查。程序员 2：P2-002-B，根 Host/Client/对应测试及 staging 脚本。只读对方固定提交，不同时改 packages 或根文件。两边可并行；Host 最终依赖提交由主会话复审后固定。

本轮只放行代码/本地检查/staging 准备，不放行更新已安装 0.1.3、启停或应用重启。不自动创建 PR/push/merge。新包在具体版本、配置、摘要及本地验证可评审后再安排安装授权。
