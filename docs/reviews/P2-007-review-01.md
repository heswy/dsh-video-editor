# P2-007 复审：可复建 staging 版本门禁

日期：2026-10-18。总调度独立复审。对象：`8c6bf26` + 记录 `b204760`。结论：**通过，P2-006-review-01 的 R1 关闭；0.2.2 可作受控安装候选，尚未安装或真机验收。** 未改客户端/Host运行时代码，未改 profile、启停、重启或 merge。

## 独立检查

- `npm run check`：静态37、Client46、Host20，共 **103/103**；版本行为脚本 **10/10**，均 exit0。
- 版本取自固定 rootCommit 的 manifest，`--bundle-version` 必填且严格 semver；错配/非法/缺失在输出及依赖工作前失败；保留非空输出保护与固定引擎0.1.1导出/版本检查，未用“删门禁”绕过。
- 新模块为纯版本准入函数；README 记录新 CLI；INTEGRITY 固定 expected/manifest/source。
- tarball **40,426 B /17files**，`3c034f2cc2fc5cdf4d84872f1a644df1c26917a832466bf9b17fd722f4f6c78d`；17/17与`8c6bf26`字节一致。README变化使新包摘要不同，旧包保留。
- 开发者候选 `staging-54f4671-8c6bf26`：INTEGRITY **`2c615075e7c0b8bf6bb5828f621f95b541cff9d98ee91fc175bf6c54af19d76e`**；bundle16、client12、worker15项摘要全部匹配；原始源码与固定root/engine提交相同。config/patch为快照路径变换，不能与根提交原始config:{}逐字节比较。
- 开发者真实产物独立核对：PNG279463B/875b48c6…、MP4135855B/fae2687e…；ffprobe H.264/1280×720/30fps/150帧/5s；证据记录cancelled+cleaned、close/dispose，与字节一致。

## 本轮独立复建与真实执行

在干净 `b204760` 工作树运行**仓库原脚本**，没有临时副本，没有allow-dirty：

```sh
node scripts/stage-dev.mjs --engine-commit 54f4671 --bundle-version 0.2.2 \
  --node '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node' \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --out '/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/review-stage-54f4671-b204760-20261018'
```

成功完成原脚本的解包、`npm ci --ignore-scripts`、fixture、INTEGRITY与版本门禁记录。rootDirty:false，rootCommit=b204760、engineCommit=54f4671，两包0.1.1、bundle0.2.2。该评审副本与开发者候选分离，未覆盖任何已有目录。

随后独立运行 `scripts/test-host-engine.mjs --staging <上述绝对目录>`：**exit0**，staging内Host→doctor/open/inspect/edit/frame/render/cancel/close/dispose完整链通过；取消实际为cancelled且cleaned，不是接受succeeded替代。独立摘要/ffprobe通过，PNG/MP4与开发者确定性产物一致。

- 评审副本INTEGRITY SHA：`0d5bb4f7c873d5953db2721a845851342eae5c98bcf889e0f42301bc58e3fc5b`。
- 独立证据：`artifacts/p2-b/evidence/engine-run-2026-10-18T01-57-48-307Z.json`，SHA `98289c0937ac3f59ae4f70e2129e4f52a3bdd8a86bfc67390d4f5e4ea3922138`。
- 评审副本用于测试，其demo含测试写入；**不作为安装路径**。实际候选仍为干净的开发者`staging-54f4671-8c6bf26/bundle`，需安装前再核对源码摘要与demo。两者生成路径不同，部署config/patch/INTEGRITY摘要不同是预期，不视为内容漂移。

## 接受范围与下一步

R1关闭，可复建性已通过实际仓库脚本和真实链验证。安装仍单独授权；目前不为这项过渡UI小修自动替换用户插件。原0.2.1、旧0.2.2目录与包保持。

本轮真实链是受控staging Host业务对象，**不是DSH激活或真页面**。0.2.2取消/时序、主题/键盘/窄窗/卸载回滚仍需真机补验。后续staging采用P3引擎0.2.1需新任务明确更新固定版本，不在这里放松旧引擎门禁。

p0-mode-shell 接 [P3-005-A](../tasks/P3-005A-native-conversation-contract.md)，核对原生AI对话/历史/模型选择及素材归属路线；不在该调查中扩展根插件实现。
