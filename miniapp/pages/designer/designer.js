// Old links to 设计: it is now a section of the main page (common/tabs.js).
Page({
  onLoad(options = {}) {
    const query = Object.keys(options).map(key => `${key}=${options[key]}`).join('&')
    wx.reLaunch({ url: `/pages/home/home?tab=designer${query ? `&${query}` : ''}` })
  }
})
