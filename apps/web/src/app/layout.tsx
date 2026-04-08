import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PFM Bot',
  description: 'Personal Finance Manager — Safe to Spend',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // SSR can't know the user's Telegram language_code; the MiniApp updates
  // document.documentElement.lang on mount based on the detected/selected locale.
  return (
    <html lang="en">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
