import './globals.css';
import type { ReactNode } from 'react';
import { RegisterSW } from './RegisterSW';

export const metadata = {
  title: 'AIShorts Admin',
  applicationName: 'AIShorts Admin',
  appleWebApp: { capable: true, title: 'AIShorts', statusBarStyle: 'black-translucent' as const },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport = { themeColor: '#0f1115', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
