import { z } from "zod";

const hex = (bytes: number) =>
  z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`));

export const Hex20Schema = hex(20);
export const Hex32Schema = hex(32);
export const HexBytesSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
export const DecimalStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const Uint32Schema = z.number().int().nonnegative().max(4_294_967_295);

export const ComplianceModeSchema = z.enum([
  "disabled-demo",
  "allowlist-membership",
  "denylist-non-membership",
]);

export const CctpSettlementSchema = z.object({
  sourceDomain: Uint32Schema,
  destinationDomain: Uint32Schema,
  nonce: Hex32Schema,
  message: HexBytesSchema,
  messageHash: Hex32Schema,
  attestationHash: Hex32Schema,
  mintRecipient: Hex32Schema,
});

export const LockWitnessSchema = z.object({
  version: z.literal(1),
  sourceChainId: z.number().int().positive(),
  sourceBlockNumber: z.number().int().nonnegative(),
  sourceReceiptRoot: Hex32Schema,
  txHash: Hex32Schema,
  logIndex: z.number().int().nonnegative(),
  lockId: Hex32Schema,
  escrowContract: Hex20Schema,
  senderAddress: Hex20Schema,
  tokenAddress: Hex20Schema,
  amount: DecimalStringSchema,
  stellarNoteCommitment: Hex32Schema,
  complianceHint: Hex32Schema,
  complianceRoot: Hex32Schema,
  complianceMode: ComplianceModeSchema,
  destinationChainId: z.number().int().positive(),
  cctpSettlement: CctpSettlementSchema,
  expected: z.object({
    sourceChainId: z.number().int().positive(),
    escrowContract: Hex20Schema,
    tokenAddress: Hex20Schema,
    minAmount: DecimalStringSchema,
    maxAmount: DecimalStringSchema,
    complianceRoot: Hex32Schema,
    destinationChainId: z.number().int().positive(),
    networkDomain: Hex32Schema,
    expiresAtLedger: z.number().int().positive(),
    cctpSourceDomain: Uint32Schema,
    cctpDestinationDomain: Uint32Schema,
    cctpMintRecipient: Hex32Schema,
  }),
  complianceWitness: z.object({
    valid: z.boolean(),
    mode: ComplianceModeSchema,
  }),
});

export const NebulaJournalSchema = z.object({
  version: z.literal(2),
  domain: Hex32Schema,
  sourceChainId: z.number().int().positive(),
  sourceBlockNumber: z.number().int().nonnegative(),
  sourceReceiptRoot: Hex32Schema,
  escrowContract: Hex20Schema,
  token: Hex20Schema,
  amount: DecimalStringSchema,
  amountBucket: z.number().int().nonnegative(),
  settlementAmount: DecimalStringSchema,
  settlementAmountBucket: z.number().int().nonnegative(),
  stellarNoteCommitment: Hex32Schema,
  complianceRoot: Hex32Schema,
  complianceMode: z.number().int().nonnegative().max(255),
  claimNullifier: Hex32Schema,
  eventCommitment: Hex32Schema,
  destinationChainId: z.number().int().positive(),
  expiresAtLedger: z.number().int().positive(),
  cctpSourceDomain: Uint32Schema,
  cctpDestinationDomain: Uint32Schema,
  cctpNonce: Hex32Schema,
  cctpMessageHash: Hex32Schema,
  cctpAttestationHash: Hex32Schema,
  cctpMintRecipient: Hex32Schema,
  cctpFeeExecuted: DecimalStringSchema,
});

export const ProofArtifactSchema = z.object({
  version: z.literal(1),
  proofMode: z.enum(["local-groth16", "remote"]),
  sealHex: HexBytesSchema,
  imageIdHex: Hex32Schema,
  journalHex: HexBytesSchema,
  journalDigestHex: Hex32Schema,
  publicOutputs: NebulaJournalSchema,
  generatedAt: z.string().datetime(),
  witnessHash: Hex32Schema,
});

export const AuditorVerificationInstructionSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1).optional(),
  expected: z.string().min(1).optional(),
});

export const AuditorPacketSchema = z.object({
  version: z.literal(1),
  sourceChainId: z.number().int().positive(),
  sourceTxHash: Hex32Schema,
  sourceLogIndex: z.number().int().nonnegative(),
  stellarClaimTxHash: z.string().optional(),
  noteCommitment: Hex32Schema,
  claimNullifier: Hex32Schema,
  eventCommitment: Hex32Schema,
  proofImageId: Hex32Schema,
  journalDigest: Hex32Schema,
  cctpMessageHash: Hex32Schema,
  cctpAttestationHash: Hex32Schema,
  cctpNonce: Hex32Schema,
  disclosureMode: z.enum([
    "user-exported",
    "view-key-demo",
    "view-key-production-planned",
  ]),
  caveats: z.array(z.string().min(1)).min(1),
  verificationInstructions: z
    .array(AuditorVerificationInstructionSchema)
    .min(1),
});

export type LockWitness = z.infer<typeof LockWitnessSchema>;
export type NebulaJournal = z.infer<typeof NebulaJournalSchema>;
export type ProofArtifact = z.infer<typeof ProofArtifactSchema>;
export type CctpSettlement = z.infer<typeof CctpSettlementSchema>;
export type AuditorVerificationInstruction = z.infer<
  typeof AuditorVerificationInstructionSchema
>;
export type AuditorPacket = z.infer<typeof AuditorPacketSchema>;
