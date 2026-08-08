# cpfst → 云织小程序 · 分类同步说明

历史数据同步说明：把原商品后台的**商品分类**同步进本项目，并给已导入的商品归类。**支持一个商品属于多个分类**。

## 改动清单（2026-07-15）

### 数据（`server/data/catalog.db`）
1. 删除演示/测试商品 6 个：款号 `YZ2601 / YZ2598 / YZ2516 / YZ2488 / asl / 环境库`。
2. 重建 `catalog_categories`：写入 cpfst 分类 + 「未分类」兜底；若“当季上新”仍存在，则按普通分类保留其名称、图片、位置与商品归属（删除后不会自动重建）。图标下载到 `server/uploads/cpfst/cat-<id>.<ext>`，`image_url` 指向它。
3. 给 **673 个商品**写分类：
   - `products.category` = 主分类（单个，后台编辑显示用）。
   - `products.categories_json` = **完整分类列表（多分类）**，来自 cpfst「按分类过滤」的权威成员数据（不是商品列表里不完整的 `category_ids`）。
   - 结果：0 空分类，仅 5 个商品无分类 → 「未分类」；其中 192 个商品属于多个分类。

### 代码（实现多分类）
- `server/db.mjs`：products 加 `categories_json` 列；`mapProduct` 输出 `categories` 数组；`listProducts`/`listCategories` 按 `categories.includes(名)` 归类；`create/updateProduct` 维护 `categories_json`（始终含主分类）；`updateCategory` 重命名分类时同步更新 `categories_json`。
- `server/public/admin/`：商品编辑器支持勾选多个所属分类；后台分类筛选、首页分类概览和商品列表均按完整分类列表统计与显示。
- `miniapp/common/api.js`：`hydrateProduct` 透传 `categories`。
- `miniapp/pages/category/category.js`：筛选由 `category === selected` 改为 `categories.includes(selected)`。
- `miniapp/common/data.js`：离线兜底刷新为真实 30 分类 + 8 个真实示例商品（本服务器图片，含 `categories`）。

> 改完后端代码需**重启后端**（`node server/server.mjs`，脚本 `scripts/start-local.ps1`）；小程序端改动需在微信开发者工具**重新编译**。

## 说明 / 遗留项

- **商品状态**：已按 cpfst 在售状态对齐 —— cpfst 在售(status=1)→`published`（小程序可见）、非在售(status=2)→`draft`（隐藏）。结果 **615 已发布 / 58 隐藏**，与 cpfst 一致，所有分类都有货。重跑：`python align_status.py`（读 `data/assign_map.json` 的 status 字段，先自动备份）。
- **图片**：商品图与分类图标都在 `server/uploads/cpfst/`，由后端 `/uploads/` 提供。

## 回滚
同步前自动备份在 `server/data/catalog.backup-<时间>.db`。回滚：停后端 → 用备份覆盖 `server/data/catalog.db`（含同名 `-wal/-shm` 若有）→ 重启。
（注意：代码层的多分类改动需另行用 git 还原对应文件。）

## 重新同步
数据快照在 `./data/`：`cpfst_categories.json`（30 分类+本服务器图标路径）、`cpfst_category_members.json`（各分类的商品成员）、`assign_map.json`（商品→主分类）、`icon_manifest.json`（分类→本服务器图标路径）。
改完快照后运行 `python resync.py`（会先自动备份，写入主分类 + 多分类 `categories_json`）。分类图标文件需已在 `server/uploads/cpfst/`。

历史源站接口和图片网址已从项目中移除，今后只使用本服务器数据库与 `/uploads/` 图片。
