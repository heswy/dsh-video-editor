# P3-006-C / P3-008 联合复审

日期：2026-10-18。对象：C功能3310280/alpha.2；008功能8ab5f1a/交付8b56304/alpha.3，p0-mode-shell / PR#3。结论：**需要集中修复R1–R5，并更新已审引擎固定版本；两个候选本轮均不进入安装。** 方向符合产品，但当前“换色/拖动/重开”不能视为用户闭环通过。

## 独立验证

- fetch成功，p0 HEAD8b56304、树干净。独立npm run check为136/136（42静态、56Client、38Host），版本10/10通过。
- alpha.2：20文件/61,611 B/SHA-256 e375adfdd9f1b808e00932c73867b9ea80f28807740887156c6861151833aa0f；alpha.3：23文件/86,943 B/68887366d98fc742be354cce4ea1926e6f1ed322a5279310eb6b5102889c3f08。逐文件均与各自功能提交Git字节一致。
- staging-54f4671-3310280的INTEGRITY为2825b8a57dbd1b18a45be5dce21423338bf1ee87bd52620979c06bbc0abdde98，bundle19/client12/worker15摘要通过；staging-74294e6-8ab5f1a为8f328d80346ced750bea0623b066ad59abdfda780c19d8ead2da4874d9baaa0e，bundle22/client15/worker33摘要通过。没有覆盖、安装或归一化这些候选。
- 自建探针直接运行候选Host模块、从真实client.js提取的事件函数与真实受控worker公开JSONL；结果位于同级artifacts/reviews/2026-10-18/P3-008/{repro.mjs,repro-result.json,extra-repro.mjs,extra-repro-result.json,package-check.json}。Scene探针使用已审82f6219 worker，其Scene写入语义与74294e6无差异；没有声称这是已安装候选或真实鼠标操作。
- 开发者Host-worker及独立runtime浏览器记录属于其交付证据，本轮未重跑它们。当前test-canvas-browser只证明沙箱runtime，不覆盖实际CanvasWorkspace的拖动/输入/错误恢复，不能据此声称这些交互已通过。

## R1 [P1] 换Scene颜色/用素材会清掉未提交的Scene字段

位置client.js applySceneColor（约2236）、useAsset（约2340）。前者只传title/duration/color，后者只传title/duration/shot及本地默认color；worker scene.update接受完整替换模板，遗漏subtitle/badge/accent/logo/shot不是“保持原值”。

独立复现：创建有subtitle、badge、logo、shot、自定义color/accent的真实工程，调用候选原applySceneColor函数，实际JSONL提交只有{title,duration,color}；inspect前8个对象，之后subtitle/logo/shot消失，badge文字也不再保持。不是仅“重开读取有限”的非阻塞限制；已有用户内容会真实丢失。useAsset同理且sceneColor初始#1d4ed8可能重置旧背景。

要求：p1按[P3-009](../tasks/P3-009-scene-template-read-contract.md)提供完整、可往返的scene.template；p0从当次权威inspect完整复制模板再只改指定字段，带expectedRevision。没有完整模板时拒绝破坏性操作，不用UI默认值猜补。回归Scene换色、换shot在重开前后均保留其它字段、其它Scene与已有人工layout/style；并补真实Host Tool project.revise在人工编辑后的续改链，不仅测试普通UI写入。

## R2 [P2] 拖动把当前动画矩形直接存成永久基座

位置client.js beginDrag（约2089）、commitLayout（约2145）。beginDrag保存selected.rect，commitLayout直接把preview.x/y/width/height写入layout；未结合inspect的静态layout与动画变换逆映射。移动还无条件把原auto高度写为当前渲染高度。

运行候选真实commitLayout函数的受控几何复现：静态left88/top196/width980/height=null，暂停动画显示rect=(88,210,980,72)，只向右移动10；提交却为left98/top210/width980/height72，未移动的Y被加了14px，auto高度变固定。runtime的rect来自真实动画getBoundingClientRect，不能当静态基座。

要求：以静态基座和拖动增量/动画逆映射求patch，移动不修改无关尺寸；缩放显式处理当前变换与未知auto尺寸。不把动画偏移/scale烘焙到HTML。必须用**真实CanvasWorkspace事件链**补两个动画时刻、两种letterbox、移动/缩放后真实write→新snapshot的浏览器回归；仅runtime seek/hit不算拖动验收。

## R3 [P2] 文件预览只验证Session绑定，未验证文件归属

位置host/bridge.js preview分支（约990）、host/preview.js readPreviewFile。a工程Session验证通过后，允许读取共享sessionCwd或整个artifactRoot下任意图片，没有核对文件属于该工程/Session的引用、receipt或job。

独立复现：登记session-a→a，把一个成功job登记为b，输出目录放b的PNG；invoke(preview,{projectId:a,sessionId:session-a,path:b图片绝对路径})成功返回b的hash/dataUrl。合法绑定被当作共享目录的通行证，跨工程读取未阻断。

要求：对Session引用/Host颁发receipt/工程产物登记做归属检查，或使用可信的工程独立根及经过验证的遗留引用适配。不能仅凭UUID难猜、同源或realpath在共享目录内就算项目授权。新增同根跨工程图片拒绝、合法本Session文件卡/mention/本地链接仍可打开、链接逃逸拒绝回归；不开放任意路径读取。无需读取个人会话来凑证据。

## R4 [P2] 新请求绕过排空，停用后仍发布快照/上传，过期上传遗留文件

位置host/bridge.js的project.create/asset.import/preview.snapshot/release早返回分支；host/asset-inbox.js handle/sweep/dispose。

- 独立受控worker adapter复现：preview.snapshot等待时inFlight=0；await bridge.dispose完成后再返回快照，仍发布成功，snapshots.records=1、路由=2。与已修Session生命周期相同的漏洞重新出现。
- 真实ReadableStream复现：上传读body期间调用AssetInbox.dispose，再放行PNG，响应200、disposed=true但重新写出文件与receipt；只提供语法合法的未注册工程id也能写入inbox。
- 让receipt过期再sweep，receipt被删除但文件仍存在；dispose也只clear Map。任务要求的取消/失败/过期清理未实现。

要求：所有已接业务请求及stream upload统一准入/排空/取消策略；停用结束后不发布路由/文件/receipt。写盘前验证工程在可信目录中，上传限额/receipt数与失败/超时清理可控；过期和dispose移除本实例拥有的临时文件，不删已复制的工程资产。补延迟worker返回、延迟body、未知工程、过期、失败重试与重复dispose回归。不能只给新方法补一个数组名称但仍提前return。

## R5 [P2] 原位文字保存失败即丢草稿

位置client.js submitText（约2191）：先setEditor(null)，错误分支只显示error，未恢复编辑值。

真实函数受控E_PERSIST注入后，visibleEditor=null且草稿不再可见；用户无法继续修正或复制。要求成功后再关闭编辑，失败/冲突保留原文、目标和可重试状态，不自动重放可能uncertain的写。补E_PERSIST/REVISION_CONFLICT/网络不确定性、Esc无写、成功关闭，以及实际浏览器输入回归。

## 固定版本与交付要求

- 当前alpha.3仍74294e6/0.3.0；在本轮交付后，总调度已审82f6219/0.3.1并关闭BUG-001，原旧候选不追认黑带通过。p1的P3-009以82f6219补读取契约，目标0.3.2；**其新提交复审通过后**由总调度再明确通知最终fixed commit。p0可并行修其它项和按约定scene.template开发，不能自动引用p1移动HEAD或未审包。
- 保留C/008旧包与当前alpha.1安装；本轮根alpha.3尚未安装发布，可沿用版本但必须新功能提交目录和新staging。p0集中修R1–R5，补真正画布UI浏览器+Host/Tool/worker真实链，再一次交回，不安装/重启/发真实模型请求、不merge。
- parent消息处理目前只查source/instance/nonce与整数seq，并未完整校验v/允许事件/载荷/单调序号；不得继续宣称“严格形状/序号已验收”。在R2完整前端事件回归中恢复已审spike契约，并使被销毁实例的pending明确结算，不靠清timer留下悬挂Promise。当前受控模板范围不外推任意JS沙箱。

p1补完整Scene投影，p0修交互、范围和生命周期，两个工作区不交叉写；总调度维护全局记忆。无需新开同类调查，也不用用户在旧候选上反复手测这些可本地复现的问题。
