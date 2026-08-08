import { listProducts } from '../server/db.mjs'
import { buildImageSearchIndex } from '../server/image-recognition.mjs'

let lastReported = 0
const index = await buildImageSearchIndex(listProducts({ status: 'published' }), {
  onProgress({ completed, total }) {
    if (completed === total || completed - lastReported >= 100) {
      lastReported = completed
      console.log(`图片索引 ${completed}/${total}`)
    }
  }
})
console.log(`图片识别索引已生成：${index.items.length} 张商品图片`)
