# -*- coding: utf-8 -*-
"""把 itcast_interview 讲义解析成 RAG 语料：题目 / 参考答案 / 章节出处。"""
import io, os, re, json, glob

CHAP = [
    ('01', 'prep',   '准备篇',     0),
    ('02', 'redis',  'Redis',      0),
    ('03', 'db',     '数据库',     0),
    ('04', 'spring', '框架',       0),
    ('05', 'micro',  '微服务',     0),
    ('06', 'mq',     '消息中间件', 0),
    ('07', 'coll',   '常见集合篇', 0),
    ('08', 'conc',   '并发编程',   0),
    ('09', 'jvm',    'JVM虚拟机',  0),
    ('10', 'biz',    '企业场景',   0),
]
BY_PREFIX = {c[0]: c for c in CHAP}

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.corpus-raw')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'corpus.js')

def clean(s):
    s = re.sub(r'(?m)^\s*>\s?', '', s)          # 去引用前缀
    s = re.sub(r'\*\*(.+?)\*\*', r'\1', s)      # 去加粗
    s = re.sub(r'`([^`]*)`', r'\1', s)          # 去行内 code 标记
    s = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', s)  # 去图片
    s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()

def squash(s, limit=1400):
    s = re.sub(r'\s*\n\s*', ' ', s)
    s = re.sub(r'\s{2,}', ' ', s).strip()
    return s[:limit]

# 面试官标记的多种写法
Q_RE = re.compile(r'面试官\s*[:：]?\s*')
HEAD_RE = re.compile(r'(?m)^(#{1,4})\s+(.+?)\s*$')

items, chunks = [], []
cid = 0

for path in sorted(glob.glob(os.path.join(SRC, '*.md'))):
    base = os.path.basename(path)
    prefix = base[:2]
    if prefix not in BY_PREFIX:
        continue
    _, cid_name, cname, _ = BY_PREFIX[prefix]
    raw = io.open(path, encoding='utf-8').read()
    text = clean(raw)

    # 章节区间：记录每个标题及其起始位置，便于给题目归章节
    heads = [(m.start(), m.group(2).strip()) for m in HEAD_RE.finditer(text)]
    def section_at(pos):
        cur = ''
        for p, t in heads:
            if p <= pos:
                cur = t
            else:
                break
        return cur

    found = list(Q_RE.finditer(text))
    if found:
        for i, m in enumerate(found):
            start = m.end()
            end = found[i + 1].start() if i + 1 < len(found) else len(text)
            block = text[start:end]
            # 拆出问题与回答
            am = re.search(r'候选人\s*[:：]?\s*', block)
            if am:
                q = block[:am.start()]
                a = block[am.end():]
            else:
                # 没标候选人：首行当问题，其余当回答
                lines = [l for l in block.split('\n') if l.strip()]
                q = lines[0] if lines else ''
                a = '\n'.join(lines[1:]) if len(lines) > 1 else ''
            q = squash(q, 200).strip(' 　:：')
            a = squash(a, 1400)
            # 过滤噪音：备注/提示被误当成题目、题干过短、没有可用参考答案
            if len(q) < 6 or len(a) < 40:
                continue
            if q.startswith(('【', '（', '(')) or '备注' in q[:12] or '则需要先介绍' in q:
                continue
            if q.endswith('】') or q.endswith('：'):
                continue
            section = section_at(start) or cname
            cid += 1
            item = {
                'id': 'q%d' % cid, 'ch': cid_name, 'chName': cname,
                'sec': section, 'file': base, 'q': q, 'a': a,
            }
            items.append(item)
            chunks.append({
                'id': item['id'], 'ch': cid_name, 'chName': cname,
                'sec': section, 'file': base,
                'text': q + ' ' + a,
            })
    else:
        # 无问答标记：按标题切段，作为纯参考语料
        if heads:
            for i, (p, t) in enumerate(heads):
                end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
                body = squash(text[p:end].split('\n', 1)[-1], 900)
                if len(body) < 80:
                    continue
                cid += 1
                chunks.append({
                    'id': 'c%d' % cid, 'ch': cid_name, 'chName': cname,
                    'sec': t, 'file': base, 'text': t + ' ' + body,
                })
        else:
            for para in re.split(r'\n\s*\n', text):
                body = squash(para, 900)
                if len(body) < 120:
                    continue
                cid += 1
                chunks.append({
                    'id': 'c%d' % cid, 'ch': cid_name, 'chName': cname,
                    'sec': cname, 'file': base, 'text': body,
                })

# 统计各篇章题量
cnt = {}
for it in items:
    cnt[it['ch']] = cnt.get(it['ch'], 0) + 1

chapters = []
for pfx, cid_name, cname, _ in CHAP:
    chapters.append({'id': cid_name, 'name': cname, 'count': cnt.get(cid_name, 0),
                     'files': sorted({c['file'] for c in chunks if c['ch'] == cid_name})})

payload = {
    'source': 'github.com/whyza/itcast_interview',
    'title': '黑马 Java 面试专题 · 八股文题库',
    'chapters': chapters,
    'items': items,
    'chunks': chunks,
}

js = 'window.CORPUS=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n'
io.open(OUT, 'w', encoding='utf-8').write(js)

print('题目 %d 条，检索块 %d 条，输出 %.1f KB' % (len(items), len(chunks), len(js) / 1024))
for c in chapters:
    print('  %-10s %3d 题  %s' % (c['name'], c['count'], ','.join(c['files'])[:70]))
