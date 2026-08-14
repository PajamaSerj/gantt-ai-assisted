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

function snapMouseDate(value: Date, authoritativeDate: string): string {
  const rawDate = localIsoDate(value)
  if (rawDate === authoritativeDate) return rawDate
  const direction = rawDate > authoritativeDate ? 1 : -1
  const snapped = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    12,
  )
  while (snapped.getDay() === 0 || snapped.getDay() === 6) {
    snapped.setDate(snapped.getDate() + direction)
  }
  return localIsoDate(snapped)
}

export function directEditIntent(
  task: Task,
  provisional: ProvisionalGanttDates,
): DirectEditIntent | null {
  const rawStart = localIsoDate(provisional.start)
  const rawEnd = localIsoDate(provisional.end)
  if (rawStart !== task.start_date) {
    return {
      type: 'move',
      task,
      intendedDate: snapMouseDate(provisional.start, task.start_date),
    }
  }
  if (rawEnd !== task.end_date) {
    return {
      type: 'resize',
      task,
      intendedDate: snapMouseDate(provisional.end, task.end_date),
    }
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
