declare module 'frappe-gantt' {
  export type GanttTask = {
    id: string
    name: string
    start: string
    end: string
    progress?: number
    dependencies?: string
    custom_class?: string
  }

  export type GanttOptions = {
    view_mode?: 'Day' | 'Week' | 'Month' | 'Year'
    readonly?: boolean
    readonly_dates?: boolean
    readonly_progress?: boolean
    move_dependencies?: boolean
    infinite_padding?: boolean
    language?: string
    scroll_to?: 'today' | 'start' | 'end' | string
    today_button?: boolean
    popup?: false | ((context: unknown) => false | string | void)
    on_click?: (task: GanttTask) => void
    container_height?: number | 'auto'
    bar_height?: number
    padding?: number
    fixed_duration?: boolean
    holidays?: Record<string, 'weekend' | ((date: Date) => boolean)>
    is_weekend?: (date: Date) => boolean
    view_modes?: GanttViewMode[]
    on_date_change?: (task: GanttTask, start: Date, end: Date) => void
  }

  export type GanttViewMode = {
    name: 'Day' | 'Week' | 'Month'
    padding: string | [string, string]
    step: string
    date_format: string
    column_width?: number
    lower_text?: string | ((date: Date, previous: Date | null, language: string) => string)
    upper_text?: string | ((date: Date, previous: Date | null, language: string) => string)
    upper_text_frequency?: number
    thick_line?: (date: Date) => boolean
    snap_at?: string
  }

  export default class Gantt {
    constructor(
      wrapper: HTMLElement | string,
      tasks: GanttTask[],
      options?: GanttOptions,
    )
    refresh(tasks: GanttTask[]): void
    change_view_mode(viewMode: string, maintainPosition?: boolean): void
  }
}
