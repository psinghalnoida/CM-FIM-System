import type { Metadata } from "next";
import { Geist_Mono, Inter, Poppins } from "next/font/google";
import "./globals.css";

// M16: adopts the Claims Mitra design's type pair (Poppins headings /
// Inter body) — see docs/UI_FOUNDATION.md.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claims Mitra — CM FIM",
  description: "Fleet Incident & Insurance Claim Management System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
