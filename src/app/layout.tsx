import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: 'Notebook — Local-first notes with peer sync',
  description:
    'A local-first markdown notebook with live preview, drawing, image attachments, PDF export, and optional P2P device sync powered by Trystero WebRTC.',
  keywords: ['notebook', 'markdown', 'notes', 'sync', 'local-first', 'offline'],
  icons: {
    icon: '/icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
          crossOrigin="anonymous"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  try{
    var s=localStorage.getItem('nb-theme');
    var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;
    var t=s==='dark'||s==='light'?s:(d?'dark':'light');
    document.documentElement.classList.toggle('dark',t==='dark');
  }catch(e){}
})();
          `,
          }}
        />
      </head>
      <body className="h-full overflow-hidden">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
