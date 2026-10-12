import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ghost Fleet X — Maritime Change-Intelligence',
  description: 'Discover maritime change. Test the evidence. Decide what to do next. Arabian Sea change-intelligence decision-support application powered by NASA Earth Science and maritime activity tracking.',
  keywords: ['maritime intelligence', 'NASA VIIRS', 'Arabian Sea', 'nighttime lights', 'MSDI', 'Global Fishing Watch', 'ocean conservation', 'decision support'],
  authors: [{ name: 'Ghost Fleet X Team' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ocean-950 text-slate-100 min-h-screen selection:bg-cyan-500/30 selection:text-cyan-200 antialiased font-sans overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
