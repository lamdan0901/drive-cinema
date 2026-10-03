import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Drive Cinema',
  description: 'Your Drive. Your screen. Watch videos with your subtitles.',
  icons: {
    icon: { url: '/brand/cloud-play.png', type: 'image/png', sizes: '1254x1254' },
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
