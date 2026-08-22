# HHC 补丁（GBK 安全版）：在 7 个职业条目的子 UL 中插入附录页条目
import io, sys

HHC = '5z_src/5z规则1.59版.hhc'
with io.open(HHC, 'r', encoding='gb18030') as f:
    text = f.read()

jobs = [
    ('职业/盗贼.htm', '职业/盗贼附录.htm', '附录：杂技花招'),
    ('职业/奇械师.htm', '职业/奇械师附录.htm', '附录：制造物品'),
    ('职业/契术师.htm', '职业/契术师附录.htm', '附录：魔能祈唤'),
    ('职业/吟游诗人.htm', '职业/吟游诗人附录.htm', '附录：吟唱'),
    ('职业/德鲁伊.htm', '职业/德鲁伊附录.htm', '附录：荒野变形'),
    ('职业/法师.htm', '职业/法师附录.htm', '附录：法术书'),
    ('职业/召唤师.htm', '职业/召唤师附录.htm', '附录：指令列表'),
]

count = 0
for local, out, nav in jobs:
    idx = text.find(local)
    if idx < 0:
        print('✗ 未找到', local); continue
    obj_start = text.rfind('<OBJECT', 0, idx)
    obj_end = text.find('</OBJECT>', idx)
    if obj_start < 0 or obj_end < 0:
        print('✗ 结构异常', local); continue
    ul = text.find('<UL>', obj_end)
    if ul < 0 or ul - obj_end > 400:
        print('✗ 未找到子 UL', local); continue
    entry = ('<LI><OBJECT type="text/sitemap">\n'
             ' <param name="Name" value="%s">\n'
             ' <param name="Local" value="%s">\n'
             ' <param name="ImageNumber" value="11">\n'
             ' </OBJECT>\n</LI>\n' % (nav, out))
    text = text[:ul + 4] + '\n' + entry + text[ul + 4:]
    count += 1
    print('OK insert', nav)

with io.open(HHC, 'w', encoding='gb18030', newline='') as f:
    f.write(text)
print('done, inserted', count)

