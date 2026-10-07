const { fetchStoreSettings, fetchCategories, readHomeSnapshot, refreshDataVersion, defaultStoreSettings } = require('../../common/api')
const { appName, appShare, timelineShare, favoriteShare } = require('../../common/share')
const { setCategoryIntent } = require('../../common/category-intent')
const { shopEntries } = require('../../common/category-groups')
const { serviceIcon } = require('../../common/icons')

function pageState(settings) {
  return {
    settings,
    storeInitial: settings.storeName.slice(0, 2),
    serviceItems: settings.services.map(name => ({ name, icon: serviceIcon(name) }))
  }
}

const initialHomeSnapshot = readHomeSnapshot()
const initialProfileSettings = initialHomeSnapshot?.storeSettings || defaultStoreSettings

// The 我的 section of the main page (pages/home/home; see common/tabs.js).
Component({
  options: {
    addGlobalClass: true
  },
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    ...pageState(initialProfileSettings),
    shopEntries: shopEntries(initialHomeSnapshot?.categories)
  },
  lifetimes: {
    attached() {
      this.settingsSignature = JSON.stringify(this.data.settings)
      this.shopEntriesSignature = JSON.stringify(this.data.shopEntries)
    }
  },
  methods: {
    // The section is showing (the main page switched to it, or came back to the screen).
    viewShown() {
      this.loadSettings()
      this.loadShopEntries()
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
    async loadShopEntries() {
      try {
        const entries = shopEntries(await fetchCategories())
        const signature = JSON.stringify(entries)
        if (signature === this.shopEntriesSignature) return
        this.shopEntriesSignature = signature
        this.setData({ shopEntries: entries })
      } catch (error) {
        console.info('购物服务入口加载失败', error.errMsg || error.message)
      }
    },
    // Opens the list of that category on 分类, like its tile on 首页 did.
    openShopEntry(e) {
      setCategoryIntent({
        category: e.currentTarget.dataset.name,
        type: e.currentTarget.dataset.type || 'normal',
        keyword: '',
        productIds: []
      })
      this.triggerEvent('opentab', { tab: 'category' })
    },
    // What the main page shares while this section is showing.
    shareMessage() {
      return appShare({ title: this.data.settings.storeName || appName(), path: '/pages/home/home' })
    },
    shareTimeline() {
      return timelineShare({ title: this.data.settings.storeName || appName() })
    },
    favorite() {
      return favoriteShare({ title: this.data.settings.storeName || appName() })
    }
  }
})
