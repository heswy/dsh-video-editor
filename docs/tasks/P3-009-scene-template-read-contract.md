# P3-009：完整Scene读取契约，支持安全的局部改色/换素材

日期：2026-10-18。执行p1-engine，基线已审82f6219/0.3.1，交付head9aebcbc；原树/分支/PR#2。用户转发后直接实现，不新tree/调查。依据[P3-008联合复审R1](../reviews/P3-008-review-01.md)。DEVELOPMENT为唯一通用规则。

## 问题与冻结接口

scene.update的template是完整替换；当前sceneSummaries只给title/order/start/duration/id等信息，UI无法构造保持其它字段不变的请求。前端仅改背景提交title/duration/color会丢subtitle/logo/shot。不能让前端解析任意工程HTML或缓存一份第二真相补洞。

给受控Scene summary新增 **template**，它是从当前权威HTML/受控解析模型得到的、可直接作为scene.update.template输入的完整合法值：`{title,duration,subtitle?,badge?,color?,accent?,logo?,shot?}`。不含sceneId/order/start/elements/目录/绝对路径，不伪造未知值。颜色与资产路径取当前工程真实值，文本含人工text修改；“未设置可选字段”和“需要清空/删除”的既有语义保持，不默认加回不存在元素。

central sceneSummaries所影响的inspect/open、project.create、scene.*、project.revise等结果保持一致，schema所有SceneSummary引用同步。legacy无受控Scene仍scenes=[]；JSONL v1与22个方法不变，旧字段不删不改；不把scene.update偷偷改成partial patch，也不更改重生成/覆盖/合并/黑带修复。

## 范围与版本

允许两engine包源码/schema/README/版本/锁根和必要测试/打包、本任务与对应research。两包 **0.3.2**。可增加真实JSONL回归，不改根插件/Host/client.js、p0树、spike、全局文档。HyperFrames保持0.8.167，不新运行时依赖。

## 验收

1. 创建带全部受支持可选字段与自定义背景/accent的工程，inspect.template可往返合法validateSceneSpec；只改color调用scene.update，subtitle/badge/logo/shot/accent保持，其它Scene和人工layout/style保留。
2. 只改shot同样保留其它字段；close/reopen与worker重启后template一致；人工text编辑后投影为新文本。可选字段缺失不生成错误默认对象。
3. schema正/负与旧结果兼容、22方法集、旧工程、历史/覆盖/合并回归通过。必要时检查一次snapshot/抽帧表明只改预期字段，不要求为只读投影变更重复整套长渲染。
4. 新固定提交目录两包/完整SHA/条目/源码字节一致与干净pack证据、方法结果样例和未测项一次交回PR#2。82f6219旧包保留。

不安装/启停/重启、不改profile、不发模型请求、不改当前用户工程、不merge、不联系或修改p0。p0按此冻结的template形状并行准备，新的具体提交需总调度复审后才能进入其最终staging，不依赖移动HEAD。

## 总调度验收（2026-10-18）

功能d383e3d、交付c31fde5已通过[复审](../reviews/P3-009-review-01.md)。独立worker44/44、client20 pass+1 opt-in skip、额外公共JSONL探针4/4、两包逐文件摘要通过；冻结两包0.3.2供p0生成新staging。本任务收口，p0 R1–R5不因本任务通过而自动关闭。未安装/merge。
