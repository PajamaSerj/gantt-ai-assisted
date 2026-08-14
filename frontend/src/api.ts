import type {
  ChangeSet,
  ChatResponse,
  ConversationMessage,
  DirectEditIntent,
  DirectEditResponse,
  ImportResponse,
  PlanState,
} from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; message?: string }
    return body.detail || body.message || `Запрос завершился с ошибкой (${response.status})`
  } catch {
    return `Запрос завершился с ошибкой (${response.status})`
  }
}

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status)
  }
  return (await response.json()) as T
}

export async function fetchSeed(signal?: AbortSignal): Promise<PlanState> {
  return expectJson<PlanState>(await fetch('/api/seed', { signal }))
}

export async function sendChat(
  message: string,
  plan: PlanState,
  conversationContext: ConversationMessage[],
): Promise<ChatResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      message,
      plan,
      conversation_context: conversationContext,
    }),
  })
  if (!response.ok) {
    const body = (await response.json()) as Partial<ChatResponse> & {
      detail?: string
    }
    if (body.status === 'provider_error' && body.plan && body.message) {
      return body as ChatResponse
    }
    throw new ApiError(
      body.detail || body.message || `Запрос завершился с ошибкой (${response.status})`,
      response.status,
    )
  }
  return expectJson<ChatResponse>(response)
}

export async function applyChangeSet(
  currentPlan: PlanState,
  changeset: ChangeSet,
  choice: 'apply_all' | 'cancel',
): Promise<{ status: string; plan: PlanState }> {
  const response = await fetch('/api/changesets/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      current_plan: currentPlan,
      changeset,
      choice,
    }),
  })
  return expectJson(response)
}

export async function prepareDirectEdit(
  currentPlan: PlanState,
  intent: DirectEditIntent,
): Promise<DirectEditResponse> {
  const edit = intent.type === 'move'
    ? {
        type: 'move',
        task_id: intent.task.internal_id,
        intended_start_date: intent.intendedDate,
      }
    : {
        type: 'resize',
        task_id: intent.task.internal_id,
        intended_end_date: intent.intendedDate,
      }
  const response = await fetch('/api/direct-edits/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ current_plan: currentPlan, edit }),
  })
  return expectJson<DirectEditResponse>(response)
}

export async function importWorkbook(
  file: File,
  mode: 'replace' | 'append',
  dateConstraint: string,
  currentPlan: PlanState,
): Promise<ImportResponse> {
  const body = new FormData()
  body.append('file', file)
  body.append('mode', mode)
  body.append('date_constraint', dateConstraint)
  body.append('current_plan', JSON.stringify(currentPlan))
  return expectJson<ImportResponse>(
    await fetch('/api/import', { method: 'POST', body }),
  )
}

export type ExportedWorkbook = {
  blob: Blob
  filename: string
}

export async function exportWorkbook(plan: PlanState): Promise<ExportedWorkbook> {
  const response = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(plan),
  })
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status)
  }
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  return {
    blob: await response.blob(),
    filename: filename || 'ai-gantt-plan.xlsx',
  }
}

export function downloadWorkbook({ blob, filename }: ExportedWorkbook): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
