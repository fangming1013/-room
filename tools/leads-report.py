#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
客资分析报告生成器
------------------------------------------------
每 6 小时跑一次：拉云端客资 -> 统计 -> 出 Markdown 报告 ->（可选）微信推送。

凭证读取顺序：
  1. 环境变量 LEAD_ADMIN_KEY
  2. 工作区 .workbuddy/leads-key.txt  （第一行就是 ADMIN_KEY 的值）
  3. 都没有 -> 直接报错并给出指引，不生成假报告

用法：
  python tools/leads-report.py
  python tools/leads-report.py --push      # 同时推微信简报
  python tools/leads-report.py --hours 6   # 统计窗口（默认 6 小时）
"""
import os, sys, json, ssl, time, urllib.request, urllib.error
from datetime import datetime, timedelta

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                        # room-mini
WS = os.path.dirname(ROOT)                          # 工作区根
OUT_DIR = os.path.join(WS, '客资报告')
KEY_FILE = os.path.join(WS, '.workbuddy', 'leads-key.txt')
API = 'https://room-rchx.onrender.com'
PUSH_TOKEN = os.environ.get('PUSHPLUS_TOKEN', '0c91d6dff98843dcbbe5d961aa05c625')

C_SPACE = {'kitchen': '厨房', 'bathroom': '卫生间', 'room': '卧室', 'living': '客厅',
           'balcony': '阳台', 'whole': '全屋'}


def get_key():
    k = (os.environ.get('LEAD_ADMIN_KEY') or '').strip()
    if k:
        return k, 'env'
    if os.path.exists(KEY_FILE):
        try:
            lines = [x.strip() for x in open(KEY_FILE, encoding='utf-8').read().splitlines()]
            for ln in lines:
                if ln and not ln.startswith('#'):
                    return ln, 'file'
        except Exception:
            pass
    return '', ''


def is_test(r):
    name = (r.get('name') or '').strip()
    phone = (r.get('phone') or '').strip()
    if '测试' in name or '联调' in name or 'test' in name.lower():
        return True
    if phone in ('13800138000',):
        return True
    return False


def fetch(key, limit=500):
    url = '%s/api/leads?limit=%d&key=%s' % (API, limit, urllib.parse.quote(key))
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={'User-Agent': 'leads-report/1.0'})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=45, context=ctx) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = ''
            try:
                body = e.read().decode('utf-8')[:200]
            except Exception:
                pass
            try:
                return json.loads(body)
            except Exception:
                return {'ok': False, 'error': 'HTTP %s %s' % (e.code, body)}
        except Exception as e:
            if attempt == 1:
                return {'ok': False, 'error': '网络异常: %s' % e}
            time.sleep(3)
    return {'ok': False, 'error': '未知错误'}


def ts(v):
    try:
        return int(float(v))
    except Exception:
        return 0


def fm(t):
    if not t:
        return '—'
    return datetime.fromtimestamp(t / 1000.0).strftime('%m-%d %H:%M')


def span_text(ms):
    if ms <= 0:
        return '—'
    m = ms // 60000
    if m < 60:
        return '%d 分钟' % m
    h = m // 60
    if h < 24:
        return '%d 小时 %d 分' % (h, m % 60)
    return '%d 天 %d 小时' % (h // 24, h % 24)


def money(v):
    v = float(v or 0)
    if v <= 0:
        return '—'
    if v >= 10000:
        return '%.1f 万' % (v / 10000.0)
    return '%d 元' % int(v)


def area_band(a):
    a = float(a or 0)
    if a <= 0:
        return '未填'
    if a < 60:
        return '60㎡以下'
    if a < 90:
        return '60-90㎡'
    if a < 120:
        return '90-120㎡'
    if a < 150:
        return '120-150㎡'
    return '150㎡以上'


def budget_band(b):
    b = float(b or 0)
    if b <= 0:
        return '未出预算'
    if b < 50000:
        return '5 万以下'
    if b < 100000:
        return '5-10 万'
    if b < 200000:
        return '10-20 万'
    if b < 300000:
        return '20-30 万'
    return '30 万以上'


def counter(items, fn):
    d = {}
    for x in items:
        k = fn(x)
        d[k] = d.get(k, 0) + 1
    return sorted(d.items(), key=lambda kv: (-kv[1], str(kv[0])))


def bar(n, total, width=12):
    if not total:
        return ''
    c = int(round(width * n / float(total)))
    return '█' * c + '░' * (width - c)


def score(x):
    s = 0
    if x.get('wantRender'):
        s += 2
    if ts(x.get('times')) > 1:
        s += 1
    if ts(x.get('spaceCount')) >= 3:
        s += 1
    if float(x.get('budget') or 0) >= 150000:
        s += 1
    return s


def level(s):
    if s >= 3:
        return '高'
    if s == 2:
        return '中'
    return '低'


def build(rows, hours):
    now = datetime.now()
    t_now = int(now.timestamp() * 1000)
    since = t_now - hours * 3600 * 1000
    t_today = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
    t7 = t_now - 7 * 86400000

    rows = sorted(rows, key=lambda x: -ts(x.get('createdAt')))
    new6 = [x for x in rows if ts(x.get('createdAt')) >= since]
    today = [x for x in rows if ts(x.get('createdAt')) >= t_today]
    w7 = [x for x in rows if ts(x.get('createdAt')) >= t7]
    hot = [x for x in rows if x.get('wantRender')]
    repeat = [x for x in rows if ts(x.get('times')) > 1]

    budgets = [float(x.get('budget') or 0) for x in rows if float(x.get('budget') or 0) > 0]
    areas = [float(x.get('area') or 0) for x in rows if float(x.get('area') or 0) > 0]
    avg_b = sum(budgets) / len(budgets) if budgets else 0
    avg_a = sum(areas) / len(areas) if areas else 0

    L = []
    A = L.append
    A('# 客资分析报告 · %s' % now.strftime('%Y-%m-%d %H:%M'))
    A('')
    A('> 数据源：云端客资库（`/api/leads`）｜统计窗口：近 %d 小时｜生成时间：%s' % (hours, now.strftime('%Y-%m-%d %H:%M:%S')))
    A('')

    # ---- 一句话 ----
    if not rows:
        one = '客资库为空，目前还没有客户完成注册。'
    elif new6:
        one = '近 %d 小时新增 %d 条客资，累计 %d 条，其中中高意向 %d 条。' % (
            hours, len(new6), len(rows), len([x for x in rows if score(x) >= 2]))
    else:
        one = '近 %d 小时没有新增客资，累计 %d 条；中高意向 %d 条待跟进。' % (
            hours, len(rows), len([x for x in rows if score(x) >= 2]))
    A('**%s**' % one)
    A('')

    # ---- 总览 ----
    A('## 一、总览')
    A('')
    A('| 指标 | 数值 |')
    A('|---|---|')
    A('| 累计客资 | %d |' % len(rows))
    A('| 近 %d 小时新增 | %d |' % (hours, len(new6)))
    A('| 今日新增 | %d |' % len(today))
    A('| 近 7 天新增 | %d |' % len(w7))
    A('| 预约出图（最高意向） | %d |' % len(hot))
    A('| 多次留资（≥2 次） | %d |' % len(repeat))
    A('| 平均面积 | %s |' % ('%.1f ㎡' % avg_a if avg_a else '—'))
    A('| 平均预算 | %s |' % (money(avg_b) if avg_b else '—'))
    A('')

    if not rows:
        A('---')
        A('')
        A('**下一步**：当前无数据。先手动从朋友圈/视频号私信 10 位有装修意向的熟人，打开小程序走完「选空间→填尺寸→生成预算→注册」，即可产生首批真实客资。')
        return '\n'.join(L), {'total': 0, 'new': 0, 'hot': 0}

    # ---- 新增明细 ----
    A('## 二、本窗口新增客户')
    A('')
    if new6:
        A('| 留资时间 | 城市 | 类型 | 面积 | 空间 | 预算 | 意向 |')
        A('|---|---|---|---|---|---|---|')
        for x in new6:
            A('| %s | %s | %s | %s | %d | %s | %s |' % (
                fm(ts(x.get('createdAt'))), x.get('city') or '—',
                x.get('decoTypeName') or ('整装' if x.get('decoType') == 'whole' else ('局改' if x.get('decoType') == 'partial' else '—')),
                (str(x.get('area')) + '㎡') if x.get('area') else '—',
                int(x.get('spaceCount') or 0), money(x.get('budget')), level(score(x))))
    else:
        A('本窗口无新增。')
    A('')

    # ---- 区域 ----
    A('## 三、区域分布')
    A('')
    A('| 城市 | 数量 | 占比 | |')
    A('|---|---|---|---|')
    for c, n in counter(rows, lambda x: x.get('city') or '未填'):
        A('| %s | %d | %.0f%% | %s |' % (c, n, 100.0 * n / len(rows), bar(n, len(rows))))
    A('')
    top_city = counter(rows, lambda x: x.get('city') or '未填')[0]
    if top_city[0] != '未填':
        A('主力区域 **%s**，占 %.0f%%。投放和地推资源优先砸这里。' % (top_city[0], 100.0 * top_city[1] / len(rows)))
    else:
        A('⚠️ 有 %d 条未填城市，建议在注册页把城市设为必选（chips 点选，不打字）。' % top_city[1])
    A('')

    # ---- 需求结构 ----
    A('## 四、需求结构')
    A('')
    A('**面积分布**')
    A('')
    A('| 面积段 | 数量 | 占比 | |')
    A('|---|---|---|---|')
    for c, n in counter(rows, lambda x: area_band(x.get('area'))):
        A('| %s | %d | %.0f%% | %s |' % (c, n, 100.0 * n / len(rows), bar(n, len(rows))))
    A('')
    A('**预算分布**')
    A('')
    A('| 预算段 | 数量 | 占比 | |')
    A('|---|---|---|---|')
    for c, n in counter(rows, lambda x: budget_band(x.get('budget'))):
        A('| %s | %d | %.0f%% | %s |' % (c, n, 100.0 * n / len(rows), bar(n, len(rows))))
    A('')
    single = len([x for x in rows if ts(x.get('spaceCount')) <= 1])
    multi = len(rows) - single
    A('**改造范围**：单空间 %d 条 / 多空间 %d 条（多空间意味着客户在考虑整装，客单价更高）' % (single, multi))
    A('')
    tc = counter(rows, lambda x: x.get('decoTypeName') or x.get('decoType') or '未填')
    A('**整装/局改**：' + ' · '.join('%s %d 条' % (k, v) for k, v in tc))
    A('')
    # 空间偏好
    space_hit = {}
    for x in rows:
        for s in (x.get('spaces') or []):
            k = s if isinstance(s, str) else (s.get('key') or s.get('name') or '')
            if k:
                space_hit[C_SPACE.get(k, k)] = space_hit.get(C_SPACE.get(k, k), 0) + 1
    if space_hit:
        A('**客户算过的空间**：' + ' · '.join('%s %d 次' % (k, v) for k, v in
                                              sorted(space_hit.items(), key=lambda kv: -kv[1])))
        A('')
        A('→ 出现最多的空间就是客户最痛的改造点，内容选题优先拍它。')
        A('')

    # ---- 高意向 ----
    A('## 五、高意向客户（优先回访）')
    A('')
    ranked = sorted(rows, key=lambda x: (-score(x), -ts(x.get('createdAt'))))
    high = [x for x in ranked if score(x) >= 2]
    if high:
        A('| 意向 | 手机 | 城市 | 预算 | 特征 | 首次留资 | 最后动作 |')
        A('|---|---|---|---|---|---|---|')
        for x in high[:20]:
            ph = str(x.get('phone') or '')
            tel = ph[:3] + '****' + ph[7:] if len(ph) == 11 else ph
            feats = []
            if x.get('wantRender'):
                feats.append('预约出图' + (('/' + x.get('wantStyle')) if x.get('wantStyle') else ''))
            if ts(x.get('times')) > 1:
                feats.append('留资 %d 次' % ts(x.get('times')))
            if ts(x.get('spaceCount')) >= 3:
                feats.append('%d 个空间' % ts(x.get('spaceCount')))
            A('| %s | %s | %s | %s | %s | %s | %s |' % (
                level(score(x)), tel, x.get('city') or '—', money(x.get('budget')),
                ' / '.join(feats) or '—', fm(ts(x.get('firstAt') or x.get('createdAt'))),
                fm(ts(x.get('updatedAt')))))
        A('')
        A('**打分口径**：预约出图 +2；重复留资 +1；≥3 空间 +1；预算≥15 万 +1。≥3 为高，2 为中。')
    else:
        A('暂无中高意向客户。')
    A('')

    # ---- 关注跨度 ----
    A('## 六、客户关注跨度')
    A('')
    A('> 说明：服务端只在注册时收一次数据，**没有页面停留时长**。下表是「首次留资 → 最后一次动作」的时间跨度，'
      '可以当关注热度参考，但不能等同于使用时长。')
    A('')
    spans = []
    for x in rows:
        f = ts(x.get('firstAt') or x.get('createdAt'))
        u = ts(x.get('updatedAt')) or f
        spans.append((u - f, x))
    spans.sort(key=lambda kv: -kv[0])
    nz = [s for s in spans if s[0] > 60000]
    if nz:
        A('| 跨度 | 城市 | 面积 | 预算 |')
        A('|---|---|---|---|')
        for d, x in nz[:10]:
            A('| %s | %s | %s | %s |' % (span_text(d), x.get('city') or '—',
                                          (str(x.get('area')) + '㎡') if x.get('area') else '—',
                                          money(x.get('budget'))))
        A('')
        A('跨度超过 1 小时的 %d 条，说明这些客户是「看过、想过、又回来」，比一次算完就走的热度高。' % len(nz))
    else:
        A('所有客户都在同一分钟内完成，暂无回访行为。')

    # ---- 结论 ----
    A('')
    A('## 七、结论与建议')
    A('')
    todos = []
    if len(rows) < 5:
        todos.append('样本仅 %d 条，**不做趋势判断**，当前唯一任务是攒量：私信 10 位有装修需求的熟人，或给 5 家装企老板发海报。' % len(rows))
    if high:
        oldest = min(high, key=lambda x: ts(x.get('updatedAt')))
        hrs = (t_now - ts(oldest.get('updatedAt'))) / 3600000.0
        if hrs >= 2:
            todos.append('有 %d 条中高意向客户，最久的一条已 %.0f 小时没联系，**今天必须打完**。' % (len(high), hrs))
    if len(today) == 0 and len(rows) > 0:
        todos.append('今日零新增，检查两件事：① 视频号是否挂了小程序卡片 ② 朋友圈/私信是否还在发。')
    if avg_b and avg_b < 60000 and len(rows) >= 10:
        todos.append('平均预算只有 %s，偏低。检查默认选材档位是否被默认成最低档。' % money(avg_b))
    if not todos:
        todos.append('数据平稳，按既定节奏推进：继续发内容、私信、盯回访。')
    for i, t in enumerate(todos, 1):
        A('%d. %s' % (i, t))
    A('')
    A('---')
    A('*本报告由脚本自动生成，未做任何数据推测。行为埋点（停留时长、页面路径）尚未上线，上线后本报告会自动增加对应章节。*')

    return '\n'.join(L), {'total': len(rows), 'new': len(new6), 'hot': len(high), 'today': len(today)}


def push(text_html):
    try:
        body = json.dumps({'token': PUSH_TOKEN, 'title': '客资报告', 'content': text_html, 'template': 'html'}).encode('utf-8')
        req = urllib.request.Request('https://www.pushplus.plus/send', data=body,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode('utf-8')).get('code') == 200
    except Exception:
        return False


def main():
    hours = 6
    args = sys.argv[1:]
    if '--hours' in args:
        try:
            hours = int(args[args.index('--hours') + 1])
        except Exception:
            pass
    do_push = '--push' in args

    key, src = get_key()
    if not key:
        msg = ('[未配置凭证] 读不到 ADMIN_KEY。\n'
               '请把 Render 里 ADMIN_KEY 的值写进：\n  %s\n（第一行就是值，不要加引号）\n' % KEY_FILE)
        print(msg)
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(os.path.join(OUT_DIR, 'PENDING-配置凭证.txt'), 'w', encoding='utf-8') as f:
            f.write(msg)
        return 2

    d = fetch(key)
    if not d.get('ok'):
        err = str(d.get('error') or '')
        print('[拉取失败] ' + err)
        if '口令' in err:
            print('ADMIN_KEY 不对，请重新从 Render 环境变量复制。')
        return 3

    raw = d.get('list') or []
    rows = [r for r in raw if not is_test(r)]
    dropped = len(raw) - len(rows)
    md, stat = build(rows, hours)
    if dropped:
        md = md.replace('## 一、总览',
                        '> 已剔除 %d 条内部测试/联调记录（名字含「测试」「联调」或手机号为 13800138000），'
                        '不计入任何统计。\n\n## 一、总览' % dropped, 1)

    os.makedirs(OUT_DIR, exist_ok=True)
    name = datetime.now().strftime('%Y-%m-%d_%H%M') + '_客资报告.md'
    path = os.path.join(OUT_DIR, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(md)

    # 追加历史（供趋势分析）
    with open(os.path.join(OUT_DIR, 'history.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'at': datetime.now().isoformat(timespec='seconds'),
                            'hours': hours, 'cloud_total': len(rows), 'dropped': dropped,
                            'rows': len(rows), 'new': stat.get('new'),
                            'today': stat.get('today'), 'hot': stat.get('hot')},
                           ensure_ascii=False) + '\n')

    print('[OK] 累计 %d 条（已剔除测试 %d 条），本窗口新增 %s 条 -> %s' % (len(rows), dropped, stat.get('new'), path))

    if do_push:
        brief = ('<b>累计 %s 条 · 近 %d 小时新增 %s · 今日 %s · 高意向 %s</b><br>'
                 '<span style="color:#666">完整报告见电脑 客资报告/%s</span>') % (
            len(rows), hours, stat.get('new'), stat.get('today'), stat.get('hot'), name)
        print('[推送] ' + ('成功' if push(brief) else '失败'))
    return 0


if __name__ == '__main__':
    import urllib.parse
    sys.exit(main())
