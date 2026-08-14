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

function numericAttribute(element: Element, name: string): number | null {
  const attribute = element.getAttribute(name)
  if (attribute === null) return null
  const value = Number(attribute)
  return Number.isFinite(value) ? value : null
}

function ganttTimelineWidth(group: SVGGElement): number | null {
  const svg = group.ownerSVGElement
  if (!svg) return null
  const gridRow = svg.querySelector<SVGElement>('.grid-row')
  return (
    (gridRow && numericAttribute(gridRow, 'width')) ||
    numericAttribute(svg, 'width') ||
    (svg.viewBox.baseVal.width > 0 ? svg.viewBox.baseVal.width : null)
  )
}

export function keepProposedPreviewLabelsVisible(
  container: HTMLElement,
): void {
  container
    .querySelectorAll<SVGGElement>('.gantt-task-preview-proposed')
    .forEach((group) => {
      const bar = group.querySelector<SVGRectElement>('.bar')
      const label = group.querySelector<SVGTextElement>('.bar-label.big')
      if (!bar || !label) return
      const timelineWidth = ganttTimelineWidth(group)
      const barX = numericAttribute(bar, 'x')
      const labelX = numericAttribute(label, 'x')
      if (timelineWidth === null || barX === null || labelX === null) return

      let labelWidth: number
      try {
        labelWidth = label.getBBox().width
      } catch {
        return
      }
      const edgePadding = 5
      if (labelX + labelWidth + edgePadding <= timelineWidth) return

      if (barX - labelWidth - edgePadding >= edgePadding) {
        label.setAttribute('x', String(barX - edgePadding))
        label.setAttribute('text-anchor', 'end')
        label.classList.add('gantt-label-before')
        return
      }

      label.setAttribute(
        'x',
        String(Math.max(edgePadding, timelineWidth - labelWidth - edgePadding)),
      )
      label.setAttribute('text-anchor', 'start')
      label.classList.add('gantt-label-contained')
    })
}
