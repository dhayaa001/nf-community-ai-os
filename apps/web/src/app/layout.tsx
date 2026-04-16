import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'NF Community AI OS',
  description: 'Autonomous AI-powered business operating system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-white/5 backdrop-blur-sm bg-surface/70 sticky top-0 z-10">
          <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              <span className="text-accent">NF</span> Community AI OS
            </Link>
            <div className="flex items-center gap-6 text-sm text-white/70">
              <Link href="/" className="hover:text-white">Chat</Link>
              <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
              <a
                href="https://github.com/dhayaa001/nf-community-ai-os"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white"
              >
                GitHub
              </a>
            </div>
          </nav>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
