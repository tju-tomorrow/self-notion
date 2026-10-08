/**
 * 文档页头：封面 + 图标。挂在正文之上（`editor.ts` 的 `mountEditor` 调一行）。
 *
 * ★ **图标只读**：改它的入口在外壳的 ⋯ 菜单（`doc:icon` 写 `documents.icon`），这里只画。
 *   图标只有一个真相 = `documents.icon`，编辑器不存第二份（跟 `title` 不一样 —— title 正文里
 *   也有一个可编辑的，所以那边要双向同步）。
 * ★ **封面归编辑器**：外壳没有它的 UI，所以存 `doc.attrs.cover`，跟正文一起落库。
 */
import { metaOf, subscribe } from './doc-meta'
import { putBlob } from './blob'

export interface PageHead {
  el: HTMLElement
  destroy(): void
}

/**
 * @param docId 这一篇
 * @param coverOf 现读 `doc.attrs.cover`
 * @param setCover 写回封面（改写 doc 的 attr，走一次事务 = 一次撤销）
 */
export function renderPageHead(
  docId: string,
  coverOf: () => string,
  setCover: (blobId: string) => void,
): PageHead {
  const el = document.createElement('div')
  el.className = 'sn-page-head'

  const coverEl = document.createElement('div')
  coverEl.className = 'sn-cover'
  const iconEl = document.createElement('div')
  iconEl.className = 'sn-page-icon'

  const coverImg = document.createElement('img')
  coverImg.className = 'sn-cover-img'
  coverImg.alt = ''
  const coverAdd = document.createElement('button')
  coverAdd.type = 'button'
  coverAdd.className = 'sn-cover-btn sn-cover-add'
  coverAdd.textContent = '添加封面'
  const coverDel = document.createElement('button')
  coverDel.type = 'button'
  coverDel.className = 'sn-cover-btn sn-cover-del'
  coverDel.textContent = '移除'

  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'image/*'
  file.style.display = 'none'

  coverEl.append(coverImg, coverAdd, coverDel, file)
  el.append(coverEl, iconEl)

  const paintCover = () => {
    const blobId = coverOf()
    coverEl.dataset.on = blobId ? '1' : '0'
    if (blobId) coverImg.src = `self-notion://blob/${blobId}`
    else coverImg.removeAttribute('src')
  }

  const paintIcon = () => {
    // 图标空 = 不占地方（`documents.icon` 是 null 就是没设过）。
    iconEl.textContent = metaOf(docId)?.icon ?? ''
    iconEl.dataset.on = iconEl.textContent ? '1' : '0'
  }

  coverAdd.addEventListener('click', () => file.click())
  coverDel.addEventListener('click', () => setCover(''))
  file.addEventListener('change', () => {
    const picked = file.files?.[0]
    if (!picked) return
    void putBlob(picked)
      .then((id) => setCover(id))
      .catch(() => {
        // 存不下就什么都不做 —— 封面不值得拦一次错误弹窗（错误进 errors.log）。
      })
    file.value = ''
  })

  paintCover()
  paintIcon()
  const off = subscribe(paintIcon)

  return {
    el,
    destroy() {
      off()
    },
  }
}
