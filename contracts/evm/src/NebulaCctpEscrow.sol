// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20CctpMinimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ICircleTokenMessengerV2 {
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

contract NebulaCctpEscrow {
    bytes32 public constant LOCK_DOMAIN = keccak256("NEBULA_LOCK_V1");
    uint32 public constant CCTP_STELLAR_DOMAIN = 27;

    struct AmountBounds {
        uint256 minAmount;
        uint256 maxAmount;
    }

    struct CctpRoute {
        address tokenMessenger;
        address burnToken;
        bytes32 stellarForwarder;
        uint256 maxFee;
        uint32 minFinalityThreshold;
    }

    event Locked(
        bytes32 indexed lockId,
        address indexed sender,
        address indexed token,
        uint256 amount,
        bytes32 stellarNoteCommitment,
        bytes32 complianceHint,
        uint256 nonce,
        uint256 destinationChainId
    );

    event CctpBurnInitiated(
        bytes32 indexed lockId,
        address indexed tokenMessenger,
        address indexed burnToken,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes32 hookDataHash
    );

    error NotOwner();
    error Paused();
    error ZeroAddress();
    error ZeroBytes32();
    error InvalidAmount(uint256 amount, uint256 minAmount, uint256 maxAmount);
    error InvalidDestination(uint256 destinationChainId);
    error InvalidFee(uint256 amount, uint256 maxFee);
    error EmptyHookData();
    error ZeroNoteCommitment();
    error LockAlreadyExists(bytes32 lockId);
    error TransferFailed();
    error ApproveFailed();
    error ReentrantCall();

    address public owner;
    bool public paused;
    CctpRoute public cctpRoute;
    AmountBounds public amountBounds;
    mapping(address user => uint256 nonce) public userNonce;
    mapping(bytes32 lockId => bool exists) public locked;

    uint256 private reentrancyStatus;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    modifier nonReentrant() {
        if (reentrancyStatus == 1) {
            revert ReentrantCall();
        }
        reentrancyStatus = 1;
        _;
        reentrancyStatus = 0;
    }

    constructor(
        address initialOwner,
        address tokenMessenger,
        address burnToken,
        bytes32 stellarForwarder,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        uint256 minAmount,
        uint256 maxAmount
    ) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        _setCctpRoute(tokenMessenger, burnToken, stellarForwarder, maxFee, minFinalityThreshold);
        _setAmountBounds(minAmount, maxAmount);
    }

    function lockAndBurn(
        uint256 amount,
        bytes32 stellarNoteCommitment,
        bytes32 complianceHint,
        bytes calldata hookData
    ) external nonReentrant returns (bytes32 lockId) {
        if (paused) {
            revert Paused();
        }
        if (stellarNoteCommitment == bytes32(0)) {
            revert ZeroNoteCommitment();
        }
        if (hookData.length == 0) {
            revert EmptyHookData();
        }
        AmountBounds memory bounds = amountBounds;
        if (amount == 0 || amount < bounds.minAmount || amount > bounds.maxAmount) {
            revert InvalidAmount(amount, bounds.minAmount, bounds.maxAmount);
        }
        CctpRoute memory route = cctpRoute;
        if (route.maxFee >= amount) {
            revert InvalidFee(amount, route.maxFee);
        }

        uint256 nonce = userNonce[msg.sender] + 1;
        lockId = computeLockId(
            msg.sender,
            route.burnToken,
            amount,
            stellarNoteCommitment,
            complianceHint,
            nonce,
            CCTP_STELLAR_DOMAIN
        );
        if (locked[lockId]) {
            revert LockAlreadyExists(lockId);
        }

        userNonce[msg.sender] = nonce;
        locked[lockId] = true;

        IERC20CctpMinimal token = IERC20CctpMinimal(route.burnToken);
        if (!token.transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        if (!token.approve(route.tokenMessenger, 0)) {
            revert ApproveFailed();
        }
        if (!token.approve(route.tokenMessenger, amount)) {
            revert ApproveFailed();
        }

        ICircleTokenMessengerV2(route.tokenMessenger)
            .depositForBurnWithHook(
                amount,
                CCTP_STELLAR_DOMAIN,
                route.stellarForwarder,
                route.burnToken,
                route.stellarForwarder,
                route.maxFee,
                route.minFinalityThreshold,
                hookData
            );

        if (!token.approve(route.tokenMessenger, 0)) {
            revert ApproveFailed();
        }

        emit Locked(
            lockId,
            msg.sender,
            route.burnToken,
            amount,
            stellarNoteCommitment,
            complianceHint,
            nonce,
            CCTP_STELLAR_DOMAIN
        );
        emit CctpBurnInitiated(
            lockId,
            route.tokenMessenger,
            route.burnToken,
            CCTP_STELLAR_DOMAIN,
            route.stellarForwarder,
            route.stellarForwarder,
            route.maxFee,
            route.minFinalityThreshold,
            keccak256(hookData)
        );
    }

    function computeLockId(
        address sender,
        address token,
        uint256 amount,
        bytes32 stellarNoteCommitment,
        bytes32 complianceHint,
        uint256 nonce,
        uint256 destinationChainId
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                LOCK_DOMAIN,
                block.chainid,
                address(this),
                sender,
                token,
                amount,
                stellarNoteCommitment,
                complianceHint,
                nonce,
                destinationChainId
            )
        );
    }

    function setCctpRoute(
        address tokenMessenger,
        address burnToken,
        bytes32 stellarForwarder,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external onlyOwner {
        _setCctpRoute(tokenMessenger, burnToken, stellarForwarder, maxFee, minFinalityThreshold);
    }

    function setAmountBounds(uint256 minAmount, uint256 maxAmount) external onlyOwner {
        _setAmountBounds(minAmount, maxAmount);
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function _setCctpRoute(
        address tokenMessenger,
        address burnToken,
        bytes32 stellarForwarder,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) internal {
        if (tokenMessenger == address(0) || burnToken == address(0)) {
            revert ZeroAddress();
        }
        if (stellarForwarder == bytes32(0)) {
            revert ZeroBytes32();
        }
        cctpRoute = CctpRoute({
            tokenMessenger: tokenMessenger,
            burnToken: burnToken,
            stellarForwarder: stellarForwarder,
            maxFee: maxFee,
            minFinalityThreshold: minFinalityThreshold
        });
    }

    function _setAmountBounds(uint256 minAmount, uint256 maxAmount) internal {
        if (minAmount == 0 || maxAmount < minAmount) {
            revert InvalidAmount(0, minAmount, maxAmount);
        }
        amountBounds = AmountBounds({minAmount: minAmount, maxAmount: maxAmount});
    }
}
