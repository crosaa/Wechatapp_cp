import { mkdir, readdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

// Line icons for the mini program, drawn like the bottom bar's (scripts/generate-tab-icons.mjs):
// a 64-unit grid, 4-unit strokes, round ends, in the colours of the symbols they replaced. Each is
// written as miniapp/assets/icons/<name>-<colour>.png, only in the colours it is used in.
const outputDir = resolve('miniapp/assets/icons')
const size = 72
const colors = {
  text: '#6e6a62',
  muted: '#9a978f',
  faint: '#aaa59b',
  gold: '#b8882d',
  'gold-deep': '#9d7022',
  white: '#ffffff'
}

const icons = {
  search: { colors: ['muted', 'faint'], drawing: '<circle cx="28" cy="28" r="15" /><path d="M39 39l13 13" />' },
  camera: { colors: ['gold-deep'], drawing: '<rect x="8" y="18" width="48" height="34" rx="7" /><path d="M22 18l4-7h12l4 7" /><circle cx="32" cy="35" r="9" />' },
  'chevron-right': { colors: ['faint', 'muted'], drawing: '<path d="M25 14l18 18-18 18" />' },
  'chevron-down': { colors: ['text', 'white'], drawing: '<path d="M14 25l18 18 18-18" />' },
  'chevron-up': { colors: ['text', 'white'], drawing: '<path d="M14 39l18-18 18 18" />' },
  'arrow-right': { colors: ['white'], drawing: '<path d="M12 32h40M36 16l16 16-16 16" />' },
  'arrow-up': { colors: ['text', 'white'], drawing: '<path d="M32 52V12M16 28l16-16 16 16" />' },
  'arrow-down': { colors: ['text', 'white'], drawing: '<path d="M32 12v40M16 36l16 16 16-16" />' },
  close: { colors: ['muted'], drawing: '<path d="M18 18l28 28M46 18L18 46" />' },
  plus: { colors: ['white'], drawing: '<path d="M32 14v36M14 32h36" />' },
  undo: { colors: ['white'], drawing: '<path d="M18 26h24a12 12 0 0 1 0 24H24" /><path d="M28 16 18 26l10 10" />' },
  help: { colors: ['white'], drawing: '<circle cx="32" cy="32" r="22" /><path d="M25 26a7 7 0 1 1 10 6c-2 1-3 3-3 5v2" /><path d="M32 46v.5" />' },
  swap: { colors: ['gold-deep'], drawing: '<path d="M14 22h34M38 12l10 10-10 10" /><path d="M50 42H16M26 32 16 42l10 10" />' },
  stack: { colors: ['white'], drawing: '<rect x="20" y="10" width="34" height="34" rx="6" /><path d="M12 22v26a6 6 0 0 0 6 6h26" />' },
  image: { colors: ['white'], drawing: '<rect x="10" y="12" width="44" height="40" rx="6" /><circle cx="24" cy="26" r="4" /><path d="M10 44l13-12 10 9 8-7 13 12" />' },
  text: { colors: ['white'], drawing: '<path d="M14 16h36M32 16v34M24 50h16" />' },
  check: { colors: ['white', 'gold'], drawing: '<path d="M14 33l12 12 24-26" />' },
  poster: { colors: ['text'], drawing: '<rect x="14" y="8" width="36" height="48" rx="5" /><rect x="21" y="15" width="22" height="18" rx="2" /><path d="M21 41h22M21 48h14" />' },
  document: { colors: ['gold-deep'], drawing: '<path d="M18 8h20l12 12v32a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z" /><path d="M38 8v12h12M22 32h20M22 42h14" />' },
  // Entries of 我的 and the selling points of a product (picked by their names).
  user: { colors: ['gold'], drawing: '<circle cx="32" cy="21" r="11" /><path d="M12 55c1-13 9-20 20-20s19 7 20 20" />' },
  pencil: { colors: ['gold'], drawing: '<path d="m13 49 4-14 25-25 12 12-25 25-16 2Z" /><path d="m17 35 12 12M37 15l12 12" />' },
  gem: { colors: ['gold'], drawing: '<path d="M18 12h28l10 14-24 28L8 26Z" /><path d="M8 26h48M26 12l-4 14 10 28 10-28-4-14" />' },
  shield: { colors: ['gold'], drawing: '<path d="M32 8l20 7v15c0 13-8 22-20 26-12-4-20-13-20-26V15Z" /><path d="M23 32l7 7 12-13" />' },
  chat: { colors: ['gold'], drawing: '<path d="M14 12h36a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H30L18 54V44h-4a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4Z" /><path d="M22 25h20M22 33h12" />' },
  hanger: { colors: ['gold'], drawing: '<path d="M26 14a6 6 0 1 1 6 6v4" /><path d="M32 24 8 46h48Z" />' },
  clipboard: { colors: ['gold'], drawing: '<rect x="14" y="12" width="36" height="44" rx="5" /><path d="M24 12V8h16v4M22 28h20M22 38h20M22 48h12" />' },
  headset: { colors: ['gold'], drawing: '<path d="M12 40v-8a20 20 0 0 1 40 0v8" /><rect x="8" y="36" width="10" height="16" rx="4" /><rect x="46" y="36" width="10" height="16" rx="4" />' },
  users: { colors: ['gold'], drawing: '<circle cx="24" cy="22" r="9" /><path d="M8 52c1-10 7-16 16-16s15 6 16 16" /><path d="M40 14a9 9 0 0 1 0 17M44 37c7 2 11 7 12 15" />' },
  leaf: { colors: ['gold'], drawing: '<path d="M12 52c0-24 16-40 40-40 0 24-16 40-40 40Z" /><path d="M12 52 36 28" />' },
  stamp: { colors: ['gold'], drawing: '<circle cx="32" cy="17" r="8" /><path d="M28 25v11h8V25" /><rect x="12" y="36" width="40" height="10" rx="3" /><path d="M16 54h32" />' },
  droplet: { colors: ['gold'], drawing: '<path d="M32 8c10 13 16 22 16 30a16 16 0 0 1-32 0c0-8 6-17 16-30Z" />' },
  wind: { colors: ['gold'], drawing: '<path d="M8 24h30a7 7 0 1 0-7-7M8 34h40a7 7 0 1 1-7 7M8 44h20" />' },
  calendar: { colors: ['gold'], drawing: '<rect x="10" y="14" width="44" height="40" rx="6" /><path d="M10 26h44M22 8v12M42 8v12" />' },
  'return': { colors: ['gold'], drawing: '<path d="M48 20A20 20 0 1 0 52 34" /><path d="M50 8v12H38" />' },
  'check-circle': { colors: ['gold'], drawing: '<circle cx="32" cy="32" r="22" /><path d="M22 33l7 7 14-15" />' }
}

await mkdir(outputDir, { recursive: true })
// Icons that are no longer listed are removed, so the package only carries what is used.
const wanted = new Set(Object.entries(icons).flatMap(([name, icon]) => icon.colors.map(color => `${name}-${color}.png`)))
for (const file of await readdir(outputDir)) {
  if (file.endsWith('.png') && !wanted.has(file)) await unlink(resolve(outputDir, file))
}

for (const [name, icon] of Object.entries(icons)) {
  for (const color of icon.colors) {
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
        <g fill="none" stroke="${colors[color]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          ${icon.drawing}
        </g>
      </svg>
    `)
    await sharp(svg).png({ compressionLevel: 9, palette: true }).toFile(resolve(outputDir, `${name}-${color}.png`))
  }
}

console.log(`已生成 ${wanted.size} 个界面图标`)
