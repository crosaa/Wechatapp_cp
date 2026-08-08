# -*- coding: utf-8 -*-
"""
cpfst「材质」-> 小程序 products.fabric（面料）迁移（可重复运行）
数据来源：./data/cpfst_attrs.json（每个 cpfst 商品的 材质/品类/款式/版型）
匹配方式：商品名称归一化（去括号/库位）+ 价格消歧，与其它同步脚本一致。
用法： python migrate_fabric.py     （先自动备份 catalog.db）

【cpfst 侧取数说明】材质是商品属性 id=8，取值藏在 getInfo 的 attrs[8].groups[].values[]（不是 values[]）：
  1) GET /super/goods//getInfo?id=<任一商品>  -> 构建字典 {valueId: 材质名}（约 8854 个取值）
  2) 逐商品 GET /super/goods//getInfo?id=<id> -> other.attrs["8"].valueId（note 非空时优先用 note）
  3) valueId 经字典解析成材质文本
"""
import sqlite3, os, json, re, time, sys
from collections import defaultdict, Counter
sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
ATTRS = os.path.join(HERE, "data", "cpfst_attrs.json")
DB = os.path.normpath(os.path.join(HERE, "..", "..", "server", "data", "catalog.db"))

attrs = json.load(open(ATTRS, encoding="utf-8"))

BRACKET = re.compile(r'[（(【\[][^（()）【】\[\]]*[）)】\]]')
def core1(s):
    s = s or ''; p = None
    while p != s: p = s; s = BRACKET.sub('', s)
    return re.sub(r'\s+', '', s).lower()
def core2(s): return re.sub(r'[A-Za-z]*\d+[-–]\d+$', '', core1(s))

c1 = defaultdict(list); c2 = defaultdict(list)
for rec in attrs.values():
    mat = (rec.get("材质") or "").strip()
    if not mat: continue
    try: price = float(rec.get("price")) if rec.get("price") is not None else None
    except Exception: price = None
    c1[core1(rec.get("name"))].append((price, mat))
    c2[core2(rec.get("name"))].append((price, mat))

def pick(cands, price):
    mats = {m for _, m in cands}
    if len(mats) == 1: return next(iter(mats))
    if price is not None:
        pm = {m for p, m in cands if p is not None and abs(p - float(price)) < 0.005}
        if len(pm) == 1: return next(iter(pm))
        if pm: return sorted(pm)[0]
    return Counter(m for _, m in cands).most_common(1)[0][0]

def fabric_for(name, price):
    if core1(name) in c1: return pick(c1[core1(name)], price)
    if core2(name) in c2: return pick(c2[core2(name)], price)
    return None

# 名称对不上的少数商品，人工核定映射（code -> 面料）
MANUAL = {
    "A2": "其他", "A3": "网布",
    "8288-XF": "72%精梳棉 28%杜邦索罗纳", "8287-XF": "72%精梳棉 28%杜邦索罗纳",
    "2170": "48%棉（丝光棉） 32%聚酯纤维 20%莱赛尔", "5501": "35%棉 65%聚酯纤维",
    "622-MLD": "55%棉 45%桑蚕丝纤维", "6601-D5F90E": "100%聚酯纤维",
    "0318H": "精梳牛仔",   # 推断：cpfst 无 0318H，取同系列同价 0318A
}

bak = os.path.join(os.path.dirname(DB), "catalog.backup-" + time.strftime("%Y%m%d-%H%M%S") + ".db")
src = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); bk = sqlite3.connect(bak)
with bk: src.backup(bk)
bk.close(); src.close(); print("备份 ->", bak)

now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"
con = sqlite3.connect(DB, timeout=25); con.execute("PRAGMA busy_timeout=25000")
cur = con.cursor(); cur.execute("BEGIN IMMEDIATE")
filled = manual = missed = 0
try:
    for pid, code, name, price in cur.execute("SELECT id,code,name,price FROM products").fetchall():
        fab = fabric_for(name, price)
        if not fab and code in MANUAL:
            fab = MANUAL[code]; manual += 1
        if not fab:
            missed += 1; continue
        con.execute("UPDATE products SET fabric=?, updated_at=? WHERE id=?", (fab, now, pid))
        filled += 1
    con.commit()
except Exception as e:
    con.rollback(); print("回滚：", e); raise
finally:
    con.close()

print(f"已填面料 {filled}（其中人工映射 {manual}）| 未匹配 {missed}")
