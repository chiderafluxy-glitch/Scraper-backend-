import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Final Expense Agent Pipeline',
  description: 'Database of independent final expense/life insurance agents with direct-dial phone numbers',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
