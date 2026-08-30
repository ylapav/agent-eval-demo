import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nordkanta-agentti",
  description:
    "Asiakaspalveluagentti työkaluineen, turvarajoineen ja evaluointikerroksineen.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}
