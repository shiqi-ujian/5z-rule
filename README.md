# 5z 规则书网页版（D&D 5e 中文规则）

将 `5z规则1.59版.chm` 转换而成的现代静态网站，手机/电脑浏览器直接可用。

## 功能

- 左侧可折叠目录树（671 页面，含原 CHM 坏路径自动修复的聚合页）
- 全站搜索：空格=交集、`A|B`=任一、`"短语"`=精确，相关度排序、分类过滤、只匹配标题、结果内筛选
- 页内搜索（🔍 按钮，替代手机端 Ctrl+F）：全文高亮 + 计数 + 上一个/下一个 + Alt+↑↓
- 面包屑、上一页/下一页导航、深色模式、移动端抽屉式侧栏
- 附件（角色卡 docx、计算器 xlsx、法术词典）在线下载

## 目录结构

| 目录 | 说明 |
|------|------|
| （根目录） | 网站内容（GitHub Pages 发布源） |
| `5z_build/` | 构建工具链（build.mjs / check-links.mjs / verify-complete.mjs / DEPLOY.md） |
| `5z_src/` | CHM 反编译中间产物（不入库，见 .gitignore） |

## 更新发布（一键自动）

拿到新版 CHM 后，任选一种方式：

**方式一：双击一键更新（推荐）**

1. 把新 CHM 放进 `incoming/` 文件夹（没有就新建）
2. 双击根目录的 `一键更新.bat`

脚本自动完成：反编译 → 构建 → 链接/完整性检查（失败即中止）→ 同步到发布源 → git 提交 → 推送到 GitHub → Pages 自动上线。处理完的 CHM 会归档到 `5z_build/archive/`。

也可以直接把 CHM 文件拖到 `一键更新.bat` 上（自动定位，无需放 incoming）。

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

## 在线访问

- GitHub Pages：`https://<用户名>.github.io/5z-rule/`
- 自定义域名：见 `5z_build/DEPLOY.md`
