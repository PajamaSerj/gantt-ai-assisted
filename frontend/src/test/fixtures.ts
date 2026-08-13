import type { ChangeSet, PlanState } from '../types'

export function makePlan(name = 'Исследование продукта'): PlanState {
  return {
    tasks: [
      {
        internal_id: '00000000-0000-4000-8000-000000000001',
        public_id: 'TASK-001',
        name,
        description: 'Проверить гипотезы',
        assignee: 'Анна',
        duration_workdays: 3,
        predecessor_ids: [],
        start_date: '2026-02-02',
        end_date: '2026-02-04',
        created_source: 'seed',
      },
      {
        internal_id: '00000000-0000-4000-8000-000000000002',
        public_id: 'TASK-002',
        name: 'UX-дизайн',
        description: null,
        assignee: 'Мария',
        duration_workdays: 4,
        predecessor_ids: ['00000000-0000-4000-8000-000000000001'],
        start_date: '2026-02-05',
        end_date: '2026-02-10',
        created_source: 'seed',
      },
    ],
  }
}

export function makeChangeSet(plan = makePlan()): ChangeSet {
  return {
    changeset_id: '00000000-0000-4000-8000-000000000099',
    source_plan_digest: 'digest',
    requested_changes: [],
    affected_tasks: [
      {
        internal_id: plan.tasks[0].internal_id,
        public_id: plan.tasks[0].public_id,
        name: plan.tasks[0].name,
      },
    ],
    conflicts: [],
    proposed_impacts: [],
    date_normalizations: [],
    confirmation_reasons: [],
    status: 'CONFIRMATION_REQUIRED',
    proposed_plan: plan,
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  })
}
