import type { ReactNode } from 'react';

export const metadata = {
  title: 'StreamPulse Dashboard',
  description: 'StreamPulse Milestone 1 status dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
