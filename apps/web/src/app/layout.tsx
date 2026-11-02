import type { Metadata } from 'next';
import './globals.css';
import { PwaLifecycleManager } from '../components/pwa-register';

export const metadata: Metadata = {
  title: 'TradeCloseout — Construction Handover & DLP Platform',
  description: "Enterprise MEP Closeout, Digital Handover & Defect Liability Platform for India's construction industry.",
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-[#F7F8FA] text-[#111827] antialiased font-sans selection:bg-[#EEF2FF] selection:text-[#3157D5]">
        <PwaLifecycleManager />
        {children}
      </body>
    </html>
  );
}
