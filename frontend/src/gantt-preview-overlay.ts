import type {
  PendingPlanPreview,
  PendingTaskPreview,
} from './pending-preview'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export type GanttDateScale = {
  timelineStart: Date
  unit: string
  step: number
  columnWidth: number
}

export type GanttBarGeometry = {
  x: number
  y: number
  width: number
  height: number
}

export type GanttPreviewDirection = 'right' | 'left' | 'resize'

export type GanttPreviewConnector = {
  x1: number
  x2: number
  y: number
  direction: 'right' | 'left'
}

export type SameRowPreviewGeometry = {
  taskPublicId: string
  source: PendingTaskPreview['source']
  direction: GanttPreviewDirection
  overlapsCurrent: boolean
  currentY: number
  proposedX: number
  proposedY: number
  proposedWidth: number
  proposedHeight: number
  proposedEndX: number
  connector: GanttPreviewConnector | null
}

type GanttRuntimeGeometry = {
  gantt_start?: Date
  config?: {
    unit?: string
    step?: number
    column_width?: number
  }
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addCalendarDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setDate(result.getDate() + days)
  return result
}

function dateDifference(date: Date, origin: Date, unit: string): number {
  const milliseconds = date.getTime() - origin.getTime() +
    (origin.getTimezoneOffset() - date.getTimezoneOffset()) * 60_000
  const days = milliseconds / MILLISECONDS_PER_DAY
  if (unit === 'day' || unit === 'days') return days
  if (unit === 'hour' || unit === 'hours') return days * 24
  if (unit === 'month' || unit === 'months') {
    const yearDifference = date.getFullYear() - origin.getFullYear()
    let monthDifference = date.getMonth() - origin.getMonth()
    monthDifference += date.getDate() / 31
    if (date.getDate() < origin.getDate()) monthDifference -= 1
    return Math.round((yearDifference * 12 + monthDifference) * 100) / 100
  }
  if (unit === 'year' || unit === 'years') {
    return dateDifference(date, origin, 'month') / 12
  }
  return days
}

export function timelineDateX(value: string | Date, scale: GanttDateScale): number {
  const date = typeof value === 'string' ? parseIsoDate(value) : value
  return (
    dateDifference(date, scale.timelineStart, scale.unit) /
    scale.step * scale.columnWidth
  )
}

function rangesOverlap(
  current: GanttBarGeometry,
  proposedX: number,
  proposedEndX: number,
): boolean {
  return (
    Math.max(current.x, proposedX) <
    Math.min(current.x + current.width, proposedEndX)
  )
}

export function resolveSameRowPreviewGeometry(
  change: PendingTaskPreview,
  current: GanttBarGeometry,
  dateToX: (value: string | Date) => number,
): SameRowPreviewGeometry | null {
  if (change.kind !== 'dates' || !change.currentTask || !change.proposedTask) {
    return null
  }

  const proposedX = dateToX(change.proposedTask.start_date)
  const proposedEndDate = addCalendarDays(
    parseIsoDate(change.proposedTask.end_date),
    1,
  )
  const proposedEndX = dateToX(proposedEndDate)
  const proposedWidth = Math.max(2, proposedEndX - proposedX)
  const sameStart = change.currentTask.start_date === change.proposedTask.start_date
  const durationChanged = (
    change.currentTask.duration_workdays !==
    change.proposedTask.duration_workdays
  )
  const direction: GanttPreviewDirection = sameStart && durationChanged
    ? 'resize'
    : proposedX >= current.x
      ? 'right'
      : 'left'
  const overlapsCurrent = rangesOverlap(current, proposedX, proposedEndX)
  const connectorY = current.y + current.height / 2
  const connectorPadding = 4
  const minimumConnectorGap = 20
  let connector: GanttPreviewConnector | null = null

  if (direction === 'right') {
    const gap = proposedX - (current.x + current.width)
    if (gap >= minimumConnectorGap) {
      connector = {
        x1: current.x + current.width + connectorPadding,
        x2: proposedX - connectorPadding,
        y: connectorY,
        direction,
      }
    }
  } else if (direction === 'left') {
    const gap = current.x - proposedEndX
    if (gap >= minimumConnectorGap) {
      connector = {
        x1: current.x - connectorPadding,
        x2: proposedEndX + connectorPadding,
        y: connectorY,
        direction,
      }
    }
  }

  return {
    taskPublicId: change.publicId,
    source: change.source,
    direction,
    overlapsCurrent,
    currentY: current.y,
    proposedX,
    proposedY: current.y,
    proposedWidth,
    proposedHeight: current.height,
    proposedEndX,
    connector,
  }
}

function numberAttribute(element: Element, name: string): number | null {
  const raw = element.getAttribute(name)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function barGeometry(group: SVGGElement): GanttBarGeometry | null {
  const bar = group.querySelector<SVGRectElement>('.bar')
  if (!bar) return null
  const x = numberAttribute(bar, 'x')
  const y = numberAttribute(bar, 'y')
  const width = numberAttribute(bar, 'width')
  const height = numberAttribute(bar, 'height')
  if (x === null || y === null || width === null || height === null) return null
  return { x, y, width, height }
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, tag)
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value))
  })
  if (text !== undefined) element.textContent = text
  return element
}

function connectorArrowPath(connector: GanttPreviewConnector): string {
  const { x2, y } = connector
  if (connector.direction === 'right') {
    return `M ${x2} ${y} L ${x2 - 6} ${y - 4} L ${x2 - 6} ${y + 4} Z`
  }
  return `M ${x2} ${y} L ${x2 + 6} ${y - 4} L ${x2 + 6} ${y + 4} Z`
}

function renderPreviewItem(
  layer: SVGGElement,
  geometry: SameRowPreviewGeometry,
): void {
  const item = createSvgElement('g', {
    class: 'gantt-preview-item',
    'data-task-id': geometry.taskPublicId,
    'data-source': geometry.source,
    'data-direction': geometry.direction,
    'data-overlap': String(geometry.overlapsCurrent),
    'data-current-y': geometry.currentY,
    'data-proposed-y': geometry.proposedY,
  })
  item.appendChild(createSvgElement('rect', {
    class: [
      'gantt-preview-proposed-bar',
      `gantt-preview-proposed-${geometry.source}`,
    ].join(' '),
    x: geometry.proposedX,
    y: geometry.proposedY,
    width: geometry.proposedWidth,
    height: geometry.proposedHeight,
    rx: 6,
    ry: 6,
  }))

  if (geometry.direction === 'resize') {
    item.appendChild(createSvgElement('line', {
      class: 'gantt-preview-resize-edge',
      x1: geometry.proposedEndX,
      x2: geometry.proposedEndX,
      y1: geometry.proposedY + 2,
      y2: geometry.proposedY + geometry.proposedHeight - 2,
    }))
  }

  if (geometry.connector) {
    item.appendChild(createSvgElement('line', {
      class: 'gantt-preview-connector',
      x1: geometry.connector.x1,
      x2: geometry.connector.x2,
      y1: geometry.connector.y,
      y2: geometry.connector.y,
    }))
    item.appendChild(createSvgElement('path', {
      class: 'gantt-preview-arrowhead',
      d: connectorArrowPath(geometry.connector),
    }))
  }

  layer.appendChild(item)
}

export function removeGanttPreviewOverlay(container: HTMLElement): void {
  container.querySelector('.gantt-preview-overlay')?.remove()
}

export function renderGanttPreviewOverlay(
  container: HTMLElement,
  preview: PendingPlanPreview | null,
  chart: object,
): void {
  removeGanttPreviewOverlay(container)
  if (!preview) return

  const svg = container.querySelector<SVGSVGElement>('svg.gantt')
  const runtimeChart = chart as GanttRuntimeGeometry
  const runtime = runtimeChart.config
  if (
    !svg || !runtimeChart.gantt_start || !runtime?.unit ||
    !runtime.step || !runtime.column_width
  ) return

  const scale: GanttDateScale = {
    timelineStart: runtimeChart.gantt_start,
    unit: runtime.unit,
    step: runtime.step,
    columnWidth: runtime.column_width,
  }
  const groups = new Map<string, SVGGElement>()
  container.querySelectorAll<SVGGElement>('.bar-wrapper[data-id]').forEach(
    (group) => {
      const id = group.dataset.id
      if (id) groups.set(id, group)
    },
  )
  const layer = createSvgElement('g', {
    class: 'gantt-preview-overlay',
    'aria-hidden': 'true',
    'pointer-events': 'none',
  })

  for (const change of preview.changes) {
    const group = groups.get(change.publicId)
    const current = group && barGeometry(group)
    if (!current) continue
    const geometry = resolveSameRowPreviewGeometry(
      change,
      current,
      (value) => timelineDateX(value, scale),
    )
    if (geometry) renderPreviewItem(layer, geometry)
  }

  if (layer.childElementCount > 0) svg.appendChild(layer)
}
