# 5z 规则书网页版（D&D 5e 中文规则）

将 `5z规则1.59版.chm` 转换而成的现代静态网站，手机/电脑浏览器直接可用。

## 功能

- 左侧可折叠目录树（673 页面，含原 CHM 坏路径自动修复的聚合页）
- 全站搜索：空格=交集、`A|B`=任一、`"短语"`=精确，相关度排序、分类过滤、只匹配标题、结果内筛选
- 页内搜索（🔍 按钮，替代手机端 Ctrl+F）：全文高亮 + 计数 + 上一个/下一个 + Alt+↑↓
- 面包屑、上一页/下一页导航、深色模式、移动端抽屉式侧栏
- 附件（角色卡 docx、计算器 xlsx、法术词典）在线下载
- 🧙 角色创建器（`car.html`，**测试版·半成品**）：向导式车卡（种族→职业→属性→背景→技能→专长→法术→战技→程序），派生数值自动计算，网页角色卡可打印，支持 localStorage 存档与 JSON 导入导出、**Word（.docx）角色卡导出**（仿社区 `5z空白角色卡.docx` 骨架，数据自动填入+留粘贴区，可在 Word 继续编辑）与 Excel 数据表导出。⚠ 数据来自规则书自动解析，数值计算与交互细节仍在打磨，可能存在 bug，请以规则书原文为准
- 📖 法术/战技/专长/程序/魔法物品词典（`dict.html`）：浏览/搜索/筛选全部 **1196 个法术**（含完整属性与全文、职业法表反查、规则书原文链接）、**253 个战技**（流派×级别×类型）、**804 个专长**（类别筛选）、**233 个程序**（协议层级×模块）、**1585 个魔法物品**（分类/同调/神器/**价格分级**/内嵌价格表、原文链接），数据与车卡同源（构建时从规则书自动解析），永远与规则书同步
- 🐉 怪物词典（`dict.html` → 怪物 Tab）：浏览/搜索/筛选 **679 只怪物**（按生物类型、体型、阵营、挑战等级分级筛选），详情展示 AC/HP/速度/五属性/豁免/技能/伤害与状态免疫/感官/语言/熟练加值/挑战等级，以及特性、动作、附赠动作、反应、传奇动作等分节全文，并可跳转规则书原文。数据同时以 `assets/card-data/monsters.json` 提供（字段 `name/type/desc/cr/text/page/url` 与骰子机器人的查询数据同语义，便于骰子侧直接改用本文件、不再各自解析规则书）
- 🔗 **关键词互链（超链接索引）**：正文里的**法术/战技/专长/程序名自动标成超链接**，点击跳到规则书对应词条（`#kw-*` 锚点，同页/跨页都支持，跨页跳转后左侧目录与面包屑同步、落点段落闪一下高亮）；词典的「📖 规则书原文」也从「跳页顶」升级为**精确到词条**。参与互链的类别、排除页与开关都在 `5z_build/keyword-config.json`，改完重跑构建即可；构建期自带「互链数/锚点数下限 + 单页上限」门禁与坏锚点检查
- 📜 旧版规则书（`旧版规则.html`）：按版本浏览历史规则书。每个历史版本都是**该版本发布时的完整站点快照**（目录、正文、当时的搜索索引、当时的角色创建器），入口在侧栏版本行/页脚「📜 旧版」。旧版内容不复制进仓库，而是由 Cloudflare Pages Function 从项目 Git 历史提交实时取回（`/v/<版本>/…`），所以仓库体积零增长；以后每次发布新版本，上一版会自动加入旧版列表

## 旧版规则书（历史版本浏览）

- 入口：`旧版规则.html`（侧栏顶部版本行「📜 旧版」、页脚「📜 旧版」、`更新日志.html` 均有链接）
- 原理：`5z_build/archive-versions.mjs` 从 `git log` 推算每个历史版本的最终状态提交（= 下一版本第一个「自动更新」提交的父提交，含该版本周期内的站内修复），构建时把清单注入 Pages Function（`5z_build/function-template.js`），运行时由 Function 把 GitHub 原始文件反向代理到 `/v/<版本>/<原路径>`。旧版站点自己的相对链接、CSS、图片、当时的搜索索引都能自然工作，**仓库里不需要存任何旧版副本**
- 依赖：**Cloudflare Pages**（生产域名 5z-rules.top）。GitHub Pages 镜像没有 Functions，旧版落地页会自动提示并禁用旧版卡片
- 代理源（自动回退）：`raw.githubusercontent.com` → `github.com/<repo>/raw/<commit>` → `cdn.jsdelivr.net/gh/<repo>@<commit>`
- 新增版本无需手动维护：下次 `一键更新.bat` 构建时会自动把上一版写进清单；当前版本不进入旧版列表


## 数据接口（供骰子机器人等外部程序）

构建产物 `assets/card-data/*.json` 是站点与外部程序的**单一数据源**（构建时从 CHM 自动解析，不手抄）：

| 文件 | 内容 |
|------|------|
| `assets/card-data/rules.json` | 规则常量（五属性、17 技能、等级表、公式） |
| `assets/card-data/classes.json` / `races.json` / `feats.json` / `spells.json` / `class-spells.json` / `maneuvers.json` / `programs.json` / `magic-items.json` | 车卡与词典数据 |
| `assets/card-data/monsters.json` | **怪物词典**（679 只；`name/type/desc/cr/text/page/url` 与骰子侧现有查询数据一致，另含 `ac/hp/speed/abilities/saves/sections/category/size/alignment/crNum` 等结构化字段） |
| `assets/card-data/features.json` | **职业特性 / 子职特性**（2026-10-27 起；`classFeatures` 227 条含 `levels`，`subclassFeatures` 957 条 / 172 个子职页含 `level`；正文保留表格为 `a｜b` 行。骰子侧 `.5z 职业特性` 查询的数据源，解析口径见 `5z_build/parse-card-data.mjs` 的 `extractClassFeatures` / `extractSubclassFeatures`） |

> 骰子侧（`qq-dice`）构建脚本 `tools/build-5z-data.mjs` 已从 `5z_web/assets/card-data/*.json` 取数；怪物改用 `monsters.json`、职业特性改用 `features.json` 后，其各自的 HTML 解析（含串页/标题粘连风险）均不再由骰子侧维护（单一数据源纪律，见 qq-dice `docs/DECISIONS.md` D-15/D-17）。

## 目录结构

| 目录 | 说明 |
|------|------|
| （根目录） | 网站内容（GitHub Pages 发布源）。Excel 导出为**自研模板**：`car.js` 纯 JS 从规则书数据生成（职业/子职/技能/程序永远同步，含赛博格职业与程序表），不再依赖官方模板 |
| `5z_build/` | 构建工具链（build.mjs / parse-card-data.mjs / check-links.mjs / verify-complete.mjs / DEPLOY.md）；`lib/` 为共享模块（`html-scan.mjs` 逐字符样式扫描 / `anchorize.mjs` 词条锚点 / `linkify.mjs` 关键词互链），互链规则见 `keyword-config.json` |
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
