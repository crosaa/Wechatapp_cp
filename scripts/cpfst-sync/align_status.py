# -*- coding: utf-8 -*-
"""
按 cpfst 在售状态对齐 products.status（可重复运行）
  cpfst status=1(在售) -> published（小程序可见）
  cpfst status=2(非在售/下架) -> draft（小程序隐藏）
数据来自 ./data/assign_map.json 的 status 字段；先自动备份。
用法： python align_status.py
"""
import sqlite3, os, json, re, time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.normpath(os.path.join(HERE, "..", "..", "server", "data", "catalog.db"))
assign = json.load(open(os.path.join(HERE, "data", "assign_map.json"), encoding="utf-8"))

BRACKET = re.compile(r'[（(【\[][^（()）【】\[\]]*[）)】\]]')
def core1(s):
    s = s or ''; prev = None
    while prev != s: prev = s; s = BRACKET.sub('', s)
    return re.sub(r'\s+', '', s).lower()
def core2(s): return re.sub(r'[A-Za-z]*\d+[-–]\d+$', '', core1(s))

c1 = defaultdict(list); c2 = defaultdict(list)
for rec in assign.values():
    e = (rec.get("status"), rec.get("price"))
    c1[core1(rec["name"])].append(e); c2[core2(rec["name"])].append(e)
def pick(cands, price):
    st = {s for s, _ in cands}
    if len(st) == 1: return next(iter(st))
    if price is not None:
        pm = {s for s, p in cands if p is not None and abs(float(p) - float(price)) < 0.005}
        if len(pm) == 1: return next(iter(pm))
    return 1 if 1 in st else next(iter(st))
def cpfst_status(name, price):
    if core1(name) in c1: return pick(c1[core1(name)], price)
    if core2(name) in c2: return pick(c2[core2(name)], price)
    return None

bak = os.path.join(os.path.dirname(DB), "catalog.backup-" + time.strftime("%Y%m%d-%H%M%S") + ".db")
src = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); bk = sqlite3.connect(bak)
with bk: src.backup(bk)
bk.close(); src.close(); print("备份 ->", bak)

now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"
con = sqlite3.connect(DB, timeout=25); con.execute("PRAGMA busy_timeout=25000")
cur = con.cursor(); cur.execute("BEGIN IMMEDIATE")
changed = 0
try:
    for pid, name, price, cur_status in cur.execute("SELECT id,name,price,status FROM products").fetchall():
        cs = cpfst_status(name, price)
        if cs is None: continue
        new = 'published' if cs == 1 else 'draft'
        if new != cur_status:
            cur.execute("UPDATE products SET status=?, updated_at=? WHERE id=?", (new, now, pid)); changed += 1
    con.commit()
except Exception as e:
    con.rollback(); print("回滚：", e); raise
finally:
    con.close()

v = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
dist = dict(v.execute("SELECT status, COUNT(*) FROM products GROUP BY status").fetchall()); v.close()
print(f"改动 {changed} 个；对齐后 status 分布:", dist)
