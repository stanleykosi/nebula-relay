use std::{fs, path::PathBuf, time::Duration};

use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use prover::{
    crypto::asp_membership_leaf,
    encryption::{
        KEY_DERIVATION_MESSAGE, derive_encryption_and_note_keypairs,
        derive_membership_blinding, generate_random_blinding,
    },
    flows::{TransactOutput, TransactParams, transact},
    merkle::MerklePrefixTree,
    prover::Prover,
};
use serde::Serialize;
use stellar::{
    Client, LocalSigner, PreparedSorobanTx, StateFetcher, hash_ext_data_offchain,
    parse_event_metadata, scval_to_u64, scval_to_u256,
};
use types::{
    AspMembershipProof, ContractConfig, ContractEvent, ExtAmount, Field, KeyDerivationSignature,
    LeafAddedEvent, NoteAmount, SMT_DEPTH,
};
use witness::WitnessCalculator;

#[derive(Debug, Parser)]
#[command(author, version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Inspect(CommonArgs),
    Prepare(PrepareArgs),
}

#[derive(Debug, Parser)]
struct CommonArgs {
    #[arg(long)]
    rpc_url: String,
    #[arg(long)]
    deployment_json: PathBuf,
    #[arg(long)]
    pool_id: String,
    #[arg(long)]
    source_secret: String,
    #[arg(long)]
    recipient_secret: Option<String>,
    #[arg(long)]
    out: PathBuf,
}

#[derive(Debug, Parser)]
struct PrepareArgs {
    #[command(flatten)]
    common: CommonArgs,
    #[arg(long)]
    amount: String,
    #[arg(long)]
    repo_root: Option<PathBuf>,
    #[arg(long)]
    circuit_profile: Option<String>,
}

#[derive(Clone)]
struct ContextData {
    fetcher: StateFetcher,
    source_public: String,
    recipient: RecipientKeys,
    membership_leaf: Field,
    leaf_events: Vec<LeafAddedEvent>,
}

#[derive(Clone)]
struct RecipientKeys {
    note_keypair: types::NoteKeyPair,
    encryption_keypair: types::EncryptionKeyPair,
    membership_blinding: Field,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectOutput {
    pool_id: String,
    source_public_key: String,
    note_public_key: types::NotePublicKey,
    encryption_public_key: types::EncryptionPublicKey,
    membership_blinding: Field,
    membership_leaf: Field,
    membership_leaf_decimal: String,
    membership_registered: bool,
    membership_leaf_index: Option<u32>,
    observed_leaf_count: usize,
    asp_membership_contract_id: String,
    asp_membership_root: Field,
    asp_membership_next_index: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareOutput {
    #[serde(flatten)]
    prepared: PreparedProverTx,
    nebula_private_pool_prepare: PrepareMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareMetadata {
    recipient_note_public_key: types::NotePublicKey,
    recipient_encryption_public_key: types::EncryptionPublicKey,
    membership_leaf: Field,
    membership_leaf_index: u32,
    amount: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedProverTx {
    proof_uncompressed: Vec<u8>,
    ext_data: types::ExtData,
    prepared: PreparedTxPublic,
    soroban_tx: PreparedSorobanTx,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedTxPublic {
    pool_root: Field,
    input_nullifiers: [Field; 2],
    output_commitments: [Field; 2],
    public_amount: Field,
    ext_data_hash_be: [u8; 32],
    asp_membership_root: Field,
    asp_non_membership_root: Field,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Inspect(args) => {
            let ctx = load_context(&args).await?;
            let state = ctx.fetcher.contracts_data_for_pool(&args.pool_id).await?;
            let (registered, index) = find_leaf(&ctx.leaf_events, ctx.membership_leaf);
            let output = InspectOutput {
                pool_id: args.pool_id,
                source_public_key: ctx.source_public,
                note_public_key: ctx.recipient.note_keypair.public,
                encryption_public_key: ctx.recipient.encryption_keypair.public,
                membership_blinding: ctx.recipient.membership_blinding,
                membership_leaf: ctx.membership_leaf,
                membership_leaf_decimal: field_decimal(ctx.membership_leaf),
                membership_registered: registered,
                membership_leaf_index: index,
                observed_leaf_count: ctx.leaf_events.len(),
                asp_membership_contract_id: state.asp_membership.contract_id,
                asp_membership_root: state.asp_membership.root,
                asp_membership_next_index: state.asp_membership.next_index,
            };
            write_json(&args.out, &output)
        }
        Command::Prepare(args) => prepare(args).await,
    }
}

async fn prepare(args: PrepareArgs) -> Result<()> {
    let ctx = load_context(&args.common).await?;
    let state = ctx
        .fetcher
        .contracts_data_for_pool(&args.common.pool_id)
        .await?;
    let pool = state
        .pools
        .first()
        .ok_or_else(|| anyhow!("pool state was not returned"))?;
    let pool_root = pool
        .merkle_root
        .ok_or_else(|| anyhow!("pool root was not returned"))?;
    let pool_next_index = pool.merkle_next_index.parse::<u32>()?;
    if pool_next_index != 0 {
        bail!(
            "Nebula prepare-only deposit currently expects no private-pool input notes; pool next index is {pool_next_index}"
        );
    }

    let (registered, leaf_index) = find_leaf(&ctx.leaf_events, ctx.membership_leaf);
    if !registered {
        bail!(
            "recipient ASP membership leaf is not registered yet: {}",
            ctx.membership_leaf
        );
    }
    let leaf_index = leaf_index.ok_or_else(|| anyhow!("registered leaf missing index"))?;

    let membership_proof = build_membership_proof(
        &ctx.leaf_events,
        leaf_index,
        ctx.membership_leaf,
        ctx.recipient.membership_blinding,
        state.asp_membership.root,
        state.asp_membership.levels,
    )?;
    let non_membership_proof = ctx
        .fetcher
        .get_nonmembership_proof(
            &ctx.recipient.note_keypair.public,
            state.asp_non_membership.root,
            SMT_DEPTH as usize,
            &ctx.source_public,
        )
        .await?;

    let amount = args
        .amount
        .parse::<u128>()
        .with_context(|| format!("invalid --amount {}", args.amount))?;
    if amount == 0 {
        bail!("--amount must be greater than zero");
    }
    let amount = NoteAmount::from(amount);
    let ext_amount = ExtAmount::try_from(amount)?;
    let outputs = vec![
        TransactOutput {
            amount,
            blinding: generate_random_blinding()?,
            recipient_note_pubkey: Some(ctx.recipient.note_keypair.public.clone()),
            recipient_encryption_pubkey: Some(ctx.recipient.encryption_keypair.public.clone()),
        },
        TransactOutput {
            amount: NoteAmount::ZERO,
            blinding: generate_random_blinding()?,
            recipient_note_pubkey: Some(ctx.recipient.note_keypair.public.clone()),
            recipient_encryption_pubkey: Some(ctx.recipient.encryption_keypair.public.clone()),
        },
    ];

    let artifacts = transact(
        TransactParams {
            priv_key: ctx.recipient.note_keypair.private.clone(),
            encryption_pubkey: ctx.recipient.encryption_keypair.public.clone(),
            pool_root,
            ext_recipient: args.common.pool_id.clone(),
            ext_amount,
            inputs: Vec::new(),
            outputs,
            membership_proof,
            non_membership_proof,
            tree_depth: pool.merkle_levels,
            smt_depth: SMT_DEPTH,
        },
        hash_ext_data_offchain,
    )?;

    let repo_root = args.repo_root.unwrap_or_else(|| PathBuf::from("."));
    let profile = args.circuit_profile.unwrap_or_else(|| "debug".to_string());
    let circuits_dir = repo_root.join("target/circuits-artifacts").join(profile);
    let wasm = fs::read(circuits_dir.join("policy_tx_2_2.wasm"))
        .with_context(|| format!("missing circuit wasm in {}", circuits_dir.display()))?;
    let r1cs = fs::read(circuits_dir.join("policy_tx_2_2.r1cs"))
        .with_context(|| format!("missing circuit r1cs in {}", circuits_dir.display()))?;
    let proving_key =
        fs::read(repo_root.join("deployments/testnet/circuit_keys/policy_tx_2_2_proving_key.bin"))
            .context("missing policy_tx_2_2 proving key")?;

    let mut witness_calc = WitnessCalculator::new(&wasm, &r1cs)?;
    let circuit_inputs_json = serde_json::to_string(&artifacts.circuit_inputs)?;
    let witness_bytes = witness_calc.compute_witness(&circuit_inputs_json)?;
    let prover = Prover::new(&proving_key, &r1cs)?;
    let proof_compressed = prover.prove_bytes(&witness_bytes)?;
    let public_inputs = prover.extract_public_inputs(&witness_bytes)?;
    if !prover.verify(&proof_compressed, &public_inputs)? {
        bail!("generated private-pool proof did not verify locally");
    }
    let proof_uncompressed = prover.proof_bytes_to_uncompressed(&proof_compressed)?;
    if proof_uncompressed.len() != 256 {
        bail!(
            "unexpected uncompressed proof length: {}",
            proof_uncompressed.len()
        );
    }

    let prepared_public = PreparedTxPublic {
        pool_root: artifacts.prepared.pool_root,
        input_nullifiers: artifacts.prepared.input_nullifiers,
        output_commitments: artifacts.prepared.output_commitments,
        public_amount: artifacts.prepared.public_amount_field,
        ext_data_hash_be: artifacts.prepared.ext_data_hash_be,
        asp_membership_root: artifacts.prepared.asp_membership_root,
        asp_non_membership_root: artifacts.prepared.asp_non_membership_root,
    };

    let output = PrepareOutput {
        prepared: PreparedProverTx {
            proof_uncompressed,
            ext_data: artifacts.ext_data,
            prepared: prepared_public,
            soroban_tx: PreparedSorobanTx::default(),
        },
        nebula_private_pool_prepare: PrepareMetadata {
            recipient_note_public_key: ctx.recipient.note_keypair.public,
            recipient_encryption_public_key: ctx.recipient.encryption_keypair.public,
            membership_leaf: ctx.membership_leaf,
            membership_leaf_index: leaf_index,
            amount: amount.to_string(),
        },
    };
    write_json(&args.common.out, &output)
}

async fn load_context(args: &CommonArgs) -> Result<ContextData> {
    let config_text = fs::read_to_string(&args.deployment_json)
        .with_context(|| format!("read {}", args.deployment_json.display()))?;
    let config: ContractConfig = serde_json::from_str(&config_text)?;
    ensure_enabled_pool(&config, &args.pool_id)?;
    let config: &'static ContractConfig = Box::leak(Box::new(config));
    let fetcher = StateFetcher::new(&args.rpc_url, config)?;
    let source_public = LocalSigner::from_secret(&args.source_secret)?
        .public_key()
        .to_string();
    let recipient_secret = args.recipient_secret.as_deref().unwrap_or(&args.source_secret);
    let recipient = derive_recipient(recipient_secret, &config.network)?;
    let membership_leaf =
        asp_membership_leaf(&recipient.note_keypair.public, &recipient.membership_blinding)?;
    let leaf_events = fetch_membership_leaves(
        &Client::new(&args.rpc_url)?,
        &config.asp_membership,
        config.min_deployment_ledger()?,
    )
    .await?;

    Ok(ContextData {
        fetcher,
        source_public,
        recipient,
        membership_leaf,
        leaf_events,
    })
}

fn derive_recipient(secret: &str, network: &str) -> Result<RecipientKeys> {
    let signer = LocalSigner::from_secret(secret)?;
    let signature = signer.sign(KEY_DERIVATION_MESSAGE.as_bytes());
    let signature = KeyDerivationSignature(signature.as_bytes().to_vec());
    let (note_keypair, encryption_keypair) =
        derive_encryption_and_note_keypairs(signature.clone())?;
    let membership_blinding = derive_membership_blinding(&signature, network)?;
    Ok(RecipientKeys {
        note_keypair,
        encryption_keypair,
        membership_blinding,
    })
}

async fn fetch_membership_leaves(
    client: &Client,
    asp_contract_id: &str,
    start_ledger: u32,
) -> Result<Vec<LeafAddedEvent>> {
    let mut cursor = None;
    let mut out = Vec::new();
    for _ in 0..20 {
        let (new_cursor, events, _) = client
            .get_contract_events(&[asp_contract_id.to_string()], start_ledger, 300, cursor)
            .await?;
        let event_count = events.len();
        for event in events {
            let event: ContractEvent = event.into();
            if event.contract_id != asp_contract_id {
                continue;
            }
            if let Some(leaf) = parse_leaf_added(event)? {
                out.push(leaf);
            }
        }
        cursor = new_cursor;
        if cursor.is_none() || event_count < 300 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    out.sort_by_key(|leaf| leaf.index);
    Ok(out)
}

fn parse_leaf_added(event: ContractEvent) -> Result<Option<LeafAddedEvent>> {
    let parsed = parse_event_metadata(event)?;
    if parsed.name != "leaf_added" && parsed.name != "LeafAdded" {
        return Ok(None);
    }
    let leaf = parsed
        .values
        .get("leaf")
        .ok_or_else(|| anyhow!("LeafAdded event missing leaf"))?;
    let index = parsed
        .values
        .get("index")
        .ok_or_else(|| anyhow!("LeafAdded event missing index"))?;
    let root = parsed
        .values
        .get("root")
        .ok_or_else(|| anyhow!("LeafAdded event missing root"))?;
    Ok(Some(LeafAddedEvent {
        id: parsed.id,
        leaf: Field::try_from_u256(scval_to_u256(leaf)?)?,
        index: scval_to_u64(index)?.try_into()?,
        root: Field::try_from_u256(scval_to_u256(root)?)?,
    }))
}

fn find_leaf(leaves: &[LeafAddedEvent], leaf: Field) -> (bool, Option<u32>) {
    leaves
        .iter()
        .find(|event| event.leaf == leaf)
        .map(|event| (true, Some(event.index)))
        .unwrap_or((false, None))
}

fn build_membership_proof(
    leaves: &[LeafAddedEvent],
    leaf_index: u32,
    leaf: Field,
    blinding: Field,
    expected_root: Field,
    depth: u32,
) -> Result<AspMembershipProof> {
    let mut ordered = Vec::with_capacity(leaves.len());
    for (expected_index, event) in leaves.iter().enumerate() {
        let expected_index = u32::try_from(expected_index)?;
        if event.index != expected_index {
            bail!(
                "ASP membership events have a gap at index {expected_index}; observed {}",
                event.index
            );
        }
        ordered.push(event.leaf);
    }
    let tree = MerklePrefixTree::new(depth, &ordered)?.into_built();
    let root = tree.root()?;
    if root != expected_root {
        bail!("ASP membership root mismatch; wait for RPC event sync and retry");
    }
    let proof = tree.proof(leaf_index)?;
    Ok(AspMembershipProof {
        leaf,
        blinding,
        path_elements: proof.path_elements,
        path_indices: proof.path_indices,
        root: proof.root,
    })
}

fn field_decimal(field: Field) -> String {
    types::U256::from(field).to_string()
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = format!("{}\n", serde_json::to_string_pretty(value)?);
    fs::write(path, json).with_context(|| format!("write {}", path.display()))
}

fn ensure_enabled_pool(config: &ContractConfig, pool_id: &str) -> Result<()> {
    config
        .enabled_pools()
        .find(|pool| pool.pool_contract_id == pool_id)
        .map(|_| ())
        .ok_or_else(|| anyhow!("enabled pool not found in deployment config: {pool_id}"))
}
