# -*- coding: utf-8 -*-
"""
cpfst -> 云织小程序 分类同步（可重复运行，含多分类）
把 cpfst 分类写入 catalog_categories，同时保留可改名、可排序、可删除的“当季上新”普通分类，并给已导入的商品设置：
  - products.category        主分类（单个，后台编辑用）
  - products.categories_json 完整分类列表（多分类，小程序按它归类/展示）

用法： python resync.py     （需 Python 3.8+）
会先自动备份 server/data/catalog.db。数据快照都在 ./data/，改后重跑即可再次同步。
依赖：分类图标文件需已在 server/uploads/cpfst/（首次由下载脚本生成，见 README）。
"""
import sqlite3, os, json, re, time
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
DB   = os.path.normpath(os.path.join(HERE, "..", "..", "server", "data", "catalog.db"))

cats     = json.load(open(os.path.join(DATA, "cpfst_categories.json"), encoding="utf-8"))
assign   = json.load(open(os.path.join(DATA, "assign_map.json"), encoding="utf-8"))          # pid -> {name, price, cat(主分类)}
members  = json.load(open(os.path.join(DATA, "cpfst_category_members.json"), encoding="utf-8"))  # catid -> [pid]
manifest = json.load(open(os.path.join(DATA, "icon_manifest.json"), encoding="utf-8"))       # catid -> /uploads/cpfst/xxx
id2name  = {c["id"]: c["name"] for c in cats}
id2sort  = {c["id"]: c.get("sort", 0) for c in cats}

# pid -> 完整分类名列表（主分类在前，其余按 cpfst sort）
pid_catids = defaultdict(set)
for cid, ids in members.items():
    for pid in ids: pid_catids[pid].add(int(cid))
def full_cats(pid, primary):
    ordered = [id2name[c] for c in sorted(pid_catids.get(pid, set()), key=lambda x:(id2sort.get(x,0), x)) if c in id2name]
    ordered = [c for c in ordered if c != primary]
    return ([primary] if primary else []) + ordered or [primary or "未分类"]

# 名称归一化（数据库商品名被截过尾部库位）
BRACKET = re.compile(r'[（(【\[][^（()）【】\[\]]*[）)】\]]')
def core1(s):
    s = s or ''; prev = None
    while prev != s: prev = s; s = BRACKET.sub('', s)
    return re.sub(r'\s+', '', s).lower()
def core2(s): return re.sub(r'[A-Za-z]*\d+[-–]\d+$', '', core1(s))

c1 = defaultdict(list); c2 = defaultdict(list)
for pid, rec in assign.items():
    entry = (rec["cat"], rec.get("price"), tuple(full_cats(pid, rec["cat"])))
    c1[core1(rec["name"])].append(entry); c2[core2(rec["name"])].append(entry)
def pick(cands, price):
    if len(cands) == 1: return cands[0][0], list(cands[0][2])
    if price is not None:
        pm = [c for c in cands if c[1] is not None and abs(float(c[1]) - float(price)) < 0.005]
        if pm: return pm[0][0], list(max((c[2] for c in pm), key=len))
    best = max(cands, key=lambda c: len(c[2]))
    return best[0], list(best[2])
def resolve(name, price):
    if core1(name) in c1: return pick(c1[core1(name)], price)
    if core2(name) in c2: return pick(c2[core2(name)], price)
    return "未分类", ["未分类"]

# 备份
bak = os.path.join(os.path.dirname(DB), "catalog.backup-" + time.strftime("%Y%m%d-%H%M%S") + ".db")
src = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); bk = sqlite3.connect(bak)
with bk: src.backup(bk)
bk.close(); src.close(); print("备份 ->", bak)

PALETTE = ['#c0894b','#8ca87f','#6f8fa6','#b7895f','#7fae9c','#a98cc0','#c77b7b','#5d7387','#d0a24e','#8fae5a','#7aa6bb','#b59a86']
now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"

con = sqlite3.connect(DB, timeout=25); con.execute("PRAGMA busy_timeout=25000"); con.execute("PRAGMA foreign_keys=ON")
if "categories_json" not in [r[1] for r in con.execute("PRAGMA table_info(products)").fetchall()]:
    con.execute("ALTER TABLE products ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'")
cur = con.cursor(); cur.execute("BEGIN IMMEDIATE")
try:
    deleted = cur.execute("DELETE FROM products WHERE code LIKE 'YZ%' OR code = ? OR code = ?", ("asl", "环境库")).rowcount
    arrival = cur.execute("SELECT name,image_url,icon,tone,sort_order FROM catalog_categories WHERE category_key LIKE 'seasonal%' OR name='当季上新' ORDER BY id LIMIT 1").fetchone()
    arrival_product_ids = set()
    if arrival:
        for product_id, categories_json, seasonal_new in cur.execute("SELECT id,categories_json,seasonal_new FROM products").fetchall():
            try: saved_categories = json.loads(categories_json or '[]')
            except Exception: saved_categories = []
            if arrival[0] in saved_categories or seasonal_new == 1: arrival_product_ids.add(product_id)
    cur.execute("DELETE FROM catalog_categories")
    sc = sorted(cats, key=lambda c: (c.get("sort", 0), c["id"])); N = len(sc)
    for i, c in enumerate(sc):
        icon = re.sub(r'[（(【\[].*', '', c["name"])[:2] or c["name"][:2]
        cur.execute("INSERT INTO catalog_categories (category_key,name,type,image_url,icon,tone,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (f"cpfst-{c['id']}", c["name"], 'normal', manifest.get(str(c["id"]), ''), icon, PALETTE[i % len(PALETTE)], (N - i) * 10, now))
    if arrival:
        arrival_name, arrival_image, arrival_icon, arrival_tone, arrival_sort = arrival
        cur.execute("INSERT INTO catalog_categories (category_key,name,type,image_url,icon,tone,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    ('seasonal', arrival_name, 'normal', arrival_image, arrival_icon or 'NEW', arrival_tone or '#d9a13b', arrival_sort, now))
    cur.execute("INSERT INTO catalog_categories (category_key,name,type,image_url,icon,tone,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                ('uncategorized', '未分类', 'normal', '', '未分', '#9aa0a6', 0, now))
    dist = Counter(); multi = 0
    for pid, name, price in cur.execute("SELECT id,name,price FROM products").fetchall():
        primary, clist = resolve(name, price)
        if arrival and pid in arrival_product_ids and arrival[0] not in clist: clist.append(arrival[0])
        con.execute("UPDATE products SET category=?, display_category=?, categories_json=?, updated_at=? WHERE id=?",
                    (primary, primary, json.dumps(clist, ensure_ascii=False), now, pid))
        dist[primary] += 1
        if len(clist) > 1: multi += 1
    con.commit()
except Exception as e:
    con.rollback(); print("回滚：", e); raise
finally:
    con.close()

print(f"删除演示/测试商品 {deleted}；写入分类 {N+1+(1 if arrival else 0)}（含未分类）；归类商品 {sum(dist.values())}（其中多分类 {multi}）")
