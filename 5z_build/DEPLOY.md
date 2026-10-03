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

Cloudflare 默认给 HTML 发 4 小时缓存（`max-age=14400`）。Git 集成的 Pages 虽然在部署时会清理一次缓存，但如果清理动作早于部署真正生效，边缘会把**旧内容**重新缓存 4 小时——表现为「源站已是新版、同一域名不同 Cloudflare 节点返回不同版本」。1.62 发布时实际踩到过这个坑（LAX 节点返回 1.61 的首页，同时 SJC 节点已是 1.62）。

两层防护：

1. **`_headers`（已自动带上，无需配置）**：`build.mjs` 每次构建都会在 `5z_web/_headers` 写一份缓存策略并随发布上线——
   HTML 与站点入口 `Cache-Control: public, max-age=0, must-revalidate`（换版本立即生效），
   带 `?v=<构建戳>` 的 `assets/*` 长缓存 1 年（URL 随构建变化，不靠 TTL 失效）。

2. **发布后自动 purge（可选，需 API Token）**：`update.mjs` 第 8 步会先轮询确认新构建戳已上线，再调用 Cloudflare `purge_cache` 清理边缘缓存。只靠 Git 集成发布也能用，与上面的「本地部署器」互不依赖。

   配置方式：`deploy.config.json` 的 `cloudflare.domain` 填站点域名（默认 `5z-rules.top`），并提供 Zone 级 API Token：

   ```powershell
   $env:CLOUDFLARE_API_TOKEN = "<Zone 级令牌>"   # 权限：Zone > 缓存 Purge > Purge
   $env:CLOUDFLARE_ZONE_ID   = "<可选，留空自动按域名反查>"
   ```

   未配置凭据时该步只打印提示并跳过，不会中断发布；没确认新版上线时也会主动跳过 purge（否则会把旧内容重新填回缓存）。

### 方式二：本地部署器（wrangler + API Token）

1. 复制 `5z_build/deploy.config.example.json` 为 `5z_build/deploy.config.json`，填 `projectName`
2. Cloudflare 后台 → **我的资料** → **API 令牌** → **创建令牌**，权限含 **Account > Cloudflare Pages > Edit**（若要「发布后自动清缓存」，再加 **Zone > 缓存 Purge > Purge**）
3. 设置环境变量 `CLOUDFLARE_API_TOKEN`（多账号时再加 `CLOUDFLARE_ACCOUNT_ID`，或填进配置文件）
4. 之后每次 `一键更新.bat` 在推送后自动调用 wrangler 部署到 Cloudflare Pages

部署失败会中止并提示（主站 GitHub Pages 不受影响）；可用 `--skip-deploy` 跳过，或事后 `node 5z_build/update.mjs --no-extract --no-push` 重跑部署（该命令也会重跑缓存清理）。

### 添加其他托管平台

`5z_build/update.mjs` 中的 `deployers` 数组是扩展点：按 `{ name, needs, check, run }` 格式添加（如 Vercel、Netlify），再在 `deploy.config.json` 加对应配置段即可。

## 技术备注

- 纯静态：无需服务器、数据库；托管商自动 CDN + HTTPS
- 搜索索引已 gzip 预压缩（9.95MB → 3.54MB），前端自动解压
- 全站 673 页零坏链，中文路径已完整测试
