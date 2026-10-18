# BUG-001 复审：完整构图导出适配

日期：2026-10-18。对象：功能82f6219、交付9aebcbc，p1-engine / PR#2，两包0.3.1。结论：**本机受控范围通过，BUG-001关闭；新整合基线冻结82f6219/两包0.3.1。** 不代表已经替换当前安装或完成整个产品验收。

## 代码与固定包

- fetch成功，HEAD9aebcbc，工作树干净。唯一生产行为差异为Jobs.env(temp, kind)在kind=render时覆盖HF_STATIC_DEDUP=false，并将job.kind传到子进程环境；frame/snapshot不注入该值，未修改父进程process.env、模板、编码参数、构图或上游包。ffprobe作为render的验证子进程也继承此无害开关，不影响其解析。
- 独立读取本机HyperFrames0.8.167：resolveStaticFrameDedup确实把false/off/0解析为关闭；关闭时跳过static verification流程。page关闭后device-metrics失效/innerHeight633的插桩诊断为开发者证据，本轮不将其冒充总调度独立插桩结果。
- worker40/40独立通过（本轮默认Node22.15.0，约17.8s）；方法/协议和布局合并无本轮行为改动。
- tarball逐文件对Git82f6219：worker14文件/55,568 B/SHA-256 31c2ed850d445e588d8063cc95a1e57cde1a994cd732c4912bc6c4e9481be8a7；client3文件/7,408 B/dcb939b023e351b4299e3789e8fbf2528083f726e74164da1c6f2fe42ce7e92b。JSONL v1、22方法与0.3.0接口一致。archive重复pack为开发者证据，本轮独立核对条目及源码字节。

## 独立反向验证与环境

在任务自有artifacts/reviews/2026-10-18/BUG-001/negative/导出82f6219的worker，再只把src/jobs.mjs换回74294e6原文件；node_modules只读链接开发树，所有临时工程/写入位于评审副本，不修改开发树、安装staging或上游依赖。

第一次评审终端环境使用Node22且PATH没有ffprobe，正/反两个真实测试均在artifact验证阶段失败，不能用作黑带验证；对应失败日志保留。补齐本机/opt/homebrew/bin的**命令级PATH**并显式使用Desktop primary Node24.21.0后重跑：旧jobs回归真实失败在baseline 0.5s，错误为“mp4 has a bottom black band，86 !== 0”。这证明新用例能够检出旧问题，而非只验证元数据或环境启动成功。

新用例覆盖1280×720 baseline、人工布局底部元素和960×720静态4:3，各0.5/1.5s，真实MP4解码与同revision worker PNG对照：完整帧及底部90行的差异容差、背景到底、黑带为0及底部logo位置。测试并非声明所有像素逐一相等，H.264/字形抗锯齿容差保留。

已查看交付的after-edited-1.5s.png，背景和底部logo完整；此视觉查看不代替新测试运行。根因/适配不依赖裁切、拉伸、放大或事后补色。

## 收口与后续

独立真实回归4/4通过（Node24.21.0，约120.2s）：jobs.integration三项覆盖真实H.264/响应与产物校验、取消/超时/EOF/shutdown清理、close准入/重开；render-band新增一项约57.8s，覆盖三种工程×两个时刻。不是独立重跑全部12项；开发者12/12作为交付记录保留。

另独立解码交付的六组前后PNG：旧路径均86行黑，新路径均0行；与worker帧的阈值24差异约0.96%–1.42%，结果吻合。证据/日志在同级artifacts/reviews/2026-10-18/BUG-001/，不覆盖开发者原失败材料。

Client完整检查：Desktop Node24.21.0首跑17 pass/2 fail/1 skip，两个既有200ms protocol fixture出现E_REQUEST_TIMEOUT；client生产源码与74294e6无差异。未改代码，改用开发者同版本Node24.14.0完整复跑19 pass/1 opt-in skip（约22.6s），打包兼容及真实worker链通过。首跑/复跑日志均保留；这符合此前fixture抖动表现，未证明具体调度根因，不删除失败记录或声称所有运行时全绿。真实render和生命周期4/4使用Node24.21.0已通过。

P3-008引擎固定到82f6219/两包0.3.1；p0需要新staging和精确版本/包门禁，不自动从移动HEAD取包、不修改当前alpha.1安装。禁用静帧去重是有性能代价的项目适配，不声称上游bug本身已修复；仅受控本机macOS范围，长片性能/音视频/GPU/任意HTML和其它平台未验收。恢复去重必须先证明上游修好并继续保留此回归。
