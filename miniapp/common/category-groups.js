// 退/换货流程 and 可预订产品 are categories in the backend but not kinds of clothing: 我的 lists them
// (each opens its list on 分类), and the tiles on 首页 leave them out. They are matched by their keys,
// which stay the same when they are renamed. The value is the icon of their entry in 我的.
const SHOP_ENTRY_ICONS = {
  'cpfst-105097': 'return',
  'cpfst-105551': 'calendar'
}

function isShopEntry(category) {
  return Boolean(SHOP_ENTRY_ICONS[category?.key])
}

// A category without published products only leads to an empty list.
function hasProducts(category) {
  return category?.count !== 0
}

// The tiles on 首页: kinds of clothing that have products.
function homeGridCategories(categories) {
  return (categories || []).filter(category => !isShopEntry(category) && hasProducts(category))
}

function shopEntries(categories) {
  return (categories || []).filter(isShopEntry).map(category => ({
    name: category.name,
    type: category.type,
    icon: `/assets/icons/${SHOP_ENTRY_ICONS[category.key]}-gold.png`
  }))
}

module.exports = { hasProducts, homeGridCategories, shopEntries }
