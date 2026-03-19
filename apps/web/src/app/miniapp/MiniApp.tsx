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
  | 'onboarding-result'
  | 'dashboard'
  | 'add-expense'
  | 'history'
  | 'settings';

type NavTab = 'dashboard' | 'history' | 'settings';
type S2SColor = 'green' | 'orange' | 'red';

interface TgUser { id: number; first_name: string; last_name?: string; username?: string; language_code?: string; }
interface Debt { id: string; title: string; apr: number; balance: number; minPayment: number; type: string; isFocusDebt: boolean; }
interface Expense { id: string; amount: number; note?: string; spentAt: string; }
interface DashboardData {
  onboardingDone: boolean;
  s2sToday: number; s2sDaily: number;
  daysLeft: number; daysTotal: number;
  periodStart: string; periodEnd: string;
  todayExpenses: Expense[]; todayTotal: number;
  focusDebt: Debt | null;
  emergencyFund: { currentAmount: number; targetAmount: number } | null;
  currency: string;
}

// ── API ──────────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

function useApi() {
  const initDataRef = useRef<string>('');
  const api = useCallback(async (path: string, options?: RequestInit) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    };
    if (initDataRef.current) headers['X-TG-INIT-DATA'] = initDataRef.current;
    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }, []);
  return { api, initDataRef };
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
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: 'spin 0.8s linear infinite' }} />
  );
}

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: '100%', padding: '15px 0', background: disabled ? C.elevated : `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 10, color: disabled ? C.textMuted : '#fff', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', boxShadow: disabled ? 'none' : `0 4px 20px ${C.accentGlow}` }}
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

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 16, padding: '18px 16px', marginBottom: 12, ...style }}>
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
    { id: 'dashboard', icon: '⊙', label: 'Home' },
    { id: 'history', icon: '☰', label: 'History' },
    { id: 'add', icon: '+', label: '' },
    { id: 'settings', icon: '⚙', label: 'Settings' },
  ];

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.bgSecondary, borderTop: `1px solid ${C.borderSubtle}`, display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', padding: '8px 0', paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
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
          <button key={item.id} onClick={() => onTab(item.id as NavTab)} style={{ background: 'none', border: 'none', color: isActive ? C.accentLight : C.textMuted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 10, fontWeight: 500, fontFamily: 'inherit', padding: '4px 16px' }}>
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

function OnbIncome({ onNext }: { onNext: (data: { amount: number; paydays: number[]; currency: string }) => void }) {
  const [amount, setAmount] = useState('');
  const [payday, setPayday] = useState<number[]>([15]);
  const [twoPaydays, setTwoPaydays] = useState(false);
  const [payday2, setPayday2] = useState<number[]>([1]);
  const [currency, setCurrency] = useState<'RUB' | 'USD'>('RUB');

  const handleNext = () => {
    const n = parseInt(amount.replace(/\D/g, ''), 10);
    if (!n || n <= 0) return;
    const days = twoPaydays ? [...new Set([...payday, ...payday2])].sort((a, b) => a - b) : payday;
    // store in kopecks/cents
    onNext({ amount: n * 100, paydays: days, currency });
  };

  const payOptions = [1, 5, 10, 15, 20, 25];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px' }}>
      <OnbProgress step={0} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 1 из 5</p>
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
            <button key={d} onClick={() => setPayday([d])} style={{ padding: '10px 16px', borderRadius: 24, background: payday.includes(d) && !twoPaydays ? C.accentBgStrong : C.surface, border: `1px solid ${payday.includes(d) && !twoPaydays ? C.accent : C.border}`, color: payday.includes(d) && !twoPaydays ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
              {d}
            </button>
          ))}
          <button onClick={() => setTwoPaydays(!twoPaydays)} style={{ padding: '10px 16px', borderRadius: 24, background: twoPaydays ? C.accentBgStrong : C.surface, border: `1px solid ${twoPaydays ? C.accent : C.border}`, color: twoPaydays ? C.accentLight : C.textSec, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>2 раза</button>
        </div>
        {twoPaydays && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: C.textTertiary, marginBottom: 8 }}>Второй день:</p>
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
      <OnbProgress step={1} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 2 из 5</p>
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
      <OnbProgress step={2} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 3 из 5</p>
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
      <OnbProgress step={3} />
      <p style={{ fontSize: 12, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>Шаг 4 из 5</p>
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

function OnbResult({ s2sDaily, currency, onDone }: { s2sDaily: number; currency: string; onDone: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, padding: '0 24px', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: C.textSec, marginBottom: 8 }}>🎉 Всё готово! Ваш Safe to Spend:</p>
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

function Dashboard({ data, onAddExpense }: { data: DashboardData; onAddExpense: () => void }) {
  const color = s2sColor(data.s2sToday, data.s2sDaily);
  const mainColor = colorOf(color);
  const efPct = data.emergencyFund && data.emergencyFund.targetAmount > 0
    ? Math.min(100, Math.round((data.emergencyFund.currentAmount / data.emergencyFund.targetAmount) * 100))
    : 0;

  const periodElapsed = data.daysTotal - data.daysLeft;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 90 }}>

      {/* Greeting */}
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 2 }}>Добрый день,</p>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: C.text }}>Safe to Spend</p>

      {/* Period bar */}
      <div style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: C.textSec }}>{periodLabel(data.periodStart, data.periodEnd)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.accentLight }}>День {periodElapsed + 1} из {data.daysTotal}</span>
      </div>

      {/* S2S Card */}
      <div style={{ background: 'linear-gradient(145deg, #1E1535, #1A1028)', border: `1px solid rgba(139,92,246,0.25)`, borderRadius: 16, padding: '22px 20px', marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-50%', right: '-20%', width: 200, height: 200, background: 'radial-gradient(circle, rgba(139,92,246,0.15), transparent 70%)', pointerEvents: 'none' }} />
        <p style={{ fontSize: 12, color: C.textSec, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>⊙ SAFE TO SPEND TODAY</p>
        <p style={{ fontSize: 48, fontWeight: 800, letterSpacing: -2, lineHeight: 1, color: mainColor, marginBottom: 4 }}>{fmt(data.s2sToday, data.currency)}</p>
        <p style={{ fontSize: 13, color: C.textTertiary, marginBottom: 16 }}>из дневного лимита {fmt(data.s2sDaily, data.currency)}</p>
        <div style={{ borderTop: `1px solid rgba(139,92,246,0.15)`, paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, color: C.textSec }}>Осталось в периоде</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{fmt(data.s2sDaily * data.daysLeft - data.todayTotal, data.currency)}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button onClick={onAddExpense} style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: '14px 12px', display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: C.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>+</span>
          Добавить расход
        </button>
        <button style={{ background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12, padding: '14px 12px', display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: C.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>↕</span>
          Разбивка
        </button>
      </div>

      {/* Emergency Fund */}
      {data.emergencyFund && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>🛡 Подушка безопасности</span>
            <span style={{ fontSize: 13, color: C.textSec }}>{fmt(data.emergencyFund.currentAmount, data.currency)} / {fmt(data.emergencyFund.targetAmount, data.currency)}</span>
          </div>
          <ProgressBar value={data.emergencyFund.currentAmount} max={data.emergencyFund.targetAmount} color={C.accent} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
            <span>{efPct}%</span>
            <span>цель: 3 месяца обязательных</span>
          </div>
        </Card>
      )}

      {/* Focus Debt */}
      {data.focusDebt && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>🎯 Фокус-долг (Лавина)</span>
            <span style={{ fontSize: 11, background: C.accentBg, color: C.accentLight, padding: '3px 8px', borderRadius: 10, fontWeight: 600 }}>APR {(data.focusDebt.apr * 100).toFixed(1)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent, display: 'inline-block', boxShadow: `0 0 8px ${C.accentGlow}` }} />
                {data.focusDebt.title}
              </p>
              <p style={{ fontSize: 12, color: C.textTertiary }}>мин. платёж {fmt(data.focusDebt.minPayment, data.currency)}/мес</p>
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{fmt(data.focusDebt.balance, data.currency)}</p>
          </div>
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

      {/* Period progress */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Период</span>
          <span style={{ fontSize: 13, color: C.textSec }}>осталось {data.daysLeft} дн.</span>
        </div>
        <ProgressBar value={periodElapsed} max={data.daysTotal} color={C.green} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textTertiary, marginTop: 8 }}>
          <span>день {periodElapsed + 1}</span>
          <span>{Math.round((periodElapsed / data.daysTotal) * 100)}% прошло</span>
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

  const amountKop = Math.round(parseFloat(input || '0') * 100);
  const remaining = Math.max(0, s2sToday - amountKop);

  const press = (key: string) => {
    if (key === 'del') { setInput((p) => p.length > 1 ? p.slice(0, -1) : '0'); return; }
    if (key === '.' && input.includes('.')) return;
    if (input === '0' && key !== '.') { setInput(key); return; }
    if (input.includes('.') && input.split('.')[1].length >= 2) return;
    setInput((p) => p + key);
  };

  const save = async () => {
    if (amountKop <= 0 || saving) return;
    setSaving(true);
    try { await onSave(amountKop, note); } finally { setSaving(false); }
  };

  const keys = ['1','2','3','4','5','6','7','8','9','.','0','del'];

  return (
    <div style={{ background: C.bg, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 20, cursor: 'pointer' }}>←</button>
        <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Новый расход</span>
        <span style={{ width: 28 }} />
      </div>

      <div style={{ textAlign: 'center', padding: '32px 20px 16px' }}>
        <p style={{ fontSize: 16, color: C.textTertiary, marginBottom: 6 }}>₽</p>
        <p style={{ fontSize: 52, fontWeight: 800, letterSpacing: -2, color: C.text, lineHeight: 1 }}>{parseFloat(input).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</p>
        <p style={{ fontSize: 14, color: C.textSec, marginTop: 10 }}>
          Останется сегодня: <span style={{ color: remaining > 0 ? C.green : C.red, fontWeight: 600 }}>{fmt(remaining, currency)}</span>
        </p>
      </div>

      <div style={{ margin: '0 16px 8px', background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: C.textMuted, fontSize: 16 }}>✎</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Добавить заметку..." style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 14, fontFamily: 'inherit', outline: 'none', flex: 1 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '8px 16px', flex: 1 }}>
        {keys.map((k) => (
          <button key={k} onClick={() => press(k)} style={{ height: 56, background: k === 'del' ? C.elevated : C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 10, color: C.text, fontSize: k === 'del' ? 16 : 22, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
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

function History({ api, currency }: { api: (path: string, opts?: RequestInit) => Promise<any>; currency: string }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/tg/expenses').then((r) => { setExpenses(r.expenses || []); setLoading(false); }).catch(() => setLoading(false));
  }, [api]);

  const groups = groupByDay(expenses);
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 90 }}>
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
              <span style={{ fontSize: 15, fontWeight: 600, color: C.red }}>-{fmt(e.amount, currency)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function Settings({ api }: { api: (path: string, opts?: RequestInit) => Promise<any> }) {
  const [settings, setSettings] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);

  useEffect(() => {
    Promise.all([api('/tg/me/settings'), api('/tg/me/plan')]).then(([s, p]) => { setSettings(s); setPlan(p); });
  }, [api]);

  const toggle = async (key: string, val: boolean) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    await api('/tg/me/settings', { method: 'PATCH', body: JSON.stringify({ [key]: val }) });
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px', paddingBottom: 90 }}>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: C.text }}>Настройки</p>

      {plan && (
        <Card style={{ marginBottom: 20, background: plan.plan === 'PRO' ? 'linear-gradient(145deg, #1E1535, #1A1028)' : C.surface, border: `1px solid ${plan.plan === 'PRO' ? C.accent : C.borderSubtle}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{plan.plan === 'PRO' ? '✨ PRO план' : 'FREE план'}</p>
              <p style={{ fontSize: 12, color: C.textSec }}>{plan.plan === 'PRO' ? 'Активна подписка' : 'Обновитесь до PRO'}</p>
            </div>
            {plan.plan === 'FREE' && (
              <button style={{ padding: '8px 16px', background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>⭐ PRO</button>
            )}
          </div>
        </Card>
      )}

      {settings && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10 }}>Уведомления</p>
          {[
            { key: 'morningNotifyEnabled', label: '🌅 Утреннее S2S', desc: settings.morningNotifyTime },
            { key: 'eveningNotifyEnabled', label: '🌙 Вечерний напоминатель', desc: settings.eveningNotifyTime },
            { key: 'paymentAlerts', label: '💳 Напоминания о платежах', desc: 'за день до' },
            { key: 'deficitAlerts', label: '⚠️ Дефицит бюджета', desc: 'когда перерасход' },
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

// ── Main App ─────────────────────────────────────────────────────────────────

export default function MiniApp() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [navTab, setNavTab] = useState<NavTab>('dashboard');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [onbResult, setOnbResult] = useState<{ s2sDaily: number; currency: string } | null>(null);
  const { api, initDataRef } = useApi();

  const loadDashboard = useCallback(async () => {
    const data = await api('/tg/dashboard');
    setDashboard(data);
    return data;
  }, [api]);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) {
      // Dev mode: check API with dev bypass header
      const devApi = (path: string, opts?: RequestInit) =>
        fetch(`${API_URL}${path}`, {
          ...opts,
          headers: { 'Content-Type': 'application/json', 'X-TG-DEV': '12345', ...(opts?.headers as any) },
        }).then((r) => r.json());

      devApi('/tg/onboarding/status').then((d) => {
        if (d.onboardingDone) {
          devApi('/tg/dashboard').then((dash) => { setDashboard(dash); setScreen('dashboard'); }).catch(() => setScreen('dashboard'));
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
  }, [api, initDataRef, loadDashboard]);

  // ── Onboarding handlers ──────────────────────────────────────────────────

  const [onbData, setOnbData] = useState<any>({});

  const handleIncome = async (data: any) => {
    await api('/tg/onboarding/income', { method: 'POST', body: JSON.stringify(data) });
    setOnbData((p: any) => ({ ...p, income: data }));
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
    const result = await api('/tg/onboarding/complete', { method: 'POST', body: JSON.stringify({}) });
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
      <Spinner />
      <p style={{ color: C.textSec, fontSize: 14 }}>Загрузка...</p>
    </div>
  );

  if (screen === 'error') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg }}>
      <p style={{ color: C.red, fontSize: 16, textAlign: 'center', padding: 24 }}>{error || 'Ошибка загрузки'}</p>
    </div>
  );

  if (screen === 'onboarding-welcome') return <OnbWelcome onStart={() => setScreen('onboarding-income')} />;
  if (screen === 'onboarding-income') return <OnbIncome onNext={handleIncome} />;
  if (screen === 'onboarding-obligations') return <OnbObligations onNext={handleObligations} onSkip={() => handleObligations([])} />;
  if (screen === 'onboarding-debts') return <OnbDebts onNext={handleDebts} onSkip={() => handleDebts([])} />;
  if (screen === 'onboarding-ef') return <OnbEF onNext={handleEF} />;
  if (screen === 'onboarding-result' && onbResult) return <OnbResult s2sDaily={onbResult.s2sDaily} currency={onbResult.currency} onDone={handleOnbDone} />;

  if (screen === 'add-expense') return (
    <AddExpense
      s2sToday={dashboard?.s2sToday ?? 0}
      currency={dashboard?.currency ?? 'RUB'}
      onSave={handleSaveExpense}
      onBack={() => { setScreen('dashboard'); setNavTab('dashboard'); }}
    />
  );

  // Screens with bottom nav
  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      {screen === 'dashboard' && dashboard && <Dashboard data={dashboard} onAddExpense={() => setScreen('add-expense')} />}
      {screen === 'dashboard' && !dashboard && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><Spinner /></div>
      )}
      {screen === 'history' && <History api={api} currency={dashboard?.currency ?? 'RUB'} />}
      {screen === 'settings' && <Settings api={api} />}

      <BottomNav
        active={navTab}
        onTab={handleTab}
        onAdd={() => setScreen('add-expense')}
      />
    </div>
  );
}
