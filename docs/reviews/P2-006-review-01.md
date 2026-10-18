# P2-006 复审：取消状态与时序校验

日期：2026-10-17。总调度独立复审。对象：实现 `97c0609`、交付记录 `16d60aa`；当前分支 `dsh/p0-mode-shell@2c46daa` 后续仅增加 AGENTS 入口。结论：**客户端修复通过本地/契约复核；交付流程需修 R1，暂不放行新安装候选。** 无安装、启停、重启、profile 修改、合并或功能代码修改。

## 独立验证

- `npm run check`：静态 **37/37**、Client smoke **46/46**、Host 契约 **20/20**，合计 **103/103**，exit 0。
- 代码：`cancelled` 单独作为中性终止态，无红色失败；frame 取消为空态，render 设置/再次导出入口保留。failed/timed_out 使用双语消息；真实终止态由 worker status 提供。
- 时序：`start + duration > project.duration + 1/240` 在发送 edit 前拒绝；0/5、2/3 允许，4/5 拒绝；worker `E_PARAMS` 的 `Timing extends beyond composition` 映射为本地化提示。原实现批量校验与 revision/operationId 保持。
- 新双语文案位于 client.js 的 ZH/EN 注册字典；locale/*.json 是包展示 metadata，未改它们不构成本轮缺失。
- tarball **40,220 B / 17 files**，SHA-256 `0dd8bcf2a6415ea4c592eea44e7b2a5bff740156540443b553cc0709768ccf89`；解包 **17/17** 与 `97c0609` 字节一致。
- staging `staging-54f4671-97c0609` 的 INTEGRITY SHA `4e43f20390cbd91cfbfa1cc8805d65cd4a0f5e6623d237a75d23577dd9b23179`；逐项 hash/大小核对通过，bundle 16 项（14 个原始源码匹配，package/patch 为部署变换）、client 12/12、worker 15/15 源码匹配固定提交；引擎为已审 `54f4671` / 两包 0.1.1。
- 原 staging 的 config 和 patch 摘要匹配；调用 `loadStagedHost` 验证通过，加载的是 staging 内 Host `07442c86…`；此验证不启动 worker。demo 标题已恢复为 `让创意成为影像`。
- 独立核对开发者已有真实链证据及产物：PNG **279,463 B / 875b48c6…**；MP4 **135,855 B / fae2687e…**，摘要一致；独立 ffprobe **H.264 / 1280×720 / 30fps / 150 帧 / 5s**。开发者证据记录 cancel→cancelled/cleaned、close/disposed，与提交/Host 摘要对应。
- 本轮**没有重新执行完整真实渲染链**：Host/engine 源码未改变，复核已有链的归属与真实字节，新增行为由独立 Client/Host 检查覆盖。不将已有证据核对写成新真机或新真实链通过。

## R1 [P2，安装候选交付阻塞]：已提交 staging 脚本不能生成本版本

位置：`scripts/stage-dev.mjs:51`、`:185`。当前 `EXPECTED_BUNDLE_VERSION = '0.2.1'`，但根 package.json 已为 0.2.2。直接执行仓库命令会在复制根文件后退出，进入不到 engine、fixture、INTEGRITY 的生成阶段。

独立复现（开发工作树干净，新任务目录，不触碰任何原 staging）：

```sh
node scripts/stage-dev.mjs --engine-commit 54f4671 \
  --node '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node' \
  --out '/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/review-P2-006-version-gate' \
  --skip-fixture
```

结果：**exit 1**，`stage-dev failed: root bundle version is 0.2.2, expected 0.2.1`。失败目录由脚本正常清理。

现有 staging 字节没有发现伪造或污染；问题是开发者只在临时副本修改门禁，仓库无法复建同版候选，且 stage 脚本不在原任务白名单。不能要求开发者在旧任务中越权修改，故新发 [P2-007](../tasks/P2-007-staging-version-reproducibility.md) 明确放行这项小修。修复应保留明确版本核对，不直接删除所有版本门禁，不顺带切到 P3 引擎。

## 非阻塞观察

- 失败终止态本地化改为简洁通用消息，原始 worker error.code 不再直接出现在 UI；符合本任务“无原始英文/路径”的范围。后续可增加“详细信息”安全诊断，不据此阻塞小修。
- Client 轮询/取消之间的异步状态和其他错误文案仍受旧实现约束，未在本轮扩大到并发交互改造。新画布接入需按新生命周期设计验收。

## 未验证与下一步

真实 DSH 0.2.2 安装后取消/时序体验、主题、键盘及完整生命周期本轮均未测；当前安装未动。p0-mode-shell 做 P2-007，继续用当前树/分支/PR #3。修后交回仓库原脚本生成的新 staging、真实链与包来源，再复审；不用重写已通过的客户端修复。v0.3 新界面与 AI 嵌入另发任务，不在此小修引入。

## 后续收口（2026-10-18）

R1已由P2-007的8c6bf26修复，独立原脚本复建与真实链通过，见 [P2-007-review-01](P2-007-review-01.md)。本报告中的阻塞结论保留为当时事实，当前候选状态读最新评审。
