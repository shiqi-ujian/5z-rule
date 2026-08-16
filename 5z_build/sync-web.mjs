// 发布源同步：把 5z_web/（staging 构建产物）镜像到仓库根目录（GitHub Pages 发布源）
// - 复制 5z_web 全部文件到根目录
// - 依据上次构建清单 5z_build/.site-manifest.json 精确删除已不存在的旧文件（绝不误删其他文件）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const STAGE = path.resolve('5z_web');
const MANIFEST = path.resolve('5z_build/.site-manifest.json');

if (!fs.existsSync(STAGE)) {
  console.error('[sync] 5z_web 不存在，请先运行 build.mjs');
  process.exit(1);
}

// 1. 收集 5z_web 全部相对路径（站点路径）
const newFiles = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(full, r);
    else newFiles.push(r);
  }
})(STAGE, '');
const newSet = new Set(newFiles);

// 2. 删除上一轮写入、本轮已不存在的文件
const removed = [];
if (fs.existsSync(MANIFEST)) {
  let old = null;
  try { old = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { old = null; }
  if (Array.isArray(old)) {
    for (const rel of old) {
      if (!newSet.has(rel)) {
        const f = path.join(ROOT, rel.split('/').join(path.sep));
        if (fs.existsSync(f) && fs.statSync(f).isFile()) {
          fs.unlinkSync(f);
          removed.push(rel);
          // 顺带清理由此产生的空目录（向上直到仓库根）
          let d = path.dirname(f);
          while (d.startsWith(ROOT) && d !== ROOT) {
            try { fs.rmdirSync(d); } catch { break; }
            d = path.dirname(d);
          }
        }
      }
    }
  }
}

// 3. 复制全部文件（覆盖）
let copied = 0;
for (const rel of newFiles) {
  const src = path.join(STAGE, rel.split('/').join(path.sep));
  const dest = path.join(ROOT, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
}

// 4. 写新清单（供下一轮精确清理）
fs.writeFileSync(MANIFEST, JSON.stringify(newFiles), 'utf8');

console.log(`[sync] 同步完成: 复制 ${copied} 个文件, 删除旧文件 ${removed.length} 个`);
removed.slice(0, 20).forEach(r => console.log('  已删除: ' + r));
