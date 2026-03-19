export { t, ru, en } from './i18n';
export type { Locale, Translations } from './i18n';

/** Format amount from kopecks/cents to display string */
export function formatMoney(amountMinor: number, currency: 'RUB' | 'USD'): string {
  const major = amountMinor / 100;
  if (currency === 'RUB') {
    return `${major.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;
  }
  return `$${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse display amount to minor units (kopecks/cents) */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** Build Telegram deep link */
export function buildTgDeepLink(botUsername: string, payload: string): string {
  return `https://t.me/${botUsername}?startapp=${encodeURIComponent(payload)}`;
}

/** Build Telegram share URL */
export function buildTgShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/** S2S color thresholds */
export function getS2SColor(s2sRemaining: number, s2sDaily: number): 'green' | 'orange' | 'red' {
  if (s2sDaily <= 0) return 'red';
  const ratio = s2sRemaining / s2sDaily;
  if (ratio > 0.7) return 'green';
  if (ratio > 0.3) return 'orange';
  return 'red';
}

/** Days between two dates */
export function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
