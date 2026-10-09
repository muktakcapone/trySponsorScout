import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SponsorScout Demo — Sponsorship-first job search",
  description:
    "Find sponsorship-aware job opportunities with your own saved profile and personalized search.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
