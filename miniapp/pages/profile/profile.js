const { fetchStoreSettings, readHomeSnapshot, refreshDataVersion, defaultStoreSettings } = require('../../common/api')
const { appName, appShare, timelineShare, favoriteShare } = require('../../common/share')

const serviceIcons = ['DIY', '♙', '◉', '✓', '咨', '样', '单', '服']

function pageState(settings) {
  return {
    settings,
    storeInitial: settings.storeName.slice(0, 2),
    serviceItems: settings.services.map((name, index) => ({ name, icon: serviceIcons[index % serviceIcons.length] }))
  }
}

const initialProfileSettings = readHomeSnapshot()?.storeSettings || defaultStoreSettings

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    ...pageState(initialProfileSettings)
  },
  onLoad() {
    this.settingsSignature = JSON.stringify(this.data.settings)
  },
  onShow() {
    this.loadSettings()
  },
  async loadSettings() {
    try {
      await refreshDataVersion(true)
      const settings = await fetchStoreSettings()
      getApp().globalData.brandName = settings.storeName
      const signature = JSON.stringify(settings)
      if (signature !== this.settingsSignature) {
        this.settingsSignature = signature
        this.setData(pageState(settings))
      }
    } catch (error) {
      console.info('店铺设置服务未启动，我的页面继续使用本地设置', error.errMsg || error.message)
    }
  },
  onShareAppMessage() {
    return appShare({ title: this.data.settings.storeName || appName(), path: '/pages/home/home' })
  },
  onShareTimeline() {
    return timelineShare({ title: this.data.settings.storeName || appName() })
  },
  onAddToFavorites() {
    return favoriteShare({ title: this.data.settings.storeName || appName() })
  }
})
