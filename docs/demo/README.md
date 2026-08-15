# Demo recording slot

Финальный media artifact должен показывать настоящую production-версию, а не
fake provider или локальный mocked response.

- Production URL:
  `https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/`
- Sample workbook: [`../../sample/sample_tasks.xlsx`](../../sample/sample_tasks.xlsx)
- Intended media path: `docs/demo/ai-gantt-demo.mp4`
- Целевая длительность: 30–60 секунд.

## Human recording script

Перед записью откройте production URL в чистом browser profile либо нажмите
«Восстановить демо-данные». Убедитесь, что browser zoom равен 100% и окно
показывает Gantt и AI panel без персональных данных или cloud console.

1. На 2–3 секунды покажите seeded interactive Gantt.
2. Через меню Excel выберите импорт и загрузите `sample/sample_tasks.xlsx`.
3. Выберите Replace, задайте дату начала `2026-09-07` и подтвердите import.
4. Покажите обновлённый Gantt с параллельными ветками и dependency edges.
5. Откройте AI panel и отправьте реальному Qwen команду:
   `Сдвинь все задачи Анны на 2 рабочих дня.`
6. Покажите consolidated preview затронутых задач и нажмите Apply.
7. Через меню Excel экспортируйте актуальный plan и покажите успешную загрузку
   `.xlsx` browser'ом.

Если модель попросит уточнение из-за изменённого состояния предыдущей попытки,
восстановите чистый Replace import и повторите команду. Не монтируйте fake
response поверх UI. В финальном коротком ролике должны остаться непрерывные
Excel upload → chat edit → export и видимое изменение Gantt.

## Publication checklist

- URL в address bar соответствует production URL выше.
- AI-ответ получен от реального production provider.
- В кадре нет API keys, `.env`, cloud console или локальных путей пользователя.
- Импортирован именно committed sample workbook в Replace mode.
- Видны preview и результат Apply.
- Экспортированный файл действительно скачан.
- Media сохранено по intended path и открывается после clone репозитория.

До добавления реальной записи этот artifact отмечается как `HUMAN PENDING` в
submission checklist.
