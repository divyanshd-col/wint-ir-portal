import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Wint Wealth – IR Portal',
  description: 'Investor Relations knowledge base and Q&A portal',
  applicationName: 'Wint IR Portal',
  icons: { icon: '/favicon.ico' },
  openGraph: {
    title: 'Wint Wealth – IR Portal',
    description: 'Investor Relations knowledge base and Q&A portal',
    siteName: 'Wint IR Portal',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Wint Wealth – IR Portal',
    description: 'Investor Relations knowledge base and Q&A portal',
  },
  robots: { index: false, follow: false }, // internal tool — keep out of search
};

export const viewport = {
  colorScheme: 'light' as const,
  themeColor: '#2d9e4f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
