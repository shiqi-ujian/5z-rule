# 5z 规则书网页版（D&D 5e 中文规则）

将 `5z规则1.59版.chm` 转换而成的现代静态网站，手机/电脑浏览器直接可用。

## 功能

- 左侧可折叠目录树（671 页面，含原 CHM 坏路径自动修复的聚合页）
- 全站搜索：空格=交集、`A|B`=任一、`"短语"`=精确，相关度排序、分类过滤、只匹配标题、结果内筛选
- 页内搜索（🔍 按钮，替代手机端 Ctrl+F）：全文高亮 + 计数 + 上一个/下一个 + Alt+↑↓
- 面包屑、上一页/下一页导航、深色模式、移动端抽屉式侧栏
- 附件（角色卡 docx、计算器 xlsx、法术词典）在线下载
- 🧙 角色创建器（`car.html`，**测试版·半成品**）：向导式车卡（种族→职业→属性→背景→技能→专长→法术→战技→程序），派生数值自动计算，网页角色卡可打印，支持 localStorage 存档与 JSON/Excel 导出。⚠ 数据来自规则书自动解析，数值计算与交互细节仍在打磨，可能存在 bug，请以规则书原文为准
- 📖 法术/战技/程序/魔法物品词典（`dict.html`）：浏览/搜索/筛选全部 **1127 个法术**（含完整属性与全文、职业法表反查、规则书原文链接）、**252 个战技**（流派×级别×类型）、**226 个程序**（协议层级×模块）、**约 1550 个魔法物品**（分类/同调/神器/**价格分级**/内嵌价格表、原文链接），数据与车卡同源（构建时从规则书自动解析），永远与规则书同步

## 目录结构

| 目录 | 说明 |
|------|------|
| （根目录） | 网站内容（GitHub Pages 发布源），含 Excel 导出模板 `dnd5z人物卡模板改.xlsx`（构建时读取并内联进 car.html） |
| `5z_build/` | 构建工具链（build.mjs / parse-card-data.mjs / check-links.mjs / verify-complete.mjs / DEPLOY.md） |
| `5z_src/` | CHM 反编译中间产物（不入库，见 .gitignore） |

## 更新发布（一键自动）

拿到新版 CHM 后，任选一种方式：

**方式一：双击一键更新（推荐）**

1. 把新 CHM 放进 `incoming/` 文件夹（没有就新建）
2. 双击根目录的 `一键更新.bat`

脚本自动完成：反编译 → 构建 → 链接/完整性检查（失败即中止）→ 同步到发布源 → git 提交 → 推送到 GitHub → Pages 自动上线。处理完的 CHM 会归档到 `5z_build/archive/`。

也可以直接把 CHM 文件拖到 `一键更新.bat` 上（自动定位，无需放 incoming）。

> 没有新 CHM 时（`incoming/` 为空）双击同样有效：脚本会改用现有 `5z_src` 重新构建并发布（等效 `--no-extract`），适合发布构建工具/样式修复等改动。

**方式二：全自动监视（连双击都省了）**

双击根目录的 `启动自动监视.bat`（窗口保持打开），之后每次把新 CHM 丢进 `incoming/`，都会自动更新并上线。日志写在 `5z_build/watch.log`，Ctrl+C 停止监视。

**方式三：手动命令（等价流程）**

```bash
node 5z_build/update.mjs                # 自动找 incoming/ 下的新 CHM
node 5z_build/update.mjs "D:\x\新CHM.chm"  # 指定路径
node 5z_build/update.mjs --no-push      # 只提交不推送
node 5z_build/update.mjs --dry-run      # 演练：构建+检查+同步，不提交不推送
node 5z_build/update.mjs --no-extract   # 跳过反编译，用现有 5z_src 重构建
```

> 前提：本机装有 Node.js（构建工具链依赖）。版本号（如 v1.60）与页面标题会从 CHM 内自动提取，无需手改。

## 多站点同步

推送后 GitHub Pages 自动更新。Cloudflare Pages 同步方式（任选其一）：

- **Git 集成（推荐）**：Cloudflare 后台 → Pages → 创建 → 连接到 Git → 选本仓库，构建输出目录 `/`。之后每次推送自动同步，零维护。步骤见 `5z_build/DEPLOY.md`
- **本地部署器**：复制 `5z_build/deploy.config.example.json` 为 `deploy.config.json` 并配 Cloudflare API Token，`一键更新.bat` 会自动多部署一份到 Cloudflare Pages

其他平台（Vercel 等）可在 `5z_build/update.mjs` 的 `deployers` 数组中扩展。

## 在线访问

- GitHub Pages：`https://<用户名>.github.io/5z-rule/`
- 自定义域名：见 `5z_build/DEPLOY.md`
