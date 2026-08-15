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

## 更新发布

CHM 出新版本时：

```bash
hh.exe -decompile 5z_src "新CHM路径"
node 5z_build/build.mjs         # 重新生成网站
node 5z_build/check-links.mjs   # 链接完整性
node 5z_build/verify-complete.mjs # 页面完整性
```

重新 commit 并 push 到 main 分支，GitHub Pages 自动更新。

## 在线访问

- GitHub Pages：`https://<用户名>.github.io/5z-rule/`
- 自定义域名：见 `5z_build/DEPLOY.md`
