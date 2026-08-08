function getPageNavigationMetrics() {
  const fallback = {
    statusBarHeight: 40,
    navigationBarHeight: 88
  }

  try {
    const windowInfo = wx.getWindowInfo()
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const windowWidth = Number(windowInfo.windowWidth) || 375
    const statusBarPx = Number(windowInfo.statusBarHeight) || 20
    const navigationBarPx = menuButton && Number(menuButton.top) > 0 && Number(menuButton.height) > 0
      ? (Number(menuButton.top) - statusBarPx) * 2 + Number(menuButton.height)
      : 44
    const rpxRatio = 750 / windowWidth

    return {
      statusBarHeight: Math.max(0, Math.round(statusBarPx * rpxRatio)),
      navigationBarHeight: Math.max(88, Math.round(navigationBarPx * rpxRatio))
    }
  } catch (error) {
    return fallback
  }
}

const obsoletePersonalDataKeys = [
  'favoriteProductIds',
  'miniappAuthToken',
  'miniappAuthExpiresAt',
  'favoritePendingOperations'
]

App({
  onLaunch() {
    obsoletePersonalDataKeys.forEach(key => wx.removeStorageSync(key))
  },

  globalData: {
    brandName: '普润制衣团购仓',
    apiBase: 'https://cpminiapp.xinghaiapp.top',
    pageNavigation: getPageNavigationMetrics()
  }
})
