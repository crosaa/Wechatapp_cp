Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    src: {
      type: String,
      value: '',
      observer(next, previous) {
        if (next === previous) return
        if (this.readyTimer) {
          clearTimeout(this.readyTimer)
          this.readyTimer = null
        }
        const retainedSource = previous && this.data.loaded
          ? previous
          : this.data.previousSrc
        const previousSrc = retainedSource && retainedSource !== next ? retainedSource : ''
        // Skip the no-op update when the first src arrives (state is already reset).
        if (previousSrc === this.data.previousSrc && !this.data.loaded && !this.data.failed) return
        this.setData({
          previousSrc,
          loaded: false,
          failed: false
        })
      }
    },
    mode: {
      type: String,
      value: 'aspectFill'
    },
    lazyLoad: {
      type: Boolean,
      value: false
    },
    showMenuByLongpress: {
      type: Boolean,
      value: false
    }
  },
  data: {
    previousSrc: '',
    loaded: false,
    failed: false
  },
  lifetimes: {
    detached() {
      if (this.readyTimer) clearTimeout(this.readyTimer)
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('imagetap', { src: this.data.src })
    },
    onLoad() {
      if (!this.data.loaded) this.setData({ loaded: true, failed: false })
      this.triggerEvent('load')
      const loadedSource = this.data.src
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null
        if (this.data.src === loadedSource && this.data.loaded && this.data.previousSrc) {
          this.setData({ previousSrc: '' })
        }
      }, 140)
    },
    onError() {
      this.setData({ loaded: false, failed: true })
      this.triggerEvent('error')
    }
  }
})
