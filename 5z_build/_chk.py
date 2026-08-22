import io
t = io.open('5z_src/5z规则1.59版.hhc', 'r', encoding='gb18030').read()
for k in ['盗贼附录.htm','奇械师附录.htm','召唤师附录.htm']:
    print(k, '->', k in t)
