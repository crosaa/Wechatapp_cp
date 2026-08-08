// 离线兜底数据：与后端 catalog.db 同步的 cpfst 真实分类 + 示例商品。
// 仅在后端 (/api) 连不上时短暂显示；正常情况下会被接口数据覆盖。
// 由 scripts/cpfst-sync 生成，勿手改。
const categories = [
  {"id": 99902, "name": "2026新品上市", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "20", "tone": "#c0894b"},
  {"id": 342901, "name": "衬衫", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "衬衫", "tone": "#8ca87f"},
  {"id": 116601, "name": "高端工服", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "高端", "tone": "#6f8fa6"},
  {"id": 101925, "name": "春秋款", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "春秋", "tone": "#b7895f"},
  {"id": 101927, "name": "夏款", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "夏款", "tone": "#7fae9c"},
  {"id": 102260, "name": "高端POLO衫", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "高端", "tone": "#a98cc0"},
  {"id": 99907, "name": "翻领广告衫", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "翻领", "tone": "#c77b7b"},
  {"id": 99910, "name": "圆领T恤", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "圆领", "tone": "#5d7387"},
  {"id": 271304, "name": "长袖T恤", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "长袖", "tone": "#d0a24e"},
  {"id": 257480, "name": "防晒衣", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "防晒", "tone": "#8fae5a"},
  {"id": 99905, "name": "冰丝速干裤+棉裤", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "冰丝", "tone": "#7aa6bb"},
  {"id": 117591, "name": "工服上衣", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "工服", "tone": "#b59a86"},
  {"id": 101928, "name": "特种工服", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "特种", "tone": "#c0894b"},
  {"id": 104399, "name": "环卫系列", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "环卫", "tone": "#8ca87f"},
  {"id": 104426, "name": "医师类大褂", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "医师", "tone": "#6f8fa6"},
  {"id": 99913, "name": "大褂", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "大褂", "tone": "#b7895f"},
  {"id": 99914, "name": "雨衣", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "雨衣", "tone": "#7fae9c"},
  {"id": 99906, "name": "马甲", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "马甲", "tone": "#a98cc0"},
  {"id": 99912, "name": "帽子", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "帽子", "tone": "#c77b7b"},
  {"id": 99816, "name": "劳保鞋", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "劳保", "tone": "#5d7387"},
  {"id": 99904, "name": "卫衣", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "卫衣", "tone": "#d0a24e"},
  {"id": 102849, "name": "特种劳保", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "特种", "tone": "#8fae5a"},
  {"id": 353844, "name": "矿用产品", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "矿用", "tone": "#7aa6bb"},
  {"id": 284634, "name": "围裙", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "围裙", "tone": "#b59a86"},
  {"id": 99903, "name": "冲锋衣系列", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "冲锋", "tone": "#c0894b"},
  {"id": 109436, "name": "羽绒系列", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "羽绒", "tone": "#8ca87f"},
  {"id": 99911, "name": "棉衣系列", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "棉衣", "tone": "#6f8fa6"},
  {"id": 99908, "name": "促销", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "促销", "tone": "#b7895f"},
  {"id": 105097, "name": "退/换货流程", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "退/", "tone": "#7fae9c"},
  {"id": 105551, "name": "可预订产品", "type": "normal", "image": "/assets/polo-grid.jpg", "icon": "可预", "tone": "#a98cc0"},
  {"id": "seasonal-local", "name": "当季上新", "type": "normal", "image": "", "icon": "当季", "tone": "#d9a13b"},
]

const products = [
  {"id": 4458948, "code": "CPFST4458948", "name": "（主推）8018速干裤（黑色） （A19-2）", "subtitle": "", "category": "冰丝速干裤+棉裤", "categories": ["冰丝速干裤+棉裤"], "seasonalNew": false, "price": 40.0, "stock": 72, "sizeStocks": {"L-3xL": 12, "ⅩL-4xL": 12, "2xL-5xL": 12, "3xL-6xL": 12, "M-2XL": 12, "4xL-7xL": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["黑色"], "sizes": ["L-3xL", "ⅩL-4xL", "2xL-5xL", "3xL-6xL", "M-2XL", "4xL-7xL"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "普润制衣团购 · 支持企业团体定制。", "detailImages": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
  {"id": 4140952, "code": "CPFST4140952", "name": "PDF画册", "subtitle": "扫码识别", "category": "翻领广告衫", "categories": ["翻领广告衫"], "seasonalNew": false, "price": 1.0, "stock": 12, "sizeStocks": {"均码": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["白色"], "sizes": ["均码"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "扫码识别", "detailImages": ["/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
  {"id": 4034742, "code": "CPFST4034742", "name": "女士竹纤维-短袖系列（V领）（展厅）", "subtitle": "30%竹纤维65%聚酯纤维5%氨纶", "category": "衬衫", "categories": ["衬衫"], "seasonalNew": false, "price": 60.0, "stock": 72, "sizeStocks": {"M": 12, "L": 12, "XL": 12, "2XL": 12, "3XL": 12, "4XL": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["白色", "黑色", "藏青色", "灰色", "粉色", "天蓝色"], "sizes": ["M", "L", "XL", "2XL", "3XL", "4XL"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "30%竹纤维65%聚酯纤维5%氨纶", "detailImages": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
  {"id": 2909474, "code": "CPFST2909474", "name": "广告帽 涤丝（B7-4）", "subtitle": "", "category": "帽子", "categories": ["帽子"], "seasonalNew": false, "price": 3.6, "stock": 12, "sizeStocks": {"均码": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["红色"], "sizes": ["均码"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "普润制衣团购 · 支持企业团体定制。", "detailImages": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
  {"id": 2474719, "code": "CPFST2474719", "name": "C5100眼镜透明片 (F区39)", "subtitle": "一盒起售/12副", "category": "特种劳保", "categories": ["特种劳保"], "seasonalNew": false, "price": 15.0, "stock": 12, "sizeStocks": {"均码": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["一盒12副"], "sizes": ["均码"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "一盒起售/12副", "detailImages": ["/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
  {"id": 1322071, "code": "CPFST1322071", "name": "013 014 015 反光马甲（F区07）", "subtitle": "", "category": "马甲", "categories": ["马甲"], "seasonalNew": false, "price": 5.6, "stock": 12, "sizeStocks": {"均码": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["荧光绿", "桔红色", "宝蓝色"], "sizes": ["均码"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "普润制衣团购 · 支持企业团体定制。", "detailImages": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
  {"id": 4177434, "code": "CPFST4177434", "name": "绒手套（展厅）", "subtitle": "", "category": "矿用产品", "categories": ["矿用产品"], "seasonalNew": false, "price": 6.4, "stock": 12, "sizeStocks": {"均码": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["宝蓝色", "草绿色"], "sizes": ["均码"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "普润制衣团购 · 支持企业团体定制。", "detailImages": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
  {"id": 3397713, "code": "CPFST3397713", "name": "2518款（C-34-1/2，C35-1/2，C36-1/2）", "subtitle": "加厚一体绒冲锋衣", "category": "冲锋衣系列", "categories": ["冲锋衣系列"], "seasonalNew": false, "price": 60.0, "stock": 60, "sizeStocks": {"L": 12, "XL": 12, "2XL": 12, "3XL": 12, "4XL": 12}, "unit": "件", "fabric": "", "style": "", "colors": ["藏青色", "中国红", "宝石蓝", "高级灰", "浅军绿"], "sizes": ["L", "XL", "2XL", "3XL", "4XL"], "image": "/assets/polo-grid.jpg", "images": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "detailText": "加厚一体绒冲锋衣", "detailImages": ["/assets/polo-grid.jpg", "/assets/polo-grid.jpg", "/assets/polo-grid.jpg"], "realImages": [{"url": "/assets/polo-grid.jpg", "category": "实物展示"}], "badge": ""},
]

module.exports = { categories, products }
