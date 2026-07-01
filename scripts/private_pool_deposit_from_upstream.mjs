#!/usr/bin/env node
import fs from "node:fs";
import {
  inspectPrivatePoolPreparedTx,
  privatePoolDepositScValToXdr,
} from "../packages/stellar-client/dist/index.js";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input ?? process.env.NEBULA_UPSTREAM_PRIVATE_POOL_PROOF_JSON;
const outPath = args.out ?? process.env.NEBULA_PRIVATE_POOL_DEPOSIT_XDR_PATH;
const metadataOutPath =
  args.metadataOut ?? process.env.NEBULA_PRIVATE_POOL_DEPOSIT_METADATA_PATH;
const expectedPoolId = args.expectedPool ?? process.env.PRIVATE_PAYMENTS_POOL_ID;
const expectedSettlementAmount =
  args.expectedSettlement ?? process.env.NEBULA_SETTLEMENT_AMOUNT;
const expectedNoteCommitment =
  args.expectedNote ?? process.env.NEBULA_NOTE_COMMITMENT;
const noteOutputIndex = parseNoteOutputIndex(
  args.noteOutputIndex ?? process.env.NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX
);

if (!inputPath) {
  fail("missing --input or NEBULA_UPSTREAM_PRIVATE_POOL_PROOF_JSON");
}
if (!outPath) {
  fail("missing --out or NEBULA_PRIVATE_POOL_DEPOSIT_XDR_PATH");
}
if (!expectedPoolId || !expectedSettlementAmount) {
  fail(
    "expected pool and settlement amount are required for binding checks"
  );
}

const upstream = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const params = {
  upstream,
  expectedPoolId,
  expectedSettlementAmount,
  expectedNoteCommitment,
  noteOutputIndex,
};
const inspection = inspectPrivatePoolPreparedTx(params);
const xdr = privatePoolDepositScValToXdr(params);

fs.writeFileSync(outPath, `${xdr}\n`);
if (metadataOutPath) {
  fs.writeFileSync(
    metadataOutPath,
    `${JSON.stringify(
      {
        ...inspection,
        privatePoolDepositXdrPath: outPath,
        upstreamPreparedTxPath: inputPath,
      },
      null,
      2
    )}\n`
  );
}
console.log(`Wrote PrivatePoolDeposit ScVal XDR to ${outPath}`);
console.log(`selected_note_commitment=${inspection.selectedNoteCommitment}`);

function parseNoteOutputIndex(value) {
  if (value === undefined || value === "") {
    return 0;
  }
  if (value === "0" || value === 0) {
    return 0;
  }
  if (value === "1" || value === 1) {
    return 1;
  }
  fail("NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX must be 0 or 1");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      fail(`unexpected argument: ${item}`);
    }
    const key = item.slice(2).replace(/-([a-z])/g, (_, char) =>
      char.toUpperCase()
    );
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for ${item}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function fail(message) {
  console.error(`private_pool_deposit_from_upstream: ${message}`);
  process.exit(1);
}
