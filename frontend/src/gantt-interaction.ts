import type { DirectEditIntent, Task } from './types'

export type ProvisionalGanttDates = {
  taskPublicId: string
  start: Date
  end: Date
}

export function localIsoDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

export function directEditIntent(
  task: Task,
  provisional: ProvisionalGanttDates,
): DirectEditIntent | null {
  const start = localIsoDate(provisional.start)
  const end = localIsoDate(provisional.end)
  if (start !== task.start_date) {
    return { type: 'move', task, intendedDate: start }
  }
  if (end !== task.end_date) {
    return { type: 'resize', task, intendedDate: end }
  }
  return null
}

export function disableLeftResizeHandles(container: HTMLElement): void {
  container
    .querySelectorAll<SVGElement>('.handle.left')
    .forEach((handle) => {
      handle.style.pointerEvents = 'none'
      handle.style.opacity = '0'
      handle.setAttribute('aria-hidden', 'true')
    })
}
