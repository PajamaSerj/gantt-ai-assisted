import type { PlannerState } from './types'

export const STORAGE_KEY = 'ai-gantt-planner:v1'

type StoredPlannerState = {
  version: 1
  state: PlannerState
}

function isPlannerState(value: unknown): value is PlannerState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PlannerState>
  return (
    !!candidate.plan &&
    Array.isArray(candidate.plan.tasks) &&
    Array.isArray(candidate.conversationContext) &&
    (candidate.pendingChange === null || typeof candidate.pendingChange === 'object')
  )
}

export function loadPlannerState(storage: Storage): PlannerState | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPlannerState>
    if (parsed.version !== 1 || !isPlannerState(parsed.state)) {
      storage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed.state
  } catch {
    storage.removeItem(STORAGE_KEY)
    return null
  }
}

export function persistPlannerState(storage: Storage, state: PlannerState): void {
  if (!state.plan) return
  const payload: StoredPlannerState = { version: 1, state }
  storage.setItem(STORAGE_KEY, JSON.stringify(payload))
}
