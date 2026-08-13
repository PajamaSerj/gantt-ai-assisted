# AI Gantt Planner — MVP Project Brief

**Version:** 1.3  
**Status:** Approved for implementation  
**Purpose:** Source of truth for MVP implementation

---

## 1. Product goal

AI Gantt Planner — веб-приложение для работы с планом задач в виде диаграммы Гантта.

Пользователь должен иметь возможность:

- сразу открыть приложение и увидеть готовый демонстрационный план;
- загрузить собственный Excel со списком задач;
- просматривать задачи и зависимости на интерактивном Gantt;
- изменять план через AI-помощника на естественном языке;
- выполнять массовые изменения;
- видеть последствия потенциально конфликтных изменений до применения;
- экспортировать актуальный план обратно в Excel.

### Product principle

AI помогает пользователю управлять планом, но **не принимает управленческие решения вместо пользователя**.

LLM отвечает за понимание естественного языка и выбор допустимых действий.

Формальные правила расписания, зависимостей и целостности плана всегда проверяются deterministic backend logic.

---

## 2. Source requirements

`SOURCE REQUIREMENT`

Исходные требования определяют следующий обязательный scope:

- при открытии страницы сразу показывается интерактивная диаграмма Гантта с seeded test data;
- можно загрузить собственный Excel;
- рядом с диаграммой есть чат;
- через естественный язык можно массово переносить задачи, менять зависимости, добавлять задачи и перераспределять исполнителей;
- изменения агента отражаются на диаграмме;
- по клику на задачу открывается modal;
- план экспортируется обратно в Excel;
- обязательный стек: React, Python/FastAPI, MCP, LLM через API;
- входной Excel содержит колонки `задача`, `описание`, `исполнитель`, `длительность`, `предшественники`;
- результат должен включать git repository и deployed application;
- repository должен содержать README, описание архитектуры и решений, раздел об использовании AI-ассистентов, demo, sample Excel и Roadmap to production.

Все остальные правила ниже являются **осознанными проектными решениями MVP**.

---

## 3. Main UX

`DECISION`

Gantt — главный элемент приложения и занимает большую часть экрана.

AI-помощник постоянно доступен, но не занимает большую постоянную колонку.

Базовая схема:

```text
┌─────────────────────────────────────────────┐
│                    toolbar                  │
├─────────────────────────────────────────────┤
│                                             │
│                                             │
│                  GANTT                      │
│                                             │
│                                             │
│                                  ┌────────┐ │
│                                  │ AI ✦   │ │
└──────────────────────────────────┴────────┘─┘
```

По нажатию AI открывается floating panel / drawer.

Основной prompt:

> Что хотите сделать с задачами?

Excel представлен одной компактной кнопкой/иконкой с меню:

```text
Excel
├─ Импортировать
└─ Экспортировать
```

Excel также можно прикрепить через `📎` в AI-помощнике. Оба entry point используют одну import logic.

### Excel attachment routing

`DECISION`

Excel-файл, прикреплённый через `📎` в AI-помощнике, **не отправляется в LLM для разбора содержимого**.

Оба entry point работают одинаково:

```text
Excel menu import
или
AI panel 📎 attachment
↓
same deterministic /api/import flow
↓
openpyxl parser
↓
structural / row / graph validation
↓
schedule calculation
↓
preview / confirmation when required
```

LLM может сопровождать import человеко-читаемыми сообщениями в UI, но стандартный MVP Excel contract обрабатывается deterministic backend logic.

AI-assisted interpretation/normalization нестандартных Excel-данных остаётся Roadmap-функцией и не должна незаметно включаться в MVP import flow.

---

## 4. Task domain model

`DECISION`

```text
Task

internal_id          UUID
public_id            TASK-NNN
name                 string
description          string | null
assignee             string | null
duration_workdays    positive integer
predecessor_ids      UUID[]
start_date           date
end_date             date
created_source       seed | excel | ai
```

### `internal_id`

Технический идентификатор.

Используется backend и dependency graph.

Пользователь UUID не видит.

### `public_id`

Человекочитаемый идентификатор:

```text
TASK-001
TASK-002
TASK-003
```

Используется UI, modal и AI-командами.

### `name`

Название задачи.

В MVP название должно быть уникальным в рамках текущего плана.

Символ `;` запрещён в названии задачи: он зарезервирован как canonical separator для predecessors в Excel. Escaping/quoting syntax в MVP не используется.

### `assignee`

Обычная строка.

Отдельной сущности Employee/User в MVP нет.

### `duration_workdays`

Положительное целое число рабочих дней.

### `predecessor_ids`

Внутри приложения зависимости всегда хранятся по `internal_id`.

### Dates

`start_date` и `end_date` хранятся явно.

### Public TASK-ID generation

`DECISION`

`public_id` генерируется системой детерминированно.

Правила:

```text
Replace import:
TASK-001, TASK-002, ...
в порядке строк валидного Excel после удаления полностью пустых строк

Append import / AI create:
max(existing TASK number) + 1

existing TASK-ID:
never renumbered automatically

Reset demo:
restores the original fixed seed TASK-ID values
```

Пропуски в последовательности допустимы.

Например, если максимальный существующий ID — `TASK-008`, следующая новая задача получает `TASK-009`, даже если один из более ранних ID отсутствует.

Internal UUID генерируется независимо от `public_id`.

---

## 5. Scheduling rules

`DECISION`

### Calendar

MVP использует рабочую неделю:

```text
Пн–Пт = working day
Сб–Вс = non-working day
```

Государственные праздники не учитываются.

Например:

```text
start = Monday
duration = 3

Mon
Tue
Wed

end = Wednesday
```

### Dependency type

MVP поддерживает только:

```text
Finish-to-Start
```

Задача с predecessor может стартовать не раньше следующего рабочего дня после завершения всех predecessor.

Если predecessors несколько:

```text
start =
следующий допустимый рабочий день
после самого позднего predecessor
```

### Weekend date normalization

`DECISION`

Если пользователь указывает дату начала, которая попадает на субботу или воскресенье, backend не отклоняет запрос как ошибочный.

Вместо этого дата нормализуется на ближайший следующий рабочий день.

Например:

```text
requested start = Saturday, 22 August
normalized start = Monday, 24 August
```

Нормализация применяется к:

```text
explicit task move date
Replace import plan start date
Append import minimum allowed date
```

Такое изменение должно быть явно показано пользователю в preview до применения:

> Указанная дата 22 августа приходится на выходной. Ближайшая рабочая дата — 24 августа.

LLM не рассчитывает такую нормализацию самостоятельно. Это правило deterministic scheduling logic.

### Relative scheduling language

`DECISION`

В контексте изменения расписания относительные длительности трактуются в рабочих днях:

```text
"на 3 дня" / "на три дня"
→ 3 working days

"на неделю"
→ 5 working days
```

При этом календарные выражения, не задающие однозначную дату, не должны превращаться LLM в управленческое решение.

Например:

> Перенеси задачу на следующую неделю.

без указания конкретного дня считается неоднозначным запросом.

AI должен уточнить дату или день недели, а не самостоятельно выбирать понедельник.

Формальный пересчёт рабочих дней выполняет deterministic backend logic.

---

## 6. Dependency rules

`DECISION`

Backend обязан запрещать:

```text
unknown predecessor
self-reference
dependency cycle
```

Например:

```text
A → B
B → C
C → A
```

должно быть отклонено.

При возможности UI показывает понятный cycle path:

```text
TASK-001 → TASK-003 → TASK-006 → TASK-001
```

LLM **не определяет**, существует цикл или нет.

Это делает deterministic Python logic.

---

## 7. Impact-aware scheduling

`DECISION — critical`

Система **никогда автоматически не двигает связанные задачи только потому, что этого требует новая зависимость, перенос другой задачи, импорт или иное изменение плана**.

Она может детерминированно рассчитать необходимые последствия, но до явного согласования пользователя не применяет вызванные ими переносы.

Для каждого автоматически рассчитанного impact preview должен показать:

```text
affected TASK-ID
task name
current start/end dates
proposed start/end dates
reason for the shift
dependency that caused the impact
```

Пример:

```text
TASK-002 Backend
до 20 августа

TASK-006 Testing
depends on TASK-002
```

Если операция потребует перенести Testing:

> TASK-006 «Testing» будет перенесена с 19–21 августа на 21–25 августа, поскольку зависит от TASK-002 «Backend», которая заканчивается 20 августа.

Если затронуто несколько задач, preview показывает **весь список затронутых задач и причин до применения**.

### Transitive downstream impact

`DECISION`

Impact analysis обязан проходить по dependency graph транзитивно, а не останавливаться на непосредственных successors.

Например:

```text
A → B → C → D
```

Если изменение `A` делает необходимым перенос `B`, новый proposed end `B` должен быть проверен относительно `C`, затем `C` относительно `D`, пока не будет рассчитана вся затронутая downstream-цепочка.

Preview должен показывать все транзитивно затронутые задачи и соответствующую цепочку причин.

До подтверждения пользователя:

```text
A/B/C/D remain unchanged
```

Это правило одинаково действует для:

```text
AI commands
Excel Replace
Excel Append
dependency changes
task moves
other operations that cause schedule impact
```

До подтверждения состояние плана не меняется.

Общая последовательность:

```text
request
↓
prepare ChangeSet
↓
validate
↓
impact analysis
↓
preview
↓
confirmation if required
↓
re-validation
↓
apply
```

При конфликте или согласуемом impact Gantt должен визуально подсвечивать затронутые задачи и dependency edges.

### No implicit schedule optimization

`DECISION`

Система автоматически рассчитывает только последствия, необходимые для проверки и сохранения валидности плана.

Она **не оптимизирует расписание без явного запроса пользователя**.

Примеры:

1. Пользователь просит перенести `TASK-007` на дату раньше окончания predecessor.

```text
requested start = 18 August
predecessor ends = 20 August
nearest valid start = 21 August
```

Система ничего не применяет автоматически и предлагает:

```text
1. использовать ближайшую допустимую дату — 21 August;
2. отдельно изменить dependency — только после явного подтверждения;
3. отменить операцию.
```

Система не двигает predecessor ради выполнения исходного запроса.

2. Пользователь удаляет dependency.

Удаление dependency **не переносит successor раньше автоматически**.

3. Пользователь сокращает duration predecessor.

Освободившийся временной интервал **не подтягивает successors влево автоматически**.

Любая оптимизация или уплотнение расписания должна быть отдельным явным пользовательским запросом.

---

## 8. ChangeSet

`DECISION`

Любое AI-изменение сначала представляется как временный `ChangeSet`.

Концептуально:

```text
ChangeSet

requested_changes[]
affected_tasks[]
conflicts[]
proposed_impacts[]
status
```

ChangeSet не требуется постоянно хранить в MVP.

### Valid request

Если:

- intent однозначен;
- все изменения валидны;
- нет требующих согласования побочных последствий;

изменение может применяться сразу.

### Conflict

Если операция содержит хотя бы один конфликт или требующее согласования побочное последствие:

**до решения пользователя не применяется ни одно изменение из всего ChangeSet.**

Например из 10 изменений одно невозможно:

```text
9 valid
1 conflict
```

До выбора пользователя:

```text
0 changes applied
```

Пользователь получает варианты:

```text
1. разрешить конфликт предложенным способом и применить всё;
2. применить 9 валидных изменений,
   конфликтную операцию оставить без изменения;
3. отменить всю операцию.
```

Выбранный итоговый вариант повторно валидируется backend перед применением.

### Final-state batch validation

`DECISION — critical`

Batch / mass changes валидируются как **единое proposed final PlanState**, а не как последовательность промежуточных мутаций.

Например пользователь просит:

> Сдвинь Backend и Testing на 3 рабочих дня.

Если `Testing` зависит от `Backend`, backend не должен:

```text
apply Backend move
↓
validate temporary state
↓
treat still-unmoved Testing as a conflict
```

Правильный flow:

```text
collect all requested changes
↓
build proposed final PlanState in memory
↓
validate name uniqueness
↓
validate dependency graph / cycles
↓
validate scheduling rules
↓
calculate transitive impacts
↓
classify AUTO_APPLICABLE or CONFIRMATION_REQUIRED
↓
apply atomically only after required confirmation
```

Никакое промежуточное состояние batch-операции не становится source of truth и не используется как самостоятельный результат пользовательской команды.

### Pending ChangeSet lifecycle

`DECISION`

Пока на frontend существует `pending ChangeSet`, другие mutation-операции плана блокируются до завершения текущего решения.

Блокируются:

```text
new AI mutations
Excel Replace
Excel Append
other plan-changing operations
```

Разрешены read-only действия, не меняющие PlanState, например просмотр Gantt/task modal.

Pending ChangeSet завершается одним из способов:

```text
Apply selected option
Cancel
Reset demo
```

`Reset demo` автоматически отменяет pending ChangeSet перед восстановлением seed.

Это правило защищает от применения ChangeSet, рассчитанного относительно уже изменившегося PlanState, без введения server-side versioning в MVP.

---

## 9. Excel input

`SOURCE REQUIREMENT + DECISION`

Обязательные входные колонки остаются ровно такими, как заданы:

```text
задача
описание
исполнитель
длительность
предшественники
```

Мы не изменяем обязательный Excel contract.

Дополнительные неизвестные колонки в MVP можно игнорировать.

### Supported workbook contract

`DECISION`

MVP принимает только:

```text
.xlsx
```

Legacy `.xls` и другие spreadsheet-форматы не поддерживаются.

Обрабатывается только **active worksheet** workbook (обычно это первый лист в стандартном файле).

Остальные worksheets в MVP игнорируются.

Если на active worksheet отсутствует требуемая структура, пользователь получает обычную structural validation error.

---

## 10. Excel validation

`DECISION`

Проверка выполняется deterministic backend logic.

### File level

Проверить:

```text
extension = .xlsx
файл читается
workbook содержит active worksheet
active worksheet не пустой
```

### Structure level

Обязательны все пять колонок.

При сравнении headers допускается normalization:

```text
whitespace
case
```

### Row level

`задача`:

```text
required
non-empty
unique
```

`длительность`:

```text
required
positive integer
```

Опциональны:

```text
описание
исполнитель
предшественники
```

Полностью пустые строки игнорируются.

### Graph level

Проверяются:

```text
duplicate names
unknown predecessor
self-reference
cycles
```

### Error handling

Import атомарный.

При ошибках:

```text
0 changes applied
```

Пользователь получает **все найденные ошибки сразу**, желательно с номером строки и причиной.

Не заставляем исправлять ошибки по одной.

---

## 11. Predecessors in Excel

`DECISION`

Excel использует **названия задач**, а не технические IDs.

Canonical syntax:

```text
Backend; Frontend
```

То есть несколько predecessors разделяются `;`.

Поскольку escaping/quoting syntax в MVP не используется, символ `;` запрещён в `Task.name`. Это ограничение применяется единообразно при Excel import и во всех create/rename flows с человекочитаемой ошибкой валидации.

После parsing:

```text
names
↓
task resolution
↓
internal UUID
```

И дальнейшая работа внутри системы происходит только по ID.

---

## 12. Import modes

`DECISION`

После загрузки Excel пользователь выбирает:

```text
Дополнить текущие задачи
Заменить текущие задачи полностью
```

### Replace

Текущий plan заменяется импортированным.

Пользователь указывает:

> Дата начала плана

После этого backend рассчитывает schedule.

### Append

Новые задачи добавляются к существующему plan.

Пользователь указывает:

> Не раньше какой даты могут начинаться добавляемые задачи?

Imported predecessor может ссылаться:

- на другую импортируемую задачу;
- на уже существующую задачу текущего Gantt.

Resolution выполняется по объединению:

```text
current tasks
+
incoming tasks
```

Затем проверяется весь результирующий dependency graph.

Перед применением обязательно проверяется уникальность названий по объединённому состоянию:

```text
current task names
+
incoming task names
↓
all names must remain unique
```

Если существующий Gantt уже содержит `Backend`, а Append-файл также содержит `Backend`, весь Append отклоняется.

Если merge создаёт duplicate name, dependency conflict или иной validation error:

```text
nothing applied
```

---

## 13. Imported scheduling

`DECISION`

Для incoming task без predecessors:

```text
start = minimum allowed date
```

Для incoming task с predecessors:

```text
start =
max(
    minimum allowed date,
    first valid working day
    after all predecessors finish
)
```

Если зависимость приводит к сдвигу относительно даты, указанной пользователем или рассчитанной для импортируемой задачи, backend сначала формирует impact preview.

Preview должен перечислить все задачи, которые предлагается сдвинуть, их текущие/запрошенные даты, предлагаемые даты и конкретную dependency-причину.

До подтверждения пользователя **ни одна такая дата не изменяется**.

Если импорт вызывает несколько schedule impacts, backend формирует **один consolidated preview** для всего импортируемого ChangeSet.

Например:

```text
TASK-A → shift +2 working days
TASK-B → shift +4 working days
TASK-C → shift +4 working days
```

показываются одним списком и подтверждаются одним пользовательским решением, а не серией отдельных диалогов.

---

## 14. Seed data

`DECISION`

Seeded plan имеет **фиксированный заранее подготовленный snapshot с фиксированными датами**.

Он не рассчитывается относительно текущей даты.

Seed должен специально демонстрировать:

```text
несколько исполнителей
параллельные задачи
цепочки dependencies
несколько predecessors
достаточно материала для AI-команд
```

Seed immutable.

При initial seed render и после `Restore demo` Gantt автоматически позиционируется на начале seed-plan, чтобы фиксированные исторические даты всегда были видны reviewer сразу.

Концептуально:

```text
scroll_to = plan start
```

или эквивалент используемой версии Gantt library.

---

## 15. State persistence

`DECISION`

MVP не использует database.

Текущее состояние хранится:

```text
browser localStorage
```

Следовательно:

```text
F5 → состояние сохраняется
другой browser → собственное состояние
другой reviewer → собственное состояние
```

Backend stateless.

На frontend также хранится request-scoped пользовательский контекст, необходимый для продолжения AI-диалога:

```text
conversation messages / minimal conversation context
pending ChangeSet when confirmation is required
```

Это необходимо, чтобы последовательность:

```text
User: Добавь задачу Code Review
AI: Укажите длительность.
User: 2 дня.
```

корректно продолжалась при stateless backend.

Постоянное server-side хранение истории чата в MVP не требуется.

При первом открытии приложения:

```text
localStorage empty
↓
GET /api/seed
↓
save locally
↓
render Gantt
```

---

## 16. Restore demo

`DECISION`

UI содержит компактное действие:

> ↺ Восстановить демо-данные

После confirmation:

```text
cancel pending ChangeSet if present
↓
GET /api/seed
↓
restore seed PlanState
↓
clear AI conversation context
↓
clear conflict / impact highlighting
↓
clear pending confirmation UI state
↓
render original seed
↓
scroll Gantt to plan start
```

Seed никогда не изменяется.

---

## 17. Task modal

`DECISION`

Modal MVP — **read-only**.

Показывает:

```text
TASK-ID
название
описание
исполнитель
длительность
дата начала
дата окончания
predecessors
successors
```

`successors` рассчитываются из dependency graph.

Редактирование через modal в MVP не требуется.

---

## 18. AI interaction model

`DECISION`

Используется controlled natural language.

Пользователю не требуется знать специальный command syntax.

Поддерживаются обычные запросы:

> Перенеси TASK-004 на 20 августа.

> Все задачи Анны сдвинь на два рабочих дня.

> Передай Backend Сергею.

> Добавь задачу Code Review длительностью 2 дня с 24 августа.

> Сделай Testing зависимой от Backend.

При недостатке информации AI задаёт **минимально необходимый уточняющий вопрос**.

AI не должен самостоятельно придумывать отсутствующие management data.

---

## 19. AI responsibility

`DECISION`

LLM отвечает за:

```text
natural-language understanding
intent detection
entity/task selection
tool selection
tool argument preparation
human-readable explanations
```

LLM **не отвечает за**:

```text
date arithmetic
working-day calculation
cycle detection
dependency validation
schedule validity
impact calculation
business-rule enforcement
```

Общий принцип:

> **LLM принимает смысловые решения.  
> Deterministic code принимает формальные решения.**

---

## 20. Supported AI operations

`DECISION`

### Move

Поддержать:

```text
move to explicit date
shift ±N working days
mass shift
relative positioning
```

При переносе задачи:

```text
start_date changes
duration_workdays remains unchanged
end_date is recalculated deterministically
```

Перенос задачи **сам по себе никогда не создаёт dependency**.

Например:

> Сдвинь все задачи Анны на 2 рабочих дня.

Фраза:

> Поставь Testing после Backend

неоднозначна.

Она может означать:

```text
move date
```

или:

```text
create dependency
```

Если dependency явно не указана, AI должен уточнить intent.

### Dependencies

Поддержать:

```text
add predecessor
remove predecessor
replace predecessor
set multiple predecessors
explicit mass dependency operation
```

AI не должен самостоятельно анализировать весь plan и придумывать «правильные» dependencies.

### Add task

Для создания новой задачи обязательны:

```text
name
duration
placement
```

`placement` должен задавать достаточную информацию для расчёта `start_date` и может содержать один или несколько совместимых ограничителей:

```text
explicit start date
predecessor(s)
unambiguous relative position
```

Эти варианты **не являются взаимоисключающими**.

Правила:

```text
only explicit start date
→ proposed start = explicit date

only predecessor(s)
→ proposed start =
  first working day after the latest predecessor finishes

explicit start date + predecessor(s)
→ proposed start =
  max(
    normalized explicit start date,
    first valid working day after all predecessors finish
  )
```

Если explicit date нарушает dependency constraint, система не молча исправляет запрос: применяется обычный impact/confirmation flow с объяснением ближайшей допустимой даты.

Relative position должна быть однозначной. Формулировка вроде «после Backend» без явного указания, имеется ли в виду дата или dependency, остаётся неоднозначной и требует clarification.

Optional:

```text
description
assignee
```

Примеры валидного placement:

> Добавь Code Review длительностью 2 дня с 24 августа.

> Добавь Code Review длительностью 2 дня, она зависит от Backend.

> Добавь Testing с 25 августа длительностью 3 дня, зависит от Backend.

Если пользователь пишет:

> Добавь Code Review длительностью 2 дня.

AI не выбирает дату самостоятельно и отвечает:

> С какой даты начать задачу или после какой задачи её поставить?

Если отсутствует `duration`, AI уточняет duration.

Если отсутствуют и `duration`, и `placement`, AI запрашивает только реально недостающие обязательные параметры и сохраняет уже известные значения в conversation context.

Predecessors задаются через placement и после resolution хранятся как `predecessor_ids`.

Не придумывать description, assignee, даты или dependencies.

Duplicate name:

```text
do not create
ask for another name
```

### Assignee

Поддержать:

```text
assign
reassign
mass reassign
remove assignee
```

Assignee остаётся строкой.

Если имя исполнителя ранее не встречалось:

> Исполнитель «Алексей Петров» пока не используется в плане. Добавить его как нового исполнителя?

Это защищает от опечаток.

Reassignment не изменяет автоматически schedule или dependencies.

### General field update

`update_task` предназначен только для обычных редактируемых свойств:

```text
name
description
duration_workdays
```

Изменение:

```text
dates
assignee
dependencies
```

должно выполняться только специализированными business operations/tools, чтобы не обходить impact analysis и validation.

Rename через `update_task` обязан сохранять уникальность `name` в текущем PlanState.

Если новое имя уже занято другой задачей:

```text
reject ChangeSet
```

Если изменяется `duration_workdays`, `end_date` пересчитывается deterministic backend logic, а возможные последствия для dependent tasks проходят через обычный impact-preview flow.

---

## 21. MCP contract

`DECISION`

MCP используется реально, а не декларативно.

### Read tools

```text
get_tasks
get_task
get_dependencies
```

Semantics:

```text
get_tasks
- returns the current request-scoped plan or a filtered task set
- supports filters needed by MVP, including assignee and name/text matching

get_task
- resolves a task by public TASK-ID
- may resolve by unique task name when unambiguous

get_dependencies
- returns predecessors
- returns successors
- returns relationship context needed for impact explanation
```

The current `PlanState` arrives at FastAPI with the request, but **the LLM must inspect plan data through MCP read tools**.

Implementation must not pass the entire plan directly into the model prompt and then call MCP only decoratively.

Conceptually:

```text
React sends PlanState to FastAPI
↓
FastAPI exposes that snapshot as request-scoped MCP context
↓
LLM calls get_tasks / get_task / get_dependencies
↓
MCP tools read from the request-scoped PlanState
```

### Prepare-change tools

```text
create_task
update_task
move_tasks
set_assignee

add_predecessor
remove_predecessor
replace_predecessor
```

Write tools **не должны напрямую обходить validation layer**.

Они формируют/дополняют ChangeSet.

### Execution

```text
apply_changes
```

`apply_changes` не является свободной управленческой командой LLM.

После подготовки ChangeSet deterministic validator классифицирует результат:

```text
AUTO_APPLICABLE
или
CONFIRMATION_REQUIRED
```

Правила:

```text
AUTO_APPLICABLE
→ backend orchestrator may authorize apply_changes immediately

CONFIRMATION_REQUIRED
→ LLM cannot call/apply changes autonomously
→ frontend must receive pending ChangeSet and user options
→ apply_changes is authorized only after explicit user choice
```

LLM не может обойти confirmation requirement выбором другого MCP tool.

Финальное применение всегда выполняется только после deterministic validation/re-validation.

MCP tools не получают прямого произвольного доступа к storage или SQL.

---

## 22. Backend API

`DECISION`

Backend stateless.

### PlanState

Минимальная структура состояния плана:

```json
{
  "tasks": []
}
```

То есть:

```text
PlanState = { tasks: Task[] }
```

`PlanState` является source of truth текущего Gantt в браузере.

Backend получает snapshot в запросе, валидирует/преобразует его и возвращает новый snapshot, но не хранит его между запросами.

### Seed

```text
GET /api/seed
```

### AI

```text
POST /api/chat
```

Conceptual request:

```json
{
  "message": "Сдвинь задачи Анны на два дня",
  "plan": {
    "tasks": []
  },
  "conversation_context": []
}
```

`conversation_context` содержит необходимую историю текущего диалога или её минимальное структурированное представление, чтобы stateless backend мог обрабатывать уточняющие ответы пользователя.

Backend:

```text
LLM
↓
MCP
↓
business logic
↓
ChangeSet
↓
build proposed final PlanState
↓
deterministic final-state validation
↓
transitive impact analysis
```

Для multi-operation requests backend валидирует итоговый proposed state целиком; промежуточные состояния отдельных операций не применяются.

Response `applied` должен включать как минимум:

```text
status = applied
human-readable message
updated PlanState
updated conversation context when required
```

Response `clarification_required` используется, когда пользовательский intent понятен, но для операции не хватает обязательных данных или запрос неоднозначен.

Он должен включать как минимум:

```text
status = clarification_required
human-readable clarification question
unchanged PlanState
updated conversation context
```

Пример:

```text
User:
"Добавь Code Review длительностью 2 дня."

Response:
status = clarification_required
message = "С какой даты начать задачу или после какой задачи её поставить?"
PlanState = unchanged
```

Response `confirmation_required` должен включать как минимум:

```text
status = confirmation_required
human-readable explanation
pending ChangeSet
available user options
affected task/dependency information for UI highlighting
updated conversation context when required
```

Pending ChangeSet хранится на frontend до выбора пользователя.

Пока существует pending ChangeSet, `/api/chat` не должен принимать новую mutation-команду для того же plan state; frontend предлагает сначала завершить `Apply` или `Cancel`.

### Import

```text
POST /api/import
```

Передаются:

```text
Excel
mode
date constraint
current PlanState when required
```

### Change confirmation

```text
POST /api/changesets/apply
```

Передаются:

```text
current PlanState
ChangeSet
user choice
```

Backend повторно валидирует итоговое состояние и возвращает обновлённый `PlanState`.

Сам факт наличия ранее подготовленного ChangeSet не является основанием доверять ему без повторной проверки.

### Export

```text
POST /api/export
```

Поскольку backend stateless, актуальный PlanState передаётся браузером.

---

## 23. Excel export

`DECISION`

Экспортируется текущий snapshot после всех изменений.

Колонки:

```text
ID
задача
описание
исполнитель
длительность
дата начала
дата окончания
предшественники
```

В `ID`:

```text
TASK-NNN
```

UUID не экспортируется.

Predecessors экспортируются человекочитаемыми названиями.

Экспорт можно использовать как обычный план задач с рассчитанными датами для передачи руководителю или другим участникам процесса.

### Re-import of exported files in MVP

Экспортированный приложением файл можно снова подать на обычный import, потому что в нём сохраняются обязательные пять source columns.

Дополнительные колонки:

```text
ID
дата начала
дата окончания
```

в MVP при повторном импорте не восстанавливают прежнюю идентичность задачи и рассчитанное расписание.

То есть при re-import:

```text
required five columns are parsed
extra export columns may be ignored
new TASK-ID values are generated
dates are calculated again using normal import rules
```

Полноценный round-trip с сохранением TASK-ID и рассчитанных дат относится к Roadmap.

---

## 24. Frontend stack

`DECISION`

```text
React
TypeScript
Vite
Frappe Gantt
```

Frappe Gantt используется как visualization layer.

Он **не является source of truth scheduling logic**.

Для MVP прямое изменение дат задач через drag/resize на Gantt отключается.

Концептуальная конфигурация:

```text
readonly dates = true
automatic dependency movement = false
```

В частности, библиотека не должна самостоятельно переносить dependent tasks (`move_dependencies = false` или эквивалент для используемой версии).

Интерактивность Gantt в MVP включает:

```text
scroll / navigation
zoom or view scale where supported
task selection
dependency visualization
task modal opening
immediate re-render after approved backend changes
impact highlighting
automatic scroll to plan start for seed/reset
```

Все изменения расписания выполняются через AI/import flows и deterministic backend validation.

Отдельный global state framework для MVP не требуется.

---

## 25. Backend stack

`DECISION`

```text
Python
FastAPI
Pydantic
Uvicorn

openpyxl
defusedxml
python-multipart

official MCP Python SDK

OpenAI Python client

pytest
httpx
```

Pandas не требуется.

---

## 26. LLM

`DECISION`

Primary candidate:

```text
Qwen 3.6-35B-A3B
```

через Yandex AI Studio.

API:

```text
OpenAI-compatible Responses API
```

Модель конфигурируется через environment variable, а не hardcode.

Conceptually:

```text
AI_MODEL=<configured model>
```

Автоматический multi-model fallback в MVP не требуется.

---

## 27. Architecture

`DECISION`

```text
Browser
│
├─ React
├─ Gantt
├─ localStorage
└─ AI UI
      │
      ▼
FastAPI
      │
      ├─ Excel service
      ├─ Scheduling / domain rules
      ├─ ChangeSet / validation
      │
      └─ LLM orchestration
              │
              ▼
            LLM
              │
              ▼
         MCP Client
              │
              ▼
         MCP Server
              │
              ▼
        Business Logic
```

MCP не заменяет FastAPI.

React не общается с MCP напрямую.

---

## 28. Deployment

`DECISION`

Приложение поставляется одним Docker image.

Build:

```text
React source
↓
Vite build
↓
static frontend
↓
copied into Docker image
↓
FastAPI serves frontend + /api
```

Hosting:

```text
Yandex Container Registry
↓
Yandex Serverless Containers
```

LLM:

```text
Yandex AI Studio
```

Для reviewer:

```text
one public application URL
public unauthenticated access to the demo application
```

Deployment configuration должна позволять проверяющему открыть приложение по ссылке без Yandex Cloud IAM-аутентификации.

---

## 29. Secrets

`DECISION`

API credentials никогда не находятся:

```text
frontend
localStorage
Git repository
```

Используются backend environment variables.

В repository:

```text
.env.example
```

Actual `.env`:

```text
.gitignore
```

---

## 30. Repository structure

`DECISION`

```text
ai-gantt-planner/
│
├─ frontend/
│  ├─ src/
│  └─ package.json
│
├─ backend/
│  ├─ app/
│  │  ├─ api/
│  │  ├─ domain/
│  │  ├─ services/
│  │  ├─ mcp/
│  │  ├─ ai/
│  │  └─ seed/
│  │
│  └─ tests/
│
├─ sample/
│  └─ sample_tasks.xlsx
│
├─ docs/
│  └─ ROADMAP_TO_PRODUCTION.md
│
├─ demo/
│
├─ .env.example
├─ .gitignore
├─ Dockerfile
├─ docker-compose.yml
└─ README.md
```

---

## 31. Automated tests

`DECISION`

Минимум необходимо проверить:

```text
working-day calculations
weekend skipping

valid dependencies
unknown predecessor
self-reference
cycle detection

valid ChangeSet
conflicting ChangeSet
atomic application

Excel structural validation
.xlsx-only / active-worksheet handling
Excel graph validation
Append duplicate-name validation

TASK-ID generation
create_task placement clarification
clarification_required flow
pending ChangeSet mutation blocking
apply_changes confirmation guard
no implicit successor pull-forward
final-state batch validation
transitive downstream impact propagation
create_task predecessor-only placement calculation
create_task explicit-date + predecessor placement calculation
Excel attachment uses deterministic import path without LLM parsing
consolidated import impact preview
```

AI response wording не должен быть основным объектом unit tests.

Тестировать нужно прежде всего deterministic system behavior.

---

## 32. Sample Excel and demo scenario

`SOURCE REQUIREMENT + DECISION`

### Sample Excel

`sample/sample_tasks.xlsx` должен быть содержательным демонстрационным планом, а не набором `Task 1 / Task 2`.

Он должен включать как минимум:

```text
multiple assignees
parallel tasks
a dependency chain
at least one task with multiple predecessors
enough tasks to demonstrate mass AI operations
```

Названия задач и зависимости должны быть человекочитаемыми и пригодными для demo-команд.

Sample должен успешно проходить тот же production import flow, что и пользовательский файл.

### Demo

Demo должно обязательно показать исходную цепочку:

```text
Excel upload
→
chat edit
→
export
```

Рекомендуемый полноценный сценарий:

```text
1. открыть приложение;
2. показать seeded Gantt;
3. импортировать sample Excel;
4. выбрать import mode/date;
5. увидеть обновлённый Gantt;
6. дать AI массовую natural-language команду;
7. показать immediate valid change;
8. дать команду, создающую dependency impact;
9. показать preview/confirmation;
10. подтвердить;
11. открыть task modal;
12. экспортировать Excel.
```

---

## 33. README requirements

`SOURCE REQUIREMENT`

README должен содержать как минимум:

```text
Product overview
Deployed application
Demo
Architecture
Stack
Local run
Excel format
AI/MCP design
Key decisions
Known MVP limitations
AI assistant usage
Roadmap to production
```

Отдельный раздел об использовании AI-ассистентов обязателен исходными требованиями.

Рекомендуемая прозрачная формулировка:

> AI-ассистенты использовались для реализации отдельных компонентов, scaffolding, code review, тестов и документации. Архитектура, бизнес-правила, системная модель и границы MVP были определены и зафиксированы до основной реализации.

Не требуется упоминать внутренние рабочие чаты.

---

## 34. Explicit MVP non-goals

`DECISION`

В MVP **не реализовывать**:

```text
database
authentication
roles/access control

multiple workspaces
project portfolio

resource capacity planning
employee directory

status / progress %
priority
tags
comments
attachments
task hierarchy

milestones

SS / FF / SF dependencies
lag / lead

holiday calendar

automatic resource leveling
AI project optimization

editable task modal

AI-generated dependencies without request
AI automatic management decisions

complex CI/CD
Terraform
Kubernetes
Redis
Celery
LangChain/LangGraph
```

Если реализация начинает двигаться в эти области — это scope creep.

---

## 35. Roadmap to production

`ROADMAP`

Roadmap должен быть отдельным документом и честно описывать сознательно оставленные ограничения.

### Priority 1 — Production persistence & access

```text
server-side persistence
database
user accounts
authentication
authorization
separate user workspaces
```

### Priority 2 — Safety & audit

```text
plan versioning
change history
AI action audit
rollback
concurrency control
rate limiting
cost controls
production secret management
```

### Priority 3 — Scheduling maturity

```text
configurable calendar
holidays
optional calendar-day durations

SS
FF
SF
lag / lead
```

### Priority 4 — Excel lifecycle

```text
stable external IDs

repeat import of exported files
without losing TASK-ID
and calculated dates

optional input start-date column

more advanced duplicate resolution
```

### Priority 5 — AI-assisted normalization

LLM may propose corrections for:

```text
duplicate human-readable names
different descriptions under same name
nonstandard predecessor separators
human-written predecessor expressions
```

Always:

```text
proposal
→
preview
→
user confirmation
```

### Priority 6 — Advanced AI planning

Future agent may:

```text
propose schedule optimization
propose dependencies
consider resource capacity
suggest assignments
```

It must remain suggestion-first.

### Priority 7 — Project-document intake

Future flow:

```text
BRD / specification / project document
↓
LLM decomposition
↓
proposed tasks
↓
preview
↓
user confirmation
↓
Gantt
```

Potentially later:

```text
document connectors / links
```

### Priority 8 — Delivery maturity

```text
CI/CD
automated deploy
monitoring
structured logging
alerts
production observability
```

---

## 36. Main risks

`ROADMAP / RISK`

### LLM interpretation error

Mitigation:

```text
restricted MCP tools
deterministic validation
no direct DB access
clarification on ambiguity
```

### AI creates technically valid but unwanted management decision

Mitigation:

```text
impact preview
explicit confirmation
```

### Excel ambiguity

Mitigation MVP:

```text
strict deterministic contract
unique task names
atomic validation
```

### localStorage loss

Accepted MVP limitation.

Production solution:

```text
server-side persistence
```

### No authentication on public demo

Accepted demo limitation.

Before real production:

```text
auth
rate limits
abuse protection
LLM cost protection
```

### AI provider/model lifecycle

Mitigation:

```text
provider interaction behind client layer
model selected by configuration
not hardcoded into domain logic
```

---

## 37. Technical implementation freedom

`OPEN — implementation detail only`

Эти пункты **не являются открытыми продуктовыми вопросами** и могут быть решены исполнителем после проверки актуальных SDK:

```text
exact MCP transport/wiring
exact package versions
exact Qwen model identifier used by Yandex endpoint
component/file naming below agreed architectural boundaries
visual polish details
```

Но ограничения обязательны:

> MCP должен реально участвовать в AI tool execution path.

Нельзя заменить его прямыми вызовами Python-функций, оставив «MCP» только в названии папки.

---

## 38. Definition of Done

MVP считается готовым только если одновременно выполнено:

```text
✓ public deployed app opens without reviewer IAM authentication
✓ seeded Gantt appears immediately and is scrolled to the seed plan start
✓ seed can be restored
✓ reset clears pending ChangeSet, conversation context and impact highlighting
✓ state survives page reload
✓ stateless AI clarification flow works across multiple chat messages
✓ clarification_required keeps PlanState unchanged
✓ create_task without placement asks for placement instead of inventing a date
✓ predecessor-only create_task placement starts after the latest predecessor
✓ explicit-date + predecessor placement combines both constraints deterministically
✓ relative scheduling phrases use working-day semantics and ambiguous calendar phrases are clarified

✓ sample Excel imports
✓ malformed Excel produces readable errors
✓ append and replace modes work
✓ Append rejects duplicate names across current + incoming plan
✓ only .xlsx active worksheet is imported in MVP
✓ import impacts are shown in one consolidated preview
✓ Excel attached through AI panel uses the same deterministic import flow and is not parsed by the LLM
✓ dependencies resolve correctly

✓ natural-language chat works
✓ move tasks works
✓ dependency modification works
✓ task creation works
✓ TASK-ID generation follows fixed Replace/Append/AI rules
✓ rename preserves unique task names
✓ reassignment works
✓ mass operation works

✓ MCP is genuinely used
✓ LLM reads current plan data through MCP tools rather than receiving the full plan directly as prompt context
✓ deterministic validation blocks invalid state
✓ batch changes are validated against one proposed final PlanState, not temporary intermediate states
✓ cycle detection works
✓ dependency impacts propagate transitively through the full affected downstream chain
✓ dependency impacts require confirmation
✓ multi-change ChangeSet remains fully unapplied until user decision when any conflict/impact requires confirmation
✓ pending ChangeSet blocks other plan mutations until Apply/Cancel/Reset
✓ LLM cannot bypass confirmation and authorize apply_changes itself
✓ predecessor conflicts offer safe options without silently moving predecessor
✓ removing dependencies / shortening predecessors does not pull successors earlier automatically
✓ weekend dates normalize to the next working day with visible preview
✓ Gantt does not directly mutate schedule through drag/automatic dependency movement
✓ Gantt updates after applied changes

✓ task modal works

✓ enriched Excel export works
✓ exported file opens correctly
✓ exported file can be re-imported through the normal MVP import contract

✓ repository contains no secrets
✓ local startup instructions work
✓ Docker build works

✓ README complete
✓ AI usage section present
✓ sample Excel committed
✓ demo video/GIF present
✓ Roadmap to production present

✓ mandatory React / FastAPI / MCP / LLM stack is real,
  not decorative
```

---

## 39. Recommended implementation sequence

Эту последовательность следует использовать как основной порядок реализации:

```text
01. Repository + basic React/FastAPI skeleton

02. Task domain model

03. Working-day scheduling

04. Dependency graph + cycle validation

05. Seed PlanState

06. Excel import + validation + .xlsx/active-worksheet contract

07. ChangeSet + final-state batch validation + transitive impact analysis + pending lifecycle

08. MCP server/tools

09. LLM + Qwen integration

10. /api/chat orchestration + clarification_required / final-state validation / apply authorization

11. React Gantt

12. AI assistant UI + frontend conversation context

13. conflict/confirmation UI + pending ChangeSet state

14. task modal

15. Excel export

16. localStorage + restore seed + reset state cleanup

17. integration tests

18. Docker deployment + public unauthenticated demo access

19. deployed end-to-end QA

20. sample Excel

21. demo recording

22. README

23. Roadmap to production

24. final requirement audit
```

---

## 40. Implementation status

**Master Brief v1.3 is approved for implementation.**

Implementation should follow this document as the main source of truth.

The original source requirements should remain available alongside it for final completeness checks. If implementation discovers a conflict between this brief and the original source requirements, the conflict must be surfaced explicitly rather than silently resolved.

**v1.3 is the final pre-implementation baseline.** Product or business behavior must not be changed during implementation without explicit approval; technical implementation details may vary only within the boundaries defined in this brief.
