# P3-004 复审：schema、预览快照与创建恢复

日期：2026-10-18。总调度独立复审。结论：**通过（本机受控范围，无阻塞项）**。接受功能提交 `5cc3ad8` + `df4b74f`、交付 head `e364017`；两包 **0.2.1**。可作为后续画布接线的固定引擎基础，不代表 Host/UI 已接入或完整代码沙箱通过。

## 独立验证

- 干净工作树与原分支保持，范围限两引擎包及本任务/研究文档；未改根插件、spikes、profile。
- worker `npm test`：**29/29**，12.67s；`npm run test:real`：**10/10**，62.63s；client `npm test`：**18 pass + 1 opt-in skip / 19**，17.81s。全部 exit 0。
- 实际覆盖：22 方法 schema/worker/README 同步、真实响应结构；快照字节/hash/相对路径、0700、revision 过期拒绝、旧快照不变、TTL/release/close/shutdown/启动 sweep、路径越界与限额、创建失败后 registry 恢复；真实链包含旧 15s 渲染/取消和新预览快照磁盘比对。
- 固定包目录：`p1-engine/artifacts/engine/df4b74f/`。独立解包并通过 git show 比较，client **3/3**、worker **13/13** 文件与 `df4b74f` 完全一致。

| 包 | 大小 | SHA-256 |
|---|---|---|
| dsh-video-engine-client 0.2.1 | 7,297 B | `59e31cf9ba503a515d89712758b713054487ad2a131412db8908409ab6545fee` |
| dsh-video-engine-worker 0.2.1 | 43,930 B | `ea7374d4555e70264c9c40d710ef9a331ff4e0311e840d1359615356b081c775` |

client 包内测试过程中另生成的 tarball 摘要与上述交付包不同，故本评审明确只接受上述固定目录与完整摘要；内容已对固定提交逐文件核验，不以同版本号或任意复打包摘要代替来源。

## 接线时必须遵守的契约

1. `preview.snapshot` 仅已 open 工程、精确当前 revision；返回 32 位 hex snapshotId、相对路径 entry/files、expiresAt/maxBytes。Host 不能接受客户端传磁盘路径或任意 URL；需登记 snapshot→project/revision/manifest，按清单供精确字节。
2. 快照位于 worker 私有 `outputRoot/previews/<snapshotId>/`，不进 revision；旧快照不会因工程改动更新。到期与释放后 Host 必须撤销可见性，不能因磁盘残留继续提供字节。
3. TTL 100–1800000ms、默认600000ms；128MiB/65文件上限为**单个快照**。`preview.release` 对未知/过期/重复返回 `E_SNAPSHOT_NOT_FOUND`：清理效果幂等，并非重复响应成功。Host 清理可将该码视为已释放。
4. schema 是 draft2020-12、22方法/85defs，响应本身无 method，以客户端 requestId 对应方法并按 x-methods 解释 result。不是 worker 新增运行时 schema 依赖。
5. 参数收紧已接受：受控 templateId 必填，宽高整数，update/revise template 不允许嵌套 sceneId；不再宣传本版“完全无校验语义变化”。
6. `project.create` 最后发布 registry；临时目录、内存映射失败恢复由测试覆盖。P3-003 的 written:false 冲突及 undo revision 规则保持。

## 非阻塞观察与已知限制

- 快照无总数量/总字节全局限额，仅单份限额+TTL；后续 Host 应限制每工程存活快照并及时释放，避免连续操作堆积。
- `expire` 先撤登记、磁盘清理失败只诊断并等启动 sweep；close/shutdown 不保证每次磁盘删除失败都上抛。Host 应以登记/TTL 授权为准，不靠“目录存在”判断有效；不能把路径隔离称为 OS 沙箱。
- 项目在第二次 read 中发生外部文件错误时，未返回给调用者的已建快照可能保留到 TTL；可后续补 try/finally 主动丢弃。当前受控单写者范围可接受。
- outputRoot 为单 worker 私有空间，启动 sweep 删除整个 previews 树；不允许多个 worker 共用。SIGKILL/断电即时清理未测，依赖下次启动。
- 未验证 Host 精确字节路由、sandbox 实时播放/选中/写回、真实 DSH、非macOS或任意生成代码安全。

## 下一步

P3-004 收口。p1-engine 进入 [P3-005-B](../tasks/P3-005B-canvas-direct-edit-spike.md) 受控画布/直接编辑契约验证；p0-mode-shell 并行 [P3-005-A](../tasks/P3-005A-native-conversation-contract.md) 宿主原生对话接入调查。均按 v0.3：无场景卡片，右 AI 常驻。先冻结坐标/写回/会话能力，再下发正式 UI/Host 实现，不照搬旧属性表单。
