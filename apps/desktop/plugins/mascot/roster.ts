/**
 * 五只预设宠物的名单。**加一只 = 往这张表加一行**：换个名字、换套配色、换个种子
 * （种子定腿的条数 —— 奇数 6 条、偶数 4 条，所以换种子就是换了只生物）。
 *
 * 配色抄 LingRui-Scribe 的宠物面板（D-0072）。`palette[1]`（身体色）同时用来画切换点。
 */
export interface Pet {
  id: string
  name: string
  /** [轮廓, 身体, 肚皮, 点缀, 白] */
  palette: readonly string[]
  seed: number
  scale: number
  /** 点它时冒的那句话（词条在 i18n） */
  line: string
}

/** 换角色落 settings 的键。读不到就回第一只。 */
export const PET_KEY = 'mascot.id'

export const PETS: readonly Pet[] = [
  {
    id: 'coral',
    name: '珊瑚',
    palette: ['#1e1e1e', '#e8836a', '#f3b39e', '#3b3b3b', '#ffffff'],
    seed: 7,
    scale: 3,
    line: 'mascot.line.coral',
  },
  {
    id: 'indigo',
    name: '靛蓝',
    palette: ['#141a2e', '#5b8def', '#9dc0ff', '#2b3556', '#ffffff'],
    seed: 12,
    scale: 3,
    line: 'mascot.line.indigo',
  },
  {
    id: 'moss',
    name: '苔绿',
    palette: ['#16241c', '#5aa469', '#a8d5b0', '#2f4636', '#ffffff'],
    seed: 23,
    scale: 3,
    line: 'mascot.line.moss',
  },
  {
    id: 'plum',
    name: '藕紫',
    palette: ['#241a2e', '#a06cd5', '#d2b3f0', '#3d2b4f', '#ffffff'],
    seed: 40,
    scale: 3,
    line: 'mascot.line.plum',
  },
  {
    id: 'sand',
    name: '沙金',
    palette: ['#2b2317', '#d9a441', '#f0d59a', '#4a3d26', '#ffffff'],
    seed: 61,
    scale: 3,
    line: 'mascot.line.sand',
  },
]

export function petById(id: string | undefined): Pet {
  return PETS.find((p) => p.id === id) ?? PETS[0]
}
