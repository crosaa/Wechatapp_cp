const { checkDataVersionNow } = require('./api')

// The refresher closes once the server has answered, but after this long at most: the first
// request after a while can be slow (a fresh connection), and a refresher held open waiting for
// it felt stuck. A later answer still updates the page and says so when it arrives.
const MAX_REFRESH_WAIT_MS = 500
// A page with new data is re-rendered only after the refresher has closed (its closing animation
// takes 200 ms): re-rendering a page full of pictures while the animation played made it stutter.
const RERENDER_DELAY_MS = 300

// Pull-to-refresh for the pages that show what admins edit in the backend. The page
// content scrolls in a scroll-view under the navigation bar (refresher-triggered bound
// to `key`), so the bar stays put. It asks the server for the current data version
// right away (every saved change bumps it and clears the cached data) and says whether that
// worked. `reload` downloads what changed and returns a function that shows it (nothing when
// nothing changed).
async function refreshFromServer(page, reload, key = 'refreshing') {
  page.setData({ [key]: true })
  let closedAt = 0
  const close = () => {
    if (closedAt) return
    closedAt = Date.now()
    page.setData({ [key]: false })
  }
  const timer = setTimeout(close, MAX_REFRESH_WAIT_MS)
  let show = null
  try {
    await checkDataVersionNow()
    show = await reload()
    wx.showToast({ title: '已刷新', icon: 'success', duration: 1200 })
  } catch (error) {
    console.info('下拉刷新失败', error.errMsg || error.message)
    wx.showToast({ title: '刷新失败，请检查网络后重试', icon: 'none', duration: 2000 })
  }
  clearTimeout(timer)
  close()
  if (typeof show === 'function') setTimeout(show, Math.max(0, closedAt + RERENDER_DELAY_MS - Date.now()))
}

module.exports = { refreshFromServer }
