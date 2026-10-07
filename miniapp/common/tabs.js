// 首页、分类、设计、我的 are sections of one page (pages/home/home), switched by that page's own
// bottom bar (components/tab-bar). WeChat's tab pages are separate pages, and a page that has been
// left stops drawing: when shown again the phone first shows the picture it had when it was left.
// So a tab put back to its start in the background flashed on return, and putting it back before
// leaving showed the jump. Inside one page a section that is not showing is still drawn, so it is
// reset unseen.
const MAIN_ROUTE = 'pages/home/home'

const TABS = [
  { key: 'home', text: '首页', icon: 'home' },
  { key: 'category', text: '分类', icon: 'category' },
  { key: 'designer', text: '设计', icon: 'design' },
  { key: 'profile', text: '我的', icon: 'profile' }
].map(tab => ({
  ...tab,
  iconPath: `/assets/tabbar/${tab.icon}-normal.png`,
  selectedIconPath: `/assets/tabbar/${tab.icon}-selected.png`
}))

const TAB_KEYS = TABS.map(tab => tab.key)

// Shows a section of the main page from any page: from a page opened on top of it, by going back
// to it (it switches when it shows again); from a page opened directly (a shared link), by opening
// the main page on that section.
function openTab(tab) {
  const pages = getCurrentPages()
  const index = pages.findIndex(page => page.route === MAIN_ROUTE)
  if (index < 0) {
    wx.reLaunch({ url: `/${MAIN_ROUTE}?tab=${tab}` })
    return
  }
  if (index === pages.length - 1) {
    pages[index].selectTab(tab)
    return
  }
  getApp().globalData.pendingTab = tab
  wx.navigateBack({ delta: pages.length - 1 - index })
}

// The section a page opened on top asked for (see openTab); read once.
function takePendingTab() {
  const globalData = getApp().globalData
  const tab = globalData.pendingTab || ''
  globalData.pendingTab = ''
  return tab
}

module.exports = { MAIN_ROUTE, TABS, TAB_KEYS, openTab, takePendingTab }
