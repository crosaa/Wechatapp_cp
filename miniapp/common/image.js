let savingOriginal = false

function finishSaving() {
  savingOriginal = false
  wx.hideLoading()
}

function saveOriginalImage(url) {
  if (!url || savingOriginal) return
  savingOriginal = true
  wx.showLoading({ title: '下载原图中', mask: true })
  wx.downloadFile({
    url,
    timeout: 30000,
    success: result => {
      if (result.statusCode < 200 || result.statusCode >= 300 || !result.tempFilePath) {
        finishSaving()
        wx.showToast({ title: '原图下载失败', icon: 'none' })
        return
      }
      wx.saveImageToPhotosAlbum({
        filePath: result.tempFilePath,
        success: () => {
          finishSaving()
          wx.showToast({ title: '原图已保存', icon: 'success' })
        },
        fail: error => {
          finishSaving()
          const denied = /auth deny|auth denied|authorize:fail/i.test(error.errMsg || '')
          if (!denied) {
            wx.showToast({ title: '保存原图失败', icon: 'none' })
            return
          }
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册。',
            confirmText: '去设置',
            success: modal => {
              if (modal.confirm) wx.openSetting()
            }
          })
        }
      })
    },
    fail: () => {
      finishSaving()
      wx.showToast({ title: '原图下载失败', icon: 'none' })
    }
  })
}

module.exports = { saveOriginalImage }
