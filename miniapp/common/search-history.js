const STORAGE_KEY = 'productSearchHistory'
const MAX_HISTORY = 20

function normaliseKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function getSearchHistory() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY)
    if (!Array.isArray(stored)) return []
    return stored.map(normaliseKeyword).filter(Boolean).slice(0, MAX_HISTORY)
  } catch {
    return []
  }
}

function saveSearchKeyword(value) {
  const keyword = normaliseKeyword(value)
  if (!keyword) return getSearchHistory()
  const keywordLower = keyword.toLowerCase()
  const history = [
    keyword,
    ...getSearchHistory().filter(item => item.toLowerCase() !== keywordLower)
  ].slice(0, MAX_HISTORY)
  try {
    wx.setStorageSync(STORAGE_KEY, history)
  } catch {}
  return history
}

function clearSearchHistory() {
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch {}
  return []
}

module.exports = {
  getSearchHistory,
  saveSearchKeyword,
  clearSearchHistory
}
