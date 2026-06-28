// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface VmLockAndBurnCctp {
    function envUint(string calldata key) external returns (uint256 value);
    function envAddress(string calldata key) external returns (address value);
    function envBytes32(string calldata key) external returns (bytes32 value);
    function envBytes(string calldata key) external returns (bytes memory value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface INebulaCctpEscrow {
    function lockAndBurn(
        uint256 amount,
        bytes32 stellarNoteCommitment,
        bytes32 complianceHint,
        bytes calldata hookData
    ) external returns (bytes32 lockId);
}

contract LockAndBurnCctp {
    VmLockAndBurnCctp private constant vm =
        VmLockAndBurnCctp(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (bytes32 lockId) {
        uint256 userPrivateKey = vm.envUint("EVM_USER_PRIVATE_KEY");
        address nebulaCctpEscrow = vm.envAddress("NEBULA_CCTP_ESCROW_ADDRESS");
        uint256 amount = vm.envUint("NEBULA_LOCK_AMOUNT");
        bytes32 noteCommitment = vm.envBytes32("NEBULA_NOTE_COMMITMENT");
        bytes32 complianceHint = vm.envBytes32("NEBULA_COMPLIANCE_HINT");
        bytes memory hookData = vm.envBytes("CCTP_STELLAR_FORWARDER_HOOK_DATA");

        vm.startBroadcast(userPrivateKey);
        lockId = INebulaCctpEscrow(nebulaCctpEscrow)
            .lockAndBurn(amount, noteCommitment, complianceHint, hookData);
        vm.stopBroadcast();
    }
}
