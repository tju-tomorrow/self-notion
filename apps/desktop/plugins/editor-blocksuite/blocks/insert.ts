/**
 * 斜杠菜单里插入块的两个小助手。三个自造块共用 —— 不共用就会出现三份
 * 「插完把空行收掉」的重复逻辑（上游每个块都各写一遍，那是它的历史包袱）。
 */
import type { BlockModel } from '@blocksuite/affine/store'

/**
 * 在触发菜单的那个块后面插一个。顺手把触发它的空行删掉 ——
 * 斜杠菜单只能从空段落里敲出来，不收掉的话会留一个空行（上游 latex 也是这么干的）。
 */
export function insertAfter(
  model: BlockModel,
  flavour: string,
  props: Record<string, unknown> = {},
): string | undefined {
  const store = model.store
  const [id] = store.addSiblingBlocks(model, [{ flavour, ...props }], 'after')
  if (model.text?.length === 0) store.deleteBlock(model)
  return id
}

/** 分栏得一次落三个块：容器 + 两列，每列先放一个空段落当落点（空列点不进去）。 */
export function insertColumns(
  model: BlockModel,
  listFlavour: string,
  columnFlavour: string,
  count = 2,
): void {
  const store = model.store
  const [list] = store.addSiblingBlocks(model, [{ flavour: listFlavour }], 'after')
  if (list) {
    for (let i = 0; i < count; i++) {
      const column = store.addBlock(columnFlavour, {}, list)
      if (column) store.addBlock('affine:paragraph', {}, column)
    }
  }
  if (model.text?.length === 0) store.deleteBlock(model)
}
