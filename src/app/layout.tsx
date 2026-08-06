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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=Fira+Code:wght@400;500;600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Outfit:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Poppins:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Roboto:wght@400;500;700&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        />
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
    var s=localStorage.getItem('nb-theme-id');
    var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;
    var isDark = false;
    if (s === 'dark' || s === 'ocean' || s === 'dracula' || s === 'nord' || s === 'gruvbox') {
      isDark = true;
    } else if (!s && d) {
      isDark = true;
    }
    document.documentElement.classList.toggle('dark', isDark);
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
