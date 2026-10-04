// The category tab reads `categoryIntent` to decide which list to show. If the tab
// is already loaded and hidden, it applies the intent right away, so switching to it
// shows the new list without a visible re-render.
function setCategoryIntent(intent) {
  wx.setStorageSync('categoryIntent', intent)
  getApp().categoryPage?.applyIntentWhileHidden()
}

module.exports = { setCategoryIntent }
