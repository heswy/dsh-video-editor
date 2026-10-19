# P3-001 多 Scene 工程与人工/AI 修订合并引擎 spike

只用于 P3 预研的独立证据工程，**不是 P3 实现**，不修改已验收的 `packages/video-engine-*`。所有工程都由 `scripts/lib/scene-templates.mjs` 的受控模板生成；"AI 重写 Scene" 由同一模板脚本生成候选 HTML 模拟，没有模型 API、联网生成或用户素材。

## 依赖与安装

HyperFrames 固定 `0.8.167`（`hyperframes`、`@hyperframes/sdk`、GSAP `3.15.0`），锁文件在 `package-lock.json`。安装只用本地缓存，忽略脚本：

```sh
npm install --prefix spikes/p3-multiscene --ignore-scripts --no-audit --no-fund --cache "$PWD/spikes/p3-multiscene/.cache/npm"
```

`node_modules/`、`artifacts/`、`.cache/` 均被本目录 `.gitignore` 排除；`artifact/` 下的 MP4/PNG 只作本机证据，不提交。真实 worker 链使用已验收的 `packages/video-engine-worker`（其依赖需按 P1-002 预装），client 复用 `packages/video-engine-client`。

## 复现

```sh
node scripts/q1-structures.mjs             # Q1 三种结构 + 渲染 + 单 Scene 重写隔离
node scripts/q1-sdk-model.mjs              # Q1/A SDK 可见性
node scripts/q2-q5-inspect-merge.mjs       # Q2 inspect 扩展 / Q5 三方合并（真实 worker）
node scripts/q3-scene-ops.mjs              # Q3 SDK 结构操作边界与受控整文件重写
node scripts/q6-q7-history-register.mjs    # Q6 历史/撤销/重开 / Q7 动态注册
node scripts/q8-render.mjs                 # Q4 素材 / Q8 15 秒渲染、抽帧、乱序 seek、取消
node --test --test-concurrency=1 test/*.test.mjs   # 合并与文档模型单元测试
```

证据 JSON 写入 `evidence/`；大产物在 `artifacts/`（gitignored），哈希与路径在证据 JSON 与本任务研究记录中。本机需要 Node >=22、Chrome、FFmpeg/ffprobe 与 `/System/Library/Fonts/STHeiti Medium.ttc`（只复制到 ignored artifacts，不入库）。

## 结论入口

见 `../../docs/research/P3-001-engine-multiscene-spike.md`：推荐**单 HTML 文档 + Scene 区段 + 单一 master timeline**；Scene 生命周期用受控整文件重写 + SDK 校验，元素级人工/AI 修订用 stableId 三方合并，冲突显式返回。嵌套 composition（A）可渲染但不能被现有 SDK 从根文档直接编辑；多入口 + manifest（C）不被官方 CLI 接受。
