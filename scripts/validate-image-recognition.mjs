// Measures how well 拍图识别 finds the right product, using the shop's own pictures and no
// paid API calls. Each query is an indexed picture's own vector; the picture itself and its
// near-identical copies are left out so the product has to be found through its other
// pictures. Three situations:
//   仓库实拍（有同批照片）  a 实拍图 whose sister shots of the same garment stay in the library
//   客户自拍（只有商品图）  a 实拍图 with ALL 实拍图 of that product left out, so it must be
//                          matched to the product's catalog pictures, like a customer's photo
//   商品图截图              a catalog picture (main or colour) as the query
// Rankings come from the same function the recognition uses, with and without the
// similarity correction.
// Usage: node scripts/validate-image-recognition.mjs [queries per situation, default 300]
import { listProducts } from '../server/db.mjs'
import { indexedPictures, rankProductsForVector } from '../server/visual-embedding.mjs'

const perSituation = Math.max(10, Math.min(5000, Number(process.argv[2]) || 300))
const products = listProducts({ status: 'published' })
const productIds = new Set(products.map(product => Number(product.id)))
const pictures = indexedPictures().filter(picture => productIds.has(Number(picture.productId)))
if (!pictures.length) throw new Error('视觉向量索引为空，请先运行 npm run build:visual-index')

const isReal = picture => picture.roles?.includes('real')
const situations = [
  { name: '仓库实拍（有同批照片）', isQuery: isReal, leaveOut: () => false },
  { name: '客户自拍（只有商品图）', isQuery: isReal, leaveOut: isReal },
  { name: '商品图截图', isQuery: picture => !isReal(picture) && (picture.roles?.includes('main') || picture.roles?.includes('color')), leaveOut: () => false }
]

// Evenly spread queries, so repeated runs measure the same pictures.
function spread(list, count) {
  if (list.length <= count) return list
  return Array.from({ length: count }, (_, position) => list[Math.floor(position * list.length / count)])
}

const percent = (hits, total) => `${(100 * hits / Math.max(1, total)).toFixed(1)}%`.padStart(6)
console.log(`商品 ${products.length} 款，已索引图片 ${pictures.length} 张；每种情况最多 ${perSituation} 张查询图`)
for (const situation of situations) {
  const results = { corrected: [], plain: [] }
  for (const query of spread(pictures.filter(situation.isQuery), perSituation)) {
    const vector = query.vector()
    const keep = (item, itemIndex, cosine) => itemIndex !== query.itemIndex
      && !(Number(item.productId) === Number(query.productId) && (cosine > 0.97 || situation.leaveOut(item)))
    for (const [key, correct] of [['corrected', true], ['plain', false]]) {
      const ranked = await rankProductsForVector(vector, productIds, { keep, correct })
      const rank = ranked.findIndex(entry => entry.productId === Number(query.productId)) + 1
      if (rank) results[key].push(rank)
    }
  }
  console.log(`\n${situation.name}：${results.corrected.length} 张查询图`)
  for (const [key, label] of [['plain', '未校正'], ['corrected', '校正后（正式使用）']]) {
    const ranks = results[key]
    const within = limit => ranks.filter(rank => rank <= limit).length
    console.log(`  ${label.padEnd(10)} 第一名 ${percent(within(1), ranks.length)}  前3 ${percent(within(3), ranks.length)}  前10 ${percent(within(10), ranks.length)}  前20 ${percent(within(20), ranks.length)}`)
  }
}
