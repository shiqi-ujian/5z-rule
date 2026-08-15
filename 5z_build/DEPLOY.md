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

## 更新发布

CHM 出新版时重新构建，然后重新上传覆盖（Cloudflare 支持拖拽覆盖；GitHub 重新 push）：

```bash
hh.exe -decompile 5z_src "新CHM路径"
node 5z_build/build.mjs        # 重新生成 5z_web/
node 5z_build/check-links.mjs  # 链接完整性检查
node 5z_build/verify-complete.mjs # 页面完整性核对
```

## 技术备注

- 纯静态：无需服务器、数据库；托管商自动 CDN + HTTPS
- 搜索索引已 gzip 预压缩（9.95MB → 3.54MB），前端自动解压
- 全站 675 页零坏链，中文路径已完整测试
