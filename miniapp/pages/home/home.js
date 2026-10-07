const { TAB_KEYS, takePendingTab } = require('../../common/tabs')
const { setCategoryIntent } = require('../../common/category-intent')
const { appName, appShare, timelineShare, favoriteShare } = require('../../common/share')
const { preloadNextPageWhenQuiet, noteTouch } = require('../../common/webview-preload')

// A section that does not get ready in time is shown anyway.
const PREPARE_TIMEOUT_MS = 600

function decode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// The main page: 首页、分类、设计、我的 are its sections (components/*-view), switched by its own
// bottom bar (components/tab-bar). common/tabs.js explains why they are one page.
Page({
  data: {
    active: 'home',
    activeIndex: 0,
    created: { home: true }
  },
  onLoad(options = {}) {
    const tab = TAB_KEYS.includes(options.tab) ? options.tab : 'home'
    if (tab === 'home') return
    // A link to a list on 分类 (a shared category or search) says which list.
    if (tab === 'category' && (options.category || options.type || options.keyword)) {
      const keyword = options.keyword ? decode(options.keyword).trim() : ''
      const category = options.category ? decode(options.category) : '全部商品'
      setCategoryIntent({
        category: keyword ? '全部商品' : category,
        type: keyword ? 'all' : (options.type ? decode(options.type) : (category === '全部商品' ? 'all' : 'normal')),
        keyword
      })
    }
    this.setData({ active: '', created: {} })
    this.selectTab(tab)
  },
  onShow() {
    preloadNextPageWhenQuiet(this)
    // A page opened on top may have asked for a section (common/tabs.js openTab).
    const pending = takePendingTab()
    if (pending && pending !== this.data.active) {
      this.selectTab(pending)
      return
    }
    const view = this.view(this.data.active)
    if (!view) return
    if (pending && view.prepareShow) view.prepareShow(() => view.viewShown?.())
    else view.viewShown?.()
  },
  onHide() {
    this.view(this.data.active)?.viewHidden?.()
  },
  onPageTouch(e) {
    noteTouch(e)
  },
  onTabSelect(e) {
    this.selectTab(TAB_KEYS[e.detail.index])
  },
  onOpenTab(e) {
    this.selectTab(e.detail.tab)
  },
  // Shows a section: created out of sight the first time, made ready (分类 takes a list picked
  // elsewhere), then shown. The section that was showing is told it was left, and may reset itself
  // now that it is out of sight.
  selectTab(tab) {
    if (!TAB_KEYS.includes(tab)) return
    const leaving = this.data.active
    if (tab === leaving) {
      const view = this.view(tab)
      if (view?.prepareShow) view.prepareShow(() => view.viewShown?.())
      return
    }
    const token = (this.switchToken || 0) + 1
    this.switchToken = token
    const activeIndex = TAB_KEYS.indexOf(tab)
    if (this.data.activeIndex !== activeIndex) this.setData({ activeIndex })
    let shown = false
    const show = () => {
      if (shown || token !== this.switchToken) return
      shown = true
      this.setData({ active: tab }, () => {
        const left = this.view(leaving)
        left?.viewHidden?.()
        left?.leftFor?.(tab)
        this.view(tab)?.viewShown?.()
      })
    }
    const prepare = () => {
      setTimeout(show, PREPARE_TIMEOUT_MS)
      const view = this.view(tab)
      if (view?.prepareShow) view.prepareShow(show)
      else show()
    }
    if (this.data.created[tab]) prepare()
    else this.setData({ [`created.${tab}`]: true }, prepare)
  },
  view(tab) {
    return tab ? this.selectComponent(`#${tab}-view`) : null
  },
  onShareAppMessage() {
    return this.view(this.data.active)?.shareMessage?.() || appShare({ title: appName(), path: '/pages/home/home' })
  },
  onShareTimeline() {
    return this.view(this.data.active)?.shareTimeline?.() || timelineShare({ title: appName() })
  },
  onAddToFavorites() {
    return this.view(this.data.active)?.favorite?.() || favoriteShare({ title: appName() })
  }
})
