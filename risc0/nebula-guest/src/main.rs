use nebula_guest::execute_guest;
use nebula_risc0_shared::{encode_journal, LockWitness};
use risc0_zkvm::guest::env;

fn main() {
    let witness: LockWitness = env::read();
    let journal = execute_guest(&witness).expect("invalid Nebula lock witness");
    let journal_bytes = encode_journal(&journal).expect("invalid Nebula journal encoding");
    env::commit_slice(&journal_bytes);
}
