# 腾讯文档收集表 → 问题收集箱 读取桥

群友在 QQ 群里通过腾讯文档收集表提交问题；本桥定时把新提交读入 `问题收集/inbox/`，由 agent（dsh-schedule 每 10 分钟唤醒）自动 debug、修复、发布，并把结果写入网站「更新日志」页。

## 一次性设置

1. **创建收集表**：打开 [docs.qq.com](https://docs.qq.com) → 新建「收集表」，字段建议：
   - 昵称（选填）
   - 页面/功能（选填，如 `dict.html 法术词典` / `规则页：法术/火球术`）
   - 问题标题（必填）
   - 问题描述（必填）
   - 期望行为（选填）
   - 复现步骤（选填）
   - 截图（选填，图片字段）
   创建后把表单链接发到 QQ 群。
2. **配置**：复制 `config.example.json` 为 `config.json`（已 gitignore），把收集表的「结果/表格」页地址填入 `formResultUrl`。
3. **登录**：双击 `login-docs.bat`，在弹出的 Edge 里用 QQ 登录 docs.qq.com，登录后关闭窗口（登录态保存在 `docs-profile/`，不入库）。
4. **校准提取**（首次或页面变化后）：`node 5z_build/feedback-bridge/collect-docs.mjs --probe`，把输出给 agent 校准提取逻辑。

## 运行方式（二选一）

- **常驻轮询**：双击 `watch-collect.bat`（默认每 30 分钟；改 `config.json` 的 `pollIntervalSec`）。日志：`collect.log`。
- **按需**：`node 5z_build/feedback-bridge/collect-docs.mjs`（单次）。agent 每次被定时提醒唤醒时也会顺带执行一次。

## 兜底通道

- **手动导出**：网页端打开收集表结果 → 导出 CSV/XLSX → 放进 `问题收集/manual/` → 运行 `collect-docs.mjs --manual`（或直接留待 agent 处理，agent 会读该目录）。
- 登录失效 / 页面结构变化时，读取桥会写告警到 `问题收集/alerts.md`，agent 会在会话里提示处理。

## 说明

- `问题收集/`、`config.json`、`docs-profile/`、`feedback-state.json` 均已 gitignore，**不会**进入公开仓库。
- 处理规程见同目录 `维护手册.md`。
