const ru = {
  common: {
    currency: '₽',
    today: 'Сегодня',
    yesterday: 'Вчера',
    save: 'Сохранить',
    cancel: 'Отменить',
    delete: 'Удалить',
    edit: 'Изменить',
    add: 'Добавить',
    next: 'Далее',
    back: 'Назад',
    done: 'Готово',
    loading: 'Загрузка...',
    error: 'Ошибка',
    retry: 'Повторить',
  },
  dashboard: {
    title: 'PFM Bot',
    safeToSpend: 'Сегодня можно потратить',
    periodLeft: 'Осталось {days} дн.',
    addExpense: '+ Внести расход',
    spentToday: 'Потрачено сегодня',
    focusDebt: 'Цель лавины',
    remaining: 'Остаток',
    extraThisPeriod: 'Досрочно в этом периоде',
    emergencyFund: 'Подушка безопасности',
    overspent: 'Перерасход',
    deficit: 'Дефицит бюджета',
  },
  onboarding: {
    welcome: 'Добро пожаловать в PFM Bot!',
    welcomeDesc: 'Узнайте, сколько вы можете безопасно тратить каждый день',
    incomeTitle: 'Ваш доход',
    incomeAmount: 'Сколько получаете?',
    incomePayday: 'Когда зарплата?',
    obligationsTitle: 'Обязательные расходы',
    debtsTitle: 'Кредиты и долги',
    debtsQuestion: 'Есть кредиты или долги?',
    efTitle: 'Подушка безопасности',
    efQuestion: 'Сколько отложено на чёрный день?',
    resultTitle: 'Ваш Safe to Spend',
    resultDesc: 'Вот сколько вы можете безопасно тратить каждый день',
  },
  debts: {
    title: 'Долги',
    focusBadge: 'Цель лавины',
    apr: 'Ставка',
    minPayment: 'Мин. платёж',
    balance: 'Остаток',
    paidOff: 'Погашен',
    addDebt: 'Добавить долг',
    avalanchePlan: 'План погашения',
  },
  settings: {
    title: 'Настройки',
    notifications: 'Уведомления',
    morningNotify: 'Утренний S2S',
    eveningReminder: 'Вечернее напоминание',
    paymentAlerts: 'Алерты платежей',
    plan: 'Тарифный план',
    free: 'FREE',
    pro: 'PRO',
    deleteAccount: 'Удалить аккаунт',
    godMode: 'Режим бога',
  },
  bot: {
    welcome: '👋 Привет! Я PFM Bot — помогу контролировать расходы и выбраться из долгов.',
    openApp: 'Открыть PFM',
    todayS2S: '💰 Сегодня можно потратить: {amount}',
    help: 'PFM Bot — персональный финансовый менеджер.\n\nОткройте Mini App, чтобы начать.',
  },
} as const;

const en = {
  common: {
    currency: '$',
    today: 'Today',
    yesterday: 'Yesterday',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    next: 'Next',
    back: 'Back',
    done: 'Done',
    loading: 'Loading...',
    error: 'Error',
    retry: 'Retry',
  },
  dashboard: {
    title: 'PFM Bot',
    safeToSpend: 'Safe to spend today',
    periodLeft: '{days} days left',
    addExpense: '+ Add expense',
    spentToday: 'Spent today',
    focusDebt: 'Avalanche target',
    remaining: 'Remaining',
    extraThisPeriod: 'Extra this period',
    emergencyFund: 'Emergency fund',
    overspent: 'Overspent',
    deficit: 'Budget deficit',
  },
  onboarding: {
    welcome: 'Welcome to PFM Bot!',
    welcomeDesc: 'Find out how much you can safely spend each day',
    incomeTitle: 'Your income',
    incomeAmount: 'How much do you earn?',
    incomePayday: 'When is payday?',
    obligationsTitle: 'Fixed expenses',
    debtsTitle: 'Loans & debts',
    debtsQuestion: 'Do you have any loans or debts?',
    efTitle: 'Emergency fund',
    efQuestion: 'How much do you have saved for emergencies?',
    resultTitle: 'Your Safe to Spend',
    resultDesc: "Here's how much you can safely spend each day",
  },
  debts: {
    title: 'Debts',
    focusBadge: 'Avalanche target',
    apr: 'APR',
    minPayment: 'Min. payment',
    balance: 'Balance',
    paidOff: 'Paid off',
    addDebt: 'Add debt',
    avalanchePlan: 'Payoff plan',
  },
  settings: {
    title: 'Settings',
    notifications: 'Notifications',
    morningNotify: 'Morning S2S',
    eveningReminder: 'Evening reminder',
    paymentAlerts: 'Payment alerts',
    plan: 'Plan',
    free: 'FREE',
    pro: 'PRO',
    deleteAccount: 'Delete account',
    godMode: 'God mode',
  },
  bot: {
    welcome: "👋 Hi! I'm PFM Bot — I'll help you control spending and get out of debt.",
    openApp: 'Open PFM',
    todayS2S: '💰 Safe to spend today: {amount}',
    help: 'PFM Bot — your personal finance manager.\n\nOpen the Mini App to get started.',
  },
} as const;

export type Locale = 'ru' | 'en';

type DeepStringRecord = { readonly [key: string]: string | DeepStringRecord };
export type Translations = DeepStringRecord;

const dictionaries: Record<Locale, Translations> = { ru, en };

export function t(locale: Locale, path: string, vars?: Record<string, string | number>): string {
  const keys = path.split('.');
  let value: unknown = dictionaries[locale];
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return path;
    }
  }
  if (typeof value !== 'string') return path;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export { ru, en };
