import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TradeCloseout - Construction Handover & DLP Platform',
  description: 'Enterprise MEP Closeout & Digital Handover Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased font-sans min-h-screen">
        {children}
      </body>
    </html>
  );
}
