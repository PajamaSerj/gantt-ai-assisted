import {
  signedWorkingDayDelta,
  type PendingPlanPreview,
  type PendingTaskPreview,
} from './pending-preview'

export { signedWorkingDayDelta } from './pending-preview'

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

export type GanttPreviewViewport = {
  start: number
  end: number
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
  showProposedText: boolean
  connector: GanttPreviewConnector | null
  labelX: number
  labelY: number
  labelWidth: number
  labelHeight: number
  deltaLabel: string
  reasonLabel: string
}

type CurrentLabelGeometry = {
  x: number
  y: number
  text: string
  insideBar: boolean
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

function abbreviatedWorkingDays(count: number): string {
  const absolute = Math.abs(count)
  const modulo100 = absolute % 100
  const modulo10 = absolute % 10
  if (modulo10 === 1 && modulo100 !== 11) return 'раб. день'
  if ([2, 3, 4].includes(modulo10) && ![12, 13, 14].includes(modulo100)) {
    return 'раб. дня'
  }
  return 'раб. дней'
}

export function previewDeltaLabel(change: PendingTaskPreview): string {
  const current = change.currentTask
  const proposed = change.proposedTask
  if (!current || !proposed) return ''
  if (current.duration_workdays !== proposed.duration_workdays) {
    return (
      `${current.duration_workdays} → ${proposed.duration_workdays} ` +
      abbreviatedWorkingDays(proposed.duration_workdays)
    )
  }
  const delta = signedWorkingDayDelta(current.start_date, proposed.start_date)
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±'
  return `${sign}${Math.abs(delta)} ${abbreviatedWorkingDays(delta)}`
}

export function previewReasonLabel(
  source: PendingTaskPreview['source'],
): string {
  if (source === 'direct') return 'Запрошенное изменение'
  if (source === 'dependency') return 'Сдвиг из-за зависимости'
  return 'Связанное изменение'
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

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function labelWidth(delta: string, reason: string, available: number): number {
  const estimated = (delta.length + reason.length + 3) * 5.1 + 18
  return Math.min(Math.max(148, estimated), 232, Math.max(48, available - 8))
}

export function resolveSameRowPreviewGeometry(
  change: PendingTaskPreview,
  current: GanttBarGeometry,
  dateToX: (value: string | Date) => number,
  viewport: GanttPreviewViewport,
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
  const connectorY = current.y + 5
  const connectorPadding = 4
  const minimumConnectorLength = 12
  let connector: GanttPreviewConnector | null = null

  if (direction === 'right') {
    const gap = proposedX - (current.x + current.width)
    if (gap >= minimumConnectorLength) {
      connector = {
        x1: current.x + current.width + connectorPadding,
        x2: proposedX - connectorPadding,
        y: connectorY,
        direction,
      }
    }
  } else if (direction === 'left') {
    const gap = current.x - proposedEndX
    if (gap >= minimumConnectorLength) {
      connector = {
        x1: current.x - connectorPadding,
        x2: proposedEndX + connectorPadding,
        y: connectorY,
        direction,
      }
    }
  }

  const delta = previewDeltaLabel(change)
  const reason = previewReasonLabel(change.source)
  const availableWidth = Math.max(0, viewport.end - viewport.start)
  const width = labelWidth(delta, reason, availableWidth)
  const preferredX = direction === 'left'
    ? proposedX - width - 7
    : proposedEndX + 7
  const x = clamp(
    preferredX,
    viewport.start + 4,
    viewport.end - width - 4,
  )

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
    showProposedText: proposedWidth >= 128 && !overlapsCurrent,
    connector,
    labelX: x,
    labelY: current.y + current.height + 2,
    labelWidth: width,
    labelHeight: 16,
    deltaLabel: delta,
    reasonLabel: reason,
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

function timelineWidth(svg: SVGSVGElement): number {
  const gridRow = svg.querySelector<SVGElement>('.grid-row')
  const gridWidth = gridRow && numberAttribute(gridRow, 'width')
  if (gridWidth && gridWidth > 0) return gridWidth
  const svgWidth = numberAttribute(svg, 'width')
  if (svgWidth && svgWidth > 0) return svgWidth
  return svg.viewBox.baseVal.width > 0 ? svg.viewBox.baseVal.width : 0
}

function visibleViewport(
  scroller: HTMLElement | null,
  width: number,
  proposedX: number,
  proposedEndX: number,
  current: GanttBarGeometry,
): GanttPreviewViewport {
  if (!scroller || scroller.clientWidth <= 0) return { start: 0, end: width }
  const visible = {
    start: Math.max(0, scroller.scrollLeft),
    end: Math.min(width, scroller.scrollLeft + scroller.clientWidth),
  }
  const currentEnd = current.x + current.width
  const rowIsVisible = (
    proposedEndX >= visible.start && proposedX <= visible.end
  ) || (
    currentEnd >= visible.start && current.x <= visible.end
  )
  return rowIsVisible ? visible : { start: 0, end: width }
}

function renderPreviewItem(
  layer: SVGGElement,
  geometry: SameRowPreviewGeometry,
  currentLabel: CurrentLabelGeometry | null,
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
    class: 'gantt-preview-proposed-bar',
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

  if (geometry.showProposedText) {
    item.appendChild(createSvgElement('text', {
      class: 'gantt-preview-proposed-text',
      x: geometry.proposedX + geometry.proposedWidth / 2,
      y: geometry.proposedY + geometry.proposedHeight / 2 + 3,
      'text-anchor': 'middle',
    }, 'После применения'))
  }

  if (currentLabel) {
    item.appendChild(createSvgElement('text', {
      class: [
        'gantt-preview-current-label',
        currentLabel.insideBar ? 'inside' : 'outside',
      ].join(' '),
      x: currentLabel.x,
      y: currentLabel.y,
    }, currentLabel.text))
  }

  const label = createSvgElement('g', {
    class: 'gantt-preview-label',
    transform: `translate(${geometry.labelX} ${geometry.labelY})`,
  })
  label.appendChild(createSvgElement('rect', {
    class: 'gantt-preview-label-background',
    width: geometry.labelWidth,
    height: geometry.labelHeight,
    rx: 6,
    ry: 6,
  }))
  const deltaPrefix = geometry.showProposedText ? '' : 'После · '
  label.appendChild(createSvgElement('text', {
    class: 'gantt-preview-delta',
    x: 7,
    y: 11,
  }, `${deltaPrefix}${geometry.deltaLabel}`))
  const deltaText = `${deltaPrefix}${geometry.deltaLabel}`
  label.appendChild(createSvgElement('text', {
    class: 'gantt-preview-reason',
    x: Math.min(geometry.labelWidth - 8, 9 + deltaText.length * 5.2),
    y: 11,
  }, `· ${geometry.reasonLabel}`))
  item.appendChild(label)
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

  const width = timelineWidth(svg)
  if (width <= 0) return
  const height = numberAttribute(svg, 'height') ?? Number.POSITIVE_INFINITY
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
  const scroller = container.querySelector<HTMLElement>('.gantt-container')
  const layer = createSvgElement('g', {
    class: 'gantt-preview-overlay',
    'aria-hidden': 'true',
    'pointer-events': 'none',
  })

  for (const change of preview.changes) {
    const group = groups.get(change.publicId)
    const current = group && barGeometry(group)
    if (!current || !change.proposedTask) continue
    const proposedX = timelineDateX(change.proposedTask.start_date, scale)
    const proposedEndX = timelineDateX(
      addCalendarDays(parseIsoDate(change.proposedTask.end_date), 1),
      scale,
    )
    const viewport = visibleViewport(
      scroller,
      width,
      proposedX,
      proposedEndX,
      current,
    )
    const geometry = resolveSameRowPreviewGeometry(
      change,
      current,
      (value) => timelineDateX(value, scale),
      viewport,
    )
    if (geometry && geometry.labelY + geometry.labelHeight > height - 12) {
      geometry.labelY = current.y + (current.height - geometry.labelHeight) / 2
      geometry.labelX = clamp(
        Math.min(current.x, geometry.proposedX) - geometry.labelWidth - 7,
        viewport.start + 4,
        viewport.end - geometry.labelWidth - 4,
      )
    }
    const sourceLabel = group.querySelector<SVGTextElement>('.bar-label')
    const labelX = sourceLabel && numberAttribute(sourceLabel, 'x')
    const labelY = sourceLabel && numberAttribute(sourceLabel, 'y')
    const currentLabel = (
      sourceLabel && labelX !== null && labelY !== null && sourceLabel.textContent
    ) ? {
        x: labelX,
        y: labelY,
        text: sourceLabel.textContent,
        insideBar: !sourceLabel.classList.contains('big'),
      } : null
    if (geometry) renderPreviewItem(layer, geometry, currentLabel)
  }

  if (layer.childElementCount > 0) svg.appendChild(layer)
}
