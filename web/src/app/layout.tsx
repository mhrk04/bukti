import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bukti — inspectable evidence receipts",
  description: "Gonka-verified public-claim evidence receipts anchored on Sui.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
