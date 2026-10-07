const { TABS } = require('../../common/tabs')

// The bottom bar of the main page (see common/tabs.js). It only reports which tab was tapped;
// the page switches sections.
Component({
  properties: {
    selected: { type: Number, value: 0 }
  },
  data: {
    tabs: TABS
  },
  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (index !== this.data.selected && TABS[index]) this.triggerEvent('select', { index })
    }
  }
})
