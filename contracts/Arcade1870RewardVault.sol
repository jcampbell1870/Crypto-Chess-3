// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title Arcade1870RewardVault
/// @notice Holds ARC and releases it only for claims authorized by the reward signer.
contract Arcade1870RewardVault {
    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error ClaimExpired();
    error ClaimAlreadyUsed();
    error InvalidSignature();
    error InvalidToken();
    error TokenTransferFailed();

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 private constant NAME_HASH = keccak256("Arcade1870RewardVault");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant SECP256K1N_DIV_2 =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    IERC20 public immutable rewardToken;
    address public owner;
    address public pendingOwner;
    address public rewardSigner;
    mapping(address recipient => mapping(uint256 nonce => bool)) public claimed;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event RewardSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event RewardClaimed(address indexed recipient, uint256 amount, uint256 indexed nonce);
    event TokensRecovered(address indexed token, address indexed recipient, uint256 amount);

    constructor(address rewardToken_, address rewardSigner_) {
        if (rewardToken_ == address(0) || rewardSigner_ == address(0)) revert ZeroAddress();
        if (rewardToken_.code.length == 0) revert InvalidToken();
        rewardToken = IERC20(rewardToken_);
        owner = msg.sender;
        rewardSigner = rewardSigner_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RewardSignerUpdated(address(0), rewardSigner_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function claim(
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert ClaimExpired();
        if (claimed[msg.sender][nonce]) revert ClaimAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, msg.sender, amount, nonce, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        if (_recover(digest, signature) != rewardSigner) revert InvalidSignature();

        claimed[msg.sender][nonce] = true;
        _safeTransfer(address(rewardToken), msg.sender, amount);
        emit RewardClaimed(msg.sender, amount, nonce);
    }

    function setRewardSigner(address newRewardSigner) external onlyOwner {
        if (newRewardSigner == address(0)) revert ZeroAddress();
        emit RewardSignerUpdated(rewardSigner, newRewardSigner);
        rewardSigner = newRewardSigner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /// @notice Recover tokens accidentally sent to the vault or remove unallocated vault funds.
    function recoverTokens(address token, address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        _safeTransfer(token, recipient, amount);
        emit TokensRecovered(token, recipient, amount);
    }

    function _safeTransfer(address token, address recipient, uint256 amount) private {
        if (token.code.length == 0) revert InvalidToken();
        (bool success, bytes memory returnData) = token.call(
            abi.encodeCall(IERC20.transfer, (recipient, amount))
        );
        if (!success || (returnData.length != 0 && !abi.decode(returnData, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (uint256(s) > uint256(SECP256K1N_DIV_2) || (v != 27 && v != 28)) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
