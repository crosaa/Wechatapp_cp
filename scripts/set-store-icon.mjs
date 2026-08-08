import { getStoreSettings, updateStoreSettings } from '../server/db.mjs'

const storeIcon = String(process.argv[2] || '').trim()

if (!storeIcon) {
  throw new Error('请提供店铺图标地址')
}

const previous = getStoreSettings()
const updated = updateStoreSettings({ storeIcon })

console.log(JSON.stringify({
  previousStoreIcon: previous.storeIcon,
  storeIcon: updated.storeIcon,
  updatedAt: updated.updatedAt
}))
