// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract NebulaEscrow {
    bytes32 public constant LOCK_DOMAIN = keccak256("NEBULA_LOCK_V1");

    struct AmountBounds {
        uint256 minAmount;
        uint256 maxAmount;
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

    error NotOwner();
    error Paused();
    error UnsupportedToken(address token);
    error InvalidAmount(uint256 amount, uint256 minAmount, uint256 maxAmount);
    error ZeroNoteCommitment();
    error ZeroToken();
    error InvalidDestination(uint256 destinationChainId);
    error LockAlreadyExists(bytes32 lockId);
    error TransferFailed();

    address public owner;
    bool public paused;

    mapping(address token => bool supported) public supportedToken;
    mapping(address token => AmountBounds bounds) public amountBounds;
    mapping(address user => uint256 nonce) public userNonce;
    mapping(bytes32 lockId => bool exists) public locked;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    constructor(address initialOwner) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
    }

    function lock(
        address token,
        uint256 amount,
        bytes32 stellarNoteCommitment,
        bytes32 complianceHint,
        uint256 destinationChainId
    ) external returns (bytes32 lockId) {
        if (paused) {
            revert Paused();
        }
        if (token == address(0)) {
            revert ZeroToken();
        }
        if (destinationChainId == 0) {
            revert InvalidDestination(destinationChainId);
        }
        if (!supportedToken[token]) {
            revert UnsupportedToken(token);
        }
        AmountBounds memory bounds = amountBounds[token];
        if (amount == 0 || amount < bounds.minAmount || amount > bounds.maxAmount) {
            revert InvalidAmount(amount, bounds.minAmount, bounds.maxAmount);
        }
        if (stellarNoteCommitment == bytes32(0)) {
            revert ZeroNoteCommitment();
        }

        uint256 nonce = userNonce[msg.sender] + 1;
        lockId = computeLockId(
            msg.sender,
            token,
            amount,
            stellarNoteCommitment,
            complianceHint,
            nonce,
            destinationChainId
        );
        if (locked[lockId]) {
            revert LockAlreadyExists(lockId);
        }

        userNonce[msg.sender] = nonce;
        locked[lockId] = true;

        bool ok = IERC20Minimal(token).transferFrom(msg.sender, address(this), amount);
        if (!ok) {
            revert TransferFailed();
        }

        emit Locked(
            lockId,
            msg.sender,
            token,
            amount,
            stellarNoteCommitment,
            complianceHint,
            nonce,
            destinationChainId
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

    function setSupportedToken(address token, bool supported) external onlyOwner {
        if (token == address(0)) {
            revert ZeroToken();
        }
        supportedToken[token] = supported;
    }

    function setAmountBounds(address token, uint256 minAmount, uint256 maxAmount)
        external
        onlyOwner
    {
        if (token == address(0)) {
            revert ZeroToken();
        }
        if (minAmount == 0 || maxAmount < minAmount) {
            revert InvalidAmount(0, minAmount, maxAmount);
        }
        amountBounds[token] = AmountBounds({minAmount: minAmount, maxAmount: maxAmount});
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }
}
