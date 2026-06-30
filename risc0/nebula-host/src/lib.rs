use boundless_market::{
    alloy::{
        primitives::{utils::format_ether, Address, U256},
        providers::Provider,
    },
    client::FundingMode,
    indexer_client::IndexerClient,
    price_oracle::{Amount, Asset},
    price_provider::{MarketPricing, MarketPricingConfig, PricePercentiles, PriceProvider},
    request_builder::{OfferParams, RequestParams},
    storage::StorageUploaderType,
    Client, Deployment, GuestEnv, StorageUploaderConfig,
};
use chrono::{SecondsFormat, Utc};
use nebula_guest::execute_guest;
use nebula_methods::{NEBULA_GUEST_ELF, NEBULA_GUEST_ID};
use nebula_risc0_shared::{
    bytes_to_hex, encode_journal, journal_digest, load_witness, to_hex_32, witness_hash,
    LockWitness, NebulaError, NebulaJournal, ProofArtifact, ProofMode,
};
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::{default_executor, default_prover, ExecutorEnv, ProverOpts};
use serde_json::{json, Value};
use std::{borrow::Cow, env, fmt::Display, fs, path::Path, str::FromStr, time::Duration};
use thiserror::Error;
use url::Url;

const STATIC_FALLBACK_PRICE_PER_CYCLE_WEI: u64 = 100_000;

#[derive(Debug, Error)]
pub enum HostError {
    #[error(transparent)]
    Nebula(#[from] NebulaError),
    #[error("proof mode {0} is not available; use local-groth16 or remote")]
    UnsupportedMode(String),
    #[error("Boundless remote proving is not configured: {0}")]
    BoundlessConfig(String),
    #[error("Boundless remote proving failed: {0}")]
    Boundless(String),
    #[error("Boundless fulfillment was not usable: {0}")]
    BoundlessFulfillment(String),
    #[error("RISC Zero proving failed: {0}")]
    Proving(String),
    #[error("RISC Zero seal encoding failed: {0}")]
    SealEncoding(String),
    #[error("async runtime failed: {0}")]
    Runtime(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct BoundlessConfig {
    rpc_url: Url,
    requestor_key: String,
    storage_config: StorageUploaderConfig,
    deployment: Option<Deployment>,
    offer_params: OfferParams,
    program_url: Option<Url>,
    poll_interval: Duration,
}

#[derive(Debug, Clone)]
struct BoundlessQuoteConfig {
    indexer_url: Option<Url>,
    buffer_percent: u64,
    market_blocks: u64,
    event_chunk_size: u64,
    pricing_timeout: Duration,
}

#[derive(Debug, Clone)]
struct PricingSnapshot {
    source: String,
    indexer_url: Option<String>,
    percentiles: PricePercentiles,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct BalanceSnapshot {
    requestor: Address,
    chain_id: u64,
    wallet_balance: U256,
    market_balance: U256,
}

impl BoundlessConfig {
    pub fn from_env() -> Result<Self, HostError> {
        Self::from_lookup(|name| env::var(name).ok())
    }

    fn from_lookup<F>(lookup: F) -> Result<Self, HostError>
    where
        F: Fn(&str) -> Option<String>,
    {
        if let Some(value) = var(&lookup, "RISC0_DEV_MODE") {
            if !matches!(value.as_str(), "0" | "false" | "FALSE" | "False") {
                return Err(HostError::BoundlessConfig(
                    "RISC0_DEV_MODE must be unset or false for Boundless testnet proving"
                        .to_owned(),
                ));
            }
        }

        let rpc_url = parse_required::<Url, _>(&lookup, "BOUNDLESS_RPC_URL")?;
        let requestor_key = var(&lookup, "BOUNDLESS_PRIVATE_KEY")
            .or_else(|| var(&lookup, "BOUNDLESS_REQUESTOR_KEY"))
            .ok_or_else(|| {
                HostError::BoundlessConfig(
                    "BOUNDLESS_PRIVATE_KEY is required for remote proving".to_owned(),
                )
            })?;
        let storage_config = storage_config_from_lookup(&lookup)?;
        let program_url = parse_optional::<Url, _>(&lookup, "BOUNDLESS_PROGRAM_URL")?;
        if program_url.is_none() && storage_config.storage_uploader == StorageUploaderType::None {
            return Err(HostError::BoundlessConfig(
                "set BOUNDLESS_PROGRAM_URL or configure Pinata/S3 storage for the guest ELF"
                    .to_owned(),
            ));
        }

        Ok(Self {
            rpc_url,
            requestor_key,
            storage_config,
            deployment: deployment_from_lookup(&lookup)?,
            offer_params: offer_params_from_lookup(&lookup)?,
            program_url,
            poll_interval: Duration::from_secs(
                parse_optional::<u64, _>(&lookup, "BOUNDLESS_POLL_INTERVAL_SECS")?.unwrap_or(5),
            ),
        })
    }
}

impl BoundlessQuoteConfig {
    fn from_env() -> Result<Self, HostError> {
        Self::from_lookup(|name| env::var(name).ok())
    }

    fn from_lookup<F>(lookup: F) -> Result<Self, HostError>
    where
        F: Fn(&str) -> Option<String>,
    {
        Ok(Self {
            indexer_url: parse_optional::<Url, _>(&lookup, "BOUNDLESS_QUOTE_INDEXER_URL")?,
            buffer_percent: parse_optional::<u64, _>(&lookup, "BOUNDLESS_QUOTE_BUFFER_PERCENT")?
                .unwrap_or(125),
            market_blocks: parse_optional::<u64, _>(&lookup, "BOUNDLESS_QUOTE_MARKET_BLOCKS")?
                .unwrap_or(250),
            event_chunk_size: parse_optional::<u64, _>(
                &lookup,
                "BOUNDLESS_QUOTE_EVENT_CHUNK_SIZE",
            )?
            .unwrap_or(1_000),
            pricing_timeout: Duration::from_secs(
                parse_optional::<u64, _>(&lookup, "BOUNDLESS_QUOTE_TIMEOUT_SECS")?.unwrap_or(180),
            ),
        })
    }
}

pub fn prove_fixture(
    fixture: impl AsRef<Path>,
    mode: &str,
    out: impl AsRef<Path>,
) -> Result<ProofArtifact, HostError> {
    match mode {
        "local-groth16" => prove_fixture_local(fixture, out),
        "remote" => {
            let config = BoundlessConfig::from_env()?;
            prove_fixture_remote(fixture, out, config)
        }
        other => return Err(HostError::UnsupportedMode(other.to_owned())),
    }
}

pub fn quote_boundless_fixture(
    fixture: impl AsRef<Path>,
    out: Option<&Path>,
) -> Result<Value, HostError> {
    let config = BoundlessConfig::from_env()?;
    let quote_config = BoundlessQuoteConfig::from_env()?;
    let (witness, _expected_journal, expected_journal_bytes) = prepare_witness(fixture)?;
    let cycles = estimate_guest_cycles(&witness, &expected_journal_bytes)?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| HostError::Runtime(error.to_string()))?;
    let snapshot = runtime.block_on(fetch_pricing_snapshot(&config, &quote_config))?;
    let balance = runtime.block_on(fetch_boundless_balance(&config));

    let quote = build_boundless_quote(
        &config.offer_params,
        cycles,
        &witness,
        &expected_journal_bytes,
        &snapshot,
        balance,
        &quote_config,
    )?;

    if let Some(path) = out {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(&quote)?)?;
    }

    Ok(quote)
}

pub fn quote_boundless_market_fixture(
    fixture: impl AsRef<Path>,
    chain_id: u64,
    indexer_url: Option<Url>,
    out: Option<&Path>,
) -> Result<Value, HostError> {
    let quote_config = BoundlessQuoteConfig::from_env()?;
    let (witness, _expected_journal, expected_journal_bytes) = prepare_witness(fixture)?;
    let cycles = estimate_guest_cycles(&witness, &expected_journal_bytes)?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| HostError::Runtime(error.to_string()))?;
    let snapshot = runtime.block_on(fetch_indexer_pricing_snapshot(
        chain_id,
        indexer_url.clone(),
    ))?;
    let quote = build_boundless_quote(
        &OfferParams::default(),
        cycles,
        &witness,
        &expected_journal_bytes,
        &snapshot,
        Err(HostError::BoundlessConfig(
            "read-only market quote does not query wallet or market balances".to_owned(),
        )),
        &quote_config,
    )?;

    if let Some(path) = out {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(&quote)?)?;
    }

    Ok(quote)
}

pub fn quote_boundless_sdk_fixture(
    fixture: impl AsRef<Path>,
    out: Option<&Path>,
) -> Result<Value, HostError> {
    let config = BoundlessConfig::from_env()?;
    let (witness, _expected_journal, expected_journal_bytes) = prepare_witness(fixture)?;
    let cycles = estimate_guest_cycles(&witness, &expected_journal_bytes)?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| HostError::Runtime(error.to_string()))?;
    let quote = runtime.block_on(build_boundless_sdk_quote(
        &witness,
        &expected_journal_bytes,
        cycles,
        &config,
    ))?;

    if let Some(path) = out {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(&quote)?)?;
    }

    Ok(quote)
}

pub fn prove_fixture_remote(
    fixture: impl AsRef<Path>,
    out: impl AsRef<Path>,
    config: BoundlessConfig,
) -> Result<ProofArtifact, HostError> {
    let (witness, expected_journal, expected_journal_bytes) = prepare_witness(fixture)?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| HostError::Runtime(error.to_string()))?;
    let (seal, journal_bytes) =
        runtime.block_on(prove_boundless(&witness, &expected_journal_bytes, &config))?;
    let artifact = build_artifact(
        ProofMode::Remote,
        seal,
        journal_bytes,
        expected_journal,
        &witness,
    )?;
    write_artifact(out, &artifact)?;
    Ok(artifact)
}

fn prove_fixture_local(
    fixture: impl AsRef<Path>,
    out: impl AsRef<Path>,
) -> Result<ProofArtifact, HostError> {
    let (witness, expected_journal, expected_journal_bytes) = prepare_witness(fixture)?;
    let (seal, journal_bytes) = prove_local_groth16(&witness, &expected_journal_bytes)?;
    let artifact = build_artifact(
        ProofMode::LocalGroth16,
        seal,
        journal_bytes,
        expected_journal,
        &witness,
    )?;
    write_artifact(out, &artifact)?;
    Ok(artifact)
}

fn prepare_witness(
    fixture: impl AsRef<Path>,
) -> Result<(LockWitness, NebulaJournal, Vec<u8>), HostError> {
    let witness = load_witness(fixture)?;
    let expected_journal = execute_guest(&witness)?;
    let expected_journal_bytes = encode_journal(&expected_journal)?;
    Ok((witness, expected_journal, expected_journal_bytes))
}

fn estimate_guest_cycles(
    witness: &LockWitness,
    expected_journal_bytes: &[u8],
) -> Result<u64, HostError> {
    let env = ExecutorEnv::builder()
        .write(witness)
        .map_err(|error| HostError::Proving(error.to_string()))?
        .build()
        .map_err(|error| HostError::Proving(error.to_string()))?;
    let session = default_executor()
        .execute(env, NEBULA_GUEST_ELF)
        .map_err(|error| HostError::Proving(error.to_string()))?;
    if session.journal.bytes != expected_journal_bytes {
        return Err(HostError::Proving(
            "guest journal did not match host validation during cycle estimate".to_owned(),
        ));
    }
    Ok(session.cycles())
}

fn prove_local_groth16(
    witness: &LockWitness,
    expected_journal_bytes: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), HostError> {
    let env = ExecutorEnv::builder()
        .write(witness)
        .map_err(|error| HostError::Proving(error.to_string()))?
        .build()
        .map_err(|error| HostError::Proving(error.to_string()))?;
    let receipt = default_prover()
        .prove_with_opts(env, NEBULA_GUEST_ELF, &ProverOpts::groth16())
        .map_err(|error| HostError::Proving(error.to_string()))?
        .receipt;
    let journal_bytes = receipt.journal.bytes.clone();
    if journal_bytes != expected_journal_bytes {
        return Err(HostError::Proving(
            "guest journal did not match host validation".to_owned(),
        ));
    }
    let seal = encode_seal(&receipt).map_err(|error| HostError::SealEncoding(error.to_string()))?;
    Ok((seal, journal_bytes))
}

async fn fetch_pricing_snapshot(
    config: &BoundlessConfig,
    quote_config: &BoundlessQuoteConfig,
) -> Result<PricingSnapshot, HostError> {
    let mut warnings = Vec::new();
    let indexer_url = quote_config
        .indexer_url
        .clone()
        .or_else(|| deployment_indexer_url(config));

    if let Some(url) = indexer_url.clone() {
        match IndexerClient::new(url.clone()) {
            Ok(client) => match client.price_percentiles().await {
                Ok(percentiles) => {
                    return Ok(PricingSnapshot {
                        source: "indexer".to_owned(),
                        indexer_url: Some(url.to_string()),
                        percentiles,
                        warnings,
                    });
                }
                Err(error) => warnings.push(format!(
                    "Boundless indexer pricing unavailable from {url}: {error:#}"
                )),
            },
            Err(error) => warnings.push(format!(
                "Boundless indexer client could not be created for {url}: {error:#}"
            )),
        }
    } else {
        warnings.push("no Boundless indexer URL configured for this deployment".to_owned());
    }

    for block_window in quote_block_windows(quote_config.market_blocks) {
        let mut market_config = MarketPricingConfig::builder();
        if let Some(deployment) = config.deployment.clone() {
            market_config.deployment(deployment);
        }
        let market_config = market_config
            .event_query_chunk_size(quote_config.event_chunk_size.min(block_window.max(1)))
            .market_price_blocks_to_query(block_window)
            .timeout(quote_config.pricing_timeout)
            .build()
            .map_err(|error| HostError::BoundlessConfig(error.to_string()))?;
        let market_pricing = MarketPricing::new(config.rpc_url.clone(), market_config);
        match market_pricing.price_percentiles().await {
            Ok(percentiles) => {
                return Ok(PricingSnapshot {
                    source: format!("onchain-market-events-{block_window}-blocks"),
                    indexer_url: indexer_url.map(|url| url.to_string()),
                    percentiles,
                    warnings,
                });
            }
            Err(error) => {
                warnings.push(format!(
                    "on-chain Boundless pricing scan over {block_window} blocks returned no usable data: {error:#}"
                ));
            }
        }
    }

    warnings.push(format!(
        "falling back to SDK-style static price of {STATIC_FALLBACK_PRICE_PER_CYCLE_WEI} wei/cycle"
    ));
    Ok(PricingSnapshot {
        source: "static-fallback".to_owned(),
        indexer_url: indexer_url.map(|url| url.to_string()),
        percentiles: static_price_percentiles(),
        warnings,
    })
}

async fn fetch_indexer_pricing_snapshot(
    chain_id: u64,
    indexer_url: Option<Url>,
) -> Result<PricingSnapshot, HostError> {
    let client = match indexer_url.clone() {
        Some(url) => IndexerClient::new(url)
            .map_err(|error| HostError::Boundless(format!("indexer client failed: {error:#}")))?,
        None => IndexerClient::new_from_chain_id(chain_id).map_err(|error| {
            HostError::Boundless(format!(
                "SDK default indexer client failed for chain {chain_id}: {error:#}"
            ))
        })?,
    };
    let percentiles = client
        .price_percentiles()
        .await
        .map_err(|error| HostError::Boundless(format!("indexer pricing failed: {error:#}")))?;
    Ok(PricingSnapshot {
        source: format!("indexer-chain-{chain_id}"),
        indexer_url: indexer_url
            .map(|url| url.to_string())
            .or_else(|| Some(format!("sdk-default-for-chain-{chain_id}"))),
        percentiles,
        warnings: Vec::new(),
    })
}

async fn fetch_boundless_balance(config: &BoundlessConfig) -> Result<BalanceSnapshot, HostError> {
    let client = Client::builder()
        .with_rpc_url(config.rpc_url.clone())
        .with_deployment(config.deployment.clone())
        .with_funding_mode(FundingMode::AvailableBalance)
        .with_private_key_str(&config.requestor_key)
        .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
        .build()
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let signer = client.signer.as_ref().ok_or_else(|| {
        HostError::BoundlessConfig("Boundless signer was not configured".to_owned())
    })?;
    let requestor = signer.address();
    let provider = client.provider();
    let chain_id = provider
        .get_chain_id()
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let wallet_balance = provider
        .get_balance(requestor)
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let market_balance = client
        .boundless_market
        .balance_of(requestor)
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;

    Ok(BalanceSnapshot {
        requestor,
        chain_id,
        wallet_balance,
        market_balance,
    })
}

async fn build_boundless_sdk_quote(
    witness: &LockWitness,
    expected_journal_bytes: &[u8],
    cycles: u64,
    config: &BoundlessConfig,
) -> Result<Value, HostError> {
    let guest_env = GuestEnv::builder()
        .write(witness)
        .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
        .build_env();
    let client = Client::builder()
        .with_rpc_url(config.rpc_url.clone())
        .with_deployment(config.deployment.clone())
        .with_funding_mode(FundingMode::AvailableBalance)
        .with_uploader_config(&config.storage_config)
        .await
        .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
        .with_private_key_str(&config.requestor_key)
        .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
        .build()
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;

    let mut params = RequestParams::new()
        .with_env(guest_env)
        .with_groth16_proof();
    params = if let Some(program_url) = config.program_url.clone() {
        params
            .with_program_url(program_url)
            .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
    } else {
        params.with_program(NEBULA_GUEST_ELF)
    };
    params = params.with_offer(config.offer_params.clone());

    let request = client
        .build_request(params)
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let signer = client.signer.as_ref().ok_or_else(|| {
        HostError::BoundlessConfig("Boundless signer was not configured".to_owned())
    })?;
    let requestor = signer.address();
    let provider = client.provider();
    let chain_id = provider
        .get_chain_id()
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let wallet_balance = provider
        .get_balance(requestor)
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let market_balance = client
        .boundless_market
        .balance_of(requestor)
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let max_price = request.offer.maxPrice;
    let min_price = request.offer.minPrice;
    let funding_value = saturating_sub(max_price, market_balance);
    let gas_price = provider
        .get_gas_price()
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let mut warnings = Vec::new();
    let deposit_gas = if funding_value > U256::ZERO {
        match client
            .boundless_market
            .instance()
            .deposit()
            .value(funding_value)
            .estimate_gas()
            .await
        {
            Ok(gas) => Some(gas),
            Err(error) => {
                warnings.push(format!(
                    "deposit gas estimate failed for requestor address, likely because the wallet is unfunded: {error}"
                ));
                None
            }
        }
    } else {
        Some(0)
    };
    let deposit_gas_cost = deposit_gas.map(|gas| U256::from(gas) * U256::from(gas_price));

    Ok(json!({
        "version": 1,
        "quoteType": "boundless-sdk-dry-run",
        "generatedAt": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        "proofRequest": {
            "program": "nebula-guest",
            "proofType": "raw-groth16",
            "guestCycles": cycles,
            "imageIdHex": to_hex_32(&image_id_bytes(NEBULA_GUEST_ID)),
            "journalDigestHex": to_hex_32(&journal_digest(expected_journal_bytes)),
            "witnessHash": to_hex_32(&witness_hash(witness)?),
            "pricingNote": "offer was built by boundless-market Client::build_request using the configured deployment, Base RPC, indexer price provider, and exact Nebula witness"
        },
        "boundless": {
            "chainId": chain_id,
            "requestor": requestor.to_string(),
            "marketAddress": client.deployment.boundless_market_address.to_string(),
            "orderStreamUrl": client.deployment.order_stream_url.as_ref().map(|value| value.to_string()),
            "indexerUrl": client.deployment.indexer_url.as_ref().map(|value| value.to_string())
        },
        "request": {
            "requestId": format!("0x{:x}", request.id),
            "imageUrl": request.imageUrl,
            "inputType": format!("{:?}", request.input.inputType),
            "expiresAt": request.expires_at(),
            "lockExpiresAt": request.lock_expires_at()
        },
        "offer": {
            "minPriceWei": min_price.to_string(),
            "minPriceEth": wei_to_eth(min_price),
            "maxPriceWei": max_price.to_string(),
            "maxPriceEth": wei_to_eth(max_price),
            "rampUpStart": request.offer.rampUpStart,
            "rampUpPeriodSecs": request.offer.rampUpPeriod,
            "lockTimeoutSecs": request.offer.lockTimeout,
            "timeoutSecs": request.offer.timeout,
            "lockCollateral": request.offer.lockCollateral.to_string()
        },
        "funding": {
            "walletBalanceWei": wallet_balance.to_string(),
            "walletBalanceEth": wei_to_eth(wallet_balance),
            "marketBalanceWei": market_balance.to_string(),
            "marketBalanceEth": wei_to_eth(market_balance),
            "fundingValueWei": funding_value.to_string(),
            "fundingValueEth": wei_to_eth(funding_value),
            "fundingMode": "AvailableBalance"
        },
        "gas": {
            "gasPriceWei": gas_price.to_string(),
            "depositGas": deposit_gas,
            "depositGasCostWei": deposit_gas_cost.map(|value| value.to_string()),
            "depositGasCostEth": deposit_gas_cost.map(wei_to_eth),
            "walletEthNeededWei": deposit_gas_cost.map(|value| (funding_value + value).to_string()),
            "walletEthNeededEth": deposit_gas_cost.map(|value| wei_to_eth(funding_value + value))
        },
        "warnings": warnings
    }))
}

fn build_boundless_quote(
    offer_params: &OfferParams,
    cycles: u64,
    witness: &LockWitness,
    journal_bytes: &[u8],
    snapshot: &PricingSnapshot,
    balance: Result<BalanceSnapshot, HostError>,
    quote_config: &BoundlessQuoteConfig,
) -> Result<Value, HostError> {
    let p95_total = quote_total(
        snapshot.percentiles.p95,
        cycles,
        quote_config.buffer_percent,
    );
    let p99_total = quote_total(
        snapshot.percentiles.p99,
        cycles,
        quote_config.buffer_percent,
    );
    let mut warnings = snapshot.warnings.clone();
    let configured_min = offer_price_eth(
        offer_params.min_price.as_ref(),
        "BOUNDLESS_MIN_PRICE",
        &mut warnings,
    );
    let configured_max = offer_price_eth(
        offer_params.max_price.as_ref(),
        "BOUNDLESS_MAX_PRICE",
        &mut warnings,
    );
    let recommended_min = configured_min.map_or(p95_total, |value| value.max(p95_total));
    let mut recommended_max = configured_max.map_or(p99_total, |value| value.max(p99_total));
    if recommended_max < recommended_min {
        recommended_max = recommended_min;
    }
    if snapshot.source == "static-fallback" {
        warnings.push(
            "no live Boundless market price was available; recommended offer keeps any explicit env price floor and should not be treated as a discovered clearing price"
                .to_owned(),
        );
    }

    let funding = match balance {
        Ok(balance) => {
            let market_shortfall = saturating_sub(recommended_max, balance.market_balance);
            let wallet_shortfall = saturating_sub(market_shortfall, balance.wallet_balance);
            json!({
                "requestor": balance.requestor.to_string(),
                "chainId": balance.chain_id,
                "walletBalanceWei": balance.wallet_balance.to_string(),
                "walletBalanceEth": wei_to_eth(balance.wallet_balance),
                "marketBalanceWei": balance.market_balance.to_string(),
                "marketBalanceEth": wei_to_eth(balance.market_balance),
                "marketShortfallForP99Wei": market_shortfall.to_string(),
                "marketShortfallForP99Eth": wei_to_eth(market_shortfall),
                "walletTopupRequiredWei": wallet_shortfall.to_string(),
                "walletTopupRequiredEth": wei_to_eth(wallet_shortfall),
                "note": "FundingMode::AvailableBalance will only send the market shortfall; the wallet still needs normal transaction gas."
            })
        }
        Err(error) => {
            warnings.push(format!("Boundless balance query failed: {error}"));
            Value::Null
        }
    };

    Ok(json!({
        "version": 1,
        "quoteType": "boundless-remote-proof",
        "generatedAt": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        "proofRequest": {
            "program": "nebula-guest",
            "proofType": "raw-groth16",
            "guestCycles": cycles,
            "imageIdHex": to_hex_32(&image_id_bytes(NEBULA_GUEST_ID)),
            "journalDigestHex": to_hex_32(&journal_digest(journal_bytes)),
            "witnessHash": to_hex_32(&witness_hash(witness)?),
            "pricingNote": "cycle count is estimated by locally executing this exact Nebula witness against NEBULA_GUEST_ELF"
        },
        "guestCycles": cycles,
        "imageIdHex": to_hex_32(&image_id_bytes(NEBULA_GUEST_ID)),
        "journalDigestHex": to_hex_32(&journal_digest(journal_bytes)),
        "witnessHash": to_hex_32(&witness_hash(witness)?),
        "pricingSource": snapshot.source,
        "indexerUrlTried": snapshot.indexer_url,
        "bufferPercent": quote_config.buffer_percent,
        "pricingNote": "diagnostic market estimate only; funding uses quote-boundless-sdk / Boundless SDK Client::build_request",
        "marketBlocksScanned": quote_config.market_blocks,
        "percentiles": percentiles_json(&snapshot.percentiles, cycles, quote_config),
        "marketEstimate": {
            "strategy": if snapshot.source == "static-fallback" {
                "explicit-env-floor-plus-static-cycle-estimate-diagnostic"
            } else {
                "p95-to-p99-buffered-market-diagnostic"
            },
            "minPriceWei": recommended_min.to_string(),
            "minPriceEth": wei_to_eth(recommended_min),
            "maxPriceWei": recommended_max.to_string(),
            "maxPriceEth": wei_to_eth(recommended_max),
            "configuredMinPriceWei": configured_min.map(|value| value.to_string()),
            "configuredMinPriceEth": configured_min.map(wei_to_eth),
            "configuredMaxPriceWei": configured_max.map(|value| value.to_string()),
            "configuredMaxPriceEth": configured_max.map(wei_to_eth),
            "liveEstimateMinPriceWei": p95_total.to_string(),
            "liveEstimateMinPriceEth": wei_to_eth(p95_total),
            "liveEstimateMaxPriceWei": p99_total.to_string(),
            "liveEstimateMaxPriceEth": wei_to_eth(p99_total)
        },
        "funding": funding,
        "warnings": warnings
    }))
}

fn offer_price_eth(
    amount: Option<&Amount>,
    name: &str,
    warnings: &mut Vec<String>,
) -> Option<U256> {
    let Some(amount) = amount else {
        return None;
    };
    if amount.asset == Asset::ETH {
        Some(amount.value)
    } else {
        warnings.push(format!(
            "{name} uses {}; quote floors only apply ETH-denominated offer values",
            amount.asset
        ));
        None
    }
}

fn percentiles_json(
    percentiles: &PricePercentiles,
    cycles: u64,
    quote_config: &BoundlessQuoteConfig,
) -> Value {
    json!({
        "p10": price_json(percentiles.p10, cycles, quote_config),
        "p25": price_json(percentiles.p25, cycles, quote_config),
        "p50": price_json(percentiles.p50, cycles, quote_config),
        "p75": price_json(percentiles.p75, cycles, quote_config),
        "p90": price_json(percentiles.p90, cycles, quote_config),
        "p95": price_json(percentiles.p95, cycles, quote_config),
        "p99": price_json(percentiles.p99, cycles, quote_config)
    })
}

fn price_json(price_per_cycle: U256, cycles: u64, quote_config: &BoundlessQuoteConfig) -> Value {
    let raw = price_per_cycle * U256::from(cycles);
    let buffered = apply_percent(raw, quote_config.buffer_percent);
    json!({
        "pricePerCycleWei": price_per_cycle.to_string(),
        "rawWei": raw.to_string(),
        "rawEth": wei_to_eth(raw),
        "bufferedWei": buffered.to_string(),
        "bufferedEth": wei_to_eth(buffered)
    })
}

fn quote_total(price_per_cycle: U256, cycles: u64, buffer_percent: u64) -> U256 {
    apply_percent(price_per_cycle * U256::from(cycles), buffer_percent)
}

fn apply_percent(value: U256, percent: u64) -> U256 {
    let numerator = value * U256::from(percent);
    let denominator = U256::from(100);
    (numerator + denominator - U256::from(1)) / denominator
}

fn saturating_sub(left: U256, right: U256) -> U256 {
    if left > right {
        left - right
    } else {
        U256::ZERO
    }
}

fn static_price_percentiles() -> PricePercentiles {
    let price = U256::from(STATIC_FALLBACK_PRICE_PER_CYCLE_WEI);
    PricePercentiles {
        p10: price,
        p25: price,
        p50: price,
        p75: price,
        p90: price,
        p95: price,
        p99: price,
    }
}

fn quote_block_windows(configured: u64) -> Vec<u64> {
    let mut windows = vec![configured.max(1)];
    for candidate in [1_000_u64, 250, 50] {
        if candidate < configured && !windows.contains(&candidate) {
            windows.push(candidate);
        }
    }
    windows
}

fn deployment_indexer_url(config: &BoundlessConfig) -> Option<Url> {
    config
        .deployment
        .as_ref()
        .and_then(|deployment| deployment.indexer_url.as_ref())
        .and_then(|value| Url::parse(value.as_ref()).ok())
}

fn wei_to_eth(value: U256) -> String {
    format_ether(value)
}

async fn prove_boundless(
    witness: &LockWitness,
    expected_journal_bytes: &[u8],
    config: &BoundlessConfig,
) -> Result<(Vec<u8>, Vec<u8>), HostError> {
    let guest_env = GuestEnv::builder()
        .write(witness)
        .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
        .build_env();
    let client = Client::builder()
        .with_rpc_url(config.rpc_url.clone())
        .with_deployment(config.deployment.clone())
        .with_funding_mode(FundingMode::AvailableBalance)
        .with_uploader_config(&config.storage_config)
        .await
        .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
        .with_private_key_str(&config.requestor_key)
        .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
        .build()
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;

    let mut request = RequestParams::new()
        .with_env(guest_env)
        .with_groth16_proof();
    request = if let Some(program_url) = config.program_url.clone() {
        request
            .with_program_url(program_url)
            .map_err(|error| HostError::BoundlessConfig(error.to_string()))?
    } else {
        request.with_program(NEBULA_GUEST_ELF)
    };
    request = request.with_offer(config.offer_params.clone());

    let (request_id, expires_at) = client
        .submit(request)
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    eprintln!("Boundless request submitted: 0x{request_id:x}");

    let fulfillment = client
        .wait_for_request_fulfillment(request_id, config.poll_interval, expires_at)
        .await
        .map_err(|error| HostError::Boundless(error.to_string()))?;
    let data = fulfillment
        .data()
        .map_err(|error| HostError::BoundlessFulfillment(error.to_string()))?;
    let journal_bytes = data
        .journal()
        .ok_or_else(|| HostError::BoundlessFulfillment("fulfillment omitted journal".to_owned()))?
        .as_ref()
        .to_vec();
    if journal_bytes != expected_journal_bytes {
        return Err(HostError::BoundlessFulfillment(
            "remote journal did not match host validation".to_owned(),
        ));
    }
    let image_id = data.image_id().ok_or_else(|| {
        HostError::BoundlessFulfillment("fulfillment omitted image ID".to_owned())
    })?;
    if image_id.as_bytes() != &image_id_bytes(NEBULA_GUEST_ID) {
        return Err(HostError::BoundlessFulfillment(
            "remote image ID did not match Nebula guest".to_owned(),
        ));
    }
    let seal = fulfillment.seal.as_ref().to_vec();
    if seal.len() <= 4 {
        return Err(HostError::BoundlessFulfillment(
            "remote Groth16 seal is too short".to_owned(),
        ));
    }
    Ok((seal, journal_bytes))
}

fn build_artifact(
    proof_mode: ProofMode,
    seal: Vec<u8>,
    journal_bytes: Vec<u8>,
    expected_journal: NebulaJournal,
    witness: &LockWitness,
) -> Result<ProofArtifact, HostError> {
    let digest = journal_digest(&journal_bytes);
    let artifact = ProofArtifact {
        version: 1,
        proof_mode,
        seal_hex: bytes_to_hex(&seal),
        image_id_hex: to_hex_32(&image_id_bytes(NEBULA_GUEST_ID)),
        journal_hex: bytes_to_hex(&journal_bytes),
        journal_digest_hex: to_hex_32(&digest),
        public_outputs: expected_journal,
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        witness_hash: to_hex_32(&witness_hash(witness)?),
    };
    Ok(artifact)
}

fn write_artifact(out: impl AsRef<Path>, artifact: &ProofArtifact) -> Result<(), HostError> {
    if let Some(parent) = out.as_ref().parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(out, serde_json::to_vec_pretty(&artifact)?)?;
    Ok(())
}

fn image_id_bytes(words: [u32; 8]) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    for (index, word) in words.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    bytes
}

fn storage_config_from_lookup<F>(lookup: &F) -> Result<StorageUploaderConfig, HostError>
where
    F: Fn(&str) -> Option<String>,
{
    let mut config = StorageUploaderConfig::default();
    let explicit = var(lookup, "BOUNDLESS_STORAGE_UPLOADER").map(|value| value.to_lowercase());
    let pinata_jwt = var(lookup, "BOUNDLESS_PINATA_JWT").or_else(|| var(lookup, "PINATA_JWT"));
    let s3_bucket = var(lookup, "BOUNDLESS_S3_BUCKET").or_else(|| var(lookup, "S3_BUCKET"));

    config.storage_uploader = match explicit.as_deref() {
        Some("none") => StorageUploaderType::None,
        Some("pinata") => StorageUploaderType::Pinata,
        Some("s3") => StorageUploaderType::S3,
        Some(other) => {
            return Err(HostError::BoundlessConfig(format!(
                "unsupported BOUNDLESS_STORAGE_UPLOADER '{other}'; use pinata, s3, or none"
            )));
        }
        None if pinata_jwt.is_some() => StorageUploaderType::Pinata,
        None if s3_bucket.is_some() => StorageUploaderType::S3,
        None => StorageUploaderType::None,
    };

    config.pinata_jwt = pinata_jwt;
    config.pinata_api_url = parse_optional(lookup, "BOUNDLESS_PINATA_API_URL")?
        .or(parse_optional(lookup, "PINATA_API_URL")?);
    config.ipfs_gateway_url = parse_optional(lookup, "BOUNDLESS_IPFS_GATEWAY_URL")?
        .or(parse_optional(lookup, "IPFS_GATEWAY_URL")?);

    config.s3_bucket = s3_bucket;
    config.s3_url = var(lookup, "BOUNDLESS_S3_URL").or_else(|| var(lookup, "S3_URL"));
    config.aws_access_key_id =
        var(lookup, "BOUNDLESS_AWS_ACCESS_KEY_ID").or_else(|| var(lookup, "AWS_ACCESS_KEY_ID"));
    config.aws_secret_access_key = var(lookup, "BOUNDLESS_AWS_SECRET_ACCESS_KEY")
        .or_else(|| var(lookup, "AWS_SECRET_ACCESS_KEY"));
    config.aws_region = var(lookup, "BOUNDLESS_AWS_REGION").or_else(|| var(lookup, "AWS_REGION"));
    config.s3_presigned = parse_optional(lookup, "BOUNDLESS_S3_PRESIGNED")?
        .or(parse_optional(lookup, "S3_PRESIGNED")?);
    config.s3_public_url = parse_optional(lookup, "BOUNDLESS_S3_PUBLIC_URL")?
        .or(parse_optional(lookup, "S3_PUBLIC_URL")?);

    Ok(config)
}

fn deployment_from_lookup<F>(lookup: &F) -> Result<Option<Deployment>, HostError>
where
    F: Fn(&str) -> Option<String>,
{
    let market = parse_optional::<Address, _>(lookup, "BOUNDLESS_MARKET_ADDRESS")?;
    let set_verifier = parse_optional::<Address, _>(lookup, "BOUNDLESS_SET_VERIFIER_ADDRESS")?;
    let verifier_router =
        parse_optional::<Address, _>(lookup, "BOUNDLESS_VERIFIER_ROUTER_ADDRESS")?;
    let collateral = parse_optional::<Address, _>(lookup, "BOUNDLESS_COLLATERAL_TOKEN_ADDRESS")?;
    let order_stream = var(lookup, "BOUNDLESS_ORDER_STREAM_URL").map(Cow::Owned);
    let indexer_url = var(lookup, "BOUNDLESS_INDEXER_URL").map(Cow::Owned);
    let chain_id = parse_optional::<u64, _>(lookup, "BOUNDLESS_MARKET_CHAIN_ID")?;
    let deployment_block = parse_optional::<u64, _>(lookup, "BOUNDLESS_DEPLOYMENT_BLOCK")?;

    if market.is_some()
        || set_verifier.is_some()
        || verifier_router.is_some()
        || collateral.is_some()
        || order_stream.is_some()
        || indexer_url.is_some()
        || deployment_block.is_some()
    {
        let mut builder = Deployment::builder();
        if let Some(id) = chain_id {
            builder.market_chain_id(id);
        }
        builder.boundless_market_address(market.ok_or_else(|| {
            HostError::BoundlessConfig(
                "BOUNDLESS_MARKET_ADDRESS is required for a custom deployment".to_owned(),
            )
        })?);
        builder.set_verifier_address(set_verifier.ok_or_else(|| {
            HostError::BoundlessConfig(
                "BOUNDLESS_SET_VERIFIER_ADDRESS is required for a custom deployment".to_owned(),
            )
        })?);
        if let Some(addr) = verifier_router {
            builder.verifier_router_address(addr);
        }
        if let Some(addr) = collateral {
            builder.collateral_token_address(addr);
        }
        if let Some(url) = order_stream {
            builder.order_stream_url(url);
        }
        if let Some(url) = indexer_url {
            builder.indexer_url(url);
        }
        if let Some(block) = deployment_block {
            builder.deployment_block(block);
        }
        return builder
            .build()
            .map(Some)
            .map_err(|error| HostError::BoundlessConfig(error.to_string()));
    }

    match chain_id {
        Some(id) => Deployment::from_chain_id(id).map(Some).ok_or_else(|| {
            HostError::BoundlessConfig(format!("Boundless SDK has no deployment for chain {id}"))
        }),
        None => Ok(None),
    }
}

fn offer_params_from_lookup<F>(lookup: &F) -> Result<OfferParams, HostError>
where
    F: Fn(&str) -> Option<String>,
{
    let mut params = OfferParams::default();
    params.min_price = parse_optional(lookup, "BOUNDLESS_MIN_PRICE")?;
    params.max_price = parse_optional(lookup, "BOUNDLESS_MAX_PRICE")?;
    params.bidding_start = parse_optional(lookup, "BOUNDLESS_BIDDING_START")?;
    params.ramp_up_period = parse_optional(lookup, "BOUNDLESS_RAMP_UP_PERIOD_SECS")?;
    params.lock_timeout = parse_optional(lookup, "BOUNDLESS_LOCK_TIMEOUT_SECS")?;
    params.timeout = parse_optional(lookup, "BOUNDLESS_TIMEOUT_SECS")?;
    params.lock_collateral = parse_optional(lookup, "BOUNDLESS_LOCK_COLLATERAL")?;
    Ok(params)
}

fn var<F>(lookup: &F, name: &str) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    lookup(name).and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

fn parse_required<T, F>(lookup: &F, name: &str) -> Result<T, HostError>
where
    T: FromStr,
    T::Err: Display,
    F: Fn(&str) -> Option<String>,
{
    let value = var(lookup, name).ok_or_else(|| {
        HostError::BoundlessConfig(format!("{name} is required for Boundless remote proving"))
    })?;
    value
        .parse::<T>()
        .map_err(|error| HostError::BoundlessConfig(format!("{name} is invalid: {error}")))
}

fn parse_optional<T, F>(lookup: &F, name: &str) -> Result<Option<T>, HostError>
where
    T: FromStr,
    T::Err: Display,
    F: Fn(&str) -> Option<String>,
{
    var(lookup, name)
        .map(|value| {
            value
                .parse::<T>()
                .map_err(|error| HostError::BoundlessConfig(format!("{name} is invalid: {error}")))
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn fixture(name: &str) -> String {
        format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
    }

    fn lookup(values: HashMap<&'static str, &'static str>) -> impl Fn(&str) -> Option<String> {
        move |name| values.get(name).map(|value| (*value).to_owned())
    }

    #[test]
    fn unsupported_mode_fails_before_output() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("proof.json");
        assert!(matches!(
            prove_fixture(fixture("valid-lock.json"), "fixture", &out),
            Err(HostError::UnsupportedMode(_))
        ));
        assert!(!out.exists());
    }

    #[test]
    fn invalid_fixture_fails_before_local_proving() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("proof.json");
        assert!(prove_fixture(fixture("wrong-token.json"), "local-groth16", &out).is_err());
    }

    #[test]
    fn remote_requires_boundless_config() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("proof.json");
        assert!(matches!(
            prove_fixture(fixture("valid-lock.json"), "remote", &out),
            Err(HostError::BoundlessConfig(_))
        ));
    }

    #[test]
    fn image_id_is_32_bytes() {
        assert_eq!(image_id_bytes(NEBULA_GUEST_ID).len(), 32);
    }

    #[test]
    fn boundless_config_accepts_pinata_and_sepolia_deployment() {
        let config = BoundlessConfig::from_lookup(lookup(HashMap::from([
            ("BOUNDLESS_RPC_URL", "https://ethereum-sepolia.example"),
            (
                "BOUNDLESS_PRIVATE_KEY",
                "0x0000000000000000000000000000000000000000000000000000000000000001",
            ),
            (
                "BOUNDLESS_PROGRAM_URL",
                "https://example.com/nebula-guest.bin",
            ),
            ("PINATA_JWT", "template-token"),
            ("BOUNDLESS_MARKET_CHAIN_ID", "11155111"),
            ("BOUNDLESS_MAX_PRICE", "0.001 ETH"),
            ("BOUNDLESS_TIMEOUT_SECS", "600"),
        ])))
        .unwrap();
        assert_eq!(
            config.storage_config.storage_uploader,
            StorageUploaderType::Pinata
        );
        assert!(config.deployment.is_some());
        assert_eq!(config.offer_params.timeout, Some(600));
        assert!(config.offer_params.max_price.is_some());
    }

    #[test]
    fn boundless_config_rejects_dev_mode() {
        assert!(matches!(
            BoundlessConfig::from_lookup(lookup(HashMap::from([
                ("RISC0_DEV_MODE", "1"),
                ("BOUNDLESS_RPC_URL", "https://ethereum-sepolia.example"),
                (
                    "BOUNDLESS_PRIVATE_KEY",
                    "0x0000000000000000000000000000000000000000000000000000000000000001",
                ),
                (
                    "BOUNDLESS_PROGRAM_URL",
                    "https://example.com/nebula-guest.bin"
                ),
            ]))),
            Err(HostError::BoundlessConfig(_))
        ));
    }

    #[test]
    fn quote_total_applies_buffer() {
        let total = quote_total(U256::from(100_000u64), 2_000_000, 125);
        assert_eq!(total, U256::from(250_000_000_000u64));
    }

    #[test]
    fn quote_config_uses_separate_indexer_override_without_offer_constants() {
        let config = BoundlessQuoteConfig::from_lookup(lookup(HashMap::from([
            ("BOUNDLESS_QUOTE_INDEXER_URL", "https://indexer.example/"),
            ("BOUNDLESS_QUOTE_BUFFER_PERCENT", "150"),
        ])))
        .unwrap();
        assert_eq!(
            config.indexer_url.unwrap().as_str(),
            "https://indexer.example/"
        );
        assert_eq!(config.buffer_percent, 150);
    }

    #[test]
    fn quote_block_windows_retry_smaller_scans() {
        assert_eq!(quote_block_windows(5_000), vec![5_000, 1_000, 250, 50]);
        assert_eq!(quote_block_windows(250), vec![250, 50]);
        assert_eq!(quote_block_windows(1), vec![1]);
    }
}
