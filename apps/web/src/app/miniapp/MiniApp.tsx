'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Design Tokens ────────────────────────────────────────────────────────────

const C = {
  bg:             '#0D0D12',
  bgSecondary:    '#16161F',
  surface:        '#1C1C28',
  surfaceHover:   '#22222F',
  elevated:       '#252533',
  accent:         '#8B5CF6',
  accentLight:    '#A78BFA',
  accentDim:      '#6D28D9',
  accentBg:       'rgba(139,92,246,0.12)',
  accentBgStrong: 'rgba(139,92,246,0.20)',
  accentGlow:     'rgba(139,92,246,0.30)',
  green:          '#34D399',
  greenBg:        'rgba(52,211,153,0.12)',
  greenDim:       '#059669',
  orange:         '#FBBF24',
  orangeBg:       'rgba(251,191,36,0.12)',
  red:            '#F87171',
  redBg:          'rgba(248,113,113,0.12)',
  text:           '#F0F0F5',
  textSec:        '#8E8EA0',
  textTertiary:   '#5C5C6F',
  textMuted:      '#44445A',
  border:         '#2A2A3C',
  borderSubtle:   '#1F1F2E',
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

type Screen =
  | 'loading' | 'error'
  | 'onboarding-welcome'
  | 'onboarding-income'
  | 'onboarding-obligations'
  | 'onboarding-debts'
  | 'onboarding-ef'
  | 'onboarding-cash'
  | 'onboarding-result'
  | 'dashboard'
  | 'add-expense'
  | 'history'
  | 'debts'
  | 'settings'
  | 'emergency-fund-detail'
  | 'pro'
  | 'period-summary'
  | 'incomes'
  | 'obligations'
  | 'paydays';

type NavTab = 'dashboard' | 'history' | 'debts' | 'settings';
type S2SColor = 'green' | 'orange' | 'red';

interface TgUser { id: number; first_name: string; last_name?: string; username?: string; language_code?: string; }
interface DebtPeriodPayment { required: number; paid: number; remaining: number; status: 'PAID' | 'PARTIAL' | 'UNPAID'; }
interface Debt { id: string; title: string; apr: number; balance: number; minPayment: number; type: string; isFocusDebt: boolean; dueDay?: number | null; currentPeriodPayment?: DebtPeriodPayment | null; }
interface Expense { id: string; amount: number; note?: string; spentAt: string; }
interface DashboardData {
  onboardingDone: boolean;
  s2sToday: number; s2sDaily: number; s2sStatus: string;
  daysLeft: number; dayNumber?: number; daysTotal: number;
  periodStart: string; periodEnd: string;
  periodSpent: number; s2sPeriod: number;
  periodRemaining?: number; totalDebtPaymentsRemaining?: number;
  todayExpenses: Expense[]; todayTotal: number;
  focusDebt: Debt | null;
  debts: Debt[];
  emergencyFund: { currentAmount: number; targetAmount: number } | null;
  currency: string;
  // New fields
  cashOnHand?: number | null;
  cashAnchorAt?: string | null;
  lastIncomeDate?: string | null;
  nextIncomeDate?: string | null;
  nextIncomeAmount?: number;
  daysToNextIncome?: number | null;
  reservedUpcoming?: number;
  reservedUpcomingObligations?: number;
  reservedUpcomingDebtPayments?: number;
  windowStart?: string;
  windowEnd?: string;
  usesLiveWindow?: boolean;
}

interface PeriodSummaryData {
  id: string;
  startDate: string; endDate: string; daysTotal: number;
  s2sPeriod: number; s2sDaily: number;
  totalSpent: number; saved: number; overspentDays: number;
  currency: string;
  topExpenses: { amount: number; note?: string; spentAt: string }[];
}

interface AvalanchePlanItem {
  debtId: string; title: string; balance: number; apr: number;
  minPayment: number; isFocus: boolean; order: number;
  estimatedMonths: number; totalInterest: number;
}
interface AvalanchePlan {
  items: AvalanchePlanItem[]; totalDebt: number;
  totalMinPayments: number; estimatedDebtFreeMonths: number;
  estimatedTotalInterest: number;
}
type PayoffStatus = 'OK' | 'NO_MIN_PAYMENT' | 'PAYMENT_TOO_SMALL' | 'UNDEFINED_HORIZON' | 'PAID_OFF';
interface DebtStrategyItem {
  debtId: string; title: string; balance: number; apr: number; minPayment: number; isFocus: boolean;
  payoffStatus: PayoffStatus;
  display: { primaryAction: string; secondaryAction: string | null; forecastLabel: string | null; warningLabel: string | null };
  baseline: { estimatedMonths: number | null; totalInterest: number | null; monthlyPaymentUsed: number | null; extraPaymentUsed: number | null };
  accelerateScenarios: Array<{ extraPerMonth: number; estimatedMonths: number | null; monthsSavedVsBaseline: number | null; totalInterest: number | null; interestSavedVsBaseline: number | null; status: string }>;
}
interface DebtStrategy {
  currency: string; focusDebtId: string | null; generatedAt: string; items: DebtStrategyItem[];
  summary: { totalDebt: number; totalMinPayments: number; estimatedDebtFreeMonths: number | null; estimatedTotalInterest: number | null };
}

// ── API ──────────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

function useApi() {
  const initDataRef = useRef<string>('');
  const devMode = useRef(false);

  const api = useCallback(async (path: string, options?: RequestInit) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    };
    if (initDataRef.current) headers['X-TG-INIT-DATA'] = initDataRef.current;
    if (devMode.current) headers['X-TG-DEV'] = '12345';
    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }, []);

  return { api, initDataRef, devMode };
}

// ── Visual Viewport Hook (keyboard-aware height for Telegram iOS WebView) ────

function useVisualViewportHeight() {
  const [height, setHeight] = useState(() =>
    typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 812
  );
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(vv.height);
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return height;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: number, currency = 'RUB') {
  const sym = currency === 'USD' ? '$' : '₽';
  const n = Math.abs(amount / 100);
  const s = n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  return currency === 'USD' ? `${sym}${s}` : `${s} ${sym}`;
}

function s2sColor(s2sToday: number, s2sDaily: number): S2SColor {
  if (s2sToday <= 0 || s2sDaily <= 0) return 'red';
  const ratio = s2sToday / s2sDaily;
  if (ratio > 0.7) return 'green';
  if (ratio > 0.3) return 'orange';
  return 'red';
}

function colorOf(c: S2SColor) {
  return c === 'green' ? C.green : c === 'orange' ? C.orange : C.red;
}

function periodLabel(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const mo = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  return `${mo[s.getMonth()]} ${s.getDate()} → ${mo[e.getMonth()]} ${e.getDate()}`;
}

function groupByDay(expenses: Expense[]) {
  const map = new Map<string, Expense[]>();
  for (const e of expenses) {
    const d = new Date(e.spentAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).map(([key, items]) => ({
    key,
    date: new Date(items[0].spentAt),
    items,
    total: items.reduce((s, e) => s + e.amount, 0),
  }));
}

function dayLabel(d: Date) {
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Вчера';
  const mo = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return `${d.getDate()} ${mo[d.getMonth()]}`;
}

function debtTypeLabel(type: string) {
  const map: Record<string, string> = {
    CREDIT_CARD: 'Кредитка', CREDIT: 'Кредит', MORTGAGE: 'Ипотека',
    CAR_LOAN: 'Автокредит', PERSONAL_LOAN: 'Займ', OTHER: 'Другое',
  };
  return map[type] || type;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: 'spin 0.8s linear infinite' }} />
  );
}

function PrimaryBtn({ children, onClick, disabled, style }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: '100%', padding: '15px 0', background: disabled ? C.elevated : `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 10, color: disabled ? C.textMuted : '#fff', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', boxShadow: disabled ? 'none' : `0 4px 20px ${C.accentGlow}`, ...style }}
    >
      {children}
    </button>
  );
}

function SecondaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ width: '100%', padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', marginTop: 10 }}
    >
      {children}
    </button>
  );
}

function OnbProgress({ step, total = 5 }: { step: number; total?: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 32 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < step ? C.accent : i === step ? C.accentLight : C.elevated }} />
      ))}
    </div>
  );
}

function Card({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 16, padding: '18px 16px', marginBottom: 12, ...style }}>
      {children}
    </div>
  );
}

function ProgressBar({ value, max, color = C.accent }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 8, background: C.elevated, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${color}99, ${color})`, borderRadius: 4, transition: 'width 0.5s' }} />
    </div>
  );
}

// ── Bottom Nav ───────────────────────────────────────────────────────────────

function BottomNav({ active, onTab, onAdd }: { active: NavTab; onTab: (t: NavTab) => void; onAdd: () => void }) {
  const items: { id: NavTab | 'add'; icon: string; label: string }[] = [
    { id: 'dashboard', icon: '⊙', label: 'Главная' },
    { id: 'history', icon: '☰', label: 'История' },
    { id: 'add', icon: '+', label: '' },
    { id: 'debts', icon: '💳', label: 'Долги' },
    { id: 'settings', icon: '⚙', label: 'Ещё' },
  ];

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.bgSecondary, borderTop: `1px solid ${C.borderSubtle}`, display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', padding: '8px 0', paddingBottom: 'max(8px, env(safe-area-inset-bottom))', zIndex: 100 }}>
      {items.map((item) => {
        if (item.id === 'add') {
          return (
            <div key="add" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button
                onClick={onAdd}
                style={{ width: 52, height: 52, background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 16, color: '#fff', fontSize: 28, cursor: 'pointer', marginTop: -18, boxShadow: `0 4px 20px ${C.accentGlow}`, fontFamily: 'inherit', lineHeight: 1 }}
              >+</button>
            </div>
          );
        }
        const isActive = active === item.id;
        return (
          <button key={item.id} onClick={() => onTab(item.id as NavTab)} style={{ background: 'none', border: 'none', color: isActive ? C.accentLight : C.textMuted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 10, fontWeight: 500, fontFamily: 'inherit', padding: '4px 12px' }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Onboarding Screens ───────────────────────────────────────────────────────

function OnbWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, padding: '0 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>💜</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12, color: C.text, background: `linear-gradient(135deg, ${C.accentLight}, ${C.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PFM Bot</h1>
      <p style={{ color: C.textSec, fontSize: 16, lineHeight: 1.6, marginBottom: 40, maxWidth: 300 }}>
        Узнайте, сколько можно безопасно тратить каждый день — пока вы гасите долги
      </p>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <PrimaryBtn onClick={onStart}>Начать настройку</PrimaryBtn>
      </div>
      <p style={{ color: C.textMuted, fontSize: 12, marginTop: 16 }}>Займёт ~2 минуты</p>
    </div>
  );
}

function OnbIncome({ onNext }: { onNext: (data: { amount: number; paydays: number[]; currency: string; useRussianWorkCalendar?: boolean }) => void }) {
  const [amount, setAmount] = useState('');
  const [payday, setPayday] = useState<number[]>([15]);
  const [twoPaydays, setTwoPaydays] = useState(false);
  const [payday2, setPayday2] = useState<number[]>([1]);
  const [currency, setCurrency] = useState<'RUB' | 'USD'>('RUB');
  const [useRuCal, setUseRuCal] = useState(true);

  const handleNext = () => {
    const n = parseInt(amount.replace(/\D/g, ''), 10);
    if (!n || n <= 0) return;
    const days = twoPaydays ? [...new Set([...payday, ...payday2])].sort((a, b) => a - b) : payday;
    onNext({ amount: n * 100, paydays: days, currency, useRussianWorkCalendar: useRuCal });
  };

  const payOptions = [1, 5, 10, 15, 20, 25];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={0} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 1 из 6</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>Сколько вы зарабатываете?</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 28 }}>Введите чистый доход после налогов. Это основа для расчёта вашего дневного лимита.</p>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>Доход в месяц</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="120 000"
          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', color: C.text, fontSize: 18, fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>Валюта</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['RUB', 'USD'] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} style={{ padding: '10px 20px', borderRadius: 24, background: currency === c ? C.accentBgStrong : C.surface, border: `1px solid ${currency === c ? C.accent : C.border}`, color: currency === c ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
              {c === 'RUB' ? '₽ RUB' : '$ USD'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>День зарплаты</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {payOptions.map((d) => (
            <button key={d} onClick={() => setPayday([d])} style={{ padding: '10px 16px', borderRadius: 24, background: payday.includes(d) ? C.accentBgStrong : C.surface, border: `1px solid ${payday.includes(d) ? C.accent : C.border}`, color: payday.includes(d) ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
              {d}
            </button>
          ))}
          <button onClick={() => { setTwoPaydays(!twoPaydays); if (!twoPaydays) { const other = payOptions.find(d => !payday.includes(d)) ?? 1; setPayday2([other]); } }} style={{ padding: '10px 16px', borderRadius: 24, background: twoPaydays ? C.accentBgStrong : C.surface, border: `1px solid ${twoPaydays ? C.accent : C.border}`, color: twoPaydays ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>2 раза</button>
        </div>
        {twoPaydays && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 8 }}>Второй день зарплаты:</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {payOptions.map((d) => (
                <button key={d} onClick={() => setPayday2([d])} style={{ padding: '10px 16px', borderRadius: 24, background: payday2.includes(d) ? C.accentBgStrong : C.surface, border: `1px solid ${payday2.includes(d) ? C.accent : C.border}`, color: payday2.includes(d) ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
        <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 8 }}>Мы считаем периоды от зарплаты до зарплаты, не по месяцам</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 13, color: C.text, marginBottom: 2 }}>Производственный календарь РФ</p>
          <p style={{ fontSize: 11, color: C.textTertiary }}>Перенос на пятницу при выходном</p>
        </div>
        <div
          onClick={() => setUseRuCal(!useRuCal)}
          style={{ width: 40, height: 24, background: useRuCal ? C.accent : C.elevated, border: `1px solid ${C.border}`, borderRadius: 12, position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}
        >
          <div style={{ width: 20, height: 20, background: '#fff', borderRadius: '50%', position: 'absolute', top: 1, left: useRuCal ? 18 : 1, transition: 'left 0.2s' }} />
        </div>
      </div>

      <PrimaryBtn onClick={handleNext} disabled={!amount || parseInt(amount, 10) <= 0}>Продолжить</PrimaryBtn>
    </div>
  );
}

function OnbObligations({ onNext, onSkip }: { onNext: (data: any[]) => void; onSkip: () => void }) {
  const [items, setItems] = useState([{ title: '', type: 'RENT', amount: '' }]);

  const add = () => setItems([...items, { title: '', type: 'OTHER', amount: '' }]);
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: string, value: string) => {
    const next = [...items];
    (next[i] as any)[field] = value;
    setItems(next);
  };

  const types = [
    { v: 'RENT', l: 'Аренда' }, { v: 'UTILITIES', l: 'ЖКХ' },
    { v: 'TELECOM', l: 'Связь' }, { v: 'INSURANCE', l: 'Страховка' },
    { v: 'SUBSCRIPTION', l: 'Подписки' }, { v: 'OTHER', l: 'Другое' },
  ];

  const valid = items.filter((i) => i.title && parseInt(i.amount, 10) > 0);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={1} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 2 из 6</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>Обязательные расходы</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>Аренда, коммуналка, связь — то, что вы платите каждый месяц независимо.</p>

      {items.map((item, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: 14, marginBottom: 10, position: 'relative' }}>
          {items.length > 1 && (
            <button onClick={() => remove(i)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: C.textTertiary, cursor: 'pointer', fontSize: 16 }}>✕</button>
          )}
          <input value={item.title} onChange={(e) => update(i, 'title', e.target.value)} placeholder="Название" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={item.type} onChange={(e) => update(i, 'type', e.target.value)} style={{ flex: 1, background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
              {types.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <input type="number" value={item.amount} onChange={(e) => update(i, 'amount', e.target.value)} placeholder="Сумма ₽" style={{ width: 110, background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
          </div>
        </div>
      ))}

      <button onClick={add} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 20 }}>
        + Добавить ещё
      </button>

      <PrimaryBtn onClick={() => onNext(valid.map((it) => ({ title: it.title, type: it.type, amount: parseInt(it.amount, 10) * 100 })))} disabled={valid.length === 0}>Продолжить</PrimaryBtn>
      <SecondaryBtn onClick={onSkip}>Пропустить</SecondaryBtn>
    </div>
  );
}

function OnbDebts({ onNext, onSkip }: { onNext: (data: any[]) => void; onSkip: () => void }) {
  const [items, setItems] = useState([{ title: '', type: 'CREDIT_CARD', balance: '', apr: '', minPayment: '' }]);

  const add = () => setItems([...items, { title: '', type: 'OTHER', balance: '', apr: '', minPayment: '' }]);
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: string, value: string) => {
    const next = [...items];
    (next[i] as any)[field] = value;
    setItems(next);
  };

  const types = [
    { v: 'CREDIT_CARD', l: 'Кредитка' }, { v: 'CREDIT', l: 'Кредит' },
    { v: 'MORTGAGE', l: 'Ипотека' }, { v: 'CAR_LOAN', l: 'Автокредит' },
    { v: 'PERSONAL_LOAN', l: 'Займ' }, { v: 'OTHER', l: 'Другое' },
  ];

  const valid = items.filter((i) => i.title && parseFloat(i.balance) > 0 && parseFloat(i.apr) >= 0 && parseInt(i.minPayment, 10) > 0);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px', paddingBottom: 40 }}>
      <OnbProgress step={2} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 3 из 6</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>Ваши долги</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>Добавьте все активные долги. Мы используем стратегию Лавины — сначала высокий процент.</p>

      {items.map((item, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${i === 0 ? C.accent : C.borderSubtle}`, borderLeft: i === 0 ? `3px solid ${C.accent}` : `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: 14, marginBottom: 10, position: 'relative' }}>
          {i === 0 && <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, background: C.accentBg, color: C.accentLight, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>ФОКУС</span>}
          {items.length > 1 && i > 0 && (
            <button onClick={() => remove(i)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: C.textTertiary, cursor: 'pointer', fontSize: 16 }}>✕</button>
          )}
          <input value={item.title} onChange={(e) => update(i, 'title', e.target.value)} placeholder="Название (Тинькофф, Сбер...)" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
          <select value={item.type} onChange={(e) => update(i, 'type', e.target.value)} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}>
            {types.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { field: 'balance', placeholder: 'Остаток ₽' },
              { field: 'apr', placeholder: 'Ставка %' },
              { field: 'minPayment', placeholder: 'Мин. платёж' },
            ].map(({ field, placeholder }) => (
              <input key={field} type="number" value={(item as any)[field]} onChange={(e) => update(i, field, e.target.value)} placeholder={placeholder} style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            ))}
          </div>
        </div>
      ))}

      <button onClick={add} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 20 }}>
        + Добавить долг
      </button>

      <PrimaryBtn onClick={() => onNext(valid.map((it) => ({ title: it.title, type: it.type, balance: parseFloat(it.balance) * 100, apr: parseFloat(it.apr) / 100, minPayment: parseInt(it.minPayment, 10) * 100 })))} disabled={valid.length === 0}>Продолжить</PrimaryBtn>
      <SecondaryBtn onClick={onSkip}>Долгов нет</SecondaryBtn>
    </div>
  );
}

function OnbEF({ onNext }: { onNext: (amount: number) => void }) {
  const [amount, setAmount] = useState('0');
  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={3} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 4 из 6</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>Подушка безопасности</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 28 }}>Сколько у вас уже отложено на чёрный день? Цель — 3 месяца обязательных расходов.</p>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>Сумма на счёте (₽)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', color: C.text, fontSize: 18, fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
        <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 8 }}>Введите 0, если ещё не начали — поможем спланировать</p>
      </div>

      <PrimaryBtn onClick={() => onNext(Math.round(parseFloat(amount || '0') * 100))}>Продолжить</PrimaryBtn>
    </div>
  );
}

function OnbCash({ onNext, onSkip }: { onNext: (currentCash: number) => void; onSkip: () => void }) {
  const [amount, setAmount] = useState('');
  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={4} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 5 из 6</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>Сколько сейчас на руках?</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 28 }}>
        Укажите, сколько денег у вас сейчас на счёте или в кармане. Без этого бот не сможет точно посчитать, сколько можно тратить каждый день до следующей зарплаты.
      </p>

      <div style={{ background: C.accentBg, border: `1px solid ${C.accent}40`, borderRadius: 12, padding: '12px 16px', marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: C.accentLight, lineHeight: 1.5 }}>
          💡 Введите реальный остаток — именно от этой суммы мы посчитаем ваш дневной лимит. Данные хранятся только на вашем аккаунте.
        </p>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>Сумма сейчас (₽)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="50 000"
          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', color: C.text, fontSize: 18, fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 8 }}>Введите 0, если деньги ещё не пришли — бот пересчитает после первой зарплаты</p>
      </div>

      <PrimaryBtn
        onClick={() => {
          const n = parseFloat(amount || '0');
          onNext(Math.round(Math.max(0, n) * 100));
        }}
        disabled={amount === ''}
      >
        Продолжить
      </PrimaryBtn>
      <SecondaryBtn onClick={onSkip}>Пропустить — добавлю позже</SecondaryBtn>
    </div>
  );
}

function OnbResult({ s2sDaily, currency, onDone }: { s2sDaily: number; currency: string; onDone: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, padding: '0 24px', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: C.textSec, marginBottom: 8 }}>Всё готово! Ваш Safe to Spend:</p>
      <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: -2, color: C.green, marginBottom: 8 }}>{fmt(s2sDaily, currency)}</div>
      <p style={{ fontSize: 16, color: C.textSec, marginBottom: 8 }}>в день</p>
      <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 40, maxWidth: 300, lineHeight: 1.6 }}>Тратьте в пределах этой суммы каждый день, и вы выберетесь из долгов быстрее, чем думаете.</p>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <PrimaryBtn onClick={onDone}>Начать отслеживать</PrimaryBtn>
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ data, onAddExpense, onOpenDebts, onOpenEF, onOpenSummary, showSummaryBanner }: { data: DashboardData; onAddExpense: () => void; onOpenDebts: () => void; onOpenEF?: () => void; onOpenSummary?: () => void; showSummaryBanner?: boolean }) {
  const color = s2sColor(data.s2sToday, data.s2sDaily);
  const mainColor = colorOf(color);
  const efPct = data.emergencyFund && data.emergencyFund.targetAmount > 0
    ? Math.min(100, Math.round((data.emergencyFund.currentAmount / data.emergencyFund.targetAmount) * 100))
    : 0;
  const periodElapsed = data.daysTotal - data.daysLeft;
  const periodPct = data.s2sPeriod > 0 ? Math.min(100, Math.round((data.periodSpent / data.s2sPeriod) * 100)) : 0;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>

      {/* Period summary banner */}
      {showSummaryBanner && onOpenSummary && (
        <div onClick={onOpenSummary} style={{ background: C.accentBg, border: `1px solid ${C.accent}40`, borderRadius: 12, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.accentLight }}>🔄 Период завершён</div>
            <div style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>Посмотреть итоги прошлого периода →</div>
          </div>
        </div>
      )}

      {/* Greeting */}
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 2 }}>Добрый день,</p>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: C.text }}>Safe to Spend</p>

      {/* Period context bar */}
      <div style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        {data.usesLiveWindow && data.nextIncomeDate ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: C.textSec }}>До следующей выплаты</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.accentLight }}>
                {data.daysToNextIncome != null ? `${data.daysToNextIncome} дн.` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.textTertiary }}>
                {data.lastIncomeDate ? `${new Date(data.lastIncomeDate).getDate()} ${['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][new Date(data.lastIncomeDate).getMonth()]}` : '—'}
                {' → '}
                {data.nextIncomeDate ? `${new Date(data.nextIncomeDate).getDate()} ${['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][new Date(data.nextIncomeDate).getMonth()]}` : '—'}
              </span>
              {data.nextIncomeAmount != null && data.nextIncomeAmount > 0 && (
                <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>+{fmt(data.nextIncomeAmount, data.currency)}</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: C.textSec }}>{periodLabel(data.periodStart, data.periodEnd)}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.accentLight }}>День {data.dayNumber ?? (periodElapsed + 1)} из {data.daysTotal}</span>
          </div>
        )}
      </div>

      {/* S2S Card */}
      <div style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 16, padding: '22px 20px', marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-50%', right: '-20%', width: 200, height: 200, background: 'radial-gradient(circle, rgba(139,92,246,0.15), transparent 70%)', pointerEvents: 'none' }} />
        <p style={{ fontSize: 12, color: C.textSec, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>SAFE TO SPEND TODAY</p>
        <p style={{ fontSize: 48, fontWeight: 800, letterSpacing: -2, lineHeight: 1, color: mainColor, marginBottom: 4 }}>{fmt(data.s2sToday, data.currency)}</p>
        <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 16 }}>из дневного лимита {fmt(data.s2sDaily, data.currency)}</p>
        {data.s2sStatus === 'OVERSPENT' && (
          <div style={{ background: C.redBg, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>Перерасход на {fmt(data.todayTotal - data.s2sDaily, data.currency)}</p>
            <p style={{ fontSize: 12, color: C.textTertiary }}>Завтра лимит уменьшится</p>
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, color: C.textSec }}>Осталось в периоде</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{fmt(data.periodRemaining ?? Math.max(0, data.s2sPeriod - data.periodSpent), data.currency)}</span>
        </div>
        {data.cashOnHand != null && (
          <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', paddingTop: 14, marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: C.textSec }}>На руках сейчас</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{fmt(data.cashOnHand, data.currency)}</span>
            </div>
            {data.reservedUpcoming != null && data.reservedUpcoming > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: C.textTertiary }}>Зарезервировано (до выплаты)</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.orange }}>−{fmt(data.reservedUpcoming, data.currency)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button onClick={onAddExpense} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: '14px 12px', display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: C.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>+</span>
          Добавить расход
        </button>
        <button onClick={onOpenDebts} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: '14px 12px', display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: C.orangeBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>💳</span>
          Долги
        </button>
      </div>

      {/* Emergency Fund — tappable */}
      {data.emergencyFund && data.emergencyFund.targetAmount > 0 && (
        <Card style={{ cursor: 'pointer' }} onClick={onOpenEF}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Подушка безопасности</span>
            <span style={{ fontSize: 13, color: C.textSec }}>{fmt(data.emergencyFund.currentAmount, data.currency)} / {fmt(data.emergencyFund.targetAmount, data.currency)}</span>
          </div>
          <ProgressBar value={data.emergencyFund.currentAmount} max={data.emergencyFund.targetAmount} color={C.accent} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
            <span>{efPct}%</span>
            <span>цель: {data.emergencyFund.targetAmount > 0 ? `${Math.round(data.emergencyFund.targetAmount / Math.max(1, data.emergencyFund.targetAmount / (data.emergencyFund as any).targetMonths || 3))} мес.` : '—'}</span>
          </div>
        </Card>
      )}

      {/* Debts summary */}
      {data.debts && data.debts.length > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Долги (Лавина)</span>
            <span style={{ fontSize: 11, background: C.accentBg, color: C.accentLight, padding: '3px 8px', borderRadius: 10, fontWeight: 600 }}>{data.debts.length} активн.</span>
          </div>
          {data.debts.slice(0, 3).map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.borderSubtle}` }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {d.isFocusDebt && <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent, display: 'inline-block', boxShadow: `0 0 8px ${C.accentGlow}` }} />}
                  {d.title}
                </p>
                <p style={{ fontSize: 12, color: C.textTertiary }}>
                  APR {(d.apr * 100).toFixed(1)}%{d.isFocusDebt ? ' · Фокус' : ''}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{fmt(d.balance, data.currency)}</p>
                <p style={{ fontSize: 12, color: C.textTertiary }}>мин {fmt(d.minPayment, data.currency)}</p>
              </div>
            </div>
          ))}
          {data.debts.length > 3 && (
            <button onClick={onOpenDebts} style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', color: C.accentLight, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit' }}>
              Показать все ({data.debts.length})
            </button>
          )}
        </Card>
      )}

      {/* Today expenses */}
      {data.todayExpenses.length > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Сегодня</span>
            <span style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>-{fmt(data.todayTotal, data.currency)}</span>
          </div>
          {data.todayExpenses.slice(0, 3).map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.borderSubtle}` }}>
              <span style={{ fontSize: 14, color: C.textSec }}>{e.note || 'Расход'}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.red }}>-{fmt(e.amount, data.currency)}</span>
            </div>
          ))}
        </Card>
      )}

      {/* Period spending progress */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Расходы за период</span>
          <span style={{ fontSize: 13, color: C.textSec }}>{fmt(data.periodSpent, data.currency)} / {fmt(data.s2sPeriod, data.currency)}</span>
        </div>
        <ProgressBar value={data.periodSpent} max={data.s2sPeriod} color={periodPct > 80 ? C.red : periodPct > 50 ? C.orange : C.green} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
          <span>{periodPct}% потрачено</span>
          <span>{data.daysLeft} дн. осталось</span>
        </div>
      </Card>
    </div>
  );
}

// ── Add Expense (Numpad) ─────────────────────────────────────────────────────

function AddExpense({ s2sToday, currency, onSave, onBack }: { s2sToday: number; currency: string; onSave: (amount: number, note: string) => Promise<void>; onBack: () => void }) {
  const [input, setInput] = useState('0');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const vh = useVisualViewportHeight();

  const amountKop = Math.round(parseFloat(input || '0') * 100);
  const remaining = Math.max(0, s2sToday - amountKop);

  const press = (key: string) => {
    if (key === 'del') { setInput((p) => p.length > 1 ? p.slice(0, -1) : '0'); return; }
    if (key === '.' && input.includes('.')) return;
    if (input === '0' && key !== '.') { setInput(key); return; }
    if (input.includes('.') && input.split('.')[1].length >= 2) return;
    if (input.length >= 9) return;
    setInput((p) => p + key);
  };

  const save = async () => {
    if (amountKop <= 0 || saving) return;
    setSaving(true);
    try { await onSave(amountKop, note); } finally { setSaving(false); }
  };

  const keys = ['1','2','3','4','5','6','7','8','9','.','0','del'];

  return (
    <div style={{ background: C.bg, height: vh, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 20, cursor: 'pointer' }}>←</button>
        <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Новый расход</span>
        <span style={{ width: 28 }} />
      </div>

      <div style={{ textAlign: 'center', padding: '32px 20px 16px' }}>
        <p style={{ fontSize: 16, color: C.textTertiary, marginBottom: 6 }}>{currency === 'USD' ? '$' : '₽'}</p>
        <p style={{ fontSize: 52, fontWeight: 800, letterSpacing: -2, color: C.text, lineHeight: 1 }}>{parseFloat(input).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</p>
        <p style={{ fontSize: 14, color: C.textSec, marginTop: 10 }}>
          Останется сегодня: <span style={{ color: remaining > 0 ? C.green : C.red, fontWeight: 600 }}>{fmt(remaining, currency)}</span>
        </p>
      </div>

      <div style={{ margin: '0 16px 8px', background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: C.textMuted, fontSize: 16 }}>✎</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Добавить заметку..." style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 14, fontFamily: 'inherit', outline: 'none', flex: 1 }} />
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(4, 52px)', gap: 6, padding: '4px 16px 8px' }}>
        {keys.map((k) => (
          <button key={k} onClick={() => press(k)} style={{ background: k === 'del' ? C.elevated : C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, color: C.text, fontSize: k === 'del' ? 18 : 22, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', width: '100%', height: '100%' }}>
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>

      <div style={{ padding: '8px 16px 24px' }}>
        <PrimaryBtn onClick={save} disabled={amountKop <= 0 || saving}>
          {saving ? 'Сохраняем...' : `Сохранить · ${fmt(amountKop, currency)}`}
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

function History({ api, currency, onRefresh }: { api: (path: string, opts?: RequestInit) => Promise<any>; currency: string; onRefresh: () => void }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api('/tg/expenses').then((r) => { setExpenses(r.expenses || []); setLoading(false); }).catch(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api(`/tg/expenses/${id}`, { method: 'DELETE' });
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      await onRefresh();
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const groups = groupByDay(expenses);
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: C.text }}>История</p>

      <div style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: C.textSec }}>Текущий период</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.red }}>-{fmt(total, currency)}</span>
      </div>

      {loading && <div style={{ textAlign: 'center', paddingTop: 40 }}><Spinner /></div>}

      {!loading && groups.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: C.textTertiary }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
          <p>Расходов пока нет</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0 8px', fontSize: 13, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1px' }}>
            <span>{dayLabel(g.date)}</span>
            <span style={{ color: C.textSec, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>-{fmt(g.total, currency)}</span>
          </div>
          {g.items.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${C.borderSubtle}` }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: C.elevated, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💳</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 2 }}>{e.note || 'Расход'}</p>
                <p style={{ fontSize: 12, color: C.textTertiary }}>{new Date(e.spentAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.red, marginRight: 8 }}>-{fmt(e.amount, currency)}</span>
              <button
                onClick={() => handleDelete(e.id)}
                disabled={deletingId === e.id}
                style={{ background: C.redBg, border: 'none', borderRadius: 8, padding: '6px 10px', color: C.red, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: deletingId === e.id ? 0.5 : 1 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Emergency Fund Detail Screen ──────────────────────────────────────────────

interface EFDetail {
  currentAmount: number; targetAmount: number; targetMonths: number;
  targetMode: string; baseMonthlyAmount: number | null;
  progressPct: number; remainingToTarget: number;
  feasibility: string | null;
  canAffectCurrentBudget: boolean; currency: string;
}
interface EFBucket {
  id: string; name: string; type: string; currency: string; currentAmount: number;
  countsTowardEmergencyFund: boolean; isArchived: boolean;
}
interface EFScenario {
  pace: string; contributionAmount: number; frequency: string;
  projectedMonthsToTarget: number | null; projectedTargetDate: string | null;
  loadPctOfFreeCashflow: number | null; status: string;
}
interface EFSelectedPlan {
  mode: 'SYSTEM' | 'CUSTOM' | null; pace: string | null; contributionAmount: number | null;
  frequency: string | null; monthlyEquivalent: number | null; projectedMonthsToTarget: number | null;
  projectedTargetDate: string | null; loadPctOfFreeCashflow: number | null; comparisonHint?: string | null;
}
interface EFPlanData {
  targetAmount: number; currentAmount: number; remainingGap: number; monthlyFreeCashflow: number;
  feasibility: string | null; scenarios: EFScenario[]; message: string | null;
  requiredContribution: { frequency: string; amount: number } | null;
  selectedPlan?: EFSelectedPlan | null;
}
interface EFEntry {
  id: string; bucketId: string | null; bucketName: string | null;
  type: string; amount: number; affectsCurrentBudget: boolean; note: string | null; createdAt: string;
}

function EmergencyFundScreen({ api, onBack, onRefresh }: { api: (path: string, opts?: RequestInit) => Promise<any>; onBack: () => void; onRefresh: () => void }) {
  const [ef, setEf] = useState<EFDetail | null>(null);
  const [buckets, setBuckets] = useState<EFBucket[]>([]);
  const [planData, setPlanData] = useState<EFPlanData | null>(null);
  const [entries, setEntries] = useState<EFEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'view' | 'deposit' | 'withdraw' | 'edit-goal' | 'add-bucket'>('view');
  const [selectedBucket, setSelectedBucket] = useState<EFBucket | null>(null);
  const [amount, setAmount] = useState('');
  const [affectsBudget, setAffectsBudget] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [targetMonths, setTargetMonths] = useState(3);
  const [newBucket, setNewBucket] = useState({ name: '', type: 'SAVINGS_ACCOUNT', amount: '', countsForEF: true });

  const load = useCallback(async () => {
    try {
      const [d, b, p, e] = await Promise.all([
        api('/tg/ef'), api('/tg/ef/buckets'), api('/tg/ef/plan').catch(() => null), api('/tg/ef/entries'),
      ]);
      setEf(d);
      setBuckets(b?.items || []);
      setPlanData(p);
      setEntries(e?.items || []);
      if (d?.targetMonths) setTargetMonths(d.targetMonths);
    } catch {}
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) { setError('Введите корректную сумму'); return; }
    setSaving(true); setError('');
    try {
      await api('/tg/ef/entries', {
        method: 'POST',
        body: JSON.stringify({
          bucketId: selectedBucket?.id ?? undefined,
          type: mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL',
          amount: Math.round(n * 100),
          affectsCurrentBudget: affectsBudget,
        }),
      });
      setAmount(''); setMode('view'); setAffectsBudget(true); setSelectedBucket(null);
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) {
      setError(err?.message || 'Ошибка');
    }
    setSaving(false);
  };

  const handleSyncBalance = async () => {
    const n = parseFloat(amount);
    if (isNaN(n) || n < 0) { setError('Введите корректную сумму'); return; }
    setSaving(true); setError('');
    try {
      await api('/tg/ef/entries', {
        method: 'POST',
        body: JSON.stringify({ type: 'BALANCE_SYNC', amount: Math.round(n * 100), affectsCurrentBudget: false }),
      });
      setAmount(''); setMode('view');
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) { setError(err?.message || 'Ошибка'); }
    setSaving(false);
  };

  const handleGoalSave = async () => {
    setSaving(true); setError('');
    try {
      await api('/tg/ef', { method: 'PATCH', body: JSON.stringify({ targetMonths }) });
      setMode('view');
      await load();
    } catch (err: any) { setError(err?.message || 'Ошибка'); }
    setSaving(false);
  };

  const handleAddBucket = async () => {
    if (!newBucket.name.trim()) { setError('Укажите название'); return; }
    setSaving(true); setError('');
    try {
      await api('/tg/ef/buckets', {
        method: 'POST',
        body: JSON.stringify({
          name: newBucket.name.trim(),
          type: newBucket.type,
          currentAmount: Math.round((parseFloat(newBucket.amount) || 0) * 100),
          countsTowardEmergencyFund: newBucket.countsForEF,
        }),
      });
      setNewBucket({ name: '', type: 'SAVINGS_ACCOUNT', amount: '', countsForEF: true });
      setMode('view');
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) { setError(err?.message || 'Ошибка'); }
    setSaving(false);
  };

  const bucketTypes = [
    { v: 'SAVINGS_ACCOUNT', l: 'Накопительный счёт' }, { v: 'DEPOSIT', l: 'Вклад' },
    { v: 'CASH', l: 'Наличные' }, { v: 'CRYPTO', l: 'Крипта' },
    { v: 'BROKERAGE', l: 'Брокерский счёт' }, { v: 'OTHER', l: 'Другое' },
  ];
  const bucketTypeLabel = (t: string) => bucketTypes.find((bt) => bt.v === t)?.l ?? t;

  const currency = ef?.currency ?? 'RUB';

  if (loading) return <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>;
  if (!ef) return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <button onClick={onBack} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 20 }}>←</button>
      <p style={{ color: C.textSec, textAlign: 'center', marginTop: 40 }}>Подушка безопасности не настроена</p>
    </div>
  );

  const handleSelectPace = async (pace: string) => {
    try {
      await api('/tg/ef/plan', { method: 'PATCH', body: JSON.stringify({ planSelectionMode: 'SYSTEM', preferredPace: pace }) });
      await load();
    } catch {}
  };

  const [customMode, setCustomMode] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [customFreq, setCustomFreq] = useState<'MONTHLY' | 'BIWEEKLY' | 'WEEKLY'>('MONTHLY');

  const handleSaveCustomPlan = async () => {
    const n = parseFloat(customAmount);
    if (isNaN(n) || n <= 0) { setError('Введите корректную сумму'); return; }
    setSaving(true); setError('');
    try {
      await api('/tg/ef/plan', {
        method: 'PATCH',
        body: JSON.stringify({ planSelectionMode: 'CUSTOM', customContributionAmount: Math.round(n * 100), customContributionFrequency: customFreq }),
      });
      setCustomMode(false); setCustomAmount('');
      await load();
    } catch (err: any) { setError(err?.message || 'Ошибка'); }
    setSaving(false);
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px', paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>Подушка безопасности</h2>
      </div>

      {/* Balance card */}
      <Card style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)' }}>
        <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>Накоплено</p>
        <p style={{ fontSize: 28, fontWeight: 800, color: C.text, marginBottom: 8 }}>{fmt(ef.currentAmount, currency)}</p>
        <ProgressBar value={ef.currentAmount} max={Math.max(1, ef.targetAmount)} color={C.accent} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
          <span>{ef.progressPct}% от цели</span>
          <span>Цель: {fmt(ef.targetAmount, currency)}</span>
        </div>
        {ef.remainingToTarget > 0 && (
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 6 }}>Осталось: {fmt(ef.remainingToTarget, currency)}</p>
        )}
        {ef.currentAmount >= ef.targetAmount && ef.targetAmount > 0 && (
          <p style={{ fontSize: 13, color: C.green, fontWeight: 600, marginTop: 6 }}>Цель достигнута!</p>
        )}
      </Card>

      {/* Action buttons */}
      {mode === 'view' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <PrimaryBtn onClick={() => { setMode('deposit'); setAmount(''); setError(''); }} style={{ flex: 1 }}>Пополнить</PrimaryBtn>
            <button onClick={() => { setMode('withdraw'); setAmount(''); setError(''); }} style={{ flex: 1, padding: '13px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Вывести</button>
          </div>
          <button onClick={() => { setMode('edit-goal'); setError(''); }} style={{ width: '100%', padding: '12px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 20 }}>
            Изменить цель ({ef.targetMonths} мес.)
          </button>
        </>
      )}

      {/* Deposit / Withdraw form */}
      {(mode === 'deposit' || mode === 'withdraw') && (
        <Card>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>
            {mode === 'deposit' ? 'Пополнить подушку' : 'Вывести из подушки'}
          </p>
          <input
            type="number" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Сумма ₽" autoFocus
            style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 18, fontWeight: 700, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
          />

          {/* Budget impact choice */}
          <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>Откуда деньги?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setAffectsBudget(true)} style={{ textAlign: 'left', padding: '12px 14px', background: affectsBudget ? C.accentBg : C.elevated, border: `1px solid ${affectsBudget ? C.accent : C.border}`, borderRadius: 10, color: affectsBudget ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
              {mode === 'deposit' ? '💰 Из доступных денег' : '💰 Вернуть в доступные'}
              <span style={{ display: 'block', fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                {mode === 'deposit' ? 'Уменьшит дневной лимит' : 'Увеличит дневной лимит'}
              </span>
            </button>
            <button onClick={() => setAffectsBudget(false)} style={{ textAlign: 'left', padding: '12px 14px', background: !affectsBudget ? C.accentBg : C.elevated, border: `1px solid ${!affectsBudget ? C.accent : C.border}`, borderRadius: 10, color: !affectsBudget ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
              {mode === 'deposit' ? '📊 Уже лежит на счёте' : '📊 Просто исправляю баланс'}
              <span style={{ display: 'block', fontSize: 11, color: C.textTertiary, marginTop: 2 }}>Не влияет на дневной лимит</span>
            </button>
          </div>

          {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={!affectsBudget && mode === 'deposit' ? handleSyncBalance : handleSubmit} disabled={saving || !amount} style={{ flex: 1 }}>
              {saving ? '...' : 'Подтвердить'}
            </PrimaryBtn>
            <button onClick={() => { setMode('view'); setError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
          </div>
        </Card>
      )}

      {/* Edit goal */}
      {mode === 'edit-goal' && (
        <Card>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>Цель: сколько месяцев</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {[1, 2, 3, 4, 6].map((m) => (
              <button key={m} onClick={() => setTargetMonths(m)} style={{ padding: '10px 18px', borderRadius: 24, background: targetMonths === m ? C.accentBgStrong : C.elevated, border: `1px solid ${targetMonths === m ? C.accent : C.border}`, color: targetMonths === m ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
                {m} мес.
              </button>
            ))}
          </div>
          {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={handleGoalSave} disabled={saving} style={{ flex: 1 }}>{saving ? '...' : 'Сохранить'}</PrimaryBtn>
            <button onClick={() => { setMode('view'); setError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
          </div>
        </Card>
      )}

      {/* Add bucket form */}
      {mode === 'add-bucket' && (
        <Card>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>Новое накопление</p>
          <input value={newBucket.name} onChange={(e) => setNewBucket({ ...newBucket, name: e.target.value })} placeholder="Название (напр. Вклад Тинькофф)" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <select value={newBucket.type} onChange={(e) => setNewBucket({ ...newBucket, type: e.target.value })} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', marginBottom: 10, outline: 'none' }}>
            {bucketTypes.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <input type="number" value={newBucket.amount} onChange={(e) => setNewBucket({ ...newBucket, amount: e.target.value })} placeholder="Текущий баланс ₽" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          {newBucket.type === 'CRYPTO' && (
            <p style={{ fontSize: 11, color: C.orange, marginBottom: 10, padding: '8px 12px', background: `${C.orange}15`, borderRadius: 8 }}>
              Крипта волатильна и по умолчанию не считается надёжной частью подушки
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: C.text }}>Учитывать в подушке</span>
            <div onClick={() => setNewBucket({ ...newBucket, countsForEF: !newBucket.countsForEF })} style={{ width: 40, height: 24, background: newBucket.countsForEF ? C.accent : C.elevated, border: `1px solid ${C.border}`, borderRadius: 12, position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, background: '#fff', borderRadius: '50%', position: 'absolute', top: 1, left: newBucket.countsForEF ? 18 : 1, transition: 'left 0.2s' }} />
            </div>
          </div>
          {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={handleAddBucket} disabled={saving || !newBucket.name.trim()} style={{ flex: 1 }}>{saving ? '...' : 'Добавить'}</PrimaryBtn>
            <button onClick={() => { setMode('view'); setError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
          </div>
        </Card>
      )}

      {/* Buckets list */}
      {mode === 'view' && buckets.filter((b) => !b.isArchived).length > 0 && (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>Где лежат деньги</p>
          {buckets.filter((b) => !b.isArchived).map((b) => (
            <Card key={b.id} style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{b.name}</p>
                  <p style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    {bucketTypeLabel(b.type)}
                    {b.countsTowardEmergencyFund ? ' · в подушке' : ' · не в подушке'}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{fmt(b.currentAmount, currency)}</span>
                  <button onClick={() => { setSelectedBucket(b); setMode('deposit'); setAmount(''); setError(''); }} style={{ background: C.accentBg, border: 'none', borderRadius: 6, padding: '4px 8px', color: C.accentLight, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+</button>
                </div>
              </div>
            </Card>
          ))}
          <button onClick={() => { setMode('add-bucket'); setError(''); setNewBucket({ name: '', type: 'SAVINGS_ACCOUNT', amount: '', countsForEF: true }); }} style={{ width: '100%', padding: '12px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 16 }}>
            + Добавить накопление
          </button>
        </>
      )}

      {/* No buckets yet — CTA */}
      {mode === 'view' && buckets.filter((b) => !b.isArchived).length === 0 && (
        <button onClick={() => { setMode('add-bucket'); setError(''); setNewBucket({ name: '', type: 'SAVINGS_ACCOUNT', amount: '', countsForEF: true }); }} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 16 }}>
          + Добавить накопление
        </button>
      )}

      {/* Plan scenarios */}
      {mode === 'view' && planData && planData.scenarios.length > 0 && (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>План достижения цели</p>
          {planData.feasibility && (
            <p style={{ fontSize: 12, marginBottom: 10, color: planData.feasibility === 'REALISTIC' ? C.green : planData.feasibility === 'TIGHT' ? C.orange : C.red }}>
              {planData.feasibility === 'REALISTIC' ? 'Цель достижима' : planData.feasibility === 'TIGHT' ? 'Напряжённо, но возможно' : 'Цель недостижима в выбранный срок'}
            </p>
          )}
          {planData.message && <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 10 }}>{planData.message}</p>}
          <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>Свободный поток: {fmt(planData.monthlyFreeCashflow, currency)}/мес</p>
          {planData.scenarios.map((sc: any) => {
            const isSelected = planData.selectedPlan?.mode === 'SYSTEM' && planData.selectedPlan?.pace === sc.pace;
            return (
              <Card key={sc.pace} onClick={() => handleSelectPace(sc.pace)} style={{ padding: '12px 14px', borderLeft: isSelected ? `3px solid ${C.accent}` : sc.status === 'RECOMMENDED' ? `3px solid ${C.accent}40` : undefined, cursor: 'pointer', background: isSelected ? C.accentBg : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {sc.pace === 'GENTLE' ? 'Щадящий' : sc.pace === 'OPTIMAL' ? 'Оптимальный' : 'Агрессивный'}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isSelected && <span style={{ fontSize: 10, background: C.green + '30', color: C.green, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Выбрано</span>}
                    {sc.status === 'RECOMMENDED' && <span style={{ fontSize: 10, background: C.accentBg, color: C.accentLight, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Рекомендуем</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textSec }}>
                  <span>{fmt(sc.contributionAmount, currency)}/{sc.frequency === 'WEEKLY' ? 'нед' : sc.frequency === 'BIWEEKLY' ? '2 нед' : 'мес'}</span>
                  <span>{sc.projectedMonthsToTarget != null ? `~${sc.projectedMonthsToTarget} мес.` : 'Не определён'}</span>
                </div>
                {sc.loadPctOfFreeCashflow != null && (
                  <p style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>{sc.loadPctOfFreeCashflow}% от свободного потока</p>
                )}
              </Card>
            );
          })}

          {/* Custom plan button / editor */}
          {!customMode ? (
            <button onClick={() => { setCustomMode(true); setError(''); setCustomAmount(''); }} style={{ width: '100%', padding: '12px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 8 }}>
              {planData.selectedPlan?.mode === 'CUSTOM' ? 'Изменить свой план' : 'Настроить свой план'}
            </button>
          ) : (
            <Card>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>Свой план</p>
              <input type="number" inputMode="decimal" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder="Сколько готов откладывать ₽" autoFocus style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', fontSize: 16, fontWeight: 600, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['MONTHLY', 'мес'], ['BIWEEKLY', '2 нед'], ['WEEKLY', 'нед']] as const).map(([f, l]) => (
                  <button key={f} onClick={() => setCustomFreq(f as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 20, background: customFreq === f ? C.accentBgStrong : C.elevated, border: `1px solid ${customFreq === f ? C.accent : C.border}`, color: customFreq === f ? C.accentLight : C.textSec, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
                    раз / {l}
                  </button>
                ))}
              </div>
              {error && <p style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>⚠ {error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <PrimaryBtn onClick={handleSaveCustomPlan} disabled={saving || !customAmount} style={{ flex: 1 }}>{saving ? '...' : 'Сохранить'}</PrimaryBtn>
                <button onClick={() => { setCustomMode(false); setError(''); }} style={{ flex: 0.5, padding: '12px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
              </div>
            </Card>
          )}

          {/* My Plan summary */}
          {planData.selectedPlan?.mode && (
            <Card style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)', marginTop: 4 }}>
              <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>Мой план</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                {planData.selectedPlan.mode === 'SYSTEM'
                  ? (planData.selectedPlan.pace === 'GENTLE' ? 'Щадящий' : planData.selectedPlan.pace === 'OPTIMAL' ? 'Оптимальный' : 'Агрессивный')
                  : 'Свой план'}
              </p>
              {planData.selectedPlan.contributionAmount != null && (
                <p style={{ fontSize: 14, color: C.textSec }}>
                  {fmt(planData.selectedPlan.contributionAmount, currency)} / {planData.selectedPlan.frequency === 'WEEKLY' ? 'нед' : planData.selectedPlan.frequency === 'BIWEEKLY' ? '2 нед' : 'мес'}
                </p>
              )}
              {planData.selectedPlan.projectedMonthsToTarget != null && (
                <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>
                  Цель через ~{planData.selectedPlan.projectedMonthsToTarget} мес.
                  {planData.selectedPlan.loadPctOfFreeCashflow != null && ` · ${planData.selectedPlan.loadPctOfFreeCashflow}% потока`}
                </p>
              )}
              {planData.selectedPlan.comparisonHint && (
                <p style={{ fontSize: 11, color: C.accent, marginTop: 4 }}>{planData.selectedPlan.comparisonHint}</p>
              )}
            </Card>
          )}
        </>
      )}

      {/* History */}
      {mode === 'view' && entries.length > 0 && (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10, marginTop: 8 }}>История операций</p>
          {entries.map((e) => (
            <Card key={e.id} style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>
                    {e.type === 'DEPOSIT' ? '↗ Пополнение' : e.type === 'WITHDRAWAL' ? '↙ Вывод' : '🔄 Синхронизация'}
                    {e.bucketName && ` · ${e.bucketName}`}
                  </p>
                  <p style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    {new Date(e.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    {e.affectsCurrentBudget && ' · из бюджета'}
                    {e.note && ` · ${e.note}`}
                  </p>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: e.type === 'DEPOSIT' ? C.green : e.type === 'WITHDRAWAL' ? C.red : C.textSec }}>
                  {e.type === 'WITHDRAWAL' ? '−' : '+'}{fmt(e.amount, currency)}
                </span>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

// ── Debts Screen ─────────────────────────────────────────────────────────────

function DebtsScreen({ api, currency, onRefresh }: { api: (path: string, opts?: RequestInit) => Promise<any>; currency: string; onRefresh: () => void }) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [plan, setPlan] = useState<AvalanchePlan | null>(null);
  const [strategy, setStrategy] = useState<DebtStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newDebt, setNewDebt] = useState({ title: '', type: 'CREDIT_CARD', balance: '', apr: '', minPayment: '', dueDay: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [paymentModal, setPaymentModal] = useState<{ debt: Debt; kind: 'REQUIRED_MIN_PAYMENT' | 'EXTRA_PRINCIPAL_PAYMENT' } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Edit debt state
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [editForm, setEditForm] = useState({ title: '', type: 'CREDIT_CARD', balance: '', apr: '', minPayment: '', dueDay: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  // Extra payment state
  const [extraDebt, setExtraDebt] = useState<Debt | null>(null);
  const [extraAmount, setExtraAmount] = useState('');
  const [extraSaving, setExtraSaving] = useState(false);
  const [extraError, setExtraError] = useState('');
  // Toast
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p, s] = await Promise.all([
        api('/tg/debts'),
        api('/tg/debts/avalanche-plan'),
        api('/tg/debts/strategy'),
      ]);
      setDebts(d);
      setPlan(p);
      setStrategy(s);
    } catch {}
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newDebt.title || !newDebt.balance || !newDebt.minPayment) return;
    setSaveError('');
    const balanceRub = parseFloat(newDebt.balance);
    if (isNaN(balanceRub) || balanceRub <= 0) { setSaveError('Укажите корректный остаток'); return; }
    if (balanceRub > 21_474_836) { setSaveError('Максимальный остаток 21 474 836 ₽'); return; }
    const minPay = parseInt(newDebt.minPayment, 10);
    if (isNaN(minPay) || minPay <= 0) { setSaveError('Укажите корректный минимальный платёж'); return; }
    const aprPct = parseFloat(newDebt.apr || '0');
    setSaving(true);
    try {
      await api('/tg/debts', {
        method: 'POST',
        body: JSON.stringify({
          title: newDebt.title, type: newDebt.type,
          balance: Math.round(balanceRub * 100),
          apr: aprPct / 100,
          minPayment: Math.round(minPay * 100),
          dueDay: newDebt.dueDay ? parseInt(newDebt.dueDay) : undefined,
        }),
      });
      setShowAdd(false);
      setSaveError('');
      setNewDebt({ title: '', type: 'CREDIT_CARD', balance: '', apr: '', minPayment: '', dueDay: '' });
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) {
      setSaveError(err?.message || 'Ошибка сохранения. Проверьте данные.');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await api(`/tg/debts/${id}`, { method: 'DELETE' });
    await Promise.all([load(), onRefresh()]);
  };

  const handlePayment = async () => {
    if (!paymentModal) return;
    const amountRub = parseFloat(paymentAmount);
    if (isNaN(amountRub) || amountRub <= 0) { setPaymentError('Укажите корректную сумму'); return; }
    setPaymentSaving(true); setPaymentError('');
    try {
      await api(`/tg/debts/${paymentModal.debt.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor: Math.round(amountRub * 100), kind: paymentModal.kind, note: paymentNote || undefined }),
      });
      setPaymentModal(null); setPaymentAmount(''); setPaymentNote('');
      await Promise.all([load(), onRefresh()]);
    } catch { setPaymentError('Ошибка сохранения'); }
    setPaymentSaving(false);
  };

  const openEdit = (d: Debt) => {
    setEditDebt(d);
    setEditForm({
      title: d.title,
      type: d.type,
      balance: String(d.balance / 100),
      apr: String(+(d.apr * 100).toFixed(2)),
      minPayment: String(d.minPayment / 100),
      dueDay: d.dueDay ? String(d.dueDay) : '',
    });
    setEditError('');
  };

  const handleEdit = async () => {
    if (!editDebt) return;
    setEditError('');
    const balanceRub = parseFloat(editForm.balance);
    if (isNaN(balanceRub) || balanceRub <= 0) { setEditError('Укажите корректный остаток'); return; }
    if (balanceRub > 21_474_836) { setEditError('Максимальный остаток 21 474 836 ₽'); return; }
    const aprPct = parseFloat(editForm.apr || '0');
    if (isNaN(aprPct) || aprPct < 0 || aprPct > 100) { setEditError('Ставка от 0 до 100%'); return; }
    const minPay = parseFloat(editForm.minPayment);
    if (isNaN(minPay) || minPay < 0) { setEditError('Мин. платёж не может быть отрицательным'); return; }
    const dueDay = editForm.dueDay ? parseInt(editForm.dueDay) : null;
    if (dueDay !== null && (isNaN(dueDay) || dueDay < 1 || dueDay > 31)) { setEditError('День платежа от 1 до 31'); return; }

    setEditSaving(true);
    try {
      await api(`/tg/debts/${editDebt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editForm.title.trim(),
          type: editForm.type,
          balance: Math.round(balanceRub * 100),
          apr: aprPct / 100,
          minPayment: Math.round(minPay * 100),
          dueDay,
        }),
      });
      setEditDebt(null);
      setToast('Кредит обновлён');
      setTimeout(() => setToast(''), 2500);
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) {
      setEditError(err?.message || 'Ошибка сохранения');
    }
    setEditSaving(false);
  };

  const openExtraPayment = (d: Debt) => {
    setExtraDebt(d);
    setExtraAmount('');
    setExtraError('');
  };

  const handleExtraPayment = async () => {
    if (!extraDebt) return;
    setExtraError('');
    const amountRub = parseFloat(extraAmount);
    if (isNaN(amountRub) || amountRub <= 0) { setExtraError('Укажите корректную сумму'); return; }
    const amountMinor = Math.round(amountRub * 100);
    if (amountMinor > extraDebt.balance) { setExtraError('Сумма не может быть больше остатка'); return; }

    setExtraSaving(true);
    try {
      await api(`/tg/debts/${extraDebt.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor, kind: 'EXTRA_PRINCIPAL_PAYMENT' }),
      });
      setExtraDebt(null);
      setToast(amountMinor === extraDebt.balance ? 'Долг полностью погашен!' : 'Досрочное погашение учтено');
      setTimeout(() => setToast(''), 2500);
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) {
      setExtraError(err?.message || 'Ошибка сохранения');
    }
    setExtraSaving(false);
  };

  const paymentBadge = (status: 'PAID' | 'PARTIAL' | 'UNPAID') => {
    if (status === 'PAID')    return { label: 'Оплачен ✓',   color: C.green,  bg: C.greenBg };
    if (status === 'PARTIAL') return { label: 'Частично',    color: C.orange, bg: C.orangeBg };
    return                           { label: 'Не оплачен',  color: C.red,    bg: C.redBg };
  };

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const totalMin = debts.reduce((s, d) => s + d.minPayment, 0);

  const types = [
    { v: 'CREDIT_CARD', l: 'Кредитка' }, { v: 'CREDIT', l: 'Кредит' },
    { v: 'MORTGAGE', l: 'Ипотека' }, { v: 'CAR_LOAN', l: 'Автокредит' },
    { v: 'PERSONAL_LOAN', l: 'Займ' }, { v: 'OTHER', l: 'Другое' },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: C.text }}>Долги</p>

      {loading && <div style={{ textAlign: 'center', paddingTop: 40 }}><Spinner /></div>}

      {!loading && debts.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: C.textTertiary }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>🎉</p>
          <p style={{ fontSize: 16, fontWeight: 600, color: C.green, marginBottom: 8 }}>Долгов нет!</p>
          <p style={{ fontSize: 13 }}>Так держать</p>
        </div>
      )}

      {!loading && debts.length > 0 && (
        <>
          {/* Summary */}
          <Card style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>Общий долг</p>
                <p style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{fmt(totalDebt, currency)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>Мин. платежи/мес</p>
                <p style={{ fontSize: 18, fontWeight: 700, color: C.orange }}>{fmt(totalMin, currency)}</p>
              </div>
            </div>
            {strategy?.summary.estimatedDebtFreeMonths != null && (
              <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', paddingTop: 10, marginTop: 8 }}>
                <p style={{ fontSize: 13, color: C.textSec }}>
                  Свобода от долгов: ~{strategy.summary.estimatedDebtFreeMonths} мес.
                  {strategy.summary.estimatedTotalInterest != null && ` · Переплата: ${fmt(strategy.summary.estimatedTotalInterest, currency)}`}
                </p>
              </div>
            )}
          </Card>

          {/* Debt list */}
          {debts.map((d, i) => (
            <Card key={d.id} style={d.isFocusDebt ? { border: `1px solid ${C.accent}`, borderLeft: `3px solid ${C.accent}` } : {}}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {d.isFocusDebt && <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent, display: 'inline-block', boxShadow: `0 0 8px ${C.accentGlow}` }} />}
                    {d.title}
                  </p>
                  <p style={{ fontSize: 12, color: C.textTertiary }}>{debtTypeLabel(d.type)} · Ставка {(d.apr * 100).toFixed(1)}%</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {d.isFocusDebt && <span style={{ fontSize: 10, background: C.accentBg, color: C.accentLight, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>ФОКУС</span>}
                  <button onClick={() => openEdit(d)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', color: C.textSec, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✎</button>
                  <button onClick={() => handleDelete(d.id)} style={{ background: C.redBg, border: 'none', borderRadius: 6, padding: '4px 8px', color: C.red, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{fmt(d.balance, currency)}</p>
                  <p style={{ fontSize: 12, color: C.textTertiary }}>остаток</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 16, fontWeight: 600, color: C.textSec }}>{fmt(d.minPayment, currency)}</p>
                  <p style={{ fontSize: 12, color: C.textTertiary }}>мин/мес</p>
                </div>
              </div>
              {(() => {
                const si = strategy?.items.find((s) => s.debtId === d.id);
                if (!si) return null;
                return (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSubtle}` }}>
                    {/* Forecast line */}
                    {si.display.forecastLabel ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginBottom: si.isFocus ? 8 : 0 }}>
                        <span>{si.display.forecastLabel}</span>
                        {si.baseline.totalInterest != null && si.baseline.totalInterest > 0 && (
                          <span>переплата {fmt(si.baseline.totalInterest, currency)}</span>
                        )}
                      </div>
                    ) : si.display.warningLabel ? (
                      <p style={{ fontSize: 12, color: C.orange, marginBottom: si.isFocus ? 8 : 0 }}>⚠ {si.display.warningLabel}</p>
                    ) : null}

                    {/* Focus-only: action + acceleration scenarios */}
                    {si.isFocus && (
                      <>
                        <p style={{ fontSize: 12, color: C.accentLight, marginBottom: 4 }}>🎯 {si.display.primaryAction}</p>
                        {si.display.secondaryAction && (
                          <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 6 }}>{si.display.secondaryAction}</p>
                        )}
                        {si.accelerateScenarios.filter((sc) => sc.status === 'OK' && sc.monthsSavedVsBaseline != null && sc.monthsSavedVsBaseline > 0).map((sc) => (
                          <div key={sc.extraPerMonth} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textTertiary, marginTop: 3 }}>
                            <span>+{Math.round(sc.extraPerMonth / 100).toLocaleString('ru-RU')} ₽/мес</span>
                            <span style={{ color: C.green }}>−{sc.monthsSavedVsBaseline} мес.{sc.interestSavedVsBaseline != null && sc.interestSavedVsBaseline > 0 ? ` · экономия ${fmt(sc.interestSavedVsBaseline, currency)}` : ''}</span>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Non-focus: short label */}
                    {!si.isFocus && (
                      <p style={{ fontSize: 11, color: C.textTertiary }}>{si.display.primaryAction}</p>
                    )}
                  </div>
                );
              })()}

              {/* Period payment status */}
              {d.currentPeriodPayment && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSubtle}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.textTertiary }}>Обязательный платёж</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: paymentBadge(d.currentPeriodPayment.status).color, background: paymentBadge(d.currentPeriodPayment.status).bg, padding: '2px 8px', borderRadius: 10 }}>
                      {paymentBadge(d.currentPeriodPayment.status).label}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 4, background: C.elevated, borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ height: '100%', borderRadius: 2, background: d.currentPeriodPayment.status === 'PAID' ? C.green : C.orange, width: `${Math.min(100, d.currentPeriodPayment.required > 0 ? (d.currentPeriodPayment.paid / d.currentPeriodPayment.required) * 100 : 0)}%`, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textTertiary }}>
                    <span>Оплачено: {fmt(d.currentPeriodPayment.paid, currency)}</span>
                    {d.currentPeriodPayment.remaining > 0 && <span>Осталось: {fmt(d.currentPeriodPayment.remaining, currency)}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => { setPaymentModal({ debt: d, kind: 'REQUIRED_MIN_PAYMENT' }); setPaymentAmount(''); setPaymentNote(''); setPaymentError(''); }}
                      style={{ flex: 1, padding: '8px 0', background: C.accentBg, border: `1px solid ${C.accent}40`, borderRadius: 8, color: C.accentLight, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                    >Внести платёж</button>
                  </div>
                </div>
              )}

              {/* Action: Extra payment */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSubtle}`, display: 'flex', gap: 8 }}>
                <button onClick={() => openExtraPayment(d)} style={{ flex: 1, padding: '8px 0', background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                  Досрочное погашение
                </button>
              </div>
            </Card>
          ))}
        </>
      )}

      {/* Add debt form */}
      {showAdd && (
        <Card>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Новый долг</p>
          <input value={newDebt.title} onChange={(e) => setNewDebt({ ...newDebt, title: e.target.value })} placeholder="Название" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
          <select value={newDebt.type} onChange={(e) => setNewDebt({ ...newDebt, type: e.target.value })} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}>
            {types.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <input type="number" value={newDebt.balance} onChange={(e) => setNewDebt({ ...newDebt, balance: e.target.value })} placeholder="Остаток" style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            <input type="number" value={newDebt.apr} onChange={(e) => setNewDebt({ ...newDebt, apr: e.target.value })} placeholder="Ставка %" style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            <input type="number" value={newDebt.minPayment} onChange={(e) => setNewDebt({ ...newDebt, minPayment: e.target.value })} placeholder="Мин. пл." style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: C.orange, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>⚠️</span> День ежемесячного списания (важно для точного расчёта)
            </p>
            <input
              type="number"
              value={newDebt.dueDay}
              onChange={(e) => setNewDebt({ ...newDebt, dueDay: e.target.value })}
              placeholder="Число месяца (напр. 15)"
              style={{ width: '100%', background: C.elevated, border: `1px solid ${C.orange}60`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {saveError && (
            <p style={{ fontSize: 13, color: C.red, background: C.redBg, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>⚠ {saveError}</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={handleAdd} disabled={saving} style={{ flex: 1 }}>
              {saving ? '...' : 'Добавить'}
            </PrimaryBtn>
            <button onClick={() => { setShowAdd(false); setSaveError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
          </div>
        </Card>
      )}

      {!showAdd && !loading && (
        <button onClick={() => setShowAdd(true)} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginTop: 8 }}>
          + Добавить долг
        </button>
      )}

      {/* Payment modal (required min) */}
      {paymentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px 40px', boxSizing: 'border-box' }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>Внести платёж</p>
            <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 16 }}>{paymentModal.debt.title}</p>

            {paymentModal.debt.currentPeriodPayment && paymentModal.debt.currentPeriodPayment.remaining > 0 && (
              <div style={{ background: C.accentBg, border: `1px solid ${C.accent}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                <p style={{ fontSize: 13, color: C.accentLight }}>
                  Осталось оплатить: <strong>{fmt(paymentModal.debt.currentPeriodPayment.remaining, currency)}</strong>
                </p>
              </div>
            )}

            <input type="number" inputMode="decimal" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Сумма ₽" autoFocus
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
            <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Комментарий (необязательно)"
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', fontSize: 14, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 14, boxSizing: 'border-box' }} />
            {paymentError && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {paymentError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <PrimaryBtn onClick={handlePayment} disabled={paymentSaving} style={{ flex: 1 }}>{paymentSaving ? '...' : 'Подтвердить'}</PrimaryBtn>
              <button onClick={() => { setPaymentModal(null); setPaymentError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Extra payment modal */}
      {extraDebt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px 40px', boxSizing: 'border-box' }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>Досрочное погашение</p>
            <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 6 }}>{extraDebt.title}</p>
            <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 16 }}>Остаток: {fmt(extraDebt.balance, currency)}</p>

            <input type="number" inputMode="decimal" value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} placeholder="Сумма досрочного погашения ₽" autoFocus
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />

            <button onClick={() => setExtraAmount(String(extraDebt.balance / 100))}
              style={{ width: '100%', padding: '10px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 14 }}>
              Погасить полностью — {fmt(extraDebt.balance, currency)}
            </button>

            {extraError && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {extraError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <PrimaryBtn onClick={handleExtraPayment} disabled={extraSaving} style={{ flex: 1 }}>{extraSaving ? '...' : 'Подтвердить'}</PrimaryBtn>
              <button onClick={() => setExtraDebt(null)} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit debt modal */}
      {editDebt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px 40px', boxSizing: 'border-box', maxHeight: '85vh', overflowY: 'auto' }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 16 }}>Редактировать долг</p>

            <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="Название"
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />

            <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}>
              {types.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>Остаток, ₽</p>
                <input type="number" inputMode="decimal" value={editForm.balance} onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>Ставка, %</p>
                <input type="number" inputMode="decimal" value={editForm.apr} onChange={(e) => setEditForm({ ...editForm, apr: e.target.value })}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>Мин. платёж / мес, ₽</p>
                <input type="number" inputMode="decimal" value={editForm.minPayment} onChange={(e) => setEditForm({ ...editForm, minPayment: e.target.value })}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>День платежа</p>
                <input type="number" inputMode="numeric" value={editForm.dueDay} onChange={(e) => setEditForm({ ...editForm, dueDay: e.target.value })} placeholder="—"
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            {editError && <p style={{ fontSize: 13, color: C.red, background: C.redBg, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>⚠ {editError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <PrimaryBtn onClick={handleEdit} disabled={editSaving} style={{ flex: 1 }}>{editSaving ? '...' : 'Сохранить'}</PrimaryBtn>
              <button onClick={() => setEditDebt(null)} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', background: C.green, color: '#000', padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── PRO Paywall ──────────────────────────────────────────────────────────────

function ProPaywall({ onBack, api }: { onBack: () => void; api: (path: string, opts?: RequestInit) => Promise<any> }) {
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [err, setErr] = useState('');

  const features = [
    { icon: '📊', title: 'Еженедельный дайджест', desc: 'Аналитика трат, тренды и прогресс по долгам' },
    { icon: '⏰', title: 'Своё время уведомлений', desc: 'Настройте утреннее S2S и вечернее напоминание' },
    { icon: '📈', title: 'Расширенная аналитика', desc: 'Графики, сравнение периодов, категории трат' },
    { icon: '📤', title: 'Экспорт данных', desc: 'Скачайте историю расходов в CSV' },
    { icon: '🚀', title: 'Приоритетная поддержка', desc: 'Быстрые ответы в выделенном канале' },
  ];

  const handleSubscribe = async () => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.openInvoice) {
      setErr('Оплата доступна только в Telegram');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const { invoiceUrl } = await api('/tg/billing/pro/checkout', { method: 'POST' });
      tg.openInvoice(invoiceUrl, (status: string) => {
        setLoading(false);
        if (status === 'paid') {
          setPaid(true);
        } else if (status === 'failed') {
          setErr('Ошибка оплаты. Попробуйте ещё раз.');
        }
        // 'cancelled' — просто закрыли, ничего не делаем
      });
    } catch {
      setLoading(false);
      setErr('Не удалось создать счёт. Попробуйте позже.');
    }
  };

  if (paid) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>🎉</div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 12 }}>PRO активирован!</h2>
        <p style={{ fontSize: 15, color: C.textSec, lineHeight: 1.6, marginBottom: 36 }}>Спасибо за поддержку! Все PRO функции уже доступны.</p>
        <PrimaryBtn onClick={onBack}>Отлично!</PrimaryBtn>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 40 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 20, cursor: 'pointer', marginBottom: 16 }}>←</button>

      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', background: C.accentBgStrong, border: `1px solid ${C.accent}`, borderRadius: 24, fontSize: 14, fontWeight: 700, color: C.accentLight, marginBottom: 16 }}>PRO</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8, lineHeight: 1.3 }}>Возьмите финансы под полный контроль</h2>
        <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.5 }}>Автоматизация, аналитика и продвинутые сценарии</p>
      </div>

      {features.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '14px 0', alignItems: 'flex-start' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: C.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{f.icon}</div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{f.title}</p>
            <p style={{ fontSize: 13, color: C.textTertiary, lineHeight: 1.4 }}>{f.desc}</p>
          </div>
        </div>
      ))}

      <div style={{ textAlign: 'center', margin: '24px 0' }}>
        <p style={{ fontSize: 36, fontWeight: 800, color: C.text }}>⭐ 100</p>
        <p style={{ fontSize: 14, color: C.textTertiary }}>Telegram Stars / месяц</p>
      </div>

      {err && <p style={{ color: C.red, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>{err}</p>}

      <PrimaryBtn onClick={handleSubscribe} disabled={loading}>
        {loading ? 'Открываем счёт...' : 'Подписаться за 100 Stars'}
      </PrimaryBtn>
      <SecondaryBtn onClick={onBack}>Позже</SecondaryBtn>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function Settings({ api, onOpenPro, onOpenIncomes, onOpenObligations, onOpenPaydays, onRefresh }: { api: (path: string, opts?: RequestInit) => Promise<any>; onOpenPro: () => void; onOpenIncomes: () => void; onOpenObligations: () => void; onOpenPaydays: () => void; onRefresh?: () => void }) {
  const [settings, setSettings] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [cashModal, setCashModal] = useState(false);
  const [cashInput, setCashInput] = useState('');
  const [cashSaving, setCashSaving] = useState(false);
  const [cashDone, setCashDone] = useState(false);

  useEffect(() => {
    Promise.all([api('/tg/me/settings'), api('/tg/me/plan')]).then(([s, p]) => { setSettings(s); setPlan(p); });
  }, [api]);

  const toggle = async (key: string, val: boolean) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    await api('/tg/me/settings', { method: 'PATCH', body: JSON.stringify({ [key]: val }) });
  };

  const handleCashSave = async () => {
    const rubles = parseInt(cashInput.replace(/\D/g, ''), 10);
    if (isNaN(rubles) || rubles < 0) return;
    setCashSaving(true);
    try {
      await api('/tg/cash-anchor', { method: 'POST', body: JSON.stringify({ currentCash: rubles * 100 }) });
      setCashDone(true);
      await onRefresh?.();
      setTimeout(() => { setCashModal(false); setCashDone(false); setCashInput(''); }, 1200);
    } finally { setCashSaving(false); }
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: C.text }}>Настройки</p>

      {/* Cash anchor modal */}
      {cashModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }} onClick={() => setCashModal(false)}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', padding: '24px 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))', width: '100%', boxSizing: 'border-box' }} onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Текущий остаток</p>
            <p style={{ fontSize: 13, color: C.textSec, marginBottom: 20 }}>Укажите, сколько у вас сейчас на руках. Это обновит дневной лимит с учётом реального баланса.</p>
            <input
              type="number" inputMode="decimal" placeholder="0"
              value={cashInput} onChange={e => setCashInput(e.target.value)}
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 16, outline: 'none' }}
            />
            <PrimaryBtn onClick={handleCashSave} disabled={cashSaving || cashDone}>
              {cashDone ? '✓ Сохранено' : cashSaving ? 'Сохраняем...' : 'Обновить остаток'}
            </PrimaryBtn>
          </div>
        </div>
      )}

      {plan && (
        <Card style={{ marginBottom: 20, background: plan.plan === 'PRO' ? 'linear-gradient(145deg, #1E1535, #1A1028)' : C.surface, border: `1px solid ${plan.plan === 'PRO' ? C.accent : C.borderSubtle}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{plan.plan === 'PRO' ? 'PRO план' : 'FREE план'}</p>
              <p style={{ fontSize: 12, color: C.textSec }}>{plan.plan === 'PRO' ? 'Активна подписка' : 'Обновитесь до PRO'}</p>
            </div>
            {plan.plan === 'FREE' && (
              <button onClick={onOpenPro} style={{ padding: '8px 16px', background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>PRO</button>
            )}
          </div>
        </Card>
      )}

      {/* Budget management links */}
      <p style={{ fontSize: 12, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>Бюджет</p>
      {[
        { label: 'Текущий остаток', icon: '💵', desc: 'Обновить сколько денег на руках', onClick: () => setCashModal(true) },
        { label: 'Даты зарплаты', icon: '📅', desc: 'Когда приходят деньги', onClick: onOpenPaydays },
        { label: 'Доходы', icon: '💰', desc: 'Зарплата и другие поступления', onClick: onOpenIncomes },
        { label: 'Обязательства', icon: '📋', desc: 'Аренда, ЖКХ, подписки', onClick: onOpenObligations },
      ].map((item) => (
        <div key={item.label} onClick={item.onClick} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '14px 16px', marginBottom: 2, cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            <div>
              <p style={{ fontSize: 14, color: C.text }}>{item.label}</p>
              <p style={{ fontSize: 12, color: C.textTertiary }}>{item.desc}</p>
            </div>
          </div>
          <span style={{ color: C.textMuted, fontSize: 18 }}>›</span>
        </div>
      ))}
      <div style={{ marginBottom: 16 }} />

      {settings && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>Уведомления</p>
          {[
            { key: 'morningNotifyEnabled', label: 'Утреннее S2S', desc: settings.morningNotifyTime },
            { key: 'eveningNotifyEnabled', label: 'Вечернее напоминание', desc: settings.eveningNotifyTime },
            { key: 'paymentAlerts', label: 'Напоминания о платежах', desc: 'за день до' },
            { key: 'deficitAlerts', label: 'Дефицит бюджета', desc: 'когда перерасход' },
          ].map(({ key, label, desc }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '14px 16px', marginBottom: 2 }}>
              <div>
                <p style={{ fontSize: 14, color: C.text }}>{label}</p>
                <p style={{ fontSize: 12, color: C.textTertiary }}>{desc}</p>
              </div>
              <div
                onClick={() => toggle(key, !settings[key])}
                style={{ width: 44, height: 26, background: settings[key] ? C.accent : C.elevated, borderRadius: 13, position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
              >
                <div style={{ width: 22, height: 22, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, left: settings[key] ? 20 : 2, transition: 'left 0.2s' }} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Paydays Screen ───────────────────────────────────────────────────────────

function PaydaysScreen({ api, onBack, onChanged }: { api: (p: string, o?: RequestInit) => Promise<any>; onBack: () => void; onChanged: () => void }) {
  const [incomes, setIncomes] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, { payday: number; customPayday: string; twoPaydays: boolean; payday2: number; customPayday2: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const payOptions = [1, 5, 10, 15, 20, 25];

  const loadIncomes = () => {
    api('/tg/incomes').then((data) => {
      setIncomes(data);
      const init: Record<string, { payday: number; customPayday: string; twoPaydays: boolean; payday2: number; customPayday2: string }> = {};
      for (const inc of data) {
        const days = (inc.paydays as number[]) ?? [15];
        init[inc.id] = {
          payday: days[0] ?? 15,
          customPayday: String(days[0] ?? 15),
          twoPaydays: days.length >= 2,
          payday2: days[1] ?? (payOptions.find(d => d !== days[0]) ?? 1),
          customPayday2: String(days[1] ?? (payOptions.find(d => d !== days[0]) ?? 1)),
        };
      }
      setEdits(init);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadIncomes(); }, [api]);

  const handleDeleteIncome = async (id: string) => {
    await api(`/tg/incomes/${id}`, { method: 'DELETE' });
    await api('/tg/periods/recalculate', { method: 'POST', body: '{}' }).catch(() => {});
    onChanged();
    loadIncomes();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const inc of incomes) {
        const e = edits[inc.id];
        if (!e) continue;
        const day1 = parseInt(e.customPayday, 10) || e.payday;
        const day2 = parseInt(e.customPayday2, 10) || e.payday2;
        const paydays = e.twoPaydays
          ? [...new Set([day1, day2])].filter(d => d >= 1 && d <= 31).sort((a, b) => a - b)
          : [day1];
        await api(`/tg/incomes/${inc.id}`, { method: 'PATCH', body: JSON.stringify({ paydays }) });
      }
      await api('/tg/periods/recalculate', { method: 'POST', body: '{}' }).catch(() => {});
      onChanged();
      onBack();
    } finally { setSaving(false); }
  };

  const upd = (id: string, patch: Partial<{ payday: number; customPayday: string; twoPaydays: boolean; payday2: number; customPayday2: string }>) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>Даты зарплаты</h2>
      </div>
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 20 }}>Укажите, в какие дни вы получаете деньги. Это влияет на расчёт дневного лимита.</p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}><Spinner /></div>
      ) : incomes.length === 0 ? (
        <Card><p style={{ color: C.textSec, fontSize: 14, textAlign: 'center' }}>Нет доходов. Сначала добавьте доход в разделе «Доходы».</p></Card>
      ) : (
        incomes.map((inc) => {
          const e = edits[inc.id];
          if (!e) return null;
          const day1 = parseInt(e.customPayday, 10) || e.payday;
          const day2 = parseInt(e.customPayday2, 10) || e.payday2;
          return (
            <Card key={inc.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 2 }}>{inc.title}</p>
                  <p style={{ fontSize: 12, color: C.textTertiary }}>{fmt(inc.amount, inc.currency)} / мес</p>
                </div>
                <button
                  onClick={() => handleDeleteIncome(inc.id)}
                  style={{ background: C.redBg, border: 'none', borderRadius: 8, color: C.red, fontSize: 16, width: 32, height: 32, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                  title="Удалить источник дохода"
                >✕</button>
              </div>

              <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8, marginTop: 12 }}>День зарплаты</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {payOptions.map((d) => (
                  <button key={d} onClick={() => upd(inc.id, { payday: d, customPayday: String(d) })}
                    style={{ padding: '8px 14px', borderRadius: 20, background: day1 === d ? C.accentBgStrong : C.elevated, border: `1px solid ${day1 === d ? C.accent : C.border}`, color: day1 === d ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {d}
                  </button>
                ))}
                <input
                  type="number" min={1} max={31}
                  value={e.customPayday}
                  onChange={(ev) => upd(inc.id, { customPayday: ev.target.value })}
                  placeholder="др."
                  style={{ width: 52, padding: '8px 8px', borderRadius: 20, background: !payOptions.includes(day1) ? C.accentBgStrong : C.elevated, border: `1px solid ${!payOptions.includes(day1) ? C.accent : C.border}`, color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }}
                />
                <button
                  onClick={() => upd(inc.id, { twoPaydays: !e.twoPaydays })}
                  style={{ padding: '8px 14px', borderRadius: 20, background: e.twoPaydays ? C.accentBgStrong : C.elevated, border: `1px solid ${e.twoPaydays ? C.accent : C.border}`, color: e.twoPaydays ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {e.twoPaydays ? '− убрать 2-й' : '+ 2-й день'}
                </button>
              </div>

              {e.twoPaydays && (
                <div style={{ marginTop: 4, padding: '12px', background: C.elevated, borderRadius: 10 }}>
                  <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 8 }}>Второй день зарплаты:</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {payOptions.map((d) => (
                      <button key={d} onClick={() => upd(inc.id, { payday2: d, customPayday2: String(d) })}
                        style={{ padding: '8px 14px', borderRadius: 20, background: day2 === d ? C.accentBgStrong : C.elevated, border: `1px solid ${day2 === d ? C.accent : C.border}`, color: day2 === d ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
                        {d}
                      </button>
                    ))}
                    <input
                      type="number" min={1} max={31}
                      value={e.customPayday2}
                      onChange={(ev) => upd(inc.id, { customPayday2: ev.target.value })}
                      placeholder="др."
                      style={{ width: 52, padding: '8px 8px', borderRadius: 20, background: !payOptions.includes(day2) ? C.accentBgStrong : C.elevated, border: `1px solid ${!payOptions.includes(day2) ? C.accent : C.border}`, color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }}
                    />
                  </div>
                </div>
              )}
            </Card>
          );
        })
      )}

      {incomes.length > 0 && (
        <PrimaryBtn onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
          {saving ? 'Сохранение...' : 'Сохранить и пересчитать'}
        </PrimaryBtn>
      )}
    </div>
  );
}

// ── Incomes Screen ───────────────────────────────────────────────────────────

interface Income {
  id: string; title: string; amount: number; currency: string;
  frequency: string; paydays: number[]; monthlyEquivalent?: number;
}

const FREQ_LABELS: Record<string, string> = {
  MONTHLY: 'Ежемесячно', BIWEEKLY: 'Раз в 2 недели', WEEKLY: 'Еженедельно', IRREGULAR: 'Нерегулярно',
};

function IncomesScreen({ api, onBack, onChanged }: { api: (p: string, o?: RequestInit) => Promise<any>; onBack: () => void; onChanged: () => void }) {
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [payday, setPayday] = useState(15);
  const [twoPaydays, setTwoPaydays] = useState(false);
  const [payday2, setPayday2] = useState(1);
  const [useRuCalendar, setUseRuCalendar] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api('/tg/incomes').then(setIncomes).finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!title.trim() || !amount) return;
    setSaving(true);
    try {
      await api('/tg/incomes', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), amount: parseFloat(amount) * 100, paydays: twoPaydays ? [...new Set([payday, payday2])].sort((a, b) => a - b) : [payday], currency: 'RUB', useRussianWorkCalendar: useRuCalendar }),
      });
      await api('/tg/periods/recalculate', { method: 'POST', body: '{}' }).catch(() => {});
      setTitle(''); setAmount(''); setPayday(15); setPayday2(1); setTwoPaydays(false); setUseRuCalendar(false); setShowForm(false);
      load(); onChanged();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await api(`/tg/incomes/${id}`, { method: 'DELETE' });
    await api('/tg/periods/recalculate', { method: 'POST', body: '{}' }).catch(() => {});
    load(); onChanged();
  };

  const payOptions = [1, 5, 10, 15, 20, 25];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit' }}>←</button>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>Доходы</h2>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', background: showForm ? C.surface : `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>Новый доход</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название (напр. Зарплата)" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Сумма в месяц (₽)" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>День зарплаты</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {payOptions.map((d) => (
              <button key={d} onClick={() => setPayday(d)} style={{ padding: '8px 14px', borderRadius: 20, background: payday === d ? C.accentBgStrong : C.elevated, border: `1px solid ${payday === d ? C.accent : C.border}`, color: payday === d ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>{d}</button>
            ))}
            <button onClick={() => { setTwoPaydays(!twoPaydays); if (!twoPaydays) { const other = payOptions.find(d => d !== payday) ?? 1; setPayday2(other); } }} style={{ padding: '8px 14px', borderRadius: 20, background: twoPaydays ? C.accentBgStrong : C.elevated, border: `1px solid ${twoPaydays ? C.accent : C.border}`, color: twoPaydays ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>2 раза</button>
          </div>
          {twoPaydays && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 6 }}>Второй день зарплаты:</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {payOptions.map((d) => (
                  <button key={d} onClick={() => setPayday2(d)} style={{ padding: '8px 14px', borderRadius: 20, background: payday2 === d ? C.accentBgStrong : C.elevated, border: `1px solid ${payday2 === d ? C.accent : C.border}`, color: payday2 === d ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>{d}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '10px 12px', background: C.elevated, borderRadius: 8 }}>
            <div>
              <p style={{ fontSize: 13, color: C.text, marginBottom: 2 }}>Производственный календарь РФ</p>
              <p style={{ fontSize: 11, color: C.textTertiary }}>Перенос на пятницу при выходном/празднике</p>
            </div>
            <div
              onClick={() => setUseRuCalendar(!useRuCalendar)}
              style={{ width: 40, height: 24, background: useRuCalendar ? C.accent : C.elevated, border: `1px solid ${C.border}`, borderRadius: 12, position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}
            >
              <div style={{ width: 20, height: 20, background: '#fff', borderRadius: '50%', position: 'absolute', top: 1, left: useRuCalendar ? 18 : 1, transition: 'left 0.2s' }} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }} />
          <PrimaryBtn onClick={handleAdd} disabled={saving || !title.trim() || !amount}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </PrimaryBtn>
        </Card>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}><Spinner /></div>
      ) : incomes.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.textSec, marginTop: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
          <p>Нет источников дохода</p>
        </div>
      ) : (
        incomes.map((inc) => (
          <Card key={inc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 3 }}>{inc.title}</p>
              <p style={{ fontSize: 13, color: C.textSec }}>{fmt(inc.monthlyEquivalent ?? inc.amount, inc.currency)} / мес · {FREQ_LABELS[inc.frequency] || inc.frequency}</p>
              <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>Зарплата: {(inc.paydays as number[]).join(', ')} числа</p>
            </div>
            <button onClick={() => handleDelete(inc.id)} style={{ background: C.redBg, border: 'none', borderRadius: 8, color: C.red, fontSize: 18, width: 36, height: 36, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>✕</button>
          </Card>
        ))
      )}
    </div>
  );
}

// ── Obligations Screen ────────────────────────────────────────────────────────

interface Obligation {
  id: string; title: string; type: string; amount: number; currency: string; dueDay?: number;
}

const OB_TYPES = [
  { value: 'RENT', label: 'Аренда' },
  { value: 'UTILITIES', label: 'ЖКХ' },
  { value: 'SUBSCRIPTION', label: 'Подписка' },
  { value: 'TELECOM', label: 'Связь' },
  { value: 'INSURANCE', label: 'Страховка' },
  { value: 'OTHER', label: 'Другое' },
];

function ObligationsScreen({ api, onBack, onChanged }: { api: (p: string, o?: RequestInit) => Promise<any>; onBack: () => void; onChanged: () => void }) {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('OTHER');
  const [dueDay, setDueDay] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api('/tg/obligations').then(setObligations).finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!title.trim() || !amount) return;
    setSaving(true);
    try {
      await api('/tg/obligations', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), amount: parseFloat(amount) * 100, type, dueDay: dueDay ? parseInt(dueDay) : undefined }),
      });
      await api('/tg/periods/recalculate', { method: 'POST', body: '{}' }).catch(() => {});
      setTitle(''); setAmount(''); setType('OTHER'); setDueDay(''); setShowForm(false);
      load(); onChanged();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await api(`/tg/obligations/${id}`, { method: 'DELETE' });
    await api('/tg/periods/recalculate', { method: 'POST', body: '{}' }).catch(() => {});
    load(); onChanged();
  };

  const obTypeLabel = (t: string) => OB_TYPES.find((x) => x.value === t)?.label || t;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit' }}>←</button>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>Обязательства</h2>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', background: showForm ? C.surface : `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>Новое обязательство</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название (напр. Аренда квартиры)" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Сумма в месяц (₽)" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>Категория</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {OB_TYPES.map((t) => (
              <button key={t.value} onClick={() => setType(t.value)} style={{ padding: '7px 14px', borderRadius: 20, background: type === t.value ? C.accentBgStrong : C.elevated, border: `1px solid ${type === t.value ? C.accent : C.border}`, color: type === t.value ? C.accentLight : C.textSec, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>{t.label}</button>
            ))}
          </div>
          <input value={dueDay} onChange={(e) => setDueDay(e.target.value)} type="number" placeholder="День списания (необязательно)" style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 14, outline: 'none', boxSizing: 'border-box' }} />
          <PrimaryBtn onClick={handleAdd} disabled={saving || !title.trim() || !amount}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </PrimaryBtn>
        </Card>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}><Spinner /></div>
      ) : obligations.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.textSec, marginTop: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p>Нет обязательных расходов</p>
        </div>
      ) : (
        obligations.map((ob) => (
          <Card key={ob.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 3 }}>{ob.title}</p>
              <p style={{ fontSize: 13, color: C.textSec }}>{fmt(ob.amount, ob.currency || 'RUB')} / мес · {obTypeLabel(ob.type)}</p>
              {ob.dueDay && <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>Списание: {ob.dueDay} числа</p>}
            </div>
            <button onClick={() => handleDelete(ob.id)} style={{ background: C.redBg, border: 'none', borderRadius: 8, color: C.red, fontSize: 18, width: 36, height: 36, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>✕</button>
          </Card>
        ))
      )}
    </div>
  );
}

// ── Period Summary ───────────────────────────────────────────────────────────

function PeriodSummary({ data, onClose }: { data: PeriodSummaryData; onClose: () => void }) {
  const { currency } = data;
  const saved = data.saved;
  const isSaved = saved >= 0;
  const pct = data.s2sPeriod > 0 ? Math.min(100, Math.round((data.totalSpent / data.s2sPeriod) * 100)) : 0;

  const mo = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const s = new Date(data.startDate);
  const e = new Date(data.endDate);
  const periodLabel = `${mo[s.getMonth()]} ${s.getDate()} — ${mo[e.getMonth()]} ${e.getDate()}`;

  const barColor = pct > 100 ? C.red : pct > 80 ? C.orange : C.green;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={onClose} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>Итоги периода</h2>
      </div>

      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 20, marginTop: -16 }}>{periodLabel} · {data.daysTotal} дней</p>

      {/* Result banner */}
      <div style={{ background: isSaved ? C.greenBg : C.redBg, border: `1px solid ${isSaved ? C.greenDim : C.red}40`, borderRadius: 16, padding: '20px 18px', marginBottom: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>{isSaved ? '🎉' : '😬'}</div>
        <div style={{ fontSize: 14, color: C.textSec, marginBottom: 4 }}>
          {isSaved ? 'Сэкономили' : 'Перерасход'}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: isSaved ? C.green : C.red }}>
          {fmt(Math.abs(saved), currency)}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Бюджет периода', value: fmt(data.s2sPeriod, currency), color: C.text },
          { label: 'Потрачено', value: fmt(data.totalSpent, currency), color: pct > 100 ? C.red : C.text },
          { label: 'Дн. лимит был', value: fmt(data.s2sDaily, currency), color: C.text },
          { label: 'Дней с перерасх.', value: `${data.overspentDays}`, color: data.overspentDays > 0 ? C.orange : C.green },
        ].map((stat) => (
          <Card key={stat.label} style={{ marginBottom: 0, padding: '14px 14px' }}>
            <div style={{ fontSize: 11, color: C.textSec, marginBottom: 4 }}>{stat.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: stat.color }}>{stat.value}</div>
          </Card>
        ))}
      </div>

      {/* Spend progress */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: C.textSec }}>Израсходовано бюджета</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: barColor }}>{pct}%</span>
        </div>
        <ProgressBar value={data.totalSpent} max={data.s2sPeriod} color={barColor} />
      </Card>

      {/* Top expenses */}
      {data.topExpenses.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, color: C.textSec, marginBottom: 12 }}>Крупные траты</div>
          {data.topExpenses.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: i < data.topExpenses.length - 1 ? 10 : 0, marginBottom: i < data.topExpenses.length - 1 ? 10 : 0, borderBottom: i < data.topExpenses.length - 1 ? `1px solid ${C.borderSubtle}` : 'none' }}>
              <span style={{ fontSize: 14, color: C.text }}>{e.note || 'Без комментария'}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{fmt(e.amount, currency)}</span>
            </div>
          ))}
        </Card>
      )}

      <PrimaryBtn onClick={onClose}>Перейти к новому периоду</PrimaryBtn>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function MiniApp() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [navTab, setNavTab] = useState<NavTab>('dashboard');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [onbResult, setOnbResult] = useState<{ s2sDaily: number; currency: string } | null>(null);
  const [periodSummary, setPeriodSummary] = useState<PeriodSummaryData | null>(null);
  const [showSummaryBanner, setShowSummaryBanner] = useState(false);
  const { api, initDataRef, devMode } = useApi();

  const loadDashboard = useCallback(async () => {
    const data = await api('/tg/dashboard');
    setDashboard(data);
    // Check if there's a recent completed period to show summary banner
    api('/tg/periods/last-completed').then((summary: PeriodSummaryData | null) => {
      if (summary) {
        setPeriodSummary(summary);
        // Show banner only if period ended within last 3 days
        const endDate = new Date(summary.endDate);
        const diffDays = (Date.now() - endDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays <= 3) setShowSummaryBanner(true);
      }
    }).catch(() => {});
    return data;
  }, [api]);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) {
      // Dev mode
      devMode.current = true;

      api('/tg/onboarding/status').then((d) => {
        if (d.onboardingDone) {
          loadDashboard().then(() => setScreen('dashboard')).catch(() => setScreen('dashboard'));
        } else {
          setScreen('onboarding-welcome');
        }
      }).catch(() => setScreen('onboarding-welcome'));
      return;
    }

    initDataRef.current = tg.initData || '';
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor(C.bg); tg.setBackgroundColor(C.bg); } catch {}

    api('/tg/onboarding/status').then((d) => {
      if (d.onboardingDone) {
        loadDashboard().then(() => setScreen('dashboard')).catch(() => setScreen('dashboard'));
      } else {
        setScreen('onboarding-welcome');
      }
    }).catch((e) => { setError(String(e)); setScreen('error'); });
  }, [api, initDataRef, devMode, loadDashboard]);

  // ── Onboarding handlers ──────────────────────────────────────────────────

  const handleIncome = async (data: any) => {
    await api('/tg/onboarding/income', { method: 'POST', body: JSON.stringify(data) });
    setScreen('onboarding-obligations');
  };

  const handleObligations = async (obligations: any[]) => {
    await api('/tg/onboarding/obligations', { method: 'POST', body: JSON.stringify({ obligations }) });
    setScreen('onboarding-debts');
  };

  const handleDebts = async (debts: any[]) => {
    await api('/tg/onboarding/debts', { method: 'POST', body: JSON.stringify({ debts }) });
    setScreen('onboarding-ef');
  };

  const handleEF = async (currentAmount: number) => {
    await api('/tg/onboarding/ef', { method: 'POST', body: JSON.stringify({ currentAmount }) });
    setScreen('onboarding-cash');
  };

  const handleCash = async (currentCash: number) => {
    const result = await api('/tg/onboarding/complete', { method: 'POST', body: JSON.stringify({ currentCash }) });
    setOnbResult({ s2sDaily: result.s2s.s2sDaily, currency: result.period.currency });
    setScreen('onboarding-result');
  };

  const handleOnbDone = async () => {
    await loadDashboard();
    setScreen('dashboard');
  };

  // ── Expense handler ──────────────────────────────────────────────────────

  const handleSaveExpense = async (amount: number, note: string) => {
    await api('/tg/expenses', { method: 'POST', body: JSON.stringify({ amount, note: note || undefined }) });
    await loadDashboard();
    setScreen('dashboard');
    setNavTab('dashboard');
  };

  // ── Nav ──────────────────────────────────────────────────────────────────

  const handleTab = (tab: NavTab) => {
    setNavTab(tab);
    setScreen(tab);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (screen === 'loading') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, gap: 16 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <Spinner />
      <p style={{ color: C.textSec, fontSize: 14 }}>Загрузка...</p>
    </div>
  );

  if (screen === 'error') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, gap: 16, padding: 24 }}>
      <p style={{ color: C.red, fontSize: 16, textAlign: 'center' }}>{error || 'Ошибка загрузки'}</p>
      <PrimaryBtn onClick={() => window.location.reload()} style={{ maxWidth: 200 }}>Повторить</PrimaryBtn>
    </div>
  );

  if (screen === 'onboarding-welcome') return <OnbWelcome onStart={() => setScreen('onboarding-income')} />;
  if (screen === 'onboarding-income') return <OnbIncome onNext={handleIncome} />;
  if (screen === 'onboarding-obligations') return <OnbObligations onNext={handleObligations} onSkip={() => handleObligations([])} />;
  if (screen === 'onboarding-debts') return <OnbDebts onNext={handleDebts} onSkip={() => handleDebts([])} />;
  if (screen === 'onboarding-ef') return <OnbEF onNext={handleEF} />;
  if (screen === 'onboarding-cash') return <OnbCash onNext={handleCash} onSkip={() => handleCash(0)} />;
  if (screen === 'onboarding-result' && onbResult) return <OnbResult s2sDaily={onbResult.s2sDaily} currency={onbResult.currency} onDone={handleOnbDone} />;

  if (screen === 'add-expense') return (
    <AddExpense
      s2sToday={dashboard?.s2sToday ?? 0}
      currency={dashboard?.currency ?? 'RUB'}
      onSave={handleSaveExpense}
      onBack={() => { setScreen('dashboard'); setNavTab('dashboard'); }}
    />
  );

  if (screen === 'pro') return <ProPaywall onBack={() => { setScreen('settings'); setNavTab('settings'); }} api={api} />;

  if (screen === 'incomes') return (
    <IncomesScreen
      api={api}
      onBack={() => { setScreen('settings'); setNavTab('settings'); }}
      onChanged={loadDashboard}
    />
  );

  if (screen === 'obligations') return (
    <ObligationsScreen
      api={api}
      onBack={() => { setScreen('settings'); setNavTab('settings'); }}
      onChanged={loadDashboard}
    />
  );

  if (screen === 'paydays') return (
    <PaydaysScreen
      api={api}
      onBack={() => { setScreen('settings'); setNavTab('settings'); }}
      onChanged={loadDashboard}
    />
  );

  if (screen === 'period-summary' && periodSummary) return (
    <PeriodSummary
      data={periodSummary}
      onClose={() => { setShowSummaryBanner(false); setScreen('dashboard'); setNavTab('dashboard'); }}
    />
  );

  // Screens with bottom nav
  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {screen === 'dashboard' && dashboard && (
        <Dashboard
          data={dashboard}
          onAddExpense={() => setScreen('add-expense')}
          onOpenDebts={() => { setScreen('debts'); setNavTab('debts'); }}
          onOpenEF={() => setScreen('emergency-fund-detail')}
          onOpenSummary={periodSummary ? () => setScreen('period-summary') : undefined}
          showSummaryBanner={showSummaryBanner}
        />
      )}
      {screen === 'dashboard' && !dashboard && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><Spinner /></div>
      )}
      {screen === 'history' && <History api={api} currency={dashboard?.currency ?? 'RUB'} onRefresh={loadDashboard} />}
      {screen === 'debts' && <DebtsScreen api={api} currency={dashboard?.currency ?? 'RUB'} onRefresh={loadDashboard} />}
      {screen === 'emergency-fund-detail' && <EmergencyFundScreen api={api} onBack={() => setScreen('dashboard')} onRefresh={loadDashboard} />}
      {screen === 'settings' && <Settings api={api} onOpenPro={() => setScreen('pro')} onOpenIncomes={() => setScreen('incomes')} onOpenObligations={() => setScreen('obligations')} onOpenPaydays={() => setScreen('paydays')} onRefresh={loadDashboard} />}

      <BottomNav
        active={navTab}
        onTab={handleTab}
        onAdd={() => setScreen('add-expense')}
      />
    </div>
  );
}
