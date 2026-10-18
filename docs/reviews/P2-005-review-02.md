# P2-005 R1 补丁复审：深色主按钮 token 修复

日期：2026-10-17。总调度独立复审。结论：**通过**。`bdcfd72` + `123353c` 可作 0.2.1 安装候选；真实浅色/深色视觉仍需重装后由用户复核。

评审对象：`bdcfd72 fix(ui): use existing paired host tokens for primary buttons`、`123353c docs: record primary button token fix and evidence`，分支 `dsh/p0-mode-shell`，PR #3 head `123353ccf5815cdd92c6e049bce5042fda74be21`。

## 独立核对

- **范围**：`2539b8e..HEAD` 仅 3 个文件——`client.js`、`scripts/check.mjs`、P2-005 任务记录；无 Host/worker/引擎/全局文档改动；版本仍 `0.2.1`；工作树干净，远程一致。
- **检查**：独立复跑 `npm run check` 全通过——静态 **35/35**、Client smoke **42/42**、Host 契约 **20/20**，合计 **97/97**。
- **固定包**：`artifacts/p2-b/bdcfd72/dsh-video-0.2.1.tgz`，39,702 B / 17 files，SHA-256 `83043479416b91973a45d1fbd058faec402e3cf4b32280da66643fb213ba3feb`；解包 **17/17 与 `bdcfd72` 逐字节一致**；旧 `da8a22b` 包未覆盖（`bb8e5633…`）。
- **staging**：`staging-54f4671-bdcfd72`；`INTEGRITY.json` SHA-256 `b410ec2f…`，root `bdcfd72…`、engine `54f4671…`、bundle/client/worker `0.2.1/0.1.1/0.1.1`、`rootDirty:false`；staged bridge `07442c86…`、config `9d623323…`、patch `94159539…`、bundle 16/client 12/worker 15；受控 demo 标题干净（无 `· Host`）。
- **真实链**：`engine-run-2026-10-17T09-32-38-272Z.json` 通过——执行 staging 内 Host；edit `hf-title`；revision `135a529…`→`f714e71…`；PNG 279,463 B/`875b48c6…`；MP4 135,855 B/`fae2687e…`；cancel→cancelled；close/dispose 正常、无 warning。
- **安装状态**：已装 `0.2.0` 仍链接旧 clean staging；0.2.1 未安装。

## R1 修复审查

- 删除不存在的 `--dsw-alias-label-on-brand`；主按钮改为宿主真实配对：`button-primary-fill` / `button-primary-hover` / `button-primary-dimmed` + `label-primary-foreground`；disabled 去掉半透明、改用 `dimmed + label-secondary`；移除 hover 的 `filter:brightness` 临时补光。
- 独立核对宿主 `app.asar` 内置 theme：上述 token 均存在；静态色阶 `neutral-bluish-00=#fff`、`50=#f9fafb`、`100=#ebeef2`、`1000=#0f1115`，与开发者报告的配对方向一致（浅色深底白字 / 深色浅底深字）。报告写深色 fill `#fafafa`，实际 `#f9fafb`；对比度约 18.0:1 vs 18.1:1，无功能影响，属记录精度问题。
- `scripts/check.mjs` 新增静态断言：禁止 `label-on-brand`，并要求主按钮 CSS 块包含四个配对 token；可防回归。
- 13 个 `--dsw-alias-*` 引用与内置 theme 的对照由开发者给出；本轮独立抽查了本次改动涉及的全部 token，未发现新的不存在 token。

## 非阻塞观察

1. 真实页面浅色/深色、hover、focus-visible、disabled 的视觉与对比仍待重装后复核（本地静态与 token 值不能替代）。
2. 深色 fill 记录值 `#fafafa` 应为 `#f9fafb`（建议下次记录改正，非阻塞）。
3. 0.2.1 仍为 link staging，移动/删除目录会失效；可移植发行仍属后续任务。

## 下一步

1. 用户在 Plugins 卸载 0.2.0，安装 `staging-54f4671-bdcfd72/bundle`，启用。
2. 重装后复核：深色/浅色主按钮可读、hover/focus-visible/disabled 正常；画面时间点输入（0.5/2.5/4.2 秒）抽帧；其余 P2-004 真机验收剩余项（编辑保存、导出取消、返回对话、主题窄窗、卸载重启）。
3. 通过后 P2 与 P2-005 验收收口；P3 主线继续（P3-003 引擎在程序员 1 处进行中）。
