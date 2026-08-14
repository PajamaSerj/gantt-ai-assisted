export type CreatedSource = 'seed' | 'excel' | 'ai'

export type Task = {
  internal_id: string
  public_id: string
  name: string
  description: string | null
  assignee: string | null
  duration_workdays: number
  predecessor_ids: string[]
  start_date: string
  end_date: string
  created_source: CreatedSource
}

export type PlanState = {
  tasks: Task[]
}

export type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AffectedTask = {
  internal_id: string
  public_id: string
  name: string
}

export type ChangeConflict = {
  code: string
  message: string
  task_public_id: string | null
  related_task_public_ids: string[]
}

export type ProposedImpact = {
  internal_id: string
  public_id: string
  task_name: string
  current_start_date: string
  current_end_date: string
  proposed_start_date: string
  proposed_end_date: string
  reason: string
  dependency_internal_id: string
  dependency_public_id: string
  dependency_name: string
}

export type DateNormalization = {
  context: string
  requested_date: string
  normalized_date: string
  task_public_id: string | null
}

export type ConfirmationReason = {
  code: string
  message: string
  task_public_ids: string[]
}

export type TaskSpec = Omit<Task, 'start_date' | 'end_date'>

export type RequestedChange =
  | {
      type: 'replace_plan'
      tasks: TaskSpec[]
      plan_start_date: string
    }
  | {
      type: 'append_plan'
      tasks: TaskSpec[]
      minimum_start_date: string
    }
  | { type: 'rename_task'; task_id: string; name: string }
  | { type: 'set_description'; task_id: string; description: string | null }
  | { type: 'set_duration'; task_id: string; duration_workdays: number }
  | { type: 'move_task'; task_id: string; start_date: string }
  | { type: 'set_assignee'; task_id: string; assignee: string | null }
  | { type: 'set_predecessors'; task_id: string; predecessor_ids: string[] }

export type ChangeSet = {
  changeset_id: string
  source_plan_digest: string
  requested_changes: RequestedChange[]
  affected_tasks: AffectedTask[]
  conflicts: ChangeConflict[]
  proposed_impacts: ProposedImpact[]
  date_normalizations: DateNormalization[]
  confirmation_reasons: ConfirmationReason[]
  status: 'AUTO_APPLICABLE' | 'CONFIRMATION_REQUIRED' | 'INVALID'
  proposed_plan: PlanState | null
}

export type ChatStatus =
  | 'applied'
  | 'clarification_required'
  | 'confirmation_required'
  | 'provider_error'

export type ChatResponse = {
  status: ChatStatus
  message: string
  plan: PlanState
  conversation_context: ConversationMessage[]
  pending_changeset: ChangeSet | null
  available_options: string[]
}

export type ImportIssue = {
  code: string
  message: string
  row: number | null
  column: string | null
}

export type ImportResponse = {
  status: 'AUTO_APPLICABLE' | 'CONFIRMATION_REQUIRED' | 'VALIDATION_FAILED'
  unchanged_plan: PlanState
  changeset: ChangeSet | null
  errors: ImportIssue[]
}

export type PendingChange = {
  changeset: ChangeSet
  message: string
  availableOptions: string[]
  source: 'chat' | 'import'
}

export type PlannerState = {
  plan: PlanState | null
  conversationContext: ConversationMessage[]
  pendingChange: PendingChange | null
}
