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
    scroll_to?: 'today' | 'start' | 'end' | string
    today_button?: boolean
    popup?: false | ((context: unknown) => false | string | void)
    on_click?: (task: GanttTask) => void
    container_height?: number | 'auto'
    bar_height?: number
    padding?: number
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
