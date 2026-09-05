import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bukti — inspectable evidence receipts",
  description: "Gonka-verified public-claim evidence receipts anchored on Sui.",
};

function BuktiMark() {
  return (
    <a className="brand" href="/" aria-label="Bukti home">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2 28 7v8c0 7.5-5 12.4-12 15C9 27.4 4 22.5 4 15V7l12-5Z" />
        <path d="m10.5 16 3.4 3.4 7.6-8" />
      </svg>
      <span>Bukti</span>
    </a>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <BuktiMark />
          <nav aria-label="Primary navigation"><a href="/reports">Public reports</a></nav>
        </header>
        {children}
      </body>
    </html>
  );
}
