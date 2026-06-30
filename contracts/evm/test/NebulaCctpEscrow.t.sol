// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "../src/MockUSDC.sol";
import {NebulaCctpEscrow} from "../src/NebulaCctpEscrow.sol";

interface VmCctp {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

interface IERC20TransferFrom {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockTokenMessengerV2 {
    bool public shouldFail;
    uint256 public lastAmount;
    uint32 public lastDestinationDomain;
    bytes32 public lastMintRecipient;
    address public lastBurnToken;
    bytes32 public lastDestinationCaller;
    uint256 public lastMaxFee;
    uint32 public lastMinFinalityThreshold;
    bytes public lastHookData;

    error MessengerFailed();

    function setShouldFail(bool value) external {
        shouldFail = value;
    }

    function hookDataHash() external view returns (bytes32) {
        return keccak256(lastHookData);
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external {
        if (shouldFail) {
            revert MessengerFailed();
        }
        lastAmount = amount;
        lastDestinationDomain = destinationDomain;
        lastMintRecipient = mintRecipient;
        lastBurnToken = burnToken;
        lastDestinationCaller = destinationCaller;
        lastMaxFee = maxFee;
        lastMinFinalityThreshold = minFinalityThreshold;
        lastHookData = hookData;
        IERC20TransferFrom(burnToken).transferFrom(msg.sender, address(this), amount);
    }
}

contract NebulaCctpEscrowTest {
    VmCctp private constant vm = VmCctp(address(uint160(uint256(keccak256("hevm cheat code")))));

    NebulaCctpEscrow private escrow;
    MockUSDC private token;
    MockTokenMessengerV2 private messenger;

    bytes32 private constant NOTE = bytes32(uint256(0x1234));
    bytes32 private constant COMPLIANCE = bytes32(uint256(0x4567));
    bytes32 private constant STELLAR_FORWARDER = bytes32(uint256(0xcccc));
    uint256 private constant AMOUNT = 100_000_000;
    uint256 private constant MAX_FEE = 50_000;
    uint32 private constant MIN_FINALITY = 2_000;
    bytes private constant HOOK_DATA =
        hex"0000000000000000000000000000000000000000000000000000000000000001aa";

    function setUp() public {
        token = new MockUSDC();
        messenger = new MockTokenMessengerV2();
        escrow = new NebulaCctpEscrow(
            address(this),
            address(messenger),
            address(token),
            STELLAR_FORWARDER,
            MAX_FEE,
            MIN_FINALITY,
            10_000_000,
            500_000_000
        );
        token.mint(address(this), 1_000_000_000);
        token.approve(address(escrow), type(uint256).max);
    }

    function testLockAndBurnCallsCctpAndEmitsCanonicalLock() public {
        bytes32 expected = escrow.computeLockId(
            address(this), address(token), AMOUNT, NOTE, COMPLIANCE, 1, escrow.CCTP_STELLAR_DOMAIN()
        );

        vm.recordLogs();
        bytes32 lockId = escrow.lockAndBurn(AMOUNT, NOTE, COMPLIANCE, HOOK_DATA);
        VmCctp.Log[] memory logs = vm.getRecordedLogs();

        assert(lockId == expected);
        assert(escrow.locked(lockId));
        assert(escrow.userNonce(address(this)) == 1);
        assert(token.balanceOf(address(escrow)) == 0);
        assert(token.balanceOf(address(messenger)) == AMOUNT);
        assert(token.allowance(address(escrow), address(messenger)) == 0);

        assert(messenger.lastAmount() == AMOUNT);
        assert(messenger.lastDestinationDomain() == escrow.CCTP_STELLAR_DOMAIN());
        assert(messenger.lastMintRecipient() == STELLAR_FORWARDER);
        assert(messenger.lastBurnToken() == address(token));
        assert(messenger.lastDestinationCaller() == STELLAR_FORWARDER);
        assert(messenger.lastMaxFee() == MAX_FEE);
        assert(messenger.lastMinFinalityThreshold() == MIN_FINALITY);
        assert(messenger.hookDataHash() == keccak256(HOOK_DATA));

        bool foundLocked;
        bool foundCctp;
        bytes32 lockedTopic =
            keccak256("Locked(bytes32,address,address,uint256,bytes32,bytes32,uint256,uint256)");
        bytes32 cctpTopic = keccak256(
            "CctpBurnInitiated(bytes32,address,address,uint32,bytes32,bytes32,uint256,uint32,bytes32)"
        );
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(escrow) && logs[i].topics[0] == lockedTopic) {
                foundLocked = true;
                assert(logs[i].topics[1] == expected);
                assert(logs[i].topics[2] == bytes32(uint256(uint160(address(this)))));
                assert(logs[i].topics[3] == bytes32(uint256(uint160(address(token)))));
                (
                    uint256 amount,
                    bytes32 note,
                    bytes32 compliance,
                    uint256 nonce,
                    uint256 destinationChainId
                ) = abi.decode(logs[i].data, (uint256, bytes32, bytes32, uint256, uint256));
                assert(amount == AMOUNT);
                assert(note == NOTE);
                assert(compliance == COMPLIANCE);
                assert(nonce == 1);
                assert(destinationChainId == escrow.CCTP_STELLAR_DOMAIN());
            }
            if (logs[i].emitter == address(escrow) && logs[i].topics[0] == cctpTopic) {
                foundCctp = true;
                assert(logs[i].topics[1] == expected);
                assert(logs[i].topics[2] == bytes32(uint256(uint160(address(messenger)))));
                assert(logs[i].topics[3] == bytes32(uint256(uint160(address(token)))));
                (
                    uint32 destinationDomain,
                    bytes32 mintRecipient,
                    bytes32 destinationCaller,
                    uint256 maxFee,
                    uint32 minFinalityThreshold,
                    bytes32 hookDataHash
                ) = abi.decode(logs[i].data, (uint32, bytes32, bytes32, uint256, uint32, bytes32));
                assert(destinationDomain == escrow.CCTP_STELLAR_DOMAIN());
                assert(mintRecipient == STELLAR_FORWARDER);
                assert(destinationCaller == STELLAR_FORWARDER);
                assert(maxFee == MAX_FEE);
                assert(minFinalityThreshold == MIN_FINALITY);
                assert(hookDataHash == keccak256(HOOK_DATA));
            }
        }
        assert(foundLocked);
        assert(foundCctp);
    }

    function testMessengerFailureRollsBackLockState() public {
        messenger.setShouldFail(true);
        try escrow.lockAndBurn(AMOUNT, NOTE, COMPLIANCE, HOOK_DATA) {
            assert(false);
        } catch {}
        bytes32 expected = escrow.computeLockId(
            address(this), address(token), AMOUNT, NOTE, COMPLIANCE, 1, escrow.CCTP_STELLAR_DOMAIN()
        );
        assert(!escrow.locked(expected));
        assert(escrow.userNonce(address(this)) == 0);
        assert(token.balanceOf(address(escrow)) == 0);
        assert(token.balanceOf(address(messenger)) == 0);
    }

    function testInvalidInputsFail() public {
        try escrow.lockAndBurn(0, NOTE, COMPLIANCE, HOOK_DATA) {
            assert(false);
        } catch {}

        try escrow.lockAndBurn(AMOUNT, bytes32(0), COMPLIANCE, HOOK_DATA) {
            assert(false);
        } catch {}

        try escrow.lockAndBurn(AMOUNT, NOTE, COMPLIANCE, "") {
            assert(false);
        } catch {}
    }

    function testPauseAndUnpause() public {
        escrow.pause();
        try escrow.lockAndBurn(AMOUNT, NOTE, COMPLIANCE, HOOK_DATA) {
            assert(false);
        } catch {}

        escrow.unpause();
        escrow.lockAndBurn(AMOUNT, NOTE, COMPLIANCE, HOOK_DATA);
        assert(escrow.userNonce(address(this)) == 1);
    }

    function testOwnerCanRotateRouteButRejectsUnsafeConfig() public {
        try escrow.setCctpRoute(
            address(0), address(token), STELLAR_FORWARDER, MAX_FEE, MIN_FINALITY
        ) {
            assert(false);
        } catch {}

        try escrow.setAmountBounds(0, 1) {
            assert(false);
        } catch {}

        MockTokenMessengerV2 nextMessenger = new MockTokenMessengerV2();
        escrow.setCctpRoute(
            address(nextMessenger), address(token), STELLAR_FORWARDER, MAX_FEE, MIN_FINALITY
        );
        escrow.lockAndBurn(AMOUNT, NOTE, COMPLIANCE, HOOK_DATA);
        assert(nextMessenger.lastAmount() == AMOUNT);
    }
}
