"use client";

import type { ReactNode } from "react";
import { Check, Clipboard, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { DemoConfig } from "@/lib/config";

export function ButtonLink({
  href,
  children,
  variant = "default",
}: {
  href: string;
  children: ReactNode;
  variant?: "default" | "primary" | "warn" | "danger";
}) {
  return (
    <a className={`button ${variant}`} href={href}>
      {children}
    </a>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "warn" | "danger";
}) {
  return (
    <button
      className={`button ${variant}`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "info" | "danger";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function HashRow({ label, value }: { label: string; value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return null;
  }
  return (
    <div>
      <span className="label">{label}</span>
      <div className="hash-row">
        <code>{value}</code>
        <button
          className="icon-button"
          type="button"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 900);
          }}
        >
          {copied ? <Check size={15} /> : <Clipboard size={15} />}
        </button>
      </div>
    </div>
  );
}

export function ModeStrip({ config }: { config: DemoConfig }) {
  const modes = [
    ["Proof mode", config.proofMode],
    ["Verifier mode", config.verifierMode],
    ["Stellar network", config.stellarNetwork],
    ["EVM network", config.evmNetwork],
    ["Private payments", config.privatePoolMode],
  ];
  return (
    <div className="mode-strip">
      {modes.map(([label, value]) => (
        <div className="mode-item" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ExternalAnchor({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="button" href={href} rel="noreferrer" target="_blank">
      {children}
      <ExternalLink size={15} />
    </a>
  );
}

export function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
