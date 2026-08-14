import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyChangeSet, exportWorkbook, importWorkbook, sendChat } from './api'
import { makeChangeSet, makePlan, jsonResponse } from './test/fixtures'

describe('frontend API contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves Russian UTF-8 chat text and sends the current PlanState', async () => {
    const plan = makePlan()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'clarification_required',
        message: 'Уточните дату переноса',
        plan,
        conversation_context: [],
        pending_changeset: null,
        available_options: [],
      }),
    )

    const response = await sendChat('Перенеси задачу на следующую неделю', plan, [])

    expect(response.message).toBe('Уточните дату переноса')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({ method: 'POST' }),
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(request.headers).toEqual({ 'Content-Type': 'application/json; charset=UTF-8' })
    expect(JSON.parse(request.body as string)).toEqual({
      message: 'Перенеси задачу на следующую неделю',
      plan,
      conversation_context: [],
    })
  })

  it('returns a structured provider error so the UI can preserve PlanState', async () => {
    const plan = makePlan()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          status: 'provider_error',
          message: 'Провайдер временно недоступен.',
          plan,
          conversation_context: [],
          pending_changeset: null,
          available_options: [],
        },
        502,
      ),
    )

    const response = await sendChat('Проверь план', plan, [])

    expect(response.status).toBe('provider_error')
    expect(response.plan).toEqual(plan)
  })

  it('routes apply, import, and export through their backend endpoints', async () => {
    const plan = makePlan()
    const changeset = makeChangeSet(plan)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ status: 'applied', plan }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'VALIDATION_FAILED',
          unchanged_plan: plan,
          changeset: null,
          errors: [],
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Blob(['xlsx']), {
          headers: {
            'Content-Disposition': 'attachment; filename="review-plan.xlsx"',
          },
        }),
      )

    await applyChangeSet(plan, changeset, 'apply_all')
    await importWorkbook(
      new File(['bytes'], 'tasks.xlsx'),
      'append',
      '2026-08-17',
      plan,
    )
    const exported = await exportWorkbook(plan)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/changesets/apply',
      '/api/import',
      '/api/export',
    ])
    const importBody = fetchMock.mock.calls[1][1]?.body as FormData
    expect(importBody.get('file')).toBeInstanceOf(File)
    expect(importBody.get('current_plan')).toBe(JSON.stringify(plan))
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual(plan)
    expect(exported.filename).toBe('review-plan.xlsx')
  })
})
