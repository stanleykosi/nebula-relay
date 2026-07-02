"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Home,
  LockKeyhole,
  Menu,
  RadioTower,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { connectEvmWallet, persistWallet, storedWalletAddress } from "@/lib/evm-wallet";
import { requestFreighterAddress } from "@/lib/freighter";
import { shortHash } from "@/lib/nebula-api";

export function ProductShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [evmAddress, setEvmAddress] = useState("");
  const [stellarAddress, setStellarAddress] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletError, setWalletError] = useState<string>();

  useEffect(() => {
    setEvmAddress(storedWalletAddress("nebula.evmAddress"));
    setStellarAddress(storedWalletAddress("nebula.stellarAddress"));
  }, []);

  const connectEvm = async () => {
    setWalletError(undefined);
    try {
      const wallet = await connectEvmWallet();
      setEvmAddress(wallet.address);
    } catch (caught) {
      setWalletError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const connectStellar = async () => {
    setWalletError(undefined);
    try {
      const address = await requestFreighterAddress();
      persistWallet("nebula.stellarAddress", address);
      setStellarAddress(address);
    } catch (caught) {
      setWalletError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="nebula-brand" href="/" aria-label="Nebula Relay home">
          <NebulaMark />
          <span>Nebula Relay</span>
        </Link>

        <nav className={`site-nav ${menuOpen ? "open" : ""}`} aria-label="Main">
          <NavLink href="/bridge" active={pathname.startsWith("/bridge")}>
            Bridge
          </NavLink>
          <NavLink href="/activity" active={pathname.startsWith("/activity")}>
            Activity
          </NavLink>
          <NavLink href="/#how-it-works" active={false}>
            How it works
          </NavLink>
        </nav>

        <div className="wallet-cluster">
          <button className="wallet-chip" type="button" onClick={connectEvm}>
            <span className={`status-dot ${evmAddress ? "live" : ""}`} />
            <Wallet size={16} />
            {evmAddress ? shortHash(evmAddress) : "Connect EVM"}
          </button>
          <button className="wallet-chip" type="button" onClick={connectStellar}>
            <span className={`status-dot ${stellarAddress ? "live" : ""}`} />
            <ShieldCheck size={16} />
            {stellarAddress ? shortHash(stellarAddress) : "Connect Stellar"}
          </button>
          <button
            className="mobile-menu-button"
            type="button"
            aria-label="Toggle navigation"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {walletError ? <div className="wallet-error">{walletError}</div> : null}

      {children}

      <footer className="site-footer">
        <div>
          <Link className="nebula-brand footer-brand" href="/">
            <NebulaMark compact />
            <span>Nebula Relay</span>
          </Link>
          <p>
            Proof-backed EVM to Stellar privacy bridge for testnet USDC. Privacy
            without public transaction sprawl.
          </p>
        </div>
        <div className="footer-links">
          <Link href="/bridge">Bridge</Link>
          <Link href="/activity">Activity</Link>
          <Link href="/private">Private Pool</Link>
          <a href="https://stellar.org" rel="noreferrer" target="_blank">
            Stellar <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>

      <nav className="mobile-tabbar" aria-label="Mobile primary navigation">
        <Link className={pathname === "/" ? "active" : ""} href="/">
          <Home size={18} />
          <span>Home</span>
        </Link>
        <Link className={pathname.startsWith("/bridge") ? "active" : ""} href="/bridge">
          <RadioTower size={18} />
          <span>Bridge</span>
        </Link>
        <Link className={pathname.startsWith("/private") ? "active" : ""} href="/private">
          <LockKeyhole size={18} />
          <span>Private</span>
        </Link>
        <Link className={pathname.startsWith("/activity") ? "active" : ""} href="/activity">
          <Activity size={18} />
          <span>Activity</span>
        </Link>
      </nav>
    </div>
  );
}

export function NebulaMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`nebula-mark ${compact ? "compact" : ""}`} aria-hidden="true">
      <span />
    </span>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link className={active ? "active" : ""} href={href}>
      {children}
    </Link>
  );
}
