# 系统架构

```text
微信小程序 miniapp/
        │ 读取已上架商品
        ▼
商品 API server/server.mjs
        ├── SQLite：商品资料、状态、排序和图片地址
        ├── uploads/：本地上传图片
        ├── 百炼 Qwen3-VL：商品图片向量召回
        ├── Gemini：Top-10 候选图片复核
        └── admin/：浏览器商品管理后台
```

## 数据模型

每个商品包含：

- 款号、名称、卖点、分类和标签
- 团购价、总库存、各尺码库存、单位、面料和风格
- 多个颜色、尺码和商品图片
- 商品详情文案、详情长图，以及带“正面/背面/细节/颜色/穿着效果”分类的实拍图
- `draft` 草稿或 `published` 已上架状态
- 排序权重、创建时间和更新时间

小程序公开接口只返回 `published` 商品，草稿不会出现在用户端。

## 主要接口

公开接口：

- `GET /api/health`：服务状态
- `GET /api/categories`：已上架商品分类
- `GET /api/products`：已上架商品列表
- `GET /api/products/:id`：商品详情
- `POST /api/products/recognize`：客户图片识别；视觉向量召回、Gemini复核并自动降级

管理接口：

- `POST /api/auth/login`：管理员登录
- `POST /api/auth/logout`：退出登录
- `GET /api/admin/products`：全部商品
- `POST /api/admin/products`：创建商品
- `PUT /api/admin/products/:id`：编辑或上下架
- `DELETE /api/admin/products/:id`：删除商品
- `POST /api/admin/uploads`：上传图片
- `POST /api/admin/inventory/import`：校验并批量导入 Excel 尺码库存

## 正式环境建议

当前本地版本适合验证业务流程。生产环境建议保留相同接口结构，并替换存储层：

- SQLite → MySQL/PostgreSQL 或托管数据库
- 本地 `uploads/` → 腾讯云 COS
- 单管理员密码 → 管理员账号、角色权限与操作日志
- 本地 HTTP → 备案域名和 HTTPS
- 单机数据 → 自动备份、图片生命周期和监控告警

任何微信 `AppSecret`、支付密钥和对象存储密钥都只能放在后端环境变量中，不能写进小程序代码。
