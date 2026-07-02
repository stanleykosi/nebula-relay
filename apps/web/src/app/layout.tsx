import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ProductShell } from "@/components/nebula/ProductShell";

export const metadata: Metadata = {
  title: "Nebula Relay",
  description:
    "A proof-backed privacy bridge for moving USDC from EVM into Stellar private pools.",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      className={`${geist.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      lang="en"
    >
      <body>
        <Providers>
          <ProductShell>{children}</ProductShell>
        </Providers>
      </body>
    </html>
  );
}
