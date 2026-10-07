const { getSearchHistory, saveSearchKeyword, clearSearchHistory } = require('../../common/search-history')
const { appName, appShare, timelineShare, favoriteShare } = require('../../common/share')
const { setCategoryIntent } = require('../../common/category-intent')
const { openTab } = require('../../common/tabs')
const { preloadNextPageWhenQuiet, noteTouch } = require('../../common/webview-preload')

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    keyword: '',
    searchHistory: [],
    inputFocused: true
  },
  onLoad(options) {
    let keyword = ''
    try {
      keyword = options.keyword ? decodeURIComponent(options.keyword) : ''
    } catch {
      keyword = ''
    }
    const searchHistory = getSearchHistory()
    this.setData({
      keyword,
      searchHistory,
      inputFocused: true
    })
    this.lastHistorySignature = JSON.stringify(searchHistory)
  },
  onShow() {
    preloadNextPageWhenQuiet(this)
    const searchHistory = getSearchHistory()
    const signature = JSON.stringify(searchHistory)
    if (signature !== this.lastHistorySignature) {
      this.lastHistorySignature = signature
      this.setData({ searchHistory })
    }
  },
  onPageTouch(e) {
    noteTouch(e)
  },
  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },
  clearKeyword() {
    this.setData({ keyword: '', inputFocused: true })
  },
  submitSearch() {
    const keyword = this.data.keyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入款号或商品名称', icon: 'none' })
      this.setData({ inputFocused: true })
      return
    }
    const searchHistory = saveSearchKeyword(keyword)
    this.setData({ keyword, searchHistory, inputFocused: false })
    this.lastHistorySignature = JSON.stringify(searchHistory)
    setCategoryIntent({
      category: '全部商品',
      type: 'all',
      keyword
    })
    openTab('category')
  },
  useSearchHistory(e) {
    const keyword = String(e.currentTarget.dataset.keyword || '').trim()
    if (!keyword) return
    this.setData({ keyword }, () => this.submitSearch())
  },
  clearHistory() {
    this.setData({ searchHistory: clearSearchHistory(), inputFocused: true })
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else openTab('home')
  },
  onShareAppMessage() {
    const keyword = String(this.data.keyword || '').trim()
    const query = keyword ? `keyword=${encodeURIComponent(keyword)}` : ''
    return appShare({
      title: `搜索商品｜${appName()}`,
      path: `/pages/search/search${query ? `?${query}` : ''}`
    })
  },
  onShareTimeline() {
    const keyword = String(this.data.keyword || '').trim()
    return timelineShare({
      title: `搜索商品｜${appName()}`,
      query: keyword ? `keyword=${encodeURIComponent(keyword)}` : ''
    })
  },
  onAddToFavorites() {
    const keyword = String(this.data.keyword || '').trim()
    return favoriteShare({
      title: `搜索商品｜${appName()}`,
      query: keyword ? `keyword=${encodeURIComponent(keyword)}` : ''
    })
  }
})
