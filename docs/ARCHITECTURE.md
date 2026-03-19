# PFM Bot — Architecture Document v1.0

> **Status:** In development. Architecture + UI mockup approved.
> **Date:** 2026-03-19

---

## 1. Product Overview

**PFM** (Personal Finance Manager) — Telegram Mini App, помогающий пользователям выбраться из долгов, не «питаясь гречкой». Ключевая метрика продукта — **S2S (Safe to Spend)**: сколько денег можно безопасно потратить сегодня, при этом ускоренно погашая долги и формируя подушку безопасности.

### Ключевое обещание

Пользователь за первые 3 минуты получает конкретную цифру: «Сегодня можно потратить X ₽». Каждый день эта цифра обновляется. Каждый введённый расход пересчитывает лимит в реальном времени.

### Core Scenarios

**Должник** — человек с кредитами/долгами, который не понимает, как из них выбраться. Вводит доходы, долги, обязательные расходы. Получает дневной лимит и план ускоренного погашения (Avalanche).

**Бюджетник** — человек без долгов, который хочет контролировать траты и копить. Пользуется S2S как ежедневным бюджетом.

### Целевые рынки

- Россия (RUB, русский язык)
- США (USD, английский язык)

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Telegram Clients                      │
│       (Mini App WebApp + Bot DMs + Push notifications)    │
└───────────────┬──────────────────────┬────────────────────┘
                │                      │
                │ HTTPS                │ Telegram Bot API
                ▼                      ▼
┌──────────────────────┐    ┌─────────────────────┐
│   apps/web           │    │   apps/bot           │
│   Next.js 14 :3000   │    │   Telegraf 4.16      │
│   MiniApp.tsx        │    │   Long polling       │
└──────────┬───────────┘    └──────────┬────────────┘
           │ fetch (X-TG-INIT-DATA)     │ HTTP (X-INTERNAL-KEY)
           ▼                            ▼
┌──────────────────────────────────────────────────────────┐
│                   apps/api  :3002                         │
│                   Express 4.x + TypeScript                │
│                                                          │
│  /public/*   (no auth, landing/sharing)                  │
│  /tg/*       (X-TG-INIT-DATA HMAC)                      │
│  /internal/* (X-INTERNAL-KEY)                            │
│  /cron/*     (internal scheduled jobs)                   │
└──────────────────────────┬───────────────────────────────┘
                           │ Prisma ORM
                           ▼
               ┌───────────────────────┐
               │  PostgreSQL 16        │
               │  packages/db schema   │
               └───────────────────────┘
```

> Порт API — 3002, чтобы не конфликтовать с Wishlist API (3001) на том же сервере.

---

## 3. Financial Engine — S2S (Safe to Spend)

### 3.1 Период расчёта

Период определяется датами выплат (`paydays[]`), **не** календарным месяцем.

**Одна выплата (payday = [15]):**
```
Период: 15-е текущего → 15-е следующего месяца
days_total = количество дней в периоде
days_left = дней до следующей выплаты (включая сегодня)
```

**Две выплаты (paydays = [5, 20]):**
```
Подпериод A: 5-е → 20-е (income_a)
Подпериод B: 20-е → 5-е (income_b)
Каждый подпериод считается независимо со своим income и obligations
```

**Старт посреди периода:**
Если пользователь начинает 22-го, а payday = [15]:
```
days_remaining = 15 (следующего месяца) - 22 (сегодня) = 23 дня
obligations_prorated = obligations_monthly * (days_remaining / days_in_full_period)
ef_contribution_prorated = ef_target_monthly * (days_remaining / days_in_full_period)
```

### 3.2 Формула S2S

```
┌─────────────────────────────────────────────────────┐
│                   INCOME (period)                    │
│  = sum(all income sources for this pay period)       │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              ОБЯЗАТЕЛЬНЫЕ ВЫЧЕТЫ                     │
│                                                      │
│  obligations    = аренда + ЖКХ + подписки + конверты │
│  debt_payments  = sum(min_payment для каждого долга)  │
│  avalanche_pool = доп. погашение дорогого долга       │
│  ef_contrib     = вклад в подушку безопасности        │
│  reserve        = 10% буфер (fallback 0-5%)          │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  residual = income - obligations - debt_payments     │
│            - avalanche_pool - ef_contrib - reserve   │
│                                                      │
│  s2s_period = max(0, residual)                       │
│  s2s_daily  = s2s_period / days_left                 │
│                                                      │
│  s2s_today  = s2s_daily - sum(expenses_today)        │
│                                                      │
│  if s2s_today < 0:                                   │
│    status = OVERSPENT                                │
│    carry_deficit → уменьшить s2s_daily на остаток    │
│                    оставшихся дней периода            │
│                                                      │
│  if residual < 0:                                    │
│    status = DEFICIT                                  │
│    s2s = 0                                           │
│    показать предупреждение о кассовом разрыве        │
└─────────────────────────────────────────────────────┘
```

### 3.3 Avalanche (ускоренное погашение)

Стратегия вшита в MVP, не выбирается пользователем.

```
Правила:
1. Найти долг с максимальным APR
2. При равных APR — выбрать с меньшим остатком
3. Этот долг = "focus debt" (цель лавины)
4. Свободный пул (invest_pool) направляется на него

Условия активации:
- Если EF < 3 месяцев обязательных расходов → invest_pool = 0
  (сначала подушка)
- Если есть долг с APR ≥ 18% → invest_pool → avalanche_pool
  (инвестиции ждут, долги горят)

Когда focus debt погашен:
- Выбрать следующий по APR
- Пересчитать plan
```

### 3.4 Emergency Fund (подушка безопасности)

```
ef_target = obligations_monthly * 3  (3 месяца обязательных)
ef_current = текущий баланс подушки (вводит пользователь)

if ef_current < ef_target:
  ef_monthly_contribution = рассчитывается из свободного остатка
  invest_pool = 0  (пока подушка не набрана)
else:
  ef_monthly_contribution = 0
  invest_pool = свободный остаток для avalanche или накоплений
```

### 3.5 Reserve (буфер периода)

```
reserve_rate = 0.10  (10% от residual)

if residual * 0.10 делает s2s_daily < comfortable_threshold:
  reserve_rate = 0.05  (снижаем до 5%)
if даже 5% ломает бюджет:
  reserve_rate = 0.00  (резерв = 0, живём без запаса)
```

### 3.6 Carry-over при перерасходе

```
Если сегодня потрачено больше лимита:
  deficit = expenses_today - s2s_daily
  remaining_days = days_left - 1

  if remaining_days > 0:
    new_s2s_daily = (s2s_period_remaining - deficit) / remaining_days
  else:
    // Последний день периода, перерасход → ноль на этот день
    new_s2s_daily = 0
```

---

## 4. Data Model

### 4.1 Enums

```prisma
enum Currency {
  RUB
  USD
}

enum DebtType {
  CREDIT          // Потребительский кредит
  MORTGAGE        // Ипотека
  CREDIT_CARD     // Кредитная карта
  CAR_LOAN        // Автокредит
  PERSONAL_LOAN   // Займ у физлица
  OTHER           // Прочее
}

enum IncomeFrequency {
  MONTHLY         // Ежемесячный
  BIWEEKLY        // Раз в 2 недели
  WEEKLY          // Еженедельный
  IRREGULAR       // Нерегулярный
}

enum ObligationType {
  RENT            // Аренда
  UTILITIES       // ЖКХ / коммуналка
  SUBSCRIPTION    // Подписки
  TELECOM         // Связь / интернет
  INSURANCE       // Страховки
  ENVELOPE        // Конверт (редкие обязательные)
  OTHER           // Прочее
}

enum PeriodStatus {
  ACTIVE          // Текущий активный период
  COMPLETED       // Завершённый
  DEFICIT         // Дефицит (residual < 0)
}

enum ExpenseSource {
  MANUAL          // Ручной ввод
  IMPORT          // Автоимпорт (Pro, будущее)
}

enum SubscriptionStatus {
  ACTIVE
  CANCELLED
  EXPIRED
}
```

### 4.2 Core Models

```prisma
model User {
  id              String    @id @default(cuid())
  telegramId      String?   @unique
  telegramChatId  String?
  firstName       String?
  godMode         Boolean   @default(false)
  onboardingDone  Boolean   @default(false)
  timezone        String    @default("Europe/Moscow")
  locale          String    @default("ru")
  primaryCurrency Currency  @default(RUB)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  profile         UserProfile?
  incomes         Income[]
  obligations     Obligation[]
  debts           Debt[]
  periods         Period[]
  expenses        Expense[]
  emergencyFund   EmergencyFund?
  subscription    Subscription?
  paymentEvents   PaymentEvent[]
  settings        UserSettings?
}

model UserProfile {
  id              String    @id @default(cuid())
  userId          String    @unique
  displayName     String?
  avatarUrl       String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model UserSettings {
  id                    String   @id @default(cuid())
  userId                String   @unique
  morningNotifyTime     String   @default("09:00")  // HH:mm
  eveningNotifyTime     String   @default("21:00")  // HH:mm
  morningNotifyEnabled  Boolean  @default(true)
  eveningNotifyEnabled  Boolean  @default(true)
  paymentAlerts         Boolean  @default(true)
  deficitAlerts         Boolean  @default(true)
  weeklyDigest          Boolean  @default(false)     // Pro
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 4.3 Income & Obligations

```prisma
model Income {
  id          String           @id @default(cuid())
  userId      String
  title       String           // "Основная ЗП", "Фриланс", "Аренда"
  amount      Int              // в копейках/центах
  currency    Currency         @default(RUB)
  frequency   IncomeFrequency  @default(MONTHLY)
  paydays     Int[]            // [15] или [5, 20] — дни месяца
  isActive    Boolean          @default(true)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Obligation {
  id          String          @id @default(cuid())
  userId      String
  title       String          // "Аренда квартиры", "Netflix"
  type        ObligationType
  amount      Int             // в копейках/центах
  currency    Currency        @default(RUB)
  dueDay      Int?            // день месяца, когда списывается
  isActive    Boolean         @default(true)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 4.4 Debts

```prisma
model Debt {
  id              String    @id @default(cuid())
  userId          String
  title           String    // "Тинькофф кредитка", "Ипотека Сбер"
  type            DebtType
  balance         Int       // остаток долга в копейках/центах
  originalAmount  Int?      // изначальная сумма
  apr             Float     // годовая процентная ставка (0.18 = 18%)
  minPayment      Int       // минимальный ежемесячный платёж
  currency        Currency  @default(RUB)
  dueDay          Int?      // день месяца платежа
  isFocusDept     Boolean   @default(false)  // текущая цель лавины
  isPaidOff       Boolean   @default(false)
  paidOffAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  payments        DebtPayment[]
}

model DebtPayment {
  id          String   @id @default(cuid())
  debtId      String
  amount      Int      // сколько заплатили
  isExtra     Boolean  @default(false)  // сверх минимального (avalanche)
  paidAt      DateTime @default(now())

  debt        Debt     @relation(fields: [debtId], references: [id], onDelete: Cascade)
}
```

### 4.5 Periods & Expenses

```prisma
model Period {
  id                String       @id @default(cuid())
  userId            String
  startDate         DateTime     // начало периода
  endDate           DateTime     // конец периода (следующий payday)
  totalIncome       Int          // доход на период
  totalObligations  Int          // обязательные расходы
  totalDebtPayments Int          // платежи по долгам (мин + avalanche)
  efContribution    Int          // вклад в подушку
  reserve           Int          // буфер
  s2sPeriod         Int          // safe to spend на весь период
  s2sDaily          Int          // дневной лимит (пересчитывается)
  status            PeriodStatus @default(ACTIVE)
  daysTotal         Int
  currency          Currency     @default(RUB)
  isProratedStart   Boolean      @default(false)
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  expenses          Expense[]
  dailySnapshots    DailySnapshot[]

  @@index([userId, status])
}

model Expense {
  id          String        @id @default(cuid())
  userId      String
  periodId    String
  amount      Int           // в копейках/центах
  currency    Currency      @default(RUB)
  note        String?       // опциональная заметка
  source      ExpenseSource @default(MANUAL)
  spentAt     DateTime      @default(now())  // когда потрачено
  createdAt   DateTime      @default(now())

  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  period      Period        @relation(fields: [periodId], references: [id], onDelete: Cascade)

  @@index([periodId, spentAt])
}

model DailySnapshot {
  id            String   @id @default(cuid())
  periodId      String
  date          DateTime // день (без времени)
  s2sPlanned    Int      // сколько было можно
  s2sActual     Int      // сколько осталось после расходов
  totalExpenses Int      // сумма расходов за день
  isOverspent   Boolean  @default(false)
  createdAt     DateTime @default(now())

  period        Period   @relation(fields: [periodId], references: [id], onDelete: Cascade)

  @@unique([periodId, date])
}
```

### 4.6 Emergency Fund

```prisma
model EmergencyFund {
  id              String   @id @default(cuid())
  userId          String   @unique
  currentAmount   Int      @default(0)  // текущий баланс подушки
  targetMonths    Int      @default(3)  // цель в месяцах обязательных
  currency        Currency @default(RUB)
  updatedAt       DateTime @updatedAt

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 4.7 Billing

```prisma
model Subscription {
  id                String             @id @default(cuid())
  userId            String             @unique
  planCode          String             @default("PRO")
  status            SubscriptionStatus @default(ACTIVE)
  starsPrice        Int
  telegramChargeId  String?
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  cancelledAt       DateTime?
  cancelAtPeriodEnd Boolean            @default(false)
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  user              User               @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model PaymentEvent {
  id                        String   @id @default(cuid())
  userId                    String
  subscriptionId            String?
  telegramPaymentChargeId   String   @unique
  totalAmount               Int
  currency                  String   @default("XTR")
  eventType                 String
  createdAt                 DateTime @default(now())

  user                      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

---

## 5. API Endpoints

### 5.1 Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | `{ ok: true }` |
| GET | `/health/deep` | None | DB + bot heartbeat check |

### 5.2 Telegram Routes (`/tg/*`)

**Onboarding**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/onboarding/status` | Статус онбординга (завершён/нет) |
| POST | `/tg/onboarding/income` | Шаг 1: ввод доходов и paydays |
| POST | `/tg/onboarding/obligations` | Шаг 2: ввод обязательных расходов |
| POST | `/tg/onboarding/debts` | Шаг 3: ввод долгов |
| POST | `/tg/onboarding/emergency-fund` | Шаг 4: текущая подушка |
| POST | `/tg/onboarding/complete` | Финализация: расчёт первого периода |

**Dashboard (главный экран)**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/dashboard` | S2S на сегодня, статус периода, focus debt, EF прогресс |

**Expenses**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tg/expenses` | Внести расход (amount, note?) |
| GET | `/tg/expenses/today` | Расходы за сегодня |
| GET | `/tg/expenses/period` | Расходы за текущий период |
| DELETE | `/tg/expenses/:id` | Удалить/отменить расход |

**Income**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/incomes` | Список источников дохода |
| POST | `/tg/incomes` | Добавить источник |
| PATCH | `/tg/incomes/:id` | Изменить |
| DELETE | `/tg/incomes/:id` | Удалить |

**Obligations**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/obligations` | Список обязательных расходов |
| POST | `/tg/obligations` | Добавить |
| PATCH | `/tg/obligations/:id` | Изменить |
| DELETE | `/tg/obligations/:id` | Удалить |

**Debts**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/debts` | Список долгов с focus debt |
| POST | `/tg/debts` | Добавить долг |
| PATCH | `/tg/debts/:id` | Изменить |
| DELETE | `/tg/debts/:id` | Удалить |
| POST | `/tg/debts/:id/payment` | Зафиксировать платёж по долгу |
| GET | `/tg/debts/avalanche-plan` | План лавины: порядок погашения, прогноз |

**Emergency Fund**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/emergency-fund` | Текущий статус EF |
| PATCH | `/tg/emergency-fund` | Обновить баланс EF |

**Periods**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/periods/current` | Текущий период с детализацией |
| GET | `/tg/periods/history` | История завершённых периодов |
| GET | `/tg/periods/:id/summary` | Сводка периода |
| POST | `/tg/periods/recalculate` | Принудительный пересчёт (после изменения данных) |

**Profile & Settings**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/me/profile` | Профиль + stats |
| PATCH | `/tg/me/profile` | Обновить профиль |
| GET | `/tg/me/settings` | Настройки уведомлений |
| PATCH | `/tg/me/settings` | Изменить настройки |
| DELETE | `/tg/me/account` | Удалить аккаунт |

**Billing**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tg/me/plan` | Текущий план, подписка |
| POST | `/tg/billing/pro/checkout` | Создать invoice для Telegram Stars |
| POST | `/tg/billing/pro/sync` | Проверить статус после оплаты |
| POST | `/tg/billing/subscription/cancel` | Отменить подписку (soft) |
| POST | `/tg/billing/subscription/reactivate` | Возобновить подписку |

**God Mode (dev)**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tg/me/god-mode` | Toggle god mode (whitelisted TG IDs) |

### 5.3 Internal Routes (`/internal/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/cron/morning-notify` | Утренние S2S уведомления |
| POST | `/internal/cron/evening-notify` | Вечерние напоминания ввода |
| POST | `/internal/cron/payment-alerts` | Алерты о предстоящих платежах |
| POST | `/internal/cron/period-rollover` | Автопереход на новый период |
| POST | `/internal/cron/subscription-expiry` | Истечение подписок |

---

## 6. Frontend — Screens

### 6.1 Screen State Machine

```typescript
type Screen =
  | 'loading'
  | 'error'
  | 'maintenance'
  | 'onboarding-welcome'
  | 'onboarding-income'
  | 'onboarding-obligations'
  | 'onboarding-debts'
  | 'onboarding-ef'
  | 'onboarding-result'     // первый S2S!
  | 'dashboard'             // главный экран
  | 'add-expense'           // быстрый ввод расхода
  | 'expenses-today'        // расходы за сегодня
  | 'debts'                 // список долгов + avalanche
  | 'debt-detail'           // детали долга
  | 'obligations'           // обязательные расходы
  | 'incomes'               // источники дохода
  | 'period-summary'        // сводка периода
  | 'settings'              // настройки + план + профиль
  | 'plan'                  // PRO paywall
```

### 6.2 Dashboard (главный экран)

Самый важный экран. Пользователь видит его каждый день.
**Визуал:** см. `docs/mockup.html` → вкладка "Dashboard".

```
┌──────────────────────────────────┐
│  Good morning, Dmitriy           │
│                                  │
│  ┌ Period: Mar 15 → Apr 15 ───┐ │
│  │           Day 5 of 31       │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌── S2S Card (gradient bg) ──┐ │
│  │  ○ SAFE TO SPEND TODAY      │ │
│  │                             │ │
│  │  2,847 ₽        ← green    │ │
│  │  from daily limit 3,200 ₽  │ │
│  │  ───────────────────────    │ │
│  │  Left this period  83,200 ₽│ │
│  └─────────────────────────────┘ │
│                                  │
│  [+ Add expense] [↕ Breakdown]  │
│                                  │
│  ┌── Emergency Fund ──────────┐ │
│  │  42,000 / 180,000 ₽  23%  │ │
│  │  ████░░░░░░░░░░░░░░        │ │
│  │  ~8 months to go           │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌── Debts (Avalanche) ───────┐ │
│  │  • CC Tinkoff  APR 24.9%   │ │
│  │    145,200 ₽  min 8,500    │ │
│  │  ○ Loan Sber   APR 18.9%   │ │
│  │    320,000 ₽  min 12,400   │ │
│  │  ○ MVideo      APR 0%      │ │
│  │    24,000 ₽   min 4,000    │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌── Period spending ─────────┐ │
│  │  16,800 / 99,200 ₽  17%   │ │
│  │  ██░░░░░░░░░░░░░░░░        │ │
│  └────────────────────────────┘ │
│                                  │
│  [Home] [History] [+] [Stats] [⚙]│
└──────────────────────────────────┘
```

### 6.3 Onboarding Flow

```
Welcome → Income → Obligations → Debts → EF → Result (первый S2S!)
   │         │          │           │       │         │
   │    paydays[]   obligations[]  debts[]  ef_amt    SHOW S2S
   │    sources[]                                    + celebrate!
   └── skip если уже есть данные
```

**Шаг 1 — Income:**
- Сколько получаете? (сумма)
- Когда зарплата? (дата/даты)
- Есть доп. доходы? (+ добавить)

**Шаг 2 — Obligations:**
- Аренда (если есть)
- ЖКХ
- Подписки
- + добавить свои

**Шаг 3 — Debts:**
- Есть кредиты/долги? (да/нет)
- Если да: тип, остаток, ставка, мин. платёж
- + добавить ещё

**Шаг 4 — Emergency Fund:**
- Есть подушка безопасности? (сумма или 0)

**Шаг 5 — Result:**
- Большая цифра S2S
- "Вот сколько вы можете безопасно тратить каждый день"
- Краткая сводка: план лавины, подушка, период

### 6.4 Design System

> **Визуальный прототип:** [`docs/mockup.html`](./mockup.html) — интерактивный мокап всех ключевых экранов (Dashboard, Onboarding, Add Expense, History, PRO Paywall). Открывать в браузере. **Это утверждённый дизайн для MVP.**

**Тема:** только Dark. Светлую тему не делаем.

**Акцент:** фиолетовый (premium, выделяет среди типичных зелёных/синих PFM-приложений).

```typescript
const C = {
  // Backgrounds
  bg:           '#0D0D12',    // глубокий тёмный
  bgSecondary:  '#16161F',    // навигация, панели
  surface:      '#1C1C28',    // карточки
  surfaceHover: '#22222F',    // hover
  elevated:     '#252533',    // вложенные элементы

  // Accent — фиолетовый (premium, modern)
  accent:       '#8B5CF6',    // основной фиолетовый
  accentLight:  '#A78BFA',    // светлый (текст, иконки)
  accentDim:    '#6D28D9',    // тёмный (градиенты)
  accentBg:     'rgba(139, 92, 246, 0.12)',    // фон
  accentBgStrong: 'rgba(139, 92, 246, 0.20)',  // выделенный фон
  accentGlow:   'rgba(139, 92, 246, 0.30)',    // свечение

  // Semantic — S2S color logic
  green:        '#34D399',    // S2S > 70% лимита — всё хорошо
  greenBg:      'rgba(52, 211, 153, 0.12)',
  greenDim:     '#059669',

  orange:       '#FBBF24',    // S2S 30-70% — внимание
  orangeBg:     'rgba(251, 191, 36, 0.12)',

  red:          '#F87171',    // S2S < 30% или перерасход — опасность
  redBg:        'rgba(248, 113, 113, 0.12)',

  // Text
  text:         '#F0F0F5',    // основной
  textSec:      '#8E8EA0',    // вторичный
  textTertiary: '#5C5C6F',    // третичный
  textMuted:    '#44445A',    // приглушённый (placeholder)

  // Borders
  border:       '#2A2A3C',
  borderSubtle: '#1F1F2E',
};
```

**Цветовая логика S2S:**
- Зелёный (`C.green`): S2S > 70% от дневного лимита — всё хорошо
- Оранжевый (`C.orange`): S2S 30-70% — внимание
- Красный (`C.red`): S2S < 30% или перерасход — опасность

**Ключевые UI-компоненты (из мокапа):**
- S2S Card — градиентный фон с glow-эффектом, большая цифра 48px
- Bottom Navigation — 5 табов с центральной кнопкой "+" (gradient, приподнята)
- Numpad — для быстрого ввода расходов, остаток обновляется в реальном времени
- Progress bars — для подушки безопасности и трат за период
- Debt list — с focus-dot (светящаяся точка на фокус-долге)
- Chips — для выбора paydays и валюты в онбординге
- PRO paywall — список фич + кнопка оплаты Stars

---

## 7. Notifications (Bot → Telegram)

| Время | Триггер | Сообщение |
|-------|---------|-----------|
| 09:00 | Утро (ежедневно) | `💰 Сегодня можно потратить: X ₽` |
| 21:00 | Нет расходов за день | `📝 Внеси итог дня — иначе завтра цифра будет врать` |
| За день до | Предстоящий платёж | `⚠️ Завтра платёж: Аренда — 35 000 ₽` |
| Реальное время | Перерасход дня | `🔴 Перерасход на X ₽. Завтра лимит: Y ₽` |
| Реальное время | Прогноз дыры | `⚠️ При текущем темпе до выплаты не хватит X ₽` |
| Конец периода | Сводка | `📊 Период завершён. X% дней в лимите. В подушку: Y ₽` |

---

## 8. FREE vs PRO

### 8.1 Тарифная модель

| | **FREE** | **PRO** |
|---|---|---|
| **Цена** | — | 100 Telegram Stars / месяц |
| **S2S расчёт** | Полный | Полный |
| **Количество долгов** | Без ограничений | Без ограничений |
| **Ручной ввод расходов** | Да | Да |
| **Avalanche plan** | Да | Да |
| **Подушка безопасности** | Да | Да |
| **Утренние уведомления** | Да | Да |
| **Вечерние напоминания** | Да | Да |
| **Алерты платежей** | Да | Да |
| **Сводка периода (базовая)** | Да | Да |
| | | |
| **Расширенная аналитика** | — | Графики, тренды, сравнение периодов |
| **Автоимпорт (CSV/SMS)** | — | Да (v2) |
| **Кастомное время уведомлений** | — | Да |
| **Еженедельный дайджест** | — | Да |
| **Сценарии "что если"** | — | Да (v2) |
| **Семейный доступ** | — | Да (v3) |
| **Экспорт данных** | — | Да |
| **Кастомные цели накоплений** | — | Да (v2) |
| **Приоритетная поддержка** | — | Да |

### 8.2 Дополнительные опции (отдельно от PRO)

Пока не реализуем, но закладываем в архитектуру:

| Опция | Тип | Стоимость (ориентир) |
|-------|-----|---------------------|
| Персональный аудит финансов | Разовая | 300 Stars |
| Индивидуальный план погашения | Разовая | 200 Stars |
| Разбор и оптимизация obligations | Разовая | 150 Stars |

### 8.3 Принцип монетизации

> **Не ограничиваем базовую ценность.** FREE пользователь получает полноценный S2S, все долги, лавину, подушку. PRO — это автоматизация, аналитика, удобство и продвинутые сценарии. Мы монетизируем экономию времени, а не право быть человеком с долгами.

---

## 9. Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + открыть Mini App |
| `/start <payload>` | Deep link (share, invite) |
| `/today` | Быстрый S2S на сегодня (без Mini App) |
| `/spend <amount>` | Быстрый ввод расхода из чата |
| `/help` | Справка |

---

## 10. Background Jobs

| Job | Interval | Description |
|-----|----------|-------------|
| Morning S2S notify | Daily 09:00 (по TZ пользователя) | Утреннее уведомление с S2S |
| Evening reminder | Daily 21:00 (по TZ пользователя) | Напоминание ввести расход |
| Payment alerts | Daily 10:00 | Проверка платежей на завтра |
| Period rollover | Hourly | Автозакрытие периода и открытие нового |
| Subscription expiry | Hourly | Истечение подписок |
| Daily snapshot | Daily 23:59 | Фиксация DailySnapshot для истории |

---

## 11. Repository Structure

```
pfm-bot/
├── apps/
│   ├── api/                    # Express REST API (port 3002)
│   │   └── src/
│   │       ├── index.ts        # All routes + business logic
│   │       ├── engine.ts       # S2S calculation engine
│   │       ├── avalanche.ts    # Debt avalanche logic
│   │       └── seed.ts         # Demo data
│   │
│   ├── bot/                    # Telegram Bot (Telegraf)
│   │   └── src/
│   │       └── index.ts        # Bot commands + notifications
│   │
│   └── web/                    # Next.js 14 Frontend (port 3000)
│       └── app/
│           ├── miniapp/
│           │   └── MiniApp.tsx  # Main Mini App component
│           ├── layout.tsx
│           └── page.tsx         # Landing (future)
│
├── packages/
│   ├── db/                     # Prisma schema + client
│   │   └── prisma/
│   │       └── schema.prisma
│   │
│   └── shared/                 # i18n, types, helpers
│       └── src/
│           ├── i18n.ts         # ru + en dictionaries
│           └── index.ts
│
├── docs/                       # Documentation
├── ops/                        # Watchdog, maintenance page
├── Dockerfile.api
├── Dockerfile.bot
├── Dockerfile.web
├── docker-compose.prod.yml
├── docker-compose.dev.yml
├── package.json
├── pnpm-workspace.yaml
└── .env.example
```

---

## 12. Deployment

### Docker Compose (отдельный от Wishlist)

```yaml
# docker-compose.prod.yml
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - pfm_pg_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
    networks:
      - pfm-network

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3002:3002"
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env
    networks:
      - pfm-network

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    ports:
      - "3003:3000"
    depends_on:
      - api
    env_file: .env
    networks:
      - pfm-network

  bot:
    build:
      context: .
      dockerfile: Dockerfile.bot
    depends_on:
      - api
    env_file: .env
    networks:
      - pfm-network

volumes:
  pfm_pg_data:

networks:
  pfm-network:
    driver: bridge
```

### Nginx (добавить к существующему серверу)

```nginx
server {
  listen 443 ssl;
  server_name <PFM_DOMAIN>;

  ssl_certificate     /etc/letsencrypt/live/<PFM_DOMAIN>/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/<PFM_DOMAIN>/privkey.pem;

  location /api/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:3003;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## 13. Batch Plan

### Batch 0 — Skeleton (2-3 дня)
- Инициализация monorepo (pnpm workspace)
- Prisma schema + первая миграция
- Express API skeleton с auth middleware
- Bot skeleton (Telegraf, `/start`, menu button)
- Next.js + пустой MiniApp.tsx
- Docker Compose (dev + prod)
- CI: health endpoint

### Batch 1 — Onboarding + S2S Engine (5-7 дней)
- Онбординг: 5 шагов (income → obligations → debts → EF → result)
- S2S calculation engine (engine.ts)
- Avalanche logic (avalanche.ts)
- Dashboard: главный экран с S2S
- Ввод расхода (одна сумма)
- Пересчёт S2S после расхода
- Period автосоздание

### Batch 2 — Daily Loop + Notifications (4-5 дней)
- Список расходов за сегодня
- Удаление расхода
- Carry-over при перерасходе
- DailySnapshot
- Утренние S2S уведомления
- Вечерние напоминания
- Алерты платежей

### Batch 3 — Debt Management (3-4 дня)
- Экран долгов: список, focus debt badge
- Добавление/редактирование/удаление долга
- Фиксация платежа по долгу
- Avalanche plan: прогноз погашения
- Пересчёт при погашении долга

### Batch 4 — Period Summary + Polish (3-4 дня)
- Сводка завершённого периода
- % дней в лимите
- Сколько ушло в подушку / долг
- Автопереход на новый период
- Управление incomes / obligations (CRUD)
- Настройки уведомлений

### Batch 5 — Billing + PRO (3-4 дня)
- Telegram Stars checkout flow
- Subscription model
- PRO paywall UI
- God mode
- PRO features (кастомное время уведомлений, дайджест)

### Batch 6 — Deploy + Launch (2-3 дня)
- Покупка домена
- Nginx + SSL
- Docker deploy на Timeweb
- Smoke tests
- @BotFather setup
- Soft launch

---

## 14. Key Design Decisions

**Деньги хранятся в копейках/центах (Int, не Float).** Избегаем ошибок округления. `12345` = 123.45 ₽. Конвертация в отображение на фронте.

**S2S Engine — чистая функция.** `calculateS2S(income, obligations, debts, ef, expenses, daysLeft) → S2SResult`. Без side effects, легко тестировать.

**Один файл API (как Wishlist).** Для MVP масштаба это оправдано. Engine и Avalanche вынесены в отдельные файлы, т.к. содержат сложную математику.

**Период ≠ месяц.** Вся система думает периодами (payday → payday), не календарными месяцами. Это фундаментальное отличие от 99% PFM-приложений.

**Avalanche вшита, не выбирается.** Для MVP одна стратегия. Snowball — это v2/PRO feature.

**MVP бесплатный полностью.** Монетизация после Product-Market Fit. PRO = удобство и автоматизация, а не искусственные ограничения.
