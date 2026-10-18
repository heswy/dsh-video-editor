# P3-005-B：受控画布播放、点选与直接编辑验证

日期：2026-10-18。执行：**p1-engine**；分支 `codex/p1-engine-spike-b4bf` / PR#2；开工head `e364017`，已审功能固定 **df4b74f / 两包0.2.1**。沿用当前树；先记实际HEAD和协调SHA，不reset。依据 [P3-004复审](../reviews/P3-004-review-01.md)。

## 目标与范围

验证“worker预览快照→隔离画面播放/seek→点击选中→文字原位修改→共享worker写回→新快照”的最小真实浏览器链，并识别位置/缩放/样式写回的确切缺口。为正式画布接线冻结消息和坐标契约，**不是开发最终DSH UI，也不是只做静态PNG点选。** 产品方向读最新PRODUCT/FRONTEND-DESIGN：右AI常驻、左直接编辑、无底部场景卡片。

允许：`spikes/editor-canvas/**`、`docs/research/P3-005B-*.md`、本任务记录；必要独立包/锁文件仅在该spike内部，优先复用当前已安装的puppeteer-core等开发工具，不引入线上依赖/未知安装脚本。所有项目/素材/截图/产物使用任务自有fixtures/artifacts。

不改根插件、Host、两引擎包生产代码/协议/schema、其他spike、全局记忆、profile；不安装/启停/重启DSH，不调模型，不merge，不新tree/PR。发现引擎缺能力先给契约提案，不能越界私加接口。浏览器操作使用绑定该试验页面的自动化，不用全局坐标/键盘/剪贴板。

## 必须验证

1. 通过公开client/worker调用创建受控多Scene工程、open/inspect、previewSnapshot。入口和资源只从worker声明manifest读取，校验路径/字节/hash；不改快照内容，不使用任意URL/宿主凭据。取快照时固定revision，切换后释放旧快照，过期/release/close/worker退出有明确无效状态。
2. 在独立浏览器试验页挂隔离预览文档和固定runtime：可借鉴已验A1，但不能把整个DSH编辑器塞进iframe。说明sandbox/CSP/资源装载/网络阻断方法；bridge不提供Host/Node/模型权限。这里只证明受控模板可行，不证明任意代码安全。
3. 真正播放/暂停/seek；可重复定位至少8个时间点，定位与worker抽帧/工程时序可核对。编辑前暂停；播放时不误触拖动。不把CSS UI transition混入影片时间，内存/RAF/listener在销毁后清理。
4. 点击实际可编辑元素取stableId；选中描边/手柄只在编辑层存在，不修改工程、revision或导出内容。验证缩放适配/letterbox时坐标、边界裁切、多Scene交界、隐藏/重叠对象、未知/不可编辑对象，给明确选择范围，不承诺Canvas/WebGL任意内部对象。
5. 文字双击原位编辑，Esc恢复，提交走现有共享worker edit+expectedRevision+operationId，再inspect与新快照；验证人工修改持久/重开、旧revision冲突不覆盖、失败恢复可重试。右侧不存在目标下拉必经步骤。不要直接改磁盘HTML或只改DOM后声称保存成功。
6. **位置/缩放/颜色等能力缺口表**：核对当前worker/SDK实际支持哪些写操作。能持久写回才演示“已保存”；无现有接口时仅做明确标注的暂态验证和最小typed操作提案（坐标单位、transform与GSAP关系、revision、undo/AI合并、可编辑能力）。不在本任务实现新引擎方法，不用整文件覆盖绕过人工冲突保护。
7. 隔离文档与外层的消息契约给最小版本化字段：实例绑定/握手、稳定元素ID、project/revision、时间与坐标、命令/事件、顺序/迟到响应处理。必须约束source/window或绑定MessagePort、每实例标识和严格消息形状；测试跨实例/过期revision/未知stableId拒绝。opaque origin下不能把event.origin为null当安全认证，nonce也不是完整沙箱。

## 交付与验收

- 真实受控浏览器截图/短录屏或自动化证据，注明独立试验页，不能包装成DSH真机。
- 可重跑的命令、固定引擎提交/Node/浏览器/runtime版本；关键行为测试与失败注入，资源清理结果。时刻一致性给可核对数据，不凭肉眼说完全一致。
- 研究记录给：已验证范围、消息/坐标契约提案、直接编辑可持久能力矩阵、未决项，以及下一阶段引擎/Host/UI文件拆分。粗略概念动画或无写回演示不能替代目标。
- 原单元/真实链无需无意义重复全跑，除非新试验暴露回归或修改测试依赖；两包生产源码必须保持df4b74f字节不变。
- 普通commit/push更新PR#2后由用户交回复审，不安装。与p0-mode-shell的P3-005-A按白名单并行，互不修改对方文件；总调度据两份结果冻结正式实现。

## 开发记录（p1-engine）

待填写：实际HEAD/协调SHA、试验依赖、命令、真实行为结果、契约与能力缺口、证据、提交、未测项。
