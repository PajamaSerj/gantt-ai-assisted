# Roadmap to Production

## Как читать этот документ

AI Gantt Planner завершён как reviewer-facing MVP. Пункты ниже — сознательно
оставленный technical debt и требования промышленной эксплуатации, а не список
скрытых дефектов текущего demo. Любое развитие должно сохранить основной
контракт: LLM интерпретирует намерение, deterministic backend принимает
формальные решения, а управленческие последствия подтверждает пользователь.

## Рекомендуемый порядок

### 1. Надёжное хранение и модель доступа

Сначала перенести `PlanState` из browser-only storage в транзакционную БД,
добавить migrations, backup/restore и retention. Затем ввести пользователей,
authentication, authorization и изолированные workspaces. Browser persistence
может остаться локальным cache, но не source of truth.

Результат: планы переживают потерю устройства, доступны команде и защищены
tenant boundaries.

### 2. Версии, история и конкурентные изменения

Добавить versioned plan snapshots, optimistic concurrency, idempotency keys,
change history, audit событий AI/MCP и rollback к выбранной версии. Apply должен
отклонять ChangeSet, подготовленный для устаревшей версии, и показывать понятный
conflict/rebase flow.

Результат: воспроизводимые изменения без silent overwrite при параллельной
работе.

### 3. Operational safety и provider resilience

Ввести structured logs, metrics, traces, health/SLO dashboards и alerts. Добавить
rate limits, quotas, budget/cost controls, abuse protection, request timeouts,
circuit breakers и контролируемый retry. Provider adapter расширить явным
fallback policy и contract/evaluation suite, не перенося business rules в LLM.

Результат: наблюдаемая стоимость и деградация вместо непредсказуемых сбоев.

### 4. CI/CD и deployment hardening

Автоматизировать unit/integration/E2E, image scanning, SBOM/provenance для
registry, где формат поддерживается, signed immutable artifacts и promotion
между isolated environments. Добавить deployment approvals, post-deploy smoke,
canary/blue-green strategy, tested rollback и infrastructure drift checks.

Результат: повторяемая поставка без ручной зависимости от локального окружения.

### 5. Scheduling maturity

Расширять scheduling отдельными детерминированными модулями: configurable
work calendars и holidays, milestones, lag/lead, SS/FF/SF dependencies. Затем
добавить resource capacity, availability и leveling как suggestion/preview, а не
как неявную оптимизацию.

Результат: richer project planning при сохранении explainable impact analysis.

### 6. Excel lifecycle и большие планы

Ввести стабильные import/re-import identifiers, сохранение TASK-ID и рассчитанных
дат в version-aware round trip. Добавить streaming/queued processing, size
limits, progress, resumable failure reporting и controlled duplicate resolution
для больших workbook. Неизвестные или неоднозначные данные должны по-прежнему
проходить preview, а не silently normalize.

Результат: надёжный повторный обмен и масштабирование выше MVP workbook sizes.

### 7. Advanced AI и document intake

Только после закрепления persistence/versioning/observability расширять
AI-assisted normalization, оптимизационные предложения и intake из BRD,
спецификаций или connector-документов. Любая decomposition сначала создаёт
proposal, затем проходит deterministic validation и user confirmation.

Результат: более широкий AI workflow без обхода domain contracts.

## Основные production-риски

| Риск | Текущее MVP-ограничение | Рекомендуемое закрытие |
| --- | --- | --- |
| Потеря или рассинхронизация плана | browser `localStorage` | БД, backups, versioning, optimistic locking |
| Несанкционированный доступ | публичный demo без auth | users, workspace isolation, authorization, audit |
| Неожиданная AI-интерпретация | restricted tools и confirmation | eval suite, policy monitoring, provider resilience |
| Неконтролируемые расходы/abuse | нет production quotas | rate limits, budgets, per-tenant quotas, alerts |
| Недостаточная наблюдаемость | smoke и application logs | metrics, traces, SLO, dashboards, alerts |
| Ошибка поставки | Human-operated deployment | CI/CD, signed artifacts, promotion, rollback drills |
| Ошибки сложного расписания | ограниченный FS/calendar contract | отдельные tested scheduling extensions |
| Неоднозначный re-import | names и новые TASK-ID | stable external IDs и version-aware merge |
| Большие/нестандартные документы | строгий `.xlsx` contract | asynchronous intake с proposal/preview boundary |

## Exit criteria для следующего уровня

Перед production rollout должны одновременно существовать tenant isolation,
durable/versioned storage, audit trail, operational SLO, cost controls, tested
backup/restore и rollback, security review и automated delivery gates. Advanced
AI capabilities не считаются компенсацией отсутствующих deterministic или
operational controls.
