# 5z 规则站 部署说明

发布包：`5z_web_发布包.zip`（解压后就是完整网站，纯静态，零后端）

## 方案一：Cloudflare Pages（推荐，免费）

1. 注册 https://dash.cloudflare.com/sign-up （邮箱即可）
2. 左侧菜单 → **Workers 和 Pages** → **创建** → **Pages** → **上传资产**
3. 项目名填 `5z-rules`，把 `5z_web/` 里的**内容**拖进去（或上传 zip），部署
4. 立即获得 `https://5z-rules.pages.dev` 可访问
5. 买域名后（如 `5z-rules.com`）：
   - 域名在 Cloudflare 注册/接管（把域名 NS 改到 Cloudflare 分配的地址）
   - Pages 项目 → **自定义域** → 添加域名 → 自动配 DNS
   - HTTPS 自动生效

## 方案二：GitHub Pages（免费，需要 Git 基础）

1. 注册 github.com，新建仓库（如 `5z-web`），选 Public
2. 本地上传 `5z_web/` 内容（`git init` → `git add .` → push；或网页端 Upload files）
3. 仓库 → **Settings** → **Pages** → Source 选 `main` 分支 → Save
4. 获得 `https://你的用户名.github.io/5z-web/`
5. 域名：仓库根目录放 `CNAME` 文件（内容为你的域名），域名商加 CNAME 记录指向 `你的用户名.github.io`

## 买域名提示

- 推荐 Cloudflare Registrar 或阿里云/腾讯云，`.com` 约 70-90 元/年
- **不想备案**：用境外托管（Cloudflare Pages / GitHub Pages 都免备案）
- 绑定前先用免费子域名（`xxx.pages.dev`）确认效果

## 更新发布（双站同步）

`一键更新.bat` 会推送到 GitHub（触发 GitHub Pages），Cloudflare Pages 按你选择的接入方式自动同步：

### 方式一：Cloudflare Pages 连接 GitHub 仓库（推荐，一次性配置）

1. 登录 https://dash.cloudflare.com → **Workers 和 Pages** → **创建** → **Pages** → **连接到 Git** → 选 `shiqi-ujian/5z-rule`
2. 生产分支选 `main`；构建设置：**构建命令留空**、**构建输出目录填 `/`**（仓库根目录就是站点）
3. 保存并部署，首次完成后即获得 `https://<项目名>.pages.dev`

之后每次 `一键更新.bat` 推送，Cloudflare 通过 webhook 自动跟随更新，与 GitHub Pages 同时上线，本地零额外步骤。

> 若之前用的是「上传资产」（Direct Upload）方式，需新建一个 Git 集成项目：新项目部署成功后，把旧项目删除即可（项目名保留则 `pages.dev` 域名不变）。

### 发布后自动清缓存（解决「部分节点还是旧版」）

**问题现象**：发布新版本后，源站已是新版，但同一域名不同 Cloudflare 节点返回不同版本——例如 1.62 发布时 `104.21.73.101`（SJC）已是 1.62，而 `172.67.189.163`（LAX）仍返回 1.61 首页，持续约 4 小时。根域名 `/`、`/index.html`、内页 `/car`、`/dict`、`/更新日志` 全都受影响（含裸域名访问的每个入口）。

**根因（2026-10-03 实测确认）**：`5z-rules.top` 的 Zone 上有一条**把 `Cache-Control` 改写成 `public, max-age=14400, must-revalidate` 的缓存规则**（页面规则 / Cache Rules）。判据有三：

1. GitHub Pages 上**同一份 HTML** 返回的是 `max-age=600`（且 `Age: 0`、无边缘缓存），说明 4 小时不是 Pages 的默认行为；
2. Pages 的 `_headers` 对 `/assets/*` 生效（`max-age=31536000` 成功透出），但对 HTML 文档不生效——官方文档也写明 `_headers` 仅作用于 static asset responses；
3. 加了 Pages Function 主动设置 `Cache-Control` 后，**Function 设的 `Expires` 能透出、`Cache-Control` 仍被改回 14400**，证明是 Zone 规则在 Function 之后覆盖。

**修法一（推荐，根治，需在 Cloudflare 后台操作一次）**

进 Cloudflare 后台 → 选中 `5z-rules.top` → **规则 / Rules → Cache Rules**（旧版叫「页面规则 / Page Rules」）→ 找到那条把 HTML 设成 4 小时缓存的规则，二选一：

- **删掉它**：HTML 将回落到 Pages 默认（本项目会用下面第 2 点的 Function 补成 `max-age=0, must-revalidate`，即"每次回源校验"，换版本立即生效）；或
- **改成 Browser TTL 不覆盖 / Edge TTL 设为 0（不缓存 HTML）**：只让 `assets/*` 这类带 `?v=<构建戳>` 的资源保持长缓存。

改完访问首页，`Cache-Control` 应不再是 `max-age=14400`。`5z_web/functions/[[path]].js` 已经就位，规则一改它就会自动生效，无需再改代码。

**修法二（无需后台，项目已内置）**：发布后自动 purge 边缘缓存。`update.mjs` 第 8 步会先轮询确认新构建戳已上线，再调用 Cloudflare `purge_cache`。

- 配 `deploy.config.json` 的 `cloudflare.domain`（默认 `5z-rules.top`），并提供 Zone 级令牌：

  ```powershell
  $env:CLOUDFLARE_API_TOKEN = "<Zone 级令牌>"   # 权限：Zone > 缓存 Purge > Purge
  $env:CLOUDFLARE_ZONE_ID   = "<可选，留空自动按域名反查>"
  ```

- 未配置凭据时该步只打印提示并跳过，不中断发布；没确认新版上线时也会主动跳过 purge（否则会把旧内容重新填回缓存）。
- 注意：purge 能立刻让所有节点换版，但**下一个访客的 4 小时窗口会重新开始**，所以修法一才是根治。

### 方式二：本地部署器（wrangler + API Token）

1. 复制 `5z_build/deploy.config.example.json` 为 `5z_build/deploy.config.json`，填 `projectName`
2. Cloudflare 后台 → **我的资料** → **API 令牌** → **创建令牌**，权限含 **Account > Cloudflare Pages > Edit**（若要「发布后自动清缓存」，再加 **Zone > 缓存 Purge > Purge**）
3. 设置环境变量 `CLOUDFLARE_API_TOKEN`（多账号时再加 `CLOUDFLARE_ACCOUNT_ID`，或填进配置文件）
4. 之后每次 `一键更新.bat` 在推送后自动调用 wrangler 部署到 Cloudflare Pages

部署失败会中止并提示（主站 GitHub Pages 不受影响）；可用 `--skip-deploy` 跳过，或事后 `node 5z_build/update.mjs --no-extract --no-push` 重跑部署（该命令也会重跑缓存清理）。

> 缓存策略现状一览（构建自动生成，见 `build.mjs` 第 8.4 段）：
> `_headers` 声明 `/assets/*` 长缓存 1 年（带 `?v=<构建戳>`，URL 随构建变化，不靠 TTL 失效）；
> `functions/[[path]].js` + `_routes.json` 负责 HTML 文档不缓存（受上述 Zone 规则压制，待修法一）；`_routes.json` 只 include 文档路径、exclude `/assets/*`，避免给 4.5MB 的 `card-data.js` 白套一层 Function。

### 添加其他托管平台

`5z_build/update.mjs` 中的 `deployers` 数组是扩展点：按 `{ name, needs, check, run }` 格式添加（如 Vercel、Netlify），再在 `deploy.config.json` 加对应配置段即可。

## 技术备注

- 纯静态：无需服务器、数据库；托管商自动 CDN + HTTPS
- 搜索索引已 gzip 预压缩（9.95MB → 3.54MB），前端自动解压
- 全站 673 页零坏链，中文路径已完整测试
