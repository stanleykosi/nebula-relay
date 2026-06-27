// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NebulaEscrow} from "../src/NebulaEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract NebulaEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    NebulaEscrow private escrow;
    MockUSDC private token;

    bytes32 private constant NOTE = bytes32(uint256(0x1234));
    bytes32 private constant COMPLIANCE = bytes32(uint256(0x4567));
    uint256 private constant DESTINATION = 1_501;
    uint256 private constant AMOUNT = 100_000_000;

    function setUp() public {
        escrow = new NebulaEscrow(address(this));
        token = new MockUSDC();
        token.mint(address(this), 1_000_000_000);
        token.approve(address(escrow), type(uint256).max);
        escrow.setSupportedToken(address(token), true);
        escrow.setAmountBounds(address(token), 10_000_000, 500_000_000);
    }

    function testLockTransfersTokenAndEmitsCanonicalEvent() public {
        bytes32 expected = escrow.computeLockId(
            address(this), address(token), AMOUNT, NOTE, COMPLIANCE, 1, DESTINATION
        );

        vm.recordLogs();
        bytes32 lockId = escrow.lock(address(token), AMOUNT, NOTE, COMPLIANCE, DESTINATION);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assert(lockId == expected);
        assert(token.balanceOf(address(escrow)) == AMOUNT);
        assert(escrow.userNonce(address(this)) == 1);
        assert(escrow.locked(lockId));

        bool found;
        bytes32 lockedTopic =
            keccak256("Locked(bytes32,address,address,uint256,bytes32,bytes32,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(escrow) && logs[i].topics[0] == lockedTopic) {
                found = true;
                assert(logs[i].topics[1] == expected);
                assert(logs[i].topics[2] == bytes32(uint256(uint160(address(this)))));
                assert(logs[i].topics[3] == bytes32(uint256(uint160(address(token)))));
                (
                    uint256 amount,
                    bytes32 stellarNoteCommitment,
                    bytes32 complianceHint,
                    uint256 nonce,
                    uint256 destinationChainId
                ) = abi.decode(logs[i].data, (uint256, bytes32, bytes32, uint256, uint256));
                assert(amount == AMOUNT);
                assert(stellarNoteCommitment == NOTE);
                assert(complianceHint == COMPLIANCE);
                assert(nonce == 1);
                assert(destinationChainId == DESTINATION);
            }
        }
        assert(found);
    }

    function testUnsupportedTokenFails() public {
        MockUSDC other = new MockUSDC();
        other.mint(address(this), AMOUNT);
        other.approve(address(escrow), AMOUNT);

        try escrow.lock(address(other), AMOUNT, NOTE, COMPLIANCE, DESTINATION) {
            assert(false);
        } catch {}
    }

    function testInvalidAmountsFail() public {
        try escrow.lock(address(token), 0, NOTE, COMPLIANCE, DESTINATION) {
            assert(false);
        } catch {}

        try escrow.lock(address(token), 1, NOTE, COMPLIANCE, DESTINATION) {
            assert(false);
        } catch {}

        try escrow.lock(address(token), 900_000_000, NOTE, COMPLIANCE, DESTINATION) {
            assert(false);
        } catch {}
    }

    function testZeroCommitmentFails() public {
        try escrow.lock(address(token), AMOUNT, bytes32(0), COMPLIANCE, DESTINATION) {
            assert(false);
        } catch {}
    }

    function testPauseAndUnpause() public {
        escrow.pause();
        try escrow.lock(address(token), AMOUNT, NOTE, COMPLIANCE, DESTINATION) {
            assert(false);
        } catch {}

        escrow.unpause();
        escrow.lock(address(token), AMOUNT, NOTE, COMPLIANCE, DESTINATION);
        assert(escrow.userNonce(address(this)) == 1);
    }

    function testNonceChangesLockId() public {
        bytes32 first = escrow.lock(address(token), AMOUNT, NOTE, COMPLIANCE, DESTINATION);
        bytes32 second = escrow.lock(address(token), AMOUNT, NOTE, COMPLIANCE, DESTINATION);
        assert(first != second);
        assert(escrow.userNonce(address(this)) == 2);
    }
}
