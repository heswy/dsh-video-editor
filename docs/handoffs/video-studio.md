# video-studio：唯一当前交接

更新：2026-10-18。P3-012范围保持：右对话生成/续改，左自动只读播放预览，用户手动编辑延期。

交付1175596，固定root d49be12 / engine0deef8f，PR#4。总调度[第二轮复审](../reviews/P3-012-review-02.md)：R1关闭；正常261/261、原预览压力68/68、基础178+版本10、worker46/compose6/client22+skip和包/staging通过。**只补R2-follow-up：active预览的宽高/时长仍用了最新target props。**

独立真实Chrome：旧720×1280/5s作品保留时，新1280×720/6s候选快照失败，旧iframe被改成1280×720、seek.max改6。把尺寸/时长绑定每个预览实例，visible舞台/播放采用active、hidden采用candidate，runtime ready成功后统一切换，失败不改旧显示。详见复审复现及断言，不重做调查，不修R1、不加手动控件。

新增不同宽高比/时长在请求失败/runtime失败/等待期间保持旧作品、成功后再切换的真实浏览器回归，保留原68项及资源/消息压力断言。新固定root/staging一次交回；engine可继续0deef8f，无需重包无变化引擎或重跑无关长渲染。

沿用video-studio/codex/video-studio，同树/PR#4，fetch读协调STATUS/DEVELOPMENT，不merge/rebase协调分支。更新本任务/research，普通push允许；旧包/staging/用户作品只读，不安装/启停/重启、不新增模型请求、不改profile/用户工程、不merge main、不自动派发/跨会话联络。禁止全局坐标/键盘/个人剪贴板。
