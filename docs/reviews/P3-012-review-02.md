# P3-012 第二轮复审：发布结算通过，预览元数据尚未隔离

日期：2026-10-18。对象video-studio / PR#4，交付1175596，root固定d49be12、engine固定0deef8f；bundle alpha.4 / engine0.4.0。结论：**R1关闭；R2的iframe/资源保留通过，仍有一项尺寸/时长隔离残留，集中补修后再安排安装。** 不加功能，不恢复手动编辑。

## 独立结果

- fetch后HEAD1175596、树干净。基础检查 **178/178**（51静态+73Client+54Host），版本 **10/10**；显式Node24.14.0顺序运行worker **46/46**、compose.integration **6/6**、client **22pass+1 opt-in skip**。
- 固定staging正常Tool→worker+真实Chrome链 **261/261**，ok=true。两题材/连续修改/原失败矩阵无回归，新增history降级结算通过。
- 原R1公共JSONL故障探针在任务自有工程复测：entries.jsonl不可读时，compose现在返回成功、真实publishedRevision、history.status=degraded/code=E_HISTORY；source/磁盘为同一新作品，同operationId重试精确返回缓存结果、不二次写。以“已确认提交+历史降级”取代先前普通失败，符合第一轮给出的可选结算语义。历史可降级不表示历史完整，文档/上下文已有说明。
- 采用最新bb711d1 harness的评审副本运行原真实预览/压力链（DSH_R2_STRESS=1），仅把测试库路径改为绝对路径并添加一条元数据保持断言，产品代码和候选未改。原有 **68/68通过**，新增断言 **FAIL**，总69项68pass/1fail。原R2保留iframe、旧画面可播放、正确revision标记、runtime失败/资源释放/重试/压力/无手动控件等均保持；不是原68项失败。
- INTEGRITY **a71f657878a470874112c1790a38828c13395dde6459f8f21846a31a9939896b**；bundle22/client18/worker38记录摘要全部匹配。packages-r1r2固定包逐文件对Git0deef8f通过：client3文件/8610B/SHA14b85c39e89e912d6ab0924c88967c85c83c43921420a8b44334f4a5f35ed513；worker15文件/68190B/SHAb56dba237e0612497caea40cc53e6b1ef22b7b18f7d36be96f8b94e5502e09f8。上一轮packages/未覆盖。
- 独立证据：同级artifacts/reviews/2026-10-18/P3-012-r2/，含chain/、preview/、geometry-retention-probe.mjs、history-fixed-probe/result、package-check及分项日志。浏览器采用测试React调度和inert原生会话面，未安装/未发真实模型请求。

## R2-follow-up [P2] 保留旧iframe，却把它的尺寸与时长换成失败候选的值

位置：client.js CanvasWorkspace约2443–2449（width/height/duration全部来自最新props.inspected）；snapshotInstance未保存本实例元数据；slotFrameNode约3485–3505给active/candidate统一套用最新width/height/scale；播放条约3700也使用最新duration。

复用原runner的正常题材B→题材A失败场景，在发布失败候选前后读DOM：

- 已ready旧作品：iframe **720px ×1280px**，seek.max **5**。
- 请求新作品1280×720/6s，preview.snapshot注入失败，旧snapshotId/revision仍显示。
- 此时同一旧iframe却变成 **1280px ×720px**，seek.max **6**；没有新作品成功加载。旧画面被错误viewport裁切/变比，旧5秒作品被显示成6秒。

新增断言真实失败：`before:{width:'720px',height:'1280px',seekMax:'5'}; after:{width:'1280px',height:'720px',seekMax:'6'}`。这不是只看声明或画面仍存在的判断；当前保留的是DOM/source，尚未保留旧作品完整显示状态。格式/时长变化本就属于通用创作续改，是R2失败保护的同一范围。

要求：把width/height/duration与revision一同绑定到每个预览实例。可见舞台/letterbox、播放/seek/clamp/时间码采用active实例信息；隐藏候选采用其自身目标信息。新runtime ready后再原子切换全部显示元数据；失败/加载期间不能因props更新改变旧作品viewport或时长，不能把候选旧元数据混用。不需要改engine或增加新UI/手动编辑功能。

只补正式浏览器回归：不同宽高比及不同时长的候选请求失败、runtime失败、延迟加载期间旧尺寸/时长/播放均保持；成功ready后才切换新尺寸/时长，路由/消息释放原回归保持。原正常链/压力68项不放宽，继续同一任务/同树/同PR，新固定root提交与新staging交回；engine可继续固定已审0deef8f，不重复做R1或无关长渲染。

当前候选不安装、不启停/重启、不修改用户工程/profile、不发真实模型请求、不merge main。真实DSH/模型闭环仍需在候选通过后按具体授权验收。
