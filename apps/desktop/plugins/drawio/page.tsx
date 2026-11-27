import { useEffect, useRef } from 'react'
import type { Context } from 'cordis'

import { DrawioCanvas } from './canvas'
import * as s from './page.css'

export function DrawioPage({ ctx, id }: { ctx: Context; id: string | null }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id || !host.current) return
    const canvas = new DrawioCanvas(ctx, id, host.current)
    return () => canvas.dispose()
  }, [ctx, id])

  if (!id) return null
  return <div ref={host} className={s.page} />
}
