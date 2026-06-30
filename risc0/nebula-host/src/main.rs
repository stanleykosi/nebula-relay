use clap::{Parser, Subcommand};
use nebula_host::{
    prove_fixture, quote_boundless_fixture, quote_boundless_market_fixture,
    quote_boundless_sdk_fixture,
};
use std::path::PathBuf;
use url::Url;

#[derive(Debug, Parser)]
#[command(name = "nebula-host")]
#[command(about = "Nebula Relay proof artifact host")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Prove {
        #[arg(long)]
        fixture: PathBuf,
        #[arg(long, default_value = "local-groth16")]
        mode: String,
        #[arg(long)]
        out: PathBuf,
    },
    QuoteBoundless {
        #[arg(long)]
        fixture: PathBuf,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    QuoteBoundlessMarket {
        #[arg(long)]
        fixture: PathBuf,
        #[arg(long, default_value_t = 8453)]
        chain_id: u64,
        #[arg(long)]
        indexer_url: Option<Url>,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    QuoteBoundlessSdk {
        #[arg(long)]
        fixture: PathBuf,
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Prove { fixture, mode, out } => match prove_fixture(fixture, &mode, out) {
            Ok(artifact) => {
                println!("image_id={}", artifact.image_id_hex);
                println!("journal_digest={}", artifact.journal_digest_hex);
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        },
        Command::QuoteBoundless { fixture, out } => {
            let quote = quote_boundless_fixture(fixture, out.as_deref()).unwrap_or_else(|error| {
                eprintln!("{error}");
                std::process::exit(1);
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&quote).expect("quote JSON should serialize")
            );
        }
        Command::QuoteBoundlessMarket {
            fixture,
            chain_id,
            indexer_url,
            out,
        } => {
            let quote =
                quote_boundless_market_fixture(fixture, chain_id, indexer_url, out.as_deref())
                    .unwrap_or_else(|error| {
                        eprintln!("{error}");
                        std::process::exit(1);
                    });
            println!(
                "{}",
                serde_json::to_string_pretty(&quote).expect("quote JSON should serialize")
            );
        }
        Command::QuoteBoundlessSdk { fixture, out } => {
            let quote =
                quote_boundless_sdk_fixture(fixture, out.as_deref()).unwrap_or_else(|error| {
                    eprintln!("{error}");
                    std::process::exit(1);
                });
            println!(
                "{}",
                serde_json::to_string_pretty(&quote).expect("quote JSON should serialize")
            );
        }
    }
}
