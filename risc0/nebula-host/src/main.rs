use clap::{Parser, Subcommand};
use nebula_host::prove_fixture;
use std::path::PathBuf;

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
        #[arg(long, default_value = "dev")]
        mode: String,
        #[arg(long)]
        out: PathBuf,
    },
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Prove { fixture, mode, out } => prove_fixture(fixture, &mode, out),
    };

    match result {
        Ok(artifact) => {
            println!("image_id={}", artifact.image_id_hex);
            println!("journal_digest={}", artifact.journal_digest_hex);
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
