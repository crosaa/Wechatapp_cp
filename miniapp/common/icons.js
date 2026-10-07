// Line icons (assets/icons, drawn by scripts/generate-ui-icons.mjs) for things whose names are set
// in the backend: the selling points of a product and the services in 我的. Picked by what the name
// mentions; anything else gets a tick in a circle.
const FEATURE_ICONS = [
  [/定制|团体|团队|企业/, 'users'],
  [/透气|亲肤|舒适|柔软|面料/, 'leaf'],
  [/绣|印|LOGO|logo|标/, 'stamp'],
  [/品质|质检|检验|保障|正品/, 'shield'],
  [/防水|防雨/, 'droplet'],
  [/防风|速干|轻薄/, 'wind'],
  [/设计|款式/, 'pencil']
]

const SERVICE_ICONS = [
  [/设计|草稿/, 'pencil'],
  [/资料|个人|会员|账号/, 'user'],
  [/原创|精品|臻选/, 'gem'],
  [/认证|资质/, 'shield'],
  [/咨询|客服|联系/, 'chat'],
  [/样/, 'hanger'],
  [/订单|单/, 'clipboard'],
  [/服务|售后/, 'headset']
]

function pick(rules, name) {
  const match = rules.find(([pattern]) => pattern.test(String(name || '')))
  return `/assets/icons/${match ? match[1] : 'check-circle'}-gold.png`
}

function featureIcon(name) {
  return pick(FEATURE_ICONS, name)
}

function serviceIcon(name) {
  return pick(SERVICE_ICONS, name)
}

module.exports = { featureIcon, serviceIcon }
