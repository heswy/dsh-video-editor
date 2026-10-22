# V1 用户实机故障修复（2026-10-22）

用户反馈 alpha.7 不可用，明确授权读两个 Session 日志、操控实机、修复、安装、重启与真实模型验证。本会话负责全链路修复，不能用此前组件门禁替代实机可用。基线 `8732906`，独立 `codex/v1-live-recovery`。不覆写已审 staging；用户作品先备份，旧包保留。

## 已定位的根因与修复范围

1. **预览/导出 E_ASSET_MISSING**：`project.rename` 使用 timeline.read 的虚拟 manifest，把仅存在于快照的 `scene-<clip>.html` 写入磁盘 project.json。重命名改为只修改真实 manifest 标题；时间线读取按持久 legacyAssets 读取真实依赖，避免老坏清单的生成文件阻断快照。不能忽略真实依赖缺失/篡改。
2. **双时间线**：TimelinePanel、AudioPanel、MediaLibraryPanel 为同级组件，却都使用 projectId 作为 key。真实 DSH 打开关闭音频面板后，时间线数量 1→2，关闭素材后可继续累积。三个组件改用独立命名空间 key。
3. **未创作就有“原作品”**：UI 以有内容的旧模板新建，timeline.inspect 又自动迁移该模板为片段。新建/自动建工程改用 blank-v1：空轨道，首个 scene.compose 插入完整场景并按自动模式采用实际时长；旧工程迁移仍保留旧内容。
4. **模型几十次参数/操作猜测**：两段日志中出现缺 projectId/expectedRevision/operationId，误用 revision/baseRevision、裸 trim、嵌套 settings、status 多带 projectId。修正时间线 prompt 的确切操作名、JSON 示例、必填字段、时长编辑与 frame/status 契约；Tool 错误补该 action 字段提示，保持 revision/归属/幂等检查。
5. **错误“尺寸超限”导致反复猜大小**：SDK findRoot 优先 data-hf-root、再 #stage、再 composition root。用户作品中内层 id=stage 抢占了 #main，返回 null 尺寸，500 字节复现亦失败。验证前明确诊断根选择歧义；指导仅 #main 使用 data-hf-root，或改名内层 stage；不降低内容/尺寸限制。
6. **可发布不存在的库依赖**：scene.compose 以前固定允许 MotionPathPlugin/Heiti，即使实际工程未拥有文件。改为使用工程真实声明依赖；缺失引用发布前拒绝，revision 不变。
7. **新页面原生会话入口不可用**：Client apply 未声明 sessions 依赖，启动较早时把 null 永久缓存。当前宿主服务后来存在，页面仍不可用。将 sessions 纳入 Client 服务依赖，待服务就绪后注册完整编辑器；不通过猴补宿主获得会话。

## 用户作品恢复与隐私

受影响工程在稳定数据根的 `proj-mvhvenet-6d99e9b6`，两个绑定 Session 已只读检查。修复前完整副本位于同级 artifacts/v1/evidence/live-recovery-20261022/user-project-before（0700 证据目录）。仅移除磁盘清单中那条已确定不存在的虚拟 scene 声明；保留完整 20 秒创作、场景源码和时间线历史。新源码还应能直接读取修复前坏清单副本，而非只对手动修好的数据通过。

原始 Session/用户 HTML 不提交仓库。必要的日志诊断与失败 HTML 留本机私有证据目录，不能用其中模型的“已成功”描述替代 worker/画面证据。

## 验证计划与当前证据

- 真 worker 新增：rename 后真实清单不混入快照文件；旧坏清单仍可恢复快照；SDK stage 根歧义精确错误与显式根；blank 首次插入 20 秒；未存在依赖拒绝且 revision 不变。
- 新 prompt/Tool 契约：字段、操作名、显式根、当前 revision、4000 字符预算与 Session 服务启动依赖。
- 修复前用户工程的独立副本：3 时间点画面实际生成；20s/600 帧 H264 实际导出，contact-sheet 已人工查看，是完整飞书宣传片而非测试占位。
- 宽/窄工作区、开关音频/素材后恰好一条时间线、音频/导出/冲突/撤销、storage/协作/版本/打包门禁。
- 必须继续：固定新候选安装；真实 DSH 新页面无重复轨道；原生会话可用；真实模型从空项目生成及续改；原用户作品可播放/导出。完成前不声称用户目标已达成。
