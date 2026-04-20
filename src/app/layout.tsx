import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Medica",
  description: "Pregnancy-focused symptom support with grounded retrieval and safety-first clinical triage guidance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
