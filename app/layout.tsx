import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import './topbar.css';
import './dark-theme.css';
import Providers from '@/components/Providers';
import TopBar from '@/components/shell/TopBar';

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
  colorScheme: 'light dark' as const,
  themeColor: '#2d9e4f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme before first paint (saved choice, else the OS setting) so there is no light flash in dark mode. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('wint_theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}" }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <Providers>
          <TopBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
