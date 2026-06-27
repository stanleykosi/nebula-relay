// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NebulaEscrow} from "../src/NebulaEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract Deploy {
    function run() external returns (NebulaEscrow escrow, MockUSDC mockUsdc) {
        mockUsdc = new MockUSDC();
        escrow = new NebulaEscrow(msg.sender);
        escrow.setSupportedToken(address(mockUsdc), true);
        escrow.setAmountBounds(address(mockUsdc), 10_000_000, 1_000_000_000);
    }
}
