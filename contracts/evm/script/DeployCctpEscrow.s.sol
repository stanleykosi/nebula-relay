// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NebulaCctpEscrow} from "../src/NebulaCctpEscrow.sol";

interface VmDeployCctp {
    function envUint(string calldata key) external returns (uint256 value);
    function envAddress(string calldata key) external returns (address value);
    function envBytes32(string calldata key) external returns (bytes32 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployCctpEscrow {
    VmDeployCctp private constant vm =
        VmDeployCctp(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (NebulaCctpEscrow escrow) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("NEBULA_EVM_OWNER");
        address tokenMessenger = vm.envAddress("CCTP_TOKEN_MESSENGER_V2_ADDRESS");
        address burnToken = vm.envAddress("CCTP_USDC_ADDRESS");
        bytes32 stellarForwarder = vm.envBytes32("CCTP_STELLAR_FORWARDER_BYTES32");
        uint256 maxFee = vm.envUint("CCTP_MAX_FEE");
        uint32 minFinalityThreshold = uint32(vm.envUint("CCTP_MIN_FINALITY_THRESHOLD"));
        uint256 minAmount = vm.envUint("NEBULA_MIN_AMOUNT");
        uint256 maxAmount = vm.envUint("NEBULA_MAX_AMOUNT");

        vm.startBroadcast(deployerPrivateKey);
        escrow = new NebulaCctpEscrow(
            owner,
            tokenMessenger,
            burnToken,
            stellarForwarder,
            maxFee,
            minFinalityThreshold,
            minAmount,
            maxAmount
        );
        vm.stopBroadcast();
    }
}
