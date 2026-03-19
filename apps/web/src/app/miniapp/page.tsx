'use client';

import dynamic from 'next/dynamic';

const MiniApp = dynamic(() => import('./MiniApp'), { ssr: false });

export default function MiniAppPage() {
  return <MiniApp />;
}
