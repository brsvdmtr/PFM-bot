'use client';

import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import {
  detectLocale,
  formatMoney as formatMoneyShared,
  formatNumber,
  formatDayLabel,
  formatPeriodLabel,
  monthShortCap,
  monthShortGen,
  t as tr,
  type Locale,
} from '@pfm/shared';

// ── Locale context ──────────────────────────────────────────────────────────

const LocaleCtx = createContext<Locale>('en');
function useLocale(): Locale { return useContext(LocaleCtx); }
function useT() {
  const locale = useLocale();
  return useCallback((path: string, vars?: Record<string, string | number>) => tr(locale, path, vars), [locale]);
}

/** Read locale from Telegram WebApp init data; falls back to 'en'. */
function detectClientLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const tg = (window as any).Telegram?.WebApp;
  return detectLocale(tg?.initDataUnsafe?.user?.language_code);
}

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
  accelerationHint?: DebtAccelerationHint | null;
}
interface DebtAccelerationScenario {
  key: string; dailyCutMinor: number; monthlyExtraMinor: number;
  payoffMonths: number | null; monthsSaved: number | null;
  interestSavedMinor: number | null; tooAggressive: boolean;
}
interface DebtAccelerationHint {
  eligible: boolean; state: string; isPro: boolean; currency: string; focusDebtId: string | null;
  baseScenario: { dailyCutMinor: number; monthlyExtraMinor: number; copy: string } | null;
  proScenarios: DebtAccelerationScenario[] | null;
  copy: { title: string; body: string; cta?: string; warning?: string };
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

function fmt(amount: number, currency = 'RUB', locale: Locale = 'en') {
  const n = Math.abs(amount);
  return formatMoneyShared(n, currency, locale);
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

function periodLabel(start: string, end: string, locale: Locale = 'en') {
  return formatPeriodLabel(start, end, locale);
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

function dayLabel(d: Date, locale: Locale = 'en') {
  return formatDayLabel(d, locale);
}

function debtTypeLabel(type: string, locale: Locale = 'en') {
  return tr(locale, `debtTypes.${type}`) || type;
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
  const t = useT();
  const items: { id: NavTab | 'add'; icon: string; label: string }[] = [
    { id: 'dashboard', icon: '⊙', label: t('nav.home') },
    { id: 'history', icon: '☰', label: t('nav.history') },
    { id: 'add', icon: '+', label: '' },
    { id: 'debts', icon: '💳', label: t('nav.debts') },
    { id: 'settings', icon: '⚙', label: t('nav.more') },
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
  const t = useT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, padding: '0 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>💜</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12, color: C.text, background: `linear-gradient(135deg, ${C.accentLight}, ${C.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{t('onboarding.welcomeTitle')}</h1>
      <p style={{ color: C.textSec, fontSize: 16, lineHeight: 1.6, marginBottom: 40, maxWidth: 300 }}>
        {t('onboarding.welcomeDesc')}
      </p>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <PrimaryBtn onClick={onStart}>{t('onboarding.welcomeBtn')}</PrimaryBtn>
      </div>
      <p style={{ color: C.textMuted, fontSize: 12, marginTop: 16 }}>{t('onboarding.welcomeTime')}</p>
    </div>
  );
}

function OnbIncome({ onNext }: { onNext: (data: { amount: number; paydays: number[]; currency: string; useRussianWorkCalendar?: boolean }) => void }) {
  const t = useT();
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
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>{t('onboarding.stepOf', { n: 1 })}</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>{t('onboarding.incomeTitle')}</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 28 }}>{t('onboarding.incomeDesc')}</p>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>{t('onboarding.incomeAmountLabel')}</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t('onboarding.incomeAmountPh')}
          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', color: C.text, fontSize: 18, fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>{t('onboarding.currencyLabel')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['RUB', 'USD'] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} style={{ padding: '10px 20px', borderRadius: 24, background: currency === c ? C.accentBgStrong : C.surface, border: `1px solid ${currency === c ? C.accent : C.border}`, color: currency === c ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
              {c === 'RUB' ? '₽ RUB' : '$ USD'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>{t('onboarding.paydayLabel')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {payOptions.map((d) => (
            <button key={d} onClick={() => setPayday([d])} style={{ padding: '10px 16px', borderRadius: 24, background: payday.includes(d) ? C.accentBgStrong : C.surface, border: `1px solid ${payday.includes(d) ? C.accent : C.border}`, color: payday.includes(d) ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
              {d}
            </button>
          ))}
          <button onClick={() => { setTwoPaydays(!twoPaydays); if (!twoPaydays) { const other = payOptions.find(d => !payday.includes(d)) ?? 1; setPayday2([other]); } }} style={{ padding: '10px 16px', borderRadius: 24, background: twoPaydays ? C.accentBgStrong : C.surface, border: `1px solid ${twoPaydays ? C.accent : C.border}`, color: twoPaydays ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('onboarding.twoTimes')}</button>
        </div>
        {twoPaydays && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 8 }}>{t('onboarding.secondPayday')}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {payOptions.map((d) => (
                <button key={d} onClick={() => setPayday2([d])} style={{ padding: '10px 16px', borderRadius: 24, background: payday2.includes(d) ? C.accentBgStrong : C.surface, border: `1px solid ${payday2.includes(d) ? C.accent : C.border}`, color: payday2.includes(d) ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
        <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 8 }}>{t('onboarding.paydayHint')}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 13, color: C.text, marginBottom: 2 }}>{t('onboarding.ruCalLabel')}</p>
          <p style={{ fontSize: 11, color: C.textTertiary }}>{t('onboarding.ruCalDesc')}</p>
        </div>
        <div
          onClick={() => setUseRuCal(!useRuCal)}
          style={{ width: 40, height: 24, background: useRuCal ? C.accent : C.elevated, border: `1px solid ${C.border}`, borderRadius: 12, position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}
        >
          <div style={{ width: 20, height: 20, background: '#fff', borderRadius: '50%', position: 'absolute', top: 1, left: useRuCal ? 18 : 1, transition: 'left 0.2s' }} />
        </div>
      </div>

      <PrimaryBtn onClick={handleNext} disabled={!amount || parseInt(amount, 10) <= 0}>{t('common.continue')}</PrimaryBtn>
    </div>
  );
}

function OnbObligations({ onNext, onSkip }: { onNext: (data: any[]) => void; onSkip: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState([{ title: '', type: 'RENT', amount: '' }]);

  const add = () => setItems([...items, { title: '', type: 'OTHER', amount: '' }]);
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: string, value: string) => {
    const next = [...items];
    (next[i] as any)[field] = value;
    setItems(next);
  };

  const types = [
    { v: 'RENT', l: tr(locale, 'obligationTypes.RENT') },
    { v: 'UTILITIES', l: tr(locale, 'obligationTypes.UTILITIES') },
    { v: 'TELECOM', l: tr(locale, 'obligationTypes.TELECOM') },
    { v: 'INSURANCE', l: tr(locale, 'obligationTypes.INSURANCE') },
    { v: 'SUBSCRIPTION', l: tr(locale, 'obligationTypes.SUBSCRIPTION') },
    { v: 'OTHER', l: tr(locale, 'obligationTypes.OTHER') },
  ];

  const valid = items.filter((i) => i.title && parseInt(i.amount, 10) > 0);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={1} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>{t('onboarding.stepOf', { n: 2 })}</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>{t('onboarding.obligTitle')}</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>{t('onboarding.obligDesc')}</p>

      {items.map((item, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: 14, marginBottom: 10, position: 'relative' }}>
          {items.length > 1 && (
            <button onClick={() => remove(i)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: C.textTertiary, cursor: 'pointer', fontSize: 16 }}>✕</button>
          )}
          <input value={item.title} onChange={(e) => update(i, 'title', e.target.value)} placeholder={t('onboarding.obligNamePh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={item.type} onChange={(e) => update(i, 'type', e.target.value)} style={{ flex: 1, background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
              {types.map((tt) => <option key={tt.v} value={tt.v}>{tt.l}</option>)}
            </select>
            <input type="number" value={item.amount} onChange={(e) => update(i, 'amount', e.target.value)} placeholder={t('onboarding.obligAmountPh')} style={{ width: 110, background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
          </div>
        </div>
      ))}

      <button onClick={add} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 20 }}>
        {t('onboarding.addMore')}
      </button>

      <PrimaryBtn onClick={() => onNext(valid.map((it) => ({ title: it.title, type: it.type, amount: parseInt(it.amount, 10) * 100 })))} disabled={valid.length === 0}>{t('common.continue')}</PrimaryBtn>
      <SecondaryBtn onClick={onSkip}>{t('common.skip')}</SecondaryBtn>
    </div>
  );
}

function OnbDebts({ onNext, onSkip }: { onNext: (data: any[]) => void; onSkip: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState([{ title: '', type: 'CREDIT_CARD', balance: '', apr: '', minPayment: '' }]);

  const add = () => setItems([...items, { title: '', type: 'OTHER', balance: '', apr: '', minPayment: '' }]);
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: string, value: string) => {
    const next = [...items];
    (next[i] as any)[field] = value;
    setItems(next);
  };

  const types = [
    { v: 'CREDIT_CARD', l: tr(locale, 'debtTypes.CREDIT_CARD') },
    { v: 'CREDIT', l: tr(locale, 'debtTypes.CREDIT') },
    { v: 'MORTGAGE', l: tr(locale, 'debtTypes.MORTGAGE') },
    { v: 'CAR_LOAN', l: tr(locale, 'debtTypes.CAR_LOAN') },
    { v: 'PERSONAL_LOAN', l: tr(locale, 'debtTypes.PERSONAL_LOAN') },
    { v: 'OTHER', l: tr(locale, 'debtTypes.OTHER') },
  ];

  const valid = items.filter((i) => i.title && parseFloat(i.balance) > 0 && parseFloat(i.apr) >= 0 && parseInt(i.minPayment, 10) > 0);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px', paddingBottom: 40 }}>
      <OnbProgress step={2} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>{t('onboarding.stepOf', { n: 3 })}</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>{t('onboarding.debtTitle')}</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>{t('onboarding.debtDesc')}</p>

      {items.map((item, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${i === 0 ? C.accent : C.borderSubtle}`, borderLeft: i === 0 ? `3px solid ${C.accent}` : `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: 14, marginBottom: 10, position: 'relative' }}>
          {i === 0 && <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, background: C.accentBg, color: C.accentLight, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{t('onboarding.focusBadge')}</span>}
          {items.length > 1 && i > 0 && (
            <button onClick={() => remove(i)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: C.textTertiary, cursor: 'pointer', fontSize: 16 }}>✕</button>
          )}
          <input value={item.title} onChange={(e) => update(i, 'title', e.target.value)} placeholder={t('onboarding.debtNamePh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
          <select value={item.type} onChange={(e) => update(i, 'type', e.target.value)} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}>
            {types.map((tt) => <option key={tt.v} value={tt.v}>{tt.l}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { field: 'balance', placeholder: t('onboarding.balancePh') },
              { field: 'apr', placeholder: t('onboarding.aprPh') },
              { field: 'minPayment', placeholder: t('onboarding.minPayPh') },
            ].map(({ field, placeholder }) => (
              <input key={field} type="number" value={(item as any)[field]} onChange={(e) => update(i, field, e.target.value)} placeholder={placeholder} style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            ))}
          </div>
        </div>
      ))}

      <button onClick={add} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 20 }}>
        {t('onboarding.addDebt')}
      </button>

      <PrimaryBtn onClick={() => onNext(valid.map((it) => ({ title: it.title, type: it.type, balance: parseFloat(it.balance) * 100, apr: parseFloat(it.apr) / 100, minPayment: parseInt(it.minPayment, 10) * 100 })))} disabled={valid.length === 0}>{t('common.continue')}</PrimaryBtn>
      <SecondaryBtn onClick={onSkip}>{t('onboarding.noDebts')}</SecondaryBtn>
    </div>
  );
}

function OnbEF({ onNext }: { onNext: (amount: number) => void }) {
  const t = useT();
  const [amount, setAmount] = useState('0');
  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={3} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>{t('onboarding.stepOf', { n: 4 })}</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>{t('onboarding.efTitle')}</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 28 }}>{t('onboarding.efDesc')}</p>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>{t('onboarding.efAmountLabel')}</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', color: C.text, fontSize: 18, fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
        <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 8 }}>{t('onboarding.efZeroHint')}</p>
      </div>

      <PrimaryBtn onClick={() => onNext(Math.round(parseFloat(amount || '0') * 100))}>{t('common.continue')}</PrimaryBtn>
    </div>
  );
}

function OnbCash({ onNext, onSkip }: { onNext: (currentCash: number) => void; onSkip: () => void }) {
  const t = useT();
  const [amount, setAmount] = useState('');
  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={4} total={6} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>{t('onboarding.stepOf', { n: 5 })}</p>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: C.text }}>{t('onboarding.cashTitle')}</h2>
      <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.5, marginBottom: 28 }}>
        {t('onboarding.cashDesc')}
      </p>

      <div style={{ background: C.accentBg, border: `1px solid ${C.accent}40`, borderRadius: 12, padding: '12px 16px', marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: C.accentLight, lineHeight: 1.5 }}>
          {t('onboarding.cashTip')}
        </p>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, color: C.textSec, marginBottom: 8 }}>{t('onboarding.cashAmountLabel')}</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t('onboarding.cashAmountPh')}
          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', color: C.text, fontSize: 18, fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 8 }}>{t('onboarding.cashHint')}</p>
      </div>

      <PrimaryBtn
        onClick={() => {
          const n = parseFloat(amount || '0');
          onNext(Math.round(Math.max(0, n) * 100));
        }}
        disabled={amount === ''}
      >
        {t('common.continue')}
      </PrimaryBtn>
      <SecondaryBtn onClick={onSkip}>{t('onboarding.cashSkip')}</SecondaryBtn>
    </div>
  );
}

function OnbResult({ s2sDaily, currency, onDone }: { s2sDaily: number; currency: string; onDone: () => void }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, padding: '0 24px', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: C.textSec, marginBottom: 8 }}>{t('onboarding.resultReady')}</p>
      <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: -2, color: C.green, marginBottom: 8 }}>{fmt(s2sDaily, currency, locale)}</div>
      <p style={{ fontSize: 16, color: C.textSec, marginBottom: 8 }}>{t('onboarding.perDay')}</p>
      <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 40, maxWidth: 300, lineHeight: 1.6 }}>{t('onboarding.resultDesc')}</p>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <PrimaryBtn onClick={onDone}>{t('onboarding.startTracking')}</PrimaryBtn>
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ data, onAddExpense, onOpenDebts, onOpenEF, onOpenSummary, showSummaryBanner }: { data: DashboardData; onAddExpense: () => void; onOpenDebts: () => void; onOpenEF?: () => void; onOpenSummary?: () => void; showSummaryBanner?: boolean }) {
  const t = useT();
  const locale = useLocale();
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
            <div style={{ fontSize: 13, fontWeight: 600, color: C.accentLight }}>{t('dashboard.periodDoneBanner')}</div>
            <div style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>{t('dashboard.periodDoneCta')}</div>
          </div>
        </div>
      )}

      {/* Greeting */}
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 2 }}>{t('dashboard.greeting')}</p>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: C.text }}>{t('dashboard.title')}</p>

      {/* Period context bar */}
      <div style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        {data.usesLiveWindow && data.nextIncomeDate ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: C.textSec }}>{t('dashboard.daysToNextPay')}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.accentLight }}>
                {data.daysToNextIncome != null ? `${data.daysToNextIncome} ${t('common.daysShort')}` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.textTertiary }}>
                {data.lastIncomeDate ? `${new Date(data.lastIncomeDate).getDate()} ${monthShortGen(new Date(data.lastIncomeDate).getMonth(), locale)}` : '—'}
                {' → '}
                {data.nextIncomeDate ? `${new Date(data.nextIncomeDate).getDate()} ${monthShortGen(new Date(data.nextIncomeDate).getMonth(), locale)}` : '—'}
              </span>
              {data.nextIncomeAmount != null && data.nextIncomeAmount > 0 && (
                <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>+{fmt(data.nextIncomeAmount, data.currency, locale)}</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: C.textSec }}>{periodLabel(data.periodStart, data.periodEnd, locale)}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.accentLight }}>{t('dashboard.dayOfPeriod', { n: data.dayNumber ?? (periodElapsed + 1), total: data.daysTotal })}</span>
          </div>
        )}
      </div>

      {/* S2S Card */}
      <div style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 16, padding: '22px 20px', marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-50%', right: '-20%', width: 200, height: 200, background: 'radial-gradient(circle, rgba(139,92,246,0.15), transparent 70%)', pointerEvents: 'none' }} />
        <p style={{ fontSize: 12, color: C.textSec, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>{t('dashboard.s2sTitle')}</p>
        <p style={{ fontSize: 48, fontWeight: 800, letterSpacing: -2, lineHeight: 1, color: mainColor, marginBottom: 4 }}>{fmt(data.s2sToday, data.currency, locale)}</p>
        <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 16 }}>{t('dashboard.dailyLimitLine', { amount: fmt(data.s2sDaily, data.currency, locale) })}</p>
        {data.s2sStatus === 'OVERSPENT' && (
          <div style={{ background: C.redBg, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>{t('dashboard.overspentBy', { amount: fmt(data.todayTotal - data.s2sDaily, data.currency, locale) })}</p>
            <p style={{ fontSize: 12, color: C.textTertiary }}>{t('dashboard.tomorrowLowered')}</p>
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, color: C.textSec }}>{t('dashboard.periodRemaining')}</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{fmt(data.periodRemaining ?? Math.max(0, data.s2sPeriod - data.periodSpent), data.currency, locale)}</span>
        </div>
        {data.cashOnHand != null && (
          <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', paddingTop: 14, marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: C.textSec }}>{t('dashboard.cashOnHand')}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{fmt(data.cashOnHand, data.currency, locale)}</span>
            </div>
            {data.reservedUpcoming != null && data.reservedUpcoming > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: C.textTertiary }}>{t('dashboard.reservedUntilPay')}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.orange }}>−{fmt(data.reservedUpcoming, data.currency, locale)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button onClick={onAddExpense} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: '14px 12px', display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: C.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>+</span>
          {t('dashboard.addExpense')}
        </button>
        <button onClick={onOpenDebts} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: '14px 12px', display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: C.orangeBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>💳</span>
          {t('dashboard.debtsBtn')}
        </button>
      </div>

      {/* Emergency Fund — tappable */}
      {data.emergencyFund && data.emergencyFund.targetAmount > 0 && (
        <Card style={{ cursor: 'pointer' }} onClick={onOpenEF}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{t('dashboard.efTitle')}</span>
            <span style={{ fontSize: 13, color: C.textSec }}>{fmt(data.emergencyFund.currentAmount, data.currency, locale)} / {fmt(data.emergencyFund.targetAmount, data.currency, locale)}</span>
          </div>
          <ProgressBar value={data.emergencyFund.currentAmount} max={data.emergencyFund.targetAmount} color={C.accent} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
            <span>{efPct}%</span>
            <span>{data.emergencyFund.targetAmount > 0 ? t('dashboard.efGoal', { n: Math.round(data.emergencyFund.targetAmount / Math.max(1, data.emergencyFund.targetAmount / ((data.emergencyFund as any).targetMonths || 3))) }) : '—'}</span>
          </div>
        </Card>
      )}

      {/* Debts summary */}
      {data.debts && data.debts.length > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{t('dashboard.debtsAvalanche')}</span>
            <span style={{ fontSize: 11, background: C.accentBg, color: C.accentLight, padding: '3px 8px', borderRadius: 10, fontWeight: 600 }}>{t('dashboard.debtsActive', { n: data.debts.length })}</span>
          </div>
          {data.debts.slice(0, 3).map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.borderSubtle}` }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {d.isFocusDebt && <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent, display: 'inline-block', boxShadow: `0 0 8px ${C.accentGlow}` }} />}
                  {d.title}
                </p>
                <p style={{ fontSize: 12, color: C.textTertiary }}>
                  {t('dashboard.aprLine', { pct: (d.apr * 100).toFixed(1) })}{d.isFocusDebt ? t('dashboard.focusSuffix') : ''}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{fmt(d.balance, data.currency, locale)}</p>
                <p style={{ fontSize: 12, color: C.textTertiary }}>{t('dashboard.minLine', { amount: fmt(d.minPayment, data.currency, locale) })}</p>
              </div>
            </div>
          ))}
          {data.debts.length > 3 && (
            <button onClick={onOpenDebts} style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', color: C.accentLight, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit' }}>
              {t('dashboard.showAll', { n: data.debts.length })}
            </button>
          )}
        </Card>
      )}

      {/* Today expenses */}
      {data.todayExpenses.length > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t('common.today')}</span>
            <span style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>-{fmt(data.todayTotal, data.currency, locale)}</span>
          </div>
          {data.todayExpenses.slice(0, 3).map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.borderSubtle}` }}>
              <span style={{ fontSize: 14, color: C.textSec }}>{e.note || t('addExpense.defaultNote')}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.red }}>-{fmt(e.amount, data.currency, locale)}</span>
            </div>
          ))}
        </Card>
      )}

      {/* Period spending progress */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('dashboard.expensesPeriod')}</span>
          <span style={{ fontSize: 13, color: C.textSec }}>{fmt(data.periodSpent, data.currency, locale)} / {fmt(data.s2sPeriod, data.currency, locale)}</span>
        </div>
        <ProgressBar value={data.periodSpent} max={data.s2sPeriod} color={periodPct > 80 ? C.red : periodPct > 50 ? C.orange : C.green} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
          <span>{t('dashboard.pctSpent', { pct: periodPct })}</span>
          <span>{t('dashboard.daysLeft', { n: data.daysLeft })}</span>
        </div>
      </Card>
    </div>
  );
}

// ── Add Expense (Numpad) ─────────────────────────────────────────────────────

function AddExpense({ s2sToday, currency, onSave, onBack }: { s2sToday: number; currency: string; onSave: (amount: number, note: string) => Promise<void>; onBack: () => void }) {
  const t = useT();
  const locale = useLocale();
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
        <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{t('addExpense.title')}</span>
        <span style={{ width: 28 }} />
      </div>

      <div style={{ textAlign: 'center', padding: '32px 20px 16px' }}>
        <p style={{ fontSize: 16, color: C.textTertiary, marginBottom: 6 }}>{currency === 'USD' ? '$' : '₽'}</p>
        <p style={{ fontSize: 52, fontWeight: 800, letterSpacing: -2, color: C.text, lineHeight: 1 }}>{parseFloat(input).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 2 })}</p>
        <p style={{ fontSize: 14, color: C.textSec, marginTop: 10 }}>
          {t('addExpense.remainsToday')} <span style={{ color: remaining > 0 ? C.green : C.red, fontWeight: 600 }}>{fmt(remaining, currency, locale)}</span>
        </p>
      </div>

      <div style={{ margin: '0 16px 8px', background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: C.textMuted, fontSize: 16 }}>✎</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('addExpense.notePh')} style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 14, fontFamily: 'inherit', outline: 'none', flex: 1 }} />
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
          {saving ? t('common.saving') : t('addExpense.saveWithAmount', { amount: fmt(amountKop, currency, locale) })}
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

function History({ api, currency, onRefresh }: { api: (path: string, opts?: RequestInit) => Promise<any>; currency: string; onRefresh: () => void }) {
  const t = useT();
  const locale = useLocale();
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
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: C.text }}>{t('history.title')}</p>

      <div style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: C.textSec }}>{t('history.currentPeriod')}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.red }}>-{fmt(total, currency, locale)}</span>
      </div>

      {loading && <div style={{ textAlign: 'center', paddingTop: 40 }}><Spinner /></div>}

      {!loading && groups.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: C.textTertiary }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
          <p>{t('history.empty')}</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0 8px', fontSize: 13, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1px' }}>
            <span>{dayLabel(g.date, locale)}</span>
            <span style={{ color: C.textSec, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>-{fmt(g.total, currency, locale)}</span>
          </div>
          {g.items.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${C.borderSubtle}` }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: C.elevated, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💳</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 2 }}>{e.note || t('addExpense.defaultNote')}</p>
                <p style={{ fontSize: 12, color: C.textTertiary }}>{new Date(e.spentAt).toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.red, marginRight: 8 }}>-{fmt(e.amount, currency, locale)}</span>
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
  const t = useT();
  const locale = useLocale();
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
  const [customMode, setCustomMode] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [customFreq, setCustomFreq] = useState<'MONTHLY' | 'BIWEEKLY' | 'WEEKLY'>('MONTHLY');

  const load = useCallback(async () => {
    try {
      const [d, b, p, e] = await Promise.all([
        api('/tg/ef').catch(() => null),
        api('/tg/ef/buckets').catch(() => ({ items: [] })),
        api('/tg/ef/plan').catch(() => null),
        api('/tg/ef/entries').catch(() => ({ items: [] })),
      ]);
      setEf(d);
      setBuckets(b?.items || []);
      setPlanData(p && p.scenarios ? p : null);
      setEntries(e?.items || []);
      if (d?.targetMonths) setTargetMonths(d.targetMonths);
    } catch {}
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) { setError(t('validation.invalidAmount')); return; }
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
      setError(err?.message || t('common.error'));
    }
    setSaving(false);
  };

  const handleSyncBalance = async () => {
    const n = parseFloat(amount);
    if (isNaN(n) || n < 0) { setError(t('validation.invalidAmount')); return; }
    setSaving(true); setError('');
    try {
      await api('/tg/ef/entries', {
        method: 'POST',
        body: JSON.stringify({ type: 'BALANCE_SYNC', amount: Math.round(n * 100), affectsCurrentBudget: false }),
      });
      setAmount(''); setMode('view');
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) { setError(err?.message || t('common.error')); }
    setSaving(false);
  };

  const handleGoalSave = async () => {
    setSaving(true); setError('');
    try {
      await api('/tg/ef', { method: 'PATCH', body: JSON.stringify({ targetMonths }) });
      setMode('view');
      await load();
    } catch (err: any) { setError(err?.message || t('common.error')); }
    setSaving(false);
  };

  const handleAddBucket = async () => {
    if (!newBucket.name.trim()) { setError(t('validation.requiredName')); return; }
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
    } catch (err: any) { setError(err?.message || t('common.error')); }
    setSaving(false);
  };

  const bucketTypes = [
    { v: 'SAVINGS_ACCOUNT', l: tr(locale, 'bucketTypes.SAVINGS_ACCOUNT') },
    { v: 'DEPOSIT', l: tr(locale, 'bucketTypes.DEPOSIT') },
    { v: 'CASH', l: tr(locale, 'bucketTypes.CASH') },
    { v: 'CRYPTO', l: tr(locale, 'bucketTypes.CRYPTO') },
    { v: 'BROKERAGE', l: tr(locale, 'bucketTypes.BROKERAGE') },
    { v: 'OTHER', l: tr(locale, 'bucketTypes.OTHER') },
  ];
  const bucketTypeLabel = (type: string) => bucketTypes.find((bt) => bt.v === type)?.l ?? type;

  const currency = ef?.currency ?? 'RUB';

  if (loading) return <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>;
  if (!ef) return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <button onClick={onBack} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 20 }}>←</button>
      <p style={{ color: C.textSec, textAlign: 'center', marginTop: 40 }}>{t('ef.notSetUp')}</p>
    </div>
  );

  const handleSelectPace = async (pace: string) => {
    try {
      await api('/tg/ef/plan', { method: 'PATCH', body: JSON.stringify({ planSelectionMode: 'SYSTEM', preferredPace: pace }) });
      await load();
    } catch {}
  };

  const handleSaveCustomPlan = async () => {
    const n = parseFloat(customAmount);
    if (isNaN(n) || n <= 0) { setError(t('validation.invalidAmount')); return; }
    setSaving(true); setError('');
    try {
      await api('/tg/ef/plan', {
        method: 'PATCH',
        body: JSON.stringify({ planSelectionMode: 'CUSTOM', customContributionAmount: Math.round(n * 100), customContributionFrequency: customFreq }),
      });
      setCustomMode(false); setCustomAmount('');
      await load();
    } catch (err: any) { setError(err?.message || t('common.error')); }
    setSaving(false);
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px', paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>{t('ef.title')}</h2>
      </div>

      {/* Balance card */}
      <Card style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)' }}>
        <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>{t('ef.saved')}</p>
        <p style={{ fontSize: 28, fontWeight: 800, color: C.text, marginBottom: 8 }}>{fmt(ef.currentAmount, currency, locale)}</p>
        <ProgressBar value={ef.currentAmount} max={Math.max(1, ef.targetAmount)} color={C.accent} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
          <span>{t('ef.pctOfGoal', { pct: ef.progressPct })}</span>
          <span>{t('ef.goal', { amount: fmt(ef.targetAmount, currency, locale) })}</span>
        </div>
        {ef.remainingToTarget > 0 && (
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 6 }}>{t('ef.leftToTarget', { amount: fmt(ef.remainingToTarget, currency, locale) })}</p>
        )}
        {ef.currentAmount >= ef.targetAmount && ef.targetAmount > 0 && (
          <p style={{ fontSize: 13, color: C.green, fontWeight: 600, marginTop: 6 }}>{t('ef.goalReached')}</p>
        )}
      </Card>

      {/* Action buttons */}
      {mode === 'view' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <PrimaryBtn onClick={() => { setMode('deposit'); setAmount(''); setError(''); }} style={{ flex: 1 }}>{t('ef.deposit')}</PrimaryBtn>
            <button onClick={() => { setMode('withdraw'); setAmount(''); setError(''); }} style={{ flex: 1, padding: '13px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('ef.withdraw')}</button>
          </div>
          <button onClick={() => { setMode('edit-goal'); setError(''); }} style={{ width: '100%', padding: '12px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 20 }}>
            {t('ef.changeGoal', { n: ef.targetMonths })}
          </button>
        </>
      )}

      {/* Deposit / Withdraw form */}
      {(mode === 'deposit' || mode === 'withdraw') && (
        <Card>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>
            {mode === 'deposit' ? t('ef.depositTitle') : t('ef.withdrawTitle')}
          </p>
          <input
            type="number" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('ef.amountPh')} autoFocus
            style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 18, fontWeight: 700, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
          />

          {/* Budget impact choice */}
          <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>{t('ef.fromWhere')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setAffectsBudget(true)} style={{ textAlign: 'left', padding: '12px 14px', background: affectsBudget ? C.accentBg : C.elevated, border: `1px solid ${affectsBudget ? C.accent : C.border}`, borderRadius: 10, color: affectsBudget ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
              {mode === 'deposit' ? t('ef.fromAvailable') : t('ef.toAvailable')}
              <span style={{ display: 'block', fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                {mode === 'deposit' ? t('ef.fromAvailableSub') : t('ef.toAvailableSub')}
              </span>
            </button>
            <button onClick={() => setAffectsBudget(false)} style={{ textAlign: 'left', padding: '12px 14px', background: !affectsBudget ? C.accentBg : C.elevated, border: `1px solid ${!affectsBudget ? C.accent : C.border}`, borderRadius: 10, color: !affectsBudget ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
              {mode === 'deposit' ? t('ef.fromAccount') : t('ef.fromAccountWithdraw')}
              <span style={{ display: 'block', fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{t('ef.fromAccountSub')}</span>
            </button>
          </div>

          {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={!affectsBudget && mode === 'deposit' ? handleSyncBalance : handleSubmit} disabled={saving || !amount} style={{ flex: 1 }}>
              {saving ? '...' : t('common.confirm')}
            </PrimaryBtn>
            <button onClick={() => { setMode('view'); setError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
          </div>
        </Card>
      )}

      {/* Edit goal */}
      {mode === 'edit-goal' && (
        <Card>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>{t('ef.goalHeader')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {[1, 2, 3, 4, 6].map((m) => (
              <button key={m} onClick={() => setTargetMonths(m)} style={{ padding: '10px 18px', borderRadius: 24, background: targetMonths === m ? C.accentBgStrong : C.elevated, border: `1px solid ${targetMonths === m ? C.accent : C.border}`, color: targetMonths === m ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
                {t('ef.monthsSuffix', { n: m })}
              </button>
            ))}
          </div>
          {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={handleGoalSave} disabled={saving} style={{ flex: 1 }}>{saving ? '...' : t('common.save')}</PrimaryBtn>
            <button onClick={() => { setMode('view'); setError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
          </div>
        </Card>
      )}

      {/* Add bucket form */}
      {mode === 'add-bucket' && (
        <Card>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>{t('ef.newBucket')}</p>
          <input value={newBucket.name} onChange={(e) => setNewBucket({ ...newBucket, name: e.target.value })} placeholder={t('ef.bucketNamePh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <select value={newBucket.type} onChange={(e) => setNewBucket({ ...newBucket, type: e.target.value })} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', marginBottom: 10, outline: 'none' }}>
            {bucketTypes.map((bt) => <option key={bt.v} value={bt.v}>{bt.l}</option>)}
          </select>
          <input type="number" value={newBucket.amount} onChange={(e) => setNewBucket({ ...newBucket, amount: e.target.value })} placeholder={t('ef.bucketAmountPh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          {newBucket.type === 'CRYPTO' && (
            <p style={{ fontSize: 11, color: C.orange, marginBottom: 10, padding: '8px 12px', background: `${C.orange}15`, borderRadius: 8 }}>
              {t('ef.cryptoWarning')}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: C.text }}>{t('ef.countToward')}</span>
            <div onClick={() => setNewBucket({ ...newBucket, countsForEF: !newBucket.countsForEF })} style={{ width: 40, height: 24, background: newBucket.countsForEF ? C.accent : C.elevated, border: `1px solid ${C.border}`, borderRadius: 12, position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, background: '#fff', borderRadius: '50%', position: 'absolute', top: 1, left: newBucket.countsForEF ? 18 : 1, transition: 'left 0.2s' }} />
            </div>
          </div>
          {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={handleAddBucket} disabled={saving || !newBucket.name.trim()} style={{ flex: 1 }}>{saving ? '...' : t('common.add')}</PrimaryBtn>
            <button onClick={() => { setMode('view'); setError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
          </div>
        </Card>
      )}

      {/* Buckets list */}
      {mode === 'view' && buckets.filter((b) => !b.isArchived).length > 0 && (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>{t('ef.bucketsLocation')}</p>
          {buckets.filter((b) => !b.isArchived).map((b) => (
            <Card key={b.id} style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{b.name}</p>
                  <p style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    {bucketTypeLabel(b.type)}
                    {b.countsTowardEmergencyFund ? t('ef.inEf') : t('ef.notInEf')}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{fmt(b.currentAmount, currency, locale)}</span>
                  <button onClick={() => { setSelectedBucket(b); setMode('deposit'); setAmount(''); setError(''); }} style={{ background: C.accentBg, border: 'none', borderRadius: 6, padding: '4px 8px', color: C.accentLight, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+</button>
                </div>
              </div>
            </Card>
          ))}
          <button onClick={() => { setMode('add-bucket'); setError(''); setNewBucket({ name: '', type: 'SAVINGS_ACCOUNT', amount: '', countsForEF: true }); }} style={{ width: '100%', padding: '12px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 16 }}>
            {t('ef.addBucket')}
          </button>
        </>
      )}

      {/* No buckets yet — CTA */}
      {mode === 'view' && buckets.filter((b) => !b.isArchived).length === 0 && (
        <button onClick={() => { setMode('add-bucket'); setError(''); setNewBucket({ name: '', type: 'SAVINGS_ACCOUNT', amount: '', countsForEF: true }); }} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 16 }}>
          {t('ef.addBucket')}
        </button>
      )}

      {/* Plan scenarios */}
      {mode === 'view' && planData && Array.isArray(planData.scenarios) && planData.scenarios.length > 0 && (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>{t('ef.planTitle')}</p>
          {planData.feasibility && (
            <p style={{ fontSize: 12, marginBottom: 10, color: planData.feasibility === 'REALISTIC' ? C.green : planData.feasibility === 'TIGHT' ? C.orange : C.red }}>
              {planData.feasibility === 'REALISTIC' ? t('ef.feasibilityRealistic') : planData.feasibility === 'TIGHT' ? t('ef.feasibilityTight') : t('ef.feasibilityUnreal')}
            </p>
          )}
          {planData.message && <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 10 }}>{planData.message}</p>}
          {planData.monthlyFreeCashflow != null && <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>{t('ef.freeFlow', { amount: fmt(planData.monthlyFreeCashflow, currency, locale) })}</p>}
          {planData.scenarios.map((sc: any) => {
            const isSelected = planData.selectedPlan?.mode === 'SYSTEM' && planData.selectedPlan?.pace === sc.pace;
            const freqLabel = sc.frequency === 'WEEKLY' ? tr(locale, 'freqShort.WEEKLY') : sc.frequency === 'BIWEEKLY' ? tr(locale, 'freqShort.BIWEEKLY') : tr(locale, 'freqShort.MONTHLY');
            const paceLabel = sc.pace === 'GENTLE' ? t('ef.paceGentle') : sc.pace === 'OPTIMAL' ? t('ef.paceOptimal') : t('ef.paceAggressive');
            return (
              <Card key={sc.pace} onClick={() => handleSelectPace(sc.pace)} style={{ padding: '12px 14px', borderLeft: isSelected ? `3px solid ${C.accent}` : sc.status === 'RECOMMENDED' ? `3px solid ${C.accent}40` : undefined, cursor: 'pointer', background: isSelected ? C.accentBg : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{paceLabel}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isSelected && <span style={{ fontSize: 10, background: C.green + '30', color: C.green, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{t('ef.selected')}</span>}
                    {sc.status === 'RECOMMENDED' && <span style={{ fontSize: 10, background: C.accentBg, color: C.accentLight, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{t('ef.recommended')}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textSec }}>
                  <span>{t('ef.perFreq', { amount: fmt(sc.contributionAmount, currency, locale), freq: freqLabel })}</span>
                  <span>{sc.projectedMonthsToTarget != null ? t('ef.monthsApprox', { n: sc.projectedMonthsToTarget }) : t('common.notDefined')}</span>
                </div>
                {sc.loadPctOfFreeCashflow != null && (
                  <p style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>{t('ef.pctOfFlow', { pct: sc.loadPctOfFreeCashflow })}</p>
                )}
              </Card>
            );
          })}

          {/* Custom plan button / editor */}
          {!customMode ? (
            <button onClick={() => { setCustomMode(true); setError(''); setCustomAmount(''); }} style={{ width: '100%', padding: '12px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 8 }}>
              {planData.selectedPlan?.mode === 'CUSTOM' ? t('ef.editCustom') : t('ef.setupCustom')}
            </button>
          ) : (
            <Card>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>{t('ef.customTitle')}</p>
              <input type="number" inputMode="decimal" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder={t('ef.customAmountPh')} autoFocus style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', fontSize: 16, fontWeight: 600, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['MONTHLY', tr(locale, 'freqShort.MONTHLY')], ['BIWEEKLY', tr(locale, 'freqShort.BIWEEKLY')], ['WEEKLY', tr(locale, 'freqShort.WEEKLY')]] as const).map(([f, l]) => (
                  <button key={f} onClick={() => setCustomFreq(f as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 20, background: customFreq === f ? C.accentBgStrong : C.elevated, border: `1px solid ${customFreq === f ? C.accent : C.border}`, color: customFreq === f ? C.accentLight : C.textSec, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {t('ef.perFreqWord', { f: l })}
                  </button>
                ))}
              </div>
              {error && <p style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>⚠ {error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <PrimaryBtn onClick={handleSaveCustomPlan} disabled={saving || !customAmount} style={{ flex: 1 }}>{saving ? '...' : t('common.save')}</PrimaryBtn>
                <button onClick={() => { setCustomMode(false); setError(''); }} style={{ flex: 0.5, padding: '12px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
              </div>
            </Card>
          )}

          {/* My Plan summary */}
          {planData.selectedPlan?.mode && (
            <Card style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)', marginTop: 4 }}>
              <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>{t('ef.myPlan')}</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                {planData.selectedPlan.mode === 'SYSTEM'
                  ? (planData.selectedPlan.pace === 'GENTLE' ? t('ef.paceGentle') : planData.selectedPlan.pace === 'OPTIMAL' ? t('ef.paceOptimal') : t('ef.paceAggressive'))
                  : t('ef.customPlanLabel')}
              </p>
              {planData.selectedPlan.contributionAmount != null && (
                <p style={{ fontSize: 14, color: C.textSec }}>
                  {fmt(planData.selectedPlan.contributionAmount, currency, locale)} / {planData.selectedPlan.frequency === 'WEEKLY' ? tr(locale, 'freqShort.WEEKLY') : planData.selectedPlan.frequency === 'BIWEEKLY' ? tr(locale, 'freqShort.BIWEEKLY') : tr(locale, 'freqShort.MONTHLY')}
                </p>
              )}
              {planData.selectedPlan.projectedMonthsToTarget != null && (
                <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>
                  {t('ef.goalInMonths', { n: planData.selectedPlan.projectedMonthsToTarget })}
                  {planData.selectedPlan.loadPctOfFreeCashflow != null && ` · ${t('ef.pctOfFlowSuffix', { pct: planData.selectedPlan.loadPctOfFreeCashflow })}`}
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
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10, marginTop: 8 }}>{t('ef.historyTitle')}</p>
          {entries.map((e) => (
            <Card key={e.id} style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>
                    {e.type === 'DEPOSIT' ? t('ef.deposit_short') : e.type === 'WITHDRAWAL' ? t('ef.withdraw_short') : t('ef.sync_short')}
                    {e.bucketName && ` · ${e.bucketName}`}
                  </p>
                  <p style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    {new Date(e.createdAt).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })}
                    {e.affectsCurrentBudget && t('ef.fromBudget')}
                    {e.note && ` · ${e.note}`}
                  </p>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: e.type === 'DEPOSIT' ? C.green : e.type === 'WITHDRAWAL' ? C.red : C.textSec }}>
                  {e.type === 'WITHDRAWAL' ? '−' : '+'}{fmt(e.amount, currency, locale)}
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

function DebtsScreen({ api, currency, onRefresh, onOpenPro }: { api: (path: string, opts?: RequestInit) => Promise<any>; currency: string; onRefresh: () => void; onOpenPro?: () => void }) {
  const t = useT();
  const locale = useLocale();
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
    if (isNaN(balanceRub) || balanceRub <= 0) { setSaveError(t('validation.invalidBalance')); return; }
    if (balanceRub > 21_474_836) { setSaveError(t('validation.maxBalance')); return; }
    const minPay = parseInt(newDebt.minPayment, 10);
    if (isNaN(minPay) || minPay <= 0) { setSaveError(t('validation.invalidMinPayment')); return; }
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
      setSaveError(err?.message || t('validation.saveErrorDetails'));
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
    if (isNaN(amountRub) || amountRub <= 0) { setPaymentError(t('validation.invalidAmount')); return; }
    setPaymentSaving(true); setPaymentError('');
    try {
      await api(`/tg/debts/${paymentModal.debt.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor: Math.round(amountRub * 100), kind: paymentModal.kind, note: paymentNote || undefined }),
      });
      setPaymentModal(null); setPaymentAmount(''); setPaymentNote('');
      await Promise.all([load(), onRefresh()]);
    } catch { setPaymentError(t('validation.saveError')); }
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
    if (isNaN(balanceRub) || balanceRub <= 0) { setEditError(t('validation.invalidBalance')); return; }
    if (balanceRub > 21_474_836) { setEditError(t('validation.maxBalance')); return; }
    const aprPct = parseFloat(editForm.apr || '0');
    if (isNaN(aprPct) || aprPct < 0 || aprPct > 100) { setEditError(t('validation.invalidApr')); return; }
    const minPay = parseFloat(editForm.minPayment);
    if (isNaN(minPay) || minPay < 0) { setEditError(t('validation.minPaymentNegative')); return; }
    const dueDay = editForm.dueDay ? parseInt(editForm.dueDay) : null;
    if (dueDay !== null && (isNaN(dueDay) || dueDay < 1 || dueDay > 31)) { setEditError(t('validation.invalidDueDay')); return; }

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
      setToast(t('debts.debtUpdated'));
      setTimeout(() => setToast(''), 2500);
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) {
      setEditError(err?.message || t('validation.saveError'));
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
    if (isNaN(amountRub) || amountRub <= 0) { setExtraError(t('validation.invalidAmount')); return; }
    const amountMinor = Math.round(amountRub * 100);
    if (amountMinor > extraDebt.balance) { setExtraError(t('validation.amountTooBig')); return; }

    setExtraSaving(true);
    try {
      await api(`/tg/debts/${extraDebt.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor, kind: 'EXTRA_PRINCIPAL_PAYMENT' }),
      });
      setExtraDebt(null);
      setToast(amountMinor === extraDebt.balance ? t('debts.debtPaidOff') : t('debts.extraRecorded'));
      setTimeout(() => setToast(''), 2500);
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) {
      setExtraError(err?.message || t('validation.saveError'));
    }
    setExtraSaving(false);
  };

  const paymentBadge = (status: 'PAID' | 'PARTIAL' | 'UNPAID') => {
    if (status === 'PAID')    return { label: t('debts.statusPaid'),   color: C.green,  bg: C.greenBg };
    if (status === 'PARTIAL') return { label: t('debts.statusPartial'), color: C.orange, bg: C.orangeBg };
    return                           { label: t('debts.statusUnpaid'), color: C.red,    bg: C.redBg };
  };

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const totalMin = debts.reduce((s, d) => s + d.minPayment, 0);

  const types = [
    { v: 'CREDIT_CARD', l: tr(locale, 'debtTypes.CREDIT_CARD') },
    { v: 'CREDIT', l: tr(locale, 'debtTypes.CREDIT') },
    { v: 'MORTGAGE', l: tr(locale, 'debtTypes.MORTGAGE') },
    { v: 'CAR_LOAN', l: tr(locale, 'debtTypes.CAR_LOAN') },
    { v: 'PERSONAL_LOAN', l: tr(locale, 'debtTypes.PERSONAL_LOAN') },
    { v: 'OTHER', l: tr(locale, 'debtTypes.OTHER') },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: C.text }}>{t('debts.title')}</p>

      {loading && <div style={{ textAlign: 'center', paddingTop: 40 }}><Spinner /></div>}

      {!loading && debts.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: C.textTertiary }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>🎉</p>
          <p style={{ fontSize: 16, fontWeight: 600, color: C.green, marginBottom: 8 }}>{t('debts.none')}</p>
          <p style={{ fontSize: 13 }}>{t('debts.keepItUp')}</p>
        </div>
      )}

      {!loading && debts.length > 0 && (
        <>
          {/* Summary */}
          <Card style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>{t('debts.totalDebt')}</p>
                <p style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{fmt(totalDebt, currency, locale)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 4 }}>{t('debts.minPayments')}</p>
                <p style={{ fontSize: 18, fontWeight: 700, color: C.orange }}>{fmt(totalMin, currency, locale)}</p>
              </div>
            </div>
            {strategy?.summary.estimatedDebtFreeMonths != null && (
              <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', paddingTop: 10, marginTop: 8 }}>
                <p style={{ fontSize: 13, color: C.textSec }}>
                  {t('debts.debtFree', { n: strategy.summary.estimatedDebtFreeMonths })}
                  {strategy.summary.estimatedTotalInterest != null && ` · ${t('debts.overpay', { amount: fmt(strategy.summary.estimatedTotalInterest, currency, locale) })}`}
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
                  <p style={{ fontSize: 12, color: C.textTertiary }}>{t('debts.typeWithApr', { type: debtTypeLabel(d.type, locale), pct: (d.apr * 100).toFixed(1) })}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {d.isFocusDebt && <span style={{ fontSize: 10, background: C.accentBg, color: C.accentLight, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{t('onboarding.focusBadge')}</span>}
                  <button onClick={() => openEdit(d)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', color: C.textSec, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✎</button>
                  <button onClick={() => handleDelete(d.id)} style={{ background: C.redBg, border: 'none', borderRadius: 6, padding: '4px 8px', color: C.red, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{fmt(d.balance, currency, locale)}</p>
                  <p style={{ fontSize: 12, color: C.textTertiary }}>{t('debts.balanceShort')}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 16, fontWeight: 600, color: C.textSec }}>{fmt(d.minPayment, currency, locale)}</p>
                  <p style={{ fontSize: 12, color: C.textTertiary }}>{t('debts.minPerMonth')}</p>
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
                          <span>{t('debts.overpayShort', { amount: fmt(si.baseline.totalInterest, currency, locale) })}</span>
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
                            <span>{t('debts.extraPerMonth', { amount: formatNumber(Math.round(sc.extraPerMonth / 100), locale) })}</span>
                            <span style={{ color: C.green }}>{sc.interestSavedVsBaseline != null && sc.interestSavedVsBaseline > 0 ? t('debts.monthsSavedWithSavings', { n: sc.monthsSavedVsBaseline!, amount: fmt(sc.interestSavedVsBaseline, currency, locale) }) : t('debts.monthsSavedFmt', { n: sc.monthsSavedVsBaseline! })}</span>
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
                    <span style={{ fontSize: 12, color: C.textTertiary }}>{t('debts.requiredPayment')}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: paymentBadge(d.currentPeriodPayment.status).color, background: paymentBadge(d.currentPeriodPayment.status).bg, padding: '2px 8px', borderRadius: 10 }}>
                      {paymentBadge(d.currentPeriodPayment.status).label}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 4, background: C.elevated, borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ height: '100%', borderRadius: 2, background: d.currentPeriodPayment.status === 'PAID' ? C.green : C.orange, width: `${Math.min(100, d.currentPeriodPayment.required > 0 ? (d.currentPeriodPayment.paid / d.currentPeriodPayment.required) * 100 : 0)}%`, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textTertiary }}>
                    <span>{t('debts.paid', { amount: fmt(d.currentPeriodPayment.paid, currency, locale) })}</span>
                    {d.currentPeriodPayment.remaining > 0 && <span>{t('debts.leftToPay', { amount: fmt(d.currentPeriodPayment.remaining, currency, locale) })}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => { setPaymentModal({ debt: d, kind: 'REQUIRED_MIN_PAYMENT' }); setPaymentAmount(''); setPaymentNote(''); setPaymentError(''); }}
                      style={{ flex: 1, padding: '8px 0', background: C.accentBg, border: `1px solid ${C.accent}40`, borderRadius: 8, color: C.accentLight, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                    >{t('debts.payNow')}</button>
                  </div>
                </div>
              )}

              {/* Action: Extra payment */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSubtle}`, display: 'flex', gap: 8 }}>
                <button onClick={() => openExtraPayment(d)} style={{ flex: 1, padding: '8px 0', background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {t('debts.extraPay')}
                </button>
              </div>
            </Card>
          ))}
        </>
      )}

      {/* Add debt form */}
      {showAdd && (
        <Card>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('debts.newDebt')}</p>
          <input value={newDebt.title} onChange={(e) => setNewDebt({ ...newDebt, title: e.target.value })} placeholder={t('debts.namePh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
          <select value={newDebt.type} onChange={(e) => setNewDebt({ ...newDebt, type: e.target.value })} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}>
            {types.map((tt) => <option key={tt.v} value={tt.v}>{tt.l}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <input type="number" value={newDebt.balance} onChange={(e) => setNewDebt({ ...newDebt, balance: e.target.value })} placeholder={t('debts.balancePh')} style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            <input type="number" value={newDebt.apr} onChange={(e) => setNewDebt({ ...newDebt, apr: e.target.value })} placeholder={t('debts.aprPh')} style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            <input type="number" value={newDebt.minPayment} onChange={(e) => setNewDebt({ ...newDebt, minPayment: e.target.value })} placeholder={t('debts.minPayPh')} style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: C.orange, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              {t('debts.dueDayHint')}
            </p>
            <input
              type="number"
              value={newDebt.dueDay}
              onChange={(e) => setNewDebt({ ...newDebt, dueDay: e.target.value })}
              placeholder={t('debts.dueDayPh')}
              style={{ width: '100%', background: C.elevated, border: `1px solid ${C.orange}60`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {saveError && (
            <p style={{ fontSize: 13, color: C.red, background: C.redBg, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>⚠ {saveError}</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={handleAdd} disabled={saving} style={{ flex: 1 }}>
              {saving ? '...' : t('common.add')}
            </PrimaryBtn>
            <button onClick={() => { setShowAdd(false); setSaveError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
          </div>
        </Card>
      )}

      {/* Acceleration hint */}
      {!loading && strategy?.accelerationHint?.eligible && (() => {
        const hint = strategy.accelerationHint!;
        if (hint.state === 'DEFICIT') {
          return (
            <Card style={{ background: 'linear-gradient(145deg, #1A1028, #15102a)', border: '1px solid rgba(139,92,246,0.15)', marginTop: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>{hint.copy.title}</p>
              <p style={{ fontSize: 12, color: C.orange, lineHeight: 1.5 }}>{hint.copy.body}</p>
            </Card>
          );
        }
        if (hint.state === 'BASELINE_UNSTABLE') {
          return (
            <Card style={{ marginTop: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>{hint.copy.title}</p>
              <p style={{ fontSize: 12, color: C.textTertiary, lineHeight: 1.5 }}>{hint.copy.body}</p>
            </Card>
          );
        }
        // READY
        return (
          <Card style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: '1px solid rgba(139,92,246,0.25)', marginTop: 12 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8 }}>{hint.copy.title}</p>
            {/* Free: base scenario + CTA */}
            {!hint.proScenarios && hint.baseScenario && (
              <>
                <p style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5, marginBottom: 10 }}>{hint.baseScenario.copy}</p>
                <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 10 }}>{t('debts.accelHelp')}</p>
                {hint.copy.cta && onOpenPro && (
                  <button onClick={onOpenPro} style={{ width: '100%', padding: '11px 0', background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {hint.copy.cta}
                  </button>
                )}
              </>
            )}
            {/* Pro: 3 scenarios */}
            {hint.proScenarios && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {hint.proScenarios.map((sc) => (
                  <div key={sc.key} style={{ background: C.surface, border: `1px solid ${sc.tooAggressive ? C.orange + '40' : C.borderSubtle}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        {t('debts.cutPerDay', { amount: formatNumber(Math.round(sc.dailyCutMinor / 100), locale) })}
                      </span>
                      {sc.monthsSaved != null && sc.monthsSaved > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: C.green }}>{t('debts.monthsSavedFmt', { n: sc.monthsSaved })}</span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: C.textTertiary }}>
                      {t('debts.upToInDebt', { amount: fmt(sc.monthlyExtraMinor, currency, locale) })}
                      {sc.interestSavedMinor != null && sc.interestSavedMinor > 0 && (
                        <>{t('debts.saveSuffix', { amount: fmt(sc.interestSavedMinor, currency, locale) })}</>
                      )}
                    </p>
                    {sc.tooAggressive && (
                      <p style={{ fontSize: 10, color: C.orange, marginTop: 3 }}>{t('debts.tooHard')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })()}

      {!showAdd && !loading && (
        <button onClick={() => setShowAdd(true)} style={{ width: '100%', padding: '16px 0', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.accent, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginTop: 8 }}>
          {t('debts.addDebt')}
        </button>
      )}

      {/* Payment modal (required min) */}
      {paymentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px 40px', boxSizing: 'border-box' }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>{t('debts.payTitle')}</p>
            <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 16 }}>{paymentModal.debt.title}</p>

            {paymentModal.debt.currentPeriodPayment && paymentModal.debt.currentPeriodPayment.remaining > 0 && (
              <div style={{ background: C.accentBg, border: `1px solid ${C.accent}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                <p style={{ fontSize: 13, color: C.accentLight }}>
                  {t('debts.payRemaining')} <strong>{fmt(paymentModal.debt.currentPeriodPayment.remaining, currency, locale)}</strong>
                </p>
              </div>
            )}

            <input type="number" inputMode="decimal" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder={t('debts.payAmountPh')} autoFocus
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
            <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder={t('debts.payNotePh')}
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', fontSize: 14, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 14, boxSizing: 'border-box' }} />
            {paymentError && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {paymentError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <PrimaryBtn onClick={handlePayment} disabled={paymentSaving} style={{ flex: 1 }}>{paymentSaving ? '...' : t('common.confirm')}</PrimaryBtn>
              <button onClick={() => { setPaymentModal(null); setPaymentError(''); }} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Extra payment modal */}
      {extraDebt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px 40px', boxSizing: 'border-box' }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>{t('debts.extraTitle')}</p>
            <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 6 }}>{extraDebt.title}</p>
            <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 16 }}>{t('debts.extraBalance', { amount: fmt(extraDebt.balance, currency, locale) })}</p>

            <input type="number" inputMode="decimal" value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} placeholder={t('debts.extraAmountPh')} autoFocus
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'inherit', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />

            <button onClick={() => setExtraAmount(String(extraDebt.balance / 100))}
              style={{ width: '100%', padding: '10px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 14 }}>
              {t('debts.payAllExact', { amount: fmt(extraDebt.balance, currency, locale) })}
            </button>

            {extraError && <p style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠ {extraError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <PrimaryBtn onClick={handleExtraPayment} disabled={extraSaving} style={{ flex: 1 }}>{extraSaving ? '...' : t('common.confirm')}</PrimaryBtn>
              <button onClick={() => setExtraDebt(null)} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit debt modal */}
      {editDebt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px 40px', boxSizing: 'border-box', maxHeight: '85vh', overflowY: 'auto' }}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 16 }}>{t('debts.editTitle')}</p>

            <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder={t('debts.editName')}
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />

            <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', color: C.textSec, fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}>
              {types.map((tt) => <option key={tt.v} value={tt.v}>{tt.l}</option>)}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>{t('debts.editBalance')}</p>
                <input type="number" inputMode="decimal" value={editForm.balance} onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>{t('debts.editApr')}</p>
                <input type="number" inputMode="decimal" value={editForm.apr} onChange={(e) => setEditForm({ ...editForm, apr: e.target.value })}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>{t('debts.editMinPay')}</p>
                <input type="number" inputMode="decimal" value={editForm.minPayment} onChange={(e) => setEditForm({ ...editForm, minPayment: e.target.value })}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <p style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>{t('debts.editDueDay')}</p>
                <input type="number" inputMode="numeric" value={editForm.dueDay} onChange={(e) => setEditForm({ ...editForm, dueDay: e.target.value })} placeholder="—"
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 8px', color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            {editError && <p style={{ fontSize: 13, color: C.red, background: C.redBg, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>⚠ {editError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <PrimaryBtn onClick={handleEdit} disabled={editSaving} style={{ flex: 1 }}>{editSaving ? '...' : t('common.save')}</PrimaryBtn>
              <button onClick={() => setEditDebt(null)} style={{ flex: 0.5, padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>{t('common.cancel')}</button>
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
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [err, setErr] = useState('');

  const features = [
    { icon: '📊', title: t('pro.weeklyDigest'), desc: t('pro.weeklyDigestDesc') },
    { icon: '⏰', title: t('pro.customNotifyTime'), desc: t('pro.customNotifyTimeDesc') },
    { icon: '📈', title: t('pro.advancedAnalytics'), desc: t('pro.advancedAnalyticsDesc') },
    { icon: '📤', title: t('pro.exportData'), desc: t('pro.exportDataDesc') },
    { icon: '🚀', title: t('pro.prioritySupport'), desc: t('pro.prioritySupportDesc') },
  ];

  const handleSubscribe = async () => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.openInvoice) {
      setErr(t('pro.onlyTelegram'));
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
          setErr(t('pro.payError'));
        }
        // 'cancelled' — просто закрыли, ничего не делаем
      });
    } catch {
      setLoading(false);
      setErr(t('pro.invoiceError'));
    }
  };

  if (paid) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>🎉</div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 12 }}>{t('pro.activated')}</h2>
        <p style={{ fontSize: 15, color: C.textSec, lineHeight: 1.6, marginBottom: 36 }}>{t('pro.activatedDesc')}</p>
        <PrimaryBtn onClick={onBack}>{t('pro.great')}</PrimaryBtn>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 40 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 20, cursor: 'pointer', marginBottom: 16 }}>←</button>

      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', background: C.accentBgStrong, border: `1px solid ${C.accent}`, borderRadius: 24, fontSize: 14, fontWeight: 700, color: C.accentLight, marginBottom: 16 }}>PRO</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8, lineHeight: 1.3 }}>{t('pro.headline')}</h2>
        <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.5 }}>{t('pro.subheadline')}</p>
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
        <p style={{ fontSize: 14, color: C.textTertiary }}>{t('pro.starsPerMonth')}</p>
      </div>

      {err && <p style={{ color: C.red, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>{err}</p>}

      <PrimaryBtn onClick={handleSubscribe} disabled={loading}>
        {loading ? t('pro.openingInvoice') : t('pro.subscribe')}
      </PrimaryBtn>
      <SecondaryBtn onClick={onBack}>{t('pro.later')}</SecondaryBtn>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function Settings({ api, onOpenPro, onOpenIncomes, onOpenObligations, onOpenPaydays, onRefresh, onLocaleChanged }: { api: (path: string, opts?: RequestInit) => Promise<any>; onOpenPro: () => void; onOpenIncomes: () => void; onOpenObligations: () => void; onOpenPaydays: () => void; onRefresh?: () => void; onLocaleChanged?: (newLocale: Locale) => void }) {
  const t = useT();
  const [settings, setSettings] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [localePref, setLocalePref] = useState<'auto' | 'ru' | 'en'>('auto');
  const [localeSaving, setLocaleSaving] = useState(false);
  const [cashModal, setCashModal] = useState(false);
  const [cashInput, setCashInput] = useState('');
  const [cashSaving, setCashSaving] = useState(false);
  const [cashDone, setCashDone] = useState(false);

  useEffect(() => {
    Promise.all([api('/tg/me/settings'), api('/tg/me/plan'), api('/tg/me/locale').catch(() => null)]).then(([s, p, l]) => {
      setSettings(s);
      setPlan(p);
      if (l?.pref) setLocalePref(l.pref);
    });
  }, [api]);

  const toggle = async (key: string, val: boolean) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    await api('/tg/me/settings', { method: 'PATCH', body: JSON.stringify({ [key]: val }) });
  };

  const handleLocaleChange = async (pref: 'auto' | 'ru' | 'en') => {
    if (pref === localePref) return;
    setLocaleSaving(true);
    try {
      const res = await api('/tg/me/locale', { method: 'PATCH', body: JSON.stringify({ pref }) });
      setLocalePref(res.pref ?? pref);
      if (res.locale && onLocaleChanged) onLocaleChanged(res.locale as Locale);
    } finally { setLocaleSaving(false); }
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
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: C.text }}>{t('settings.title')}</p>

      {/* Cash anchor modal */}
      {cashModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }} onClick={() => setCashModal(false)}>
          <div style={{ background: C.bgSecondary, borderRadius: '20px 20px 0 0', padding: '24px 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))', width: '100%', boxSizing: 'border-box' }} onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>{t('settings.cashTitle')}</p>
            <p style={{ fontSize: 13, color: C.textSec, marginBottom: 20 }}>{t('settings.cashDesc')}</p>
            <input
              type="number" inputMode="decimal" placeholder="0"
              value={cashInput} onChange={e => setCashInput(e.target.value)}
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 16, outline: 'none' }}
            />
            <PrimaryBtn onClick={handleCashSave} disabled={cashSaving || cashDone}>
              {cashDone ? t('common.saved') : cashSaving ? t('common.saving') : t('settings.updateBalance')}
            </PrimaryBtn>
          </div>
        </div>
      )}

      {plan && (
        <Card style={{ marginBottom: 20, background: plan.plan === 'PRO' ? 'linear-gradient(145deg, #1E1535, #1A1028)' : C.surface, border: `1px solid ${plan.plan === 'PRO' ? C.accent : C.borderSubtle}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{plan.plan === 'PRO' ? t('settings.proLabel') : t('settings.freeLabel')}</p>
              <p style={{ fontSize: 12, color: C.textSec }}>{plan.plan === 'PRO' ? t('settings.proActive') : t('settings.upgradeToPro')}</p>
            </div>
            {plan.plan === 'FREE' && (
              <button onClick={onOpenPro} style={{ padding: '8px 16px', background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>PRO</button>
            )}
          </div>
        </Card>
      )}

      {/* Budget management links */}
      <p style={{ fontSize: 12, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>{t('settings.sectionBudget')}</p>
      {[
        { label: t('settings.cashRowLabel'), icon: '💵', desc: t('settings.cashRowDesc'), onClick: () => setCashModal(true) },
        { label: t('settings.paydaysRowLabel'), icon: '📅', desc: t('settings.paydaysRowDesc'), onClick: onOpenPaydays },
        { label: t('settings.incomesRowLabel'), icon: '💰', desc: t('settings.incomesRowDesc'), onClick: onOpenIncomes },
        { label: t('settings.obligationsRowLabel'), icon: '📋', desc: t('settings.obligationsRowDesc'), onClick: onOpenObligations },
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
          <p style={{ fontSize: 12, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>{t('settings.sectionNotifications')}</p>
          {[
            { key: 'morningNotifyEnabled', label: t('settings.morningNotify'), desc: settings.morningNotifyTime },
            { key: 'eveningNotifyEnabled', label: t('settings.eveningNotify'), desc: settings.eveningNotifyTime },
            { key: 'paymentAlerts', label: t('settings.paymentAlerts'), desc: t('settings.paymentAlertsDesc') },
            { key: 'deficitAlerts', label: t('settings.deficitAlerts'), desc: t('settings.deficitAlertsDesc') },
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

      {/* Language */}
      <p style={{ fontSize: 12, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', margin: '24px 0 10px' }}>{t('settings.sectionLanguage')}</p>
      <div style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '14px 16px' }}>
        <p style={{ fontSize: 14, color: C.text, marginBottom: 10 }}>{t('settings.languageRowLabel')}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['auto', 'ru', 'en'] as const).map((pref) => (
            <button
              key={pref}
              onClick={() => handleLocaleChange(pref)}
              disabled={localeSaving}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 8,
                background: localePref === pref ? C.accentBgStrong : C.elevated,
                border: `1px solid ${localePref === pref ? C.accent : C.border}`,
                color: localePref === pref ? C.accentLight : C.textSec,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: localeSaving ? 'wait' : 'pointer',
              }}
            >
              {pref === 'auto' ? t('settings.languageAuto') : pref === 'ru' ? t('settings.languageRu') : t('settings.languageEn')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Paydays Screen ───────────────────────────────────────────────────────────

function PaydaysScreen({ api, onBack, onChanged }: { api: (p: string, o?: RequestInit) => Promise<any>; onBack: () => void; onChanged: () => void }) {
  const t = useT();
  const locale = useLocale();
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
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>{t('paydays.title')}</h2>
      </div>
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 20 }}>{t('paydays.desc')}</p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}><Spinner /></div>
      ) : incomes.length === 0 ? (
        <Card><p style={{ color: C.textSec, fontSize: 14, textAlign: 'center' }}>{t('paydays.noIncomes')}</p></Card>
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
                  <p style={{ fontSize: 12, color: C.textTertiary }}>{t('paydays.perMonth', { amount: fmt(inc.amount, inc.currency, locale) })}</p>
                </div>
                <button
                  onClick={() => handleDeleteIncome(inc.id)}
                  style={{ background: C.redBg, border: 'none', borderRadius: 8, color: C.red, fontSize: 16, width: 32, height: 32, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                  title={t('paydays.deleteIncomeTitle')}
                >✕</button>
              </div>

              <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8, marginTop: 12 }}>{t('paydays.paydayLabel')}</p>
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
                  placeholder={t('paydays.otherPh')}
                  style={{ width: 52, padding: '8px 8px', borderRadius: 20, background: !payOptions.includes(day1) ? C.accentBgStrong : C.elevated, border: `1px solid ${!payOptions.includes(day1) ? C.accent : C.border}`, color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }}
                />
                <button
                  onClick={() => upd(inc.id, { twoPaydays: !e.twoPaydays })}
                  style={{ padding: '8px 14px', borderRadius: 20, background: e.twoPaydays ? C.accentBgStrong : C.elevated, border: `1px solid ${e.twoPaydays ? C.accent : C.border}`, color: e.twoPaydays ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {e.twoPaydays ? t('paydays.remove2nd') : t('paydays.add2nd')}
                </button>
              </div>

              {e.twoPaydays && (
                <div style={{ marginTop: 4, padding: '12px', background: C.elevated, borderRadius: 10 }}>
                  <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 8 }}>{t('paydays.second')}</p>
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
                      placeholder={t('paydays.otherPh')}
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
          {saving ? t('paydays.saving') : t('paydays.saveAndRecalc')}
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

function IncomesScreen({ api, onBack, onChanged }: { api: (p: string, o?: RequestInit) => Promise<any>; onBack: () => void; onChanged: () => void }) {
  const t = useT();
  const locale = useLocale();
  const FREQ_LABELS: Record<string, string> = {
    MONTHLY: tr(locale, 'freqLabels.MONTHLY'),
    BIWEEKLY: tr(locale, 'freqLabels.BIWEEKLY'),
    WEEKLY: tr(locale, 'freqLabels.WEEKLY'),
    IRREGULAR: tr(locale, 'freqLabels.IRREGULAR'),
  };
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
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>{t('incomes.title')}</h2>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', background: showForm ? C.surface : `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {showForm ? t('incomes.cancel') : t('incomes.addBtn')}
        </button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>{t('incomes.newIncome')}</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('incomes.namePh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder={t('incomes.monthlyPh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>{t('incomes.paydayLabel')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {payOptions.map((d) => (
              <button key={d} onClick={() => setPayday(d)} style={{ padding: '8px 14px', borderRadius: 20, background: payday === d ? C.accentBgStrong : C.elevated, border: `1px solid ${payday === d ? C.accent : C.border}`, color: payday === d ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>{d}</button>
            ))}
            <button onClick={() => { setTwoPaydays(!twoPaydays); if (!twoPaydays) { const other = payOptions.find(d => d !== payday) ?? 1; setPayday2(other); } }} style={{ padding: '8px 14px', borderRadius: 20, background: twoPaydays ? C.accentBgStrong : C.elevated, border: `1px solid ${twoPaydays ? C.accent : C.border}`, color: twoPaydays ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>{t('incomes.twice')}</button>
          </div>
          {twoPaydays && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 6 }}>{t('incomes.secondPay')}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {payOptions.map((d) => (
                  <button key={d} onClick={() => setPayday2(d)} style={{ padding: '8px 14px', borderRadius: 20, background: payday2 === d ? C.accentBgStrong : C.elevated, border: `1px solid ${payday2 === d ? C.accent : C.border}`, color: payday2 === d ? C.accentLight : C.textSec, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>{d}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '10px 12px', background: C.elevated, borderRadius: 8 }}>
            <div>
              <p style={{ fontSize: 13, color: C.text, marginBottom: 2 }}>{t('onboarding.ruCalLabel')}</p>
              <p style={{ fontSize: 11, color: C.textTertiary }}>{t('onboarding.ruCalDescFull')}</p>
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
            {saving ? t('paydays.saving') : t('common.save')}
          </PrimaryBtn>
        </Card>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}><Spinner /></div>
      ) : incomes.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.textSec, marginTop: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
          <p>{t('incomes.none')}</p>
        </div>
      ) : (
        incomes.map((inc) => (
          <Card key={inc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 3 }}>{inc.title}</p>
              <p style={{ fontSize: 13, color: C.textSec }}>{t('incomes.perMonthFreq', { amount: fmt(inc.monthlyEquivalent ?? inc.amount, inc.currency, locale), freq: FREQ_LABELS[inc.frequency] || inc.frequency })}</p>
              <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>{t('incomes.paydayLine', { days: (inc.paydays as number[]).join(', ') })}</p>
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

function ObligationsScreen({ api, onBack, onChanged }: { api: (p: string, o?: RequestInit) => Promise<any>; onBack: () => void; onChanged: () => void }) {
  const t = useT();
  const locale = useLocale();
  const OB_TYPES = [
    { value: 'RENT', label: tr(locale, 'obligationTypes.RENT') },
    { value: 'UTILITIES', label: tr(locale, 'obligationTypes.UTILITIES') },
    { value: 'SUBSCRIPTION', label: tr(locale, 'obligationTypes.SUBSCRIPTION_SINGLE') },
    { value: 'TELECOM', label: tr(locale, 'obligationTypes.TELECOM') },
    { value: 'INSURANCE', label: tr(locale, 'obligationTypes.INSURANCE') },
    { value: 'OTHER', label: tr(locale, 'obligationTypes.OTHER') },
  ];
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
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>{t('obligations.title')}</h2>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', background: showForm ? C.surface : `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {showForm ? t('obligations.cancel') : t('obligations.addBtn')}
        </button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>{t('obligations.newObligation')}</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('obligations.namePh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder={t('obligations.monthlyPh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />
          <p style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>{t('obligations.categoryLabel')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {OB_TYPES.map((tt) => (
              <button key={tt.value} onClick={() => setType(tt.value)} style={{ padding: '7px 14px', borderRadius: 20, background: type === tt.value ? C.accentBgStrong : C.elevated, border: `1px solid ${type === tt.value ? C.accent : C.border}`, color: type === tt.value ? C.accentLight : C.textSec, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>{tt.label}</button>
            ))}
          </div>
          <input value={dueDay} onChange={(e) => setDueDay(e.target.value)} type="number" placeholder={t('obligations.dueDayPh')} style={{ width: '100%', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', marginBottom: 14, outline: 'none', boxSizing: 'border-box' }} />
          <PrimaryBtn onClick={handleAdd} disabled={saving || !title.trim() || !amount}>
            {saving ? t('paydays.saving') : t('common.save')}
          </PrimaryBtn>
        </Card>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}><Spinner /></div>
      ) : obligations.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.textSec, marginTop: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p>{t('obligations.none')}</p>
        </div>
      ) : (
        obligations.map((ob) => (
          <Card key={ob.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 3 }}>{ob.title}</p>
              <p style={{ fontSize: 13, color: C.textSec }}>{t('obligations.perMonthType', { amount: fmt(ob.amount, ob.currency || 'RUB', locale), type: obTypeLabel(ob.type) })}</p>
              {ob.dueDay && <p style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>{t('obligations.dueLine', { n: ob.dueDay })}</p>}
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
  const t = useT();
  const locale = useLocale();
  const { currency } = data;
  const saved = data.saved;
  const isSaved = saved >= 0;
  const pct = data.s2sPeriod > 0 ? Math.min(100, Math.round((data.totalSpent / data.s2sPeriod) * 100)) : 0;

  const s = new Date(data.startDate);
  const e = new Date(data.endDate);
  const periodLabel = `${monthShortCap(s.getMonth(), locale)} ${s.getDate()} — ${monthShortCap(e.getMonth(), locale)} ${e.getDate()}`;

  const barColor = pct > 100 ? C.red : pct > 80 ? C.orange : C.green;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={onClose} style={{ background: C.surface, border: 'none', borderRadius: 10, color: C.textSec, fontSize: 20, width: 40, height: 40, cursor: 'pointer', fontFamily: 'inherit' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>{t('summary.title')}</h2>
      </div>

      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 20, marginTop: -16 }}>{t('summary.periodDays', { period: periodLabel, days: data.daysTotal })}</p>

      {/* Result banner */}
      <div style={{ background: isSaved ? C.greenBg : C.redBg, border: `1px solid ${isSaved ? C.greenDim : C.red}40`, borderRadius: 16, padding: '20px 18px', marginBottom: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>{isSaved ? '🎉' : '😬'}</div>
        <div style={{ fontSize: 14, color: C.textSec, marginBottom: 4 }}>
          {isSaved ? t('summary.saved') : t('summary.overspent')}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: isSaved ? C.green : C.red }}>
          {fmt(Math.abs(saved), currency, locale)}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {[
          { label: t('summary.budget'), value: fmt(data.s2sPeriod, currency, locale), color: C.text },
          { label: t('summary.spent'), value: fmt(data.totalSpent, currency, locale), color: pct > 100 ? C.red : C.text },
          { label: t('summary.dailyLimitWas'), value: fmt(data.s2sDaily, currency, locale), color: C.text },
          { label: t('summary.overspentDays'), value: `${data.overspentDays}`, color: data.overspentDays > 0 ? C.orange : C.green },
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
          <span style={{ fontSize: 13, color: C.textSec }}>{t('summary.pctSpent')}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: barColor }}>{pct}%</span>
        </div>
        <ProgressBar value={data.totalSpent} max={data.s2sPeriod} color={barColor} />
      </Card>

      {/* Top expenses */}
      {data.topExpenses.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, color: C.textSec, marginBottom: 12 }}>{t('summary.bigExpenses')}</div>
          {data.topExpenses.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: i < data.topExpenses.length - 1 ? 10 : 0, marginBottom: i < data.topExpenses.length - 1 ? 10 : 0, borderBottom: i < data.topExpenses.length - 1 ? `1px solid ${C.borderSubtle}` : 'none' }}>
              <span style={{ fontSize: 14, color: C.text }}>{e.note || t('summary.noNote')}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{fmt(e.amount, currency, locale)}</span>
            </div>
          ))}
        </Card>
      )}

      <PrimaryBtn onClick={onClose}>{t('summary.goNew')}</PrimaryBtn>
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
  // Start with client-detected locale (instant) and then reconcile with server's effective locale.
  const [locale, setLocale] = useState<Locale>(() => detectClientLocale());
  const { api, initDataRef, devMode } = useApi();

  // Keep <html lang> in sync with active locale
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

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
        // Reconcile locale with server (picks up user override if any)
        api('/tg/me/locale').then((l) => { if (l?.locale === 'ru' || l?.locale === 'en') setLocale(l.locale); }).catch(() => {});
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
      // Reconcile locale with server (respects user's explicit override)
      api('/tg/me/locale').then((l) => { if (l?.locale === 'ru' || l?.locale === 'en') setLocale(l.locale); }).catch(() => {});
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

  const content = (() => {
    if (screen === 'loading') return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, gap: 16 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <Spinner />
        <p style={{ color: C.textSec, fontSize: 14 }}>{tr(locale, 'common.loading')}</p>
      </div>
    );

    if (screen === 'error') return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, gap: 16, padding: 24 }}>
        <p style={{ color: C.red, fontSize: 16, textAlign: 'center' }}>{error || tr(locale, 'errors.loadingError')}</p>
        <PrimaryBtn onClick={() => window.location.reload()} style={{ maxWidth: 200 }}>{tr(locale, 'common.retry')}</PrimaryBtn>
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
        {screen === 'debts' && <DebtsScreen api={api} currency={dashboard?.currency ?? 'RUB'} onRefresh={loadDashboard} onOpenPro={() => setScreen('pro')} />}
        {screen === 'emergency-fund-detail' && <EmergencyFundScreen api={api} onBack={() => setScreen('dashboard')} onRefresh={loadDashboard} />}
        {screen === 'settings' && (
          <Settings
            api={api}
            onOpenPro={() => setScreen('pro')}
            onOpenIncomes={() => setScreen('incomes')}
            onOpenObligations={() => setScreen('obligations')}
            onOpenPaydays={() => setScreen('paydays')}
            onRefresh={loadDashboard}
            onLocaleChanged={(next) => setLocale(next)}
          />
        )}

        <BottomNav
          active={navTab}
          onTab={handleTab}
          onAdd={() => setScreen('add-expense')}
        />
      </div>
    );
  })();

  return <LocaleCtx.Provider value={locale}>{content}</LocaleCtx.Provider>;
}
