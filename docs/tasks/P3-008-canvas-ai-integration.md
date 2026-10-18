# P3-008：把新引擎接成可持续编辑的真实视频工作区

日期：2026-10-18。执行p0-mode-shell，沿用本树/PR#3。先完成P3-006-C文件预览修复并独立提交/产出固定候选，然后**直接继续本任务开发**，不等额外启动确认；不覆盖C的包。C若已在执行则继续原工作，不为本任务中断或重做。通用规则只读DEVELOPMENT，产品/设计读协调最新版本。

## 当前复审门禁（2026-10-18）

已收到功能8ab5f1a/交付8b56304；[联合复审](../reviews/P3-008-review-01.md)要求集中修复R1–R5。当前136/136检查/版本10/10/包摘要通过不代表Scene改色/真实拖动/失败恢复/授权与生命周期通过。不安装旧候选，按原范围修最新alpha.3，不必另重打旧alpha.2。

P3-009已通过[独立复审](../reviews/P3-009-review-01.md)。引擎最终固定 **d383e3d / 两包0.3.2**，不再等提交；读取完整scene.template后仅改目标字段。原始复现保持不变，正式回归须覆盖真实CanvasWorkspace事件、Host Tool→worker人工后AI等价续改、跨工程文件与慢上传/停用；单独runtime浏览器测试不足。R1–R5继续全部修复，不因引擎投影通过而关闭R1。

## 目标与固定基线

交一个可安装开发候选，让左侧真正播放、选中、原位编辑、拖动/缩放；右侧原生AI持续修改同一工程，模型/历史保留；支持受控工程创建/重开、换黄色和PNG/JPEG素材导入。无底部场景卡片、无常驻属性第三列、旧目标下拉+表单退出主路径。不是再交一份spike或提案。

- 根0.3.0-alpha.3（历史C为alpha.2，产物不覆盖）。引擎冻结 **d383e3d53a9401285519ee578d993081c3cb4b51 / client·worker 0.3.2**，完整template与BUG-001修复均已验收。采用p1树artifacts/engine/d383e3d/；client SHA-256 `0830ab717ac2ef2572faf95aacace0778d5dc379cdfcc4546b48e6fa851311a5`，worker `e4e161418c252e6973760ca20d8aff890eabcf26a0bce5e93e0bfb6bef3716c3`。显式固定commit/版本生成新staging并复跑真实链，不覆盖旧staging、不自动跟随PR/HEAD、不merge p1。82f6219及更旧包保留为历史。
- 功能仅限已审product-launch-v1和声明的PNG/JPEG资产。legacy demo仍可打开，但不能伪装成已有layout/style能力；用户新建受控工程，旧demo/用户数据不得静默重建或prepare-fixture重置。
- 接口/坐标/消息依据已审P3-005-B spike ea2d1a4和新engine README/schema；只读取p1固定Git文件，不改p1树。可以将必要runtime/contract逻辑以明确来源落入插件自有模块，不能把独立toy Host直接当生产授权边界。

## 允许范围

根client/index、host/**、插件自有canvas/client模块、locale、package/files/patch、scripts的stage/检查/真实链与必要测试、README、本任务与对应research/去标识证据。不改packages/video-engine-*、p1 spike或全局协调文档，不merge/rebase协调分支。可增加插件自有源码目录，不为了保持单个client.js制造超大文件；按本机client loader可用形式组织，依赖/构建如确需增加先记录实际契约，不能装未知postinstall。

## Host与持久边界

1. staging支持明确固定commit/完整manifest版本，换到0.3.2导出，不再暗中钉54f4671。核对worker-managed registry/projectsRoot/assetInboxRoot/outputRoot配置，保留Node/env/cwd和artifact完整性门禁。配置/包缺失typed error，不能退回旧worker假装新功能可用。
2. Host dispatcher/UI/Tool统一接project.create、asset.import、scene.create/update/reorder/remove、project.revise、history/undo/redo、preview.snapshot/release及layout/style edit；方法不应因“worker有”就跳过参数、范围与job/snapshot所属工程检验。模型不能调用会话管理或给自己任意工程授权。
3. UI显式“新建工程/开始创作”可先创建受控默认工程，再创建并绑定原生创作Session；只采用worker实际返回projectId。新工程加入Host可信版本化工程目录/授权映射，支持重启恢复和再次打开，不能只存在客户端Set。普通UI请求、native Session绑定与Tool范围统一；project.create不接受模型自填路径/任意projectId来绕过范围。创建/绑定中途失败诚实报告并可恢复，避免重复建工程/会话，不声称跨worker与宿主Session的分布式事务。
4. 现有绑定工程的AI只操作该工程；scope和动态上下文升级为新鲜revision、Scene、当前stableId/能力及素材摘要。同字段冲突展示为可恢复状态，AI修改后重新inspect、撤销旧预览并载入新revision，不让旧PNG/旧snapshot冒充当前画面。工程级换背景走scene级颜色操作；样式/布局走typed edit，不建议bash直接写index.html或后期调色替代修改。

## 左画布与实时预览

- 使用worker私有revision快照；Host按快照manifest逐文件验证/服务，project/snapshot/当前连接归属校验、失效/TTL/释放清理。sandbox仅allow-scripts，不加allow-same-origin；CSP禁止外网与任意脚本，timeline精确hash、Host固定runtime。消息绑定WindowProxy+instanceId+nonce+严格形状/序号；origin=null不当认证。关闭/换会话/换工程/停用后拒绝迟到消息，资源路由失效。不能宣称iframe构成OS沙箱。
- 真播放/暂停/时间定位，轻量单条进度，不做场景缩略条。选择描边/手柄只在编辑层；暂停后直接点击选择，双击原位改文字，Esc取消，Enter真实提交；小型就近工具调整颜色/字号。移动/缩放经composition CSS px及静态基座逆映射提交layout，不存当前动画矩形或transform。播放中禁写；未知auto尺寸不能伪造已知尺寸，必要时用显式尺寸patch。
- 每次成功编辑发布新revision并换快照，失败保留草稿/拖动前基座，冲突不覆盖。更新快照保留播放定位与选中stableId；对象消失时清除选中。undo/redo作用于工程内容并更新预览，不另建UI真相。
- 窄窗/明暗/宿主字号和reduced-motion保留，简洁克制，不新增阶段说明、长解释或装饰性状态栏。工程/错误/运行状态按需出现。

## 素材抽屉

左上按需展开、默认关闭，可用file input选PNG/JPEG、真实导入/列出/使用；不需要独立常驻素材列。上传Host先校验大小/签名/安全命名并发受控receipt，来源写入可信inbox，再调用worker asset.import。UI/Tool只接受receipt/assetId，不接受绝对路径/URL；工程归属校验、取消/失败清临时文件，thumbnail走受控路由。沿用worker单张8MiB/每工程16张/总64MiB等现有上限，原生附件不自动全部入库或发给模型。不支持的视频/音频/任意SVG明确拒绝，不画假按钮。

## 本轮开发验收（一次交回）

- Host与真实worker：新建受控工程→持久目录与会话绑定→三个Scene约15s→换背景黄→人工文字/位置/颜色→AI同对象续改文案保留人工布局→history/undo/redo→close/reopen内容一致→真实MP4。使用受控adapter/脚本验证；不需要真实模型来证明引擎/Host链。
- 真浏览器插件开发页/组件验证：实际播放/seek；两个动画时刻和两种letterbox尺寸下命中及拖动/缩放基座正确；原位编辑失败/冲突恢复；AI写入后画布更新；文件预览C不回归、返回/历史/草稿与单编辑根保留。
- 素材真实PNG/JPEG导入并用于受控Scene；跨工程receipt/路径穿越/越限拒绝；快照过期/切换/停用后旧消息和路由失效。日志不含私钥、个人会话正文或任意绝对文件内容。
- 固定源码提交、新包、新staging与INTEGRITY和完整SHA、分项测试、真实帧/渲染证据、开发记录一次交回PR#3。不把独立开发页当真实DSH激活。使用已审d383e3d后对本任务新staging仍需复核导出完整画面；不能把其它提交或当前旧安装自动算作已修复。

本指南授权开发与任务fixture的本地验证，不自动安装alpha.2/alpha.3、不重启DSH、不新增真实模型请求、不改用户当前工程/会话、不merge。现有alpha.1 staging已是用户安装依赖，禁止覆盖/归一化。实际候选完成并复审后再做明确安装验收；安全定向输入规则不变。
