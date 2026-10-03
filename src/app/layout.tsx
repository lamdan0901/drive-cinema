import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Drive Cinema',
  description: 'Your Drive. Your screen. Watch videos with your subtitles.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
