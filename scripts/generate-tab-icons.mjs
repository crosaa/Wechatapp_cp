import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const outputDir = resolve('miniapp/assets/tabbar')
const colors = {
  normal: '#8a8a87',
  selected: '#d79a21'
}

const drawings = {
  home: `
    <path d="M10 29 32 10l22 19" />
    <path d="M15 27v26h13V39h8v14h13V27" />
  `,
  category: `
    <rect x="10" y="10" width="18" height="18" rx="3" />
    <rect x="36" y="10" width="18" height="18" rx="3" />
    <rect x="10" y="36" width="18" height="18" rx="3" />
    <rect x="36" y="36" width="18" height="18" rx="3" />
  `,
  design: `
    <path d="m13 49 4-14 25-25 12 12-25 25-16 2Z" />
    <path d="m17 35 12 12M37 15l12 12M13 49l9-9" />
  `,
  profile: `
    <circle cx="32" cy="21" r="11" />
    <path d="M12 55c1-13 9-20 20-20s19 7 20 20" />
  `
}

await mkdir(outputDir, { recursive: true })

for (const [name, drawing] of Object.entries(drawings)) {
  for (const [state, color] of Object.entries(colors)) {
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          ${drawing}
        </g>
      </svg>
    `)
    await sharp(svg).png().toFile(resolve(outputDir, `${name}-${state}.png`))
  }
}

console.log(`已生成 ${Object.keys(drawings).length * Object.keys(colors).length} 个底部导航图标`)
