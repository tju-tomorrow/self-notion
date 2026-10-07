/**
 * 设置页的行式控件（D-0070）。骨架照 Notion 那张图：**分段标题 + 一行一件事**
 * （左边标题和一句说明，右边控件），开关是滑块，输入框在右边。
 *
 * ★ 放在 `src/ui/` 而不是某个插件里：设置页是**槽**拼起来的，每一段由不同插件出
 *   （GitHub 备份 / 字体 / 导入 / 插件），各写一套就漂了。这里是唯一的那一套。
 * ★ 颜色走 `--affine-v2-*`（新主题表），强调色读 `--sn-accent`（由设置弹窗写）。
 *   拿不到时给兜底值 —— 写错一个 token 名不是报错，是整条声明作废。
 */
import type { ReactNode } from 'react'
import * as s from './settings.css'

/** 一段。`title` 是段落标题，`desc` 是标题下的一句解释。 */
export function Group({
  title,
  desc,
  children,
}: {
  /** 段落标题。**设置页的每一段由框架出 `<h2>`**（就是导航里那个名字），所以这一段通常不用再写 ——
   *  只有段里还要分小节的才给。 */
  title?: string
  desc?: string
  /** ★ 可选：`createElement(Group, props, …children)` 这种写法里，children 是**参数**不是 prop，
   *  声明成必填的话 React 19 的 `Attributes & P` 就要求 props 里也有一个 —— 整条调用过不去
   *  （TS2769）。`shell-settings` 那个 `SectionBoundary` 也是这么写的。 */
  children?: ReactNode
}) {
  return (
    <section className={s.group}>
      {title || desc ? (
        <div className={s.groupHead}>
          {title ? <h3 className={s.groupTitle}>{title}</h3> : null}
          {desc ? <p className={s.groupDesc}>{desc}</p> : null}
        </div>
      ) : null}
      <div className={s.rows}>{children}</div>
    </section>
  )
}

/** 一行：左标签（可带一句说明）+ 右控件。 */
export function Row({
  label,
  desc,
  children,
}: {
  label: string
  desc?: string
  /** 同 `Group`：`createElement` 那条路上 children 走参数，声明成必填就报 TS2769。 */
  children?: ReactNode
}) {
  return (
    <div className={s.row}>
      <div className={s.rowMain}>
        <span className={s.rowLabel}>{label}</span>
        {desc ? <span className={s.rowDesc}>{desc}</span> : null}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  )
}

/** 滑块开关（Notion 那个样子的）。 */
export function Switch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? s.switchOn : s.switchBase}
      onClick={() => onChange(!on)}
    >
      <span className={s.knob} />
    </button>
  )
}

/** 单行输入。`mono` 给 token 这类要给眼睛对齐的东西。 */
export function Field({
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
  disabled,
  width,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  mono?: boolean
  disabled?: boolean
  width?: number
}) {
  return (
    <input
      className={mono ? `${s.input} ${s.inputMono}` : s.input}
      style={width ? { width } : undefined}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
}) {
  const cls =
    variant === 'primary' ? `${s.button} ${s.buttonPrimary}`
    : variant === 'danger' ? `${s.button} ${s.buttonDanger}`
    : s.button
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

/** 一行灰字：提示、时间、结果。 */
export function Note({ children, tone }: { children: ReactNode; tone?: 'error' | 'ok' }) {
  const cls = tone === 'error' ? `${s.note} ${s.noteError}` : tone === 'ok' ? `${s.note} ${s.noteOk}` : s.note
  return <p className={cls}>{children}</p>
}
