import { listProducts } from '../server/db.mjs'
import { buildVisualImageSearchIndex } from '../server/image-recognition.mjs'

const force = process.argv.includes('--force')
let lastReported = 0
const index = await buildVisualImageSearchIndex(listProducts({ status: 'published' }), {
  force,
  onProgress({ completed, total, reused = 0 }) {
    if (completed === total || completed - lastReported >= 50) {
      lastReported = completed
      console.log(`视觉向量索引 ${completed}/${total}（复用 ${reused}）`)
    }
  }
})
console.log(`视觉向量索引已生成：${index.items.length} 张商品图片，模型 ${index.model}，${index.dimensions}维`)
