// The list 分类 should show next (a category, a search or picture-search result). The 分类 section
// applies it just before it is shown (components/category-view, prepareShow).
function setCategoryIntent(intent) {
  wx.setStorageSync('categoryIntent', intent)
}

module.exports = { setCategoryIntent }
