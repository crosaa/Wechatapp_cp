const { checkDataVersionNow } = require('./api')

// Pull-to-refresh for the pages that show what admins edit in the backend. The page
// content scrolls in a scroll-view under the navigation bar (refresher-triggered bound
// to `key`), so the bar stays put. It asks the server for the current data version
// right away (every saved change bumps it and clears the cached data), lets the page
// reload, and then says whether that worked.
async function refreshFromServer(page, reload, key = 'refreshing') {
  page.setData({ [key]: true })
  try {
    await checkDataVersionNow()
    await reload()
    wx.showToast({ title: '已刷新', icon: 'success', duration: 1200 })
  } catch (error) {
    console.info('下拉刷新失败', error.errMsg || error.message)
    wx.showToast({ title: '刷新失败，请检查网络后重试', icon: 'none', duration: 2000 })
  } finally {
    page.setData({ [key]: false })
  }
}

module.exports = { refreshFromServer }
