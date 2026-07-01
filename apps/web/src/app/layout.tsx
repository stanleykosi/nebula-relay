import type { Metadata } from "next";
import Link from "next/link";
import { RadioTower } from "lucide-react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Nebula Relay",
  description:
    "ZK relay for proof-gated private Stellar payment notes from EVM lock events.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="app-shell">
            <header className="topbar">
              <Link className="brand" href="/">
                <span className="brand-mark" aria-hidden="true">
                  <RadioTower size={17} />
                </span>
                <span>Nebula Relay</span>
              </Link>
              <nav className="nav" aria-label="Main navigation">
                <Link href="/demo">Demo</Link>
                <Link href="/private-prover">Private Prover</Link>
                <Link href="/failure-lab">Failure Lab</Link>
                <Link href="/docs">Docs</Link>
              </nav>
            </header>
            {children}
            <footer className="footer">
              Relay-first testnet UI. Local fixture simulation is labeled
              wherever it appears.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
