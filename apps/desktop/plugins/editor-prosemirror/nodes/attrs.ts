/** `node.attrs` 的值是 `any`（PM 的 `Attrs` 那样签的）—— 收窄成具体类型再往外用。 */

export const asBool = (v: unknown): boolean => v === true

export const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

export const asWidth = (v: unknown): number | null => (typeof v === 'number' ? v : null)
