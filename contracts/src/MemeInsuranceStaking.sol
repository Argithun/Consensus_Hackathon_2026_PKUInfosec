// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface IMemePool {
    function sell(uint256 amountIn, uint256 minOut, uint256 deadline) external returns (uint256 amountOut);
    function buy(uint256 minOut, uint256 deadline) external payable returns (uint256 amountOut);
    function getCurrentPrice() external view returns (uint256);
}

/// @title MemeInsuranceStaking
/// @notice Position-NFT based staking prototype for meme-token anti-rug insurance.
/// @dev Prioritizes correctness; core operations are allowed to be O(n).
contract MemeInsuranceStaking is ERC721, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant TIME_RAMP = 7 days;
    uint256 public constant BUCKET_DURATION = 2 hours;
    uint256 public constant MATURE_BUCKET = TIME_RAMP / BUCKET_DURATION; // kept for interface compatibility
    uint256 public constant MAX_TIME_PENALTY_BPS = 1_000; // 10%
    uint256 public constant MAX_PRICE_PENALTY_BPS = 1_000; // 10%
    uint256 public constant MAX_TOTAL_PENALTY_BPS_DEFAULT = 2_000; // 20%
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant ACC_PRECISION = 1e24; // kept for interface compatibility

    struct Position {
        uint256 remainingTokens;
        uint256 initialSellPriceX18;
        uint256 lastAutoSellPriceX18;
        uint256 pendingPenaltyEth;
        uint256 pendingProceedsEth;
        uint256 rewardDebtEth; // kept for interface compatibility
        uint64 createdAt;
        uint32 creationBucket; // kept for interface compatibility
        bool isMature; // kept for interface compatibility
        bool active;
    }

    struct InternalCandidate {
        uint256 tokenId;
        uint256 amount;
        uint256 lastPriceX18;
    }

    error InvalidAmount();
    error InvalidPrice();
    error InvalidAddress();
    error PositionInactive();
    error NotPositionOwner();
    error PriceUnavailable();
    error InvalidBps();
    error PoolNotSet();
    error InsufficientLiquidity();
    error InvalidBatchSize();
    error InvalidRatio();
    error MinTokenOutNotMet();
    error DeadlineExpired();
    error EthTransferFailed();
    error QuoteCheckFailed();
    error QuoteCheckResult(uint256 tokenOut);

    event PositionOpened(
        uint256 indexed tokenId, address indexed owner, uint256 tokenAmount, uint256 initialSellPriceX18
    );
    event GlobalPoked(
        address indexed caller,
        uint256 currentPriceX18,
        uint256 processedPositions,
        uint256 soldTokens,
        uint256 ownerEthOut
    );
    event PositionSynced(uint256 indexed tokenId, address indexed caller, bool isMature, uint256 remainingTokens);
    event PositionExited(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 currentPriceX18,
        uint256 refundTokens,
        uint256 confiscatedTokens,
        uint256 penaltyEthOut,
        uint256 exitPenaltyBps
    );
    event Claimed(uint256 indexed tokenId, address indexed receiver, uint256 ethAmount);
    event PenaltyDistributed(
        uint256 penaltyEthIn, uint256 distributedEth, uint256 activePositions, uint256 totalStakeScore
    );
    event SingleSidedLiquidityBought(
        address indexed buyer, uint256 tokenOut, uint256 ethIn, uint256 currentPriceX18, uint256 processedPositions
    );
    event ExternalPoolBought(address indexed buyer, uint256 tokenOut, uint256 ethIn);
    event MixedBought(
        address indexed buyer,
        uint256 tokenOut,
        uint256 internalTokenOut,
        uint256 externalTokenOut,
        uint256 ethIn,
        uint256 ratio
    );
    event BotRewardPaid(uint256 indexed tokenId, address indexed keeper, uint256 amount);
    event BotRewardBpsUpdated(uint256 bps);
    event MaxTotalPenaltyBpsUpdated(uint256 bps);
    event ExitModeUpdated(bool enabled);
    event PoolAddressUpdated(address indexed oldPoolAddress, address indexed newPoolAddress);
    event ProtocolDustClaimed(address indexed to, uint256 amount);

    IERC20 public immutable memeToken;

    uint256 public nextTokenId = 1;
    uint256 public activePositions;
    uint256 public syncCursor;
    uint256 public buyCursor;
    uint256 public protocolUndistributedEth;
    uint256 public maxTotalPenaltyBps = MAX_TOTAL_PENALTY_BPS_DEFAULT;
    uint256 public botRewardBps;
    bool public exitMode;
    address public poolAddress;

    // kept for interface compatibility
    uint256 public lastRolledBucket;
    uint256 public matureStakeTokens;
    uint256 public matureAccPenaltyPerTokenX24;
    mapping(uint256 => uint256) public youngBucketStakeTokens;
    mapping(uint256 => uint256) public youngBucketAccPenaltyPerTokenX24;
    mapping(uint256 => uint256) public maturedBucketFinalYoungAccX24;
    mapping(uint256 => uint256) public maturedBucketStartMatureAccX24;

    mapping(uint256 => Position) private _positions;
    uint256[] private _liquidityTokenIds; // sorted by lastAutoSellPriceX18 ascending
    mapping(uint256 => uint256) private _liquidityIndexPlusOne;

    constructor(address memeToken_, string memory name_, string memory symbol_, address initialOwner_)
        ERC721(name_, symbol_)
        Ownable(initialOwner_)
    {
        if (memeToken_ == address(0) || initialOwner_ == address(0)) revert InvalidAddress();
        memeToken = IERC20(memeToken_);
        lastRolledBucket = _currentBucket();
    }

    receive() external payable {}

    function openPosition(uint256 tokenAmount, uint256 initialSellPriceX18)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (tokenAmount == 0) revert InvalidAmount();
        if (initialSellPriceX18 == 0) revert InvalidPrice();
        _rollBuckets();

        tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);

        Position storage position = _positions[tokenId];
        position.remainingTokens = tokenAmount;
        position.initialSellPriceX18 = initialSellPriceX18;
        position.lastAutoSellPriceX18 = initialSellPriceX18;
        position.createdAt = uint64(block.timestamp);
        position.creationBucket = uint32(_currentBucket());
        position.isMature = false;
        position.active = true;

        activePositions += 1;
        _addLiquidityPosition(tokenId);
        memeToken.safeTransferFrom(msg.sender, address(this), tokenAmount);

        emit PositionOpened(tokenId, msg.sender, tokenAmount, initialSellPriceX18);
    }

    /// @notice Global auto-sell sync for a batch of positions; no NFT id needed externally.
    /// @dev To keep the sorted list valid, updates are applied from right to left in the affected prefix.
    function poke(uint256 maxPositions)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 processedPositions, uint256 soldTokens, uint256 ownerEthOut)
    {
        if (maxPositions == 0) revert InvalidBatchSize();
        _rollBuckets();
        uint256 currentPriceX18 = _requireCurrentPriceX18();
        (processedPositions, soldTokens, ownerEthOut) = _syncLiquidityToPrice(currentPriceX18, msg.sender, maxPositions);
        emit GlobalPoked(msg.sender, currentPriceX18, processedPositions, soldTokens, ownerEthOut);
    }

    /// @notice Permissionless lazy sync for a position.
    function syncPosition(uint256 tokenId) external nonReentrant whenNotPaused {
        _rollBuckets();
        Position storage position = _requireActivePosition(tokenId);

        uint256 currentPriceX18 = _getCurrentPriceX18();
        if (currentPriceX18 > 0) {
            _syncPosition(tokenId, position, currentPriceX18, true, address(0), true);
        }

        emit PositionSynced(tokenId, msg.sender, position.isMature, position.remainingTokens);
    }

    /// @notice Exit the full position (burns the NFT), applies penalty, and distributes penalty ETH.
    function exitPosition(uint256 tokenId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 refundTokens, uint256 confiscatedTokens, uint256 penaltyEthOut, uint256 exitPenaltyBps)
    {
        _rollBuckets();
        Position storage position = _requireActivePosition(tokenId);
        if (ownerOf(tokenId) != msg.sender) revert NotPositionOwner();

        uint256 currentPriceX18 = _requireCurrentPriceX18();
        _syncPosition(tokenId, position, currentPriceX18, true, address(0), false);

        uint256 remainingTokens = position.remainingTokens;
        exitPenaltyBps = _computeExitPenaltyBps(position, currentPriceX18);
        confiscatedTokens = Math.mulDiv(remainingTokens, exitPenaltyBps, BPS_DENOMINATOR);
        refundTokens = remainingTokens - confiscatedTokens;

        uint256 claimableEth = position.pendingPenaltyEth + position.pendingProceedsEth;

        _burn(tokenId);
        _removeLiquidityPosition(tokenId);
        delete _positions[tokenId];
        activePositions -= 1;

        if (refundTokens > 0) {
            memeToken.safeTransfer(msg.sender, refundTokens);
        }

        if (confiscatedTokens > 0) {
            penaltyEthOut = _sellTokenForETH(confiscatedTokens);
            _distributePenaltyEth(penaltyEthOut, currentPriceX18);
        }

        if (claimableEth > 0) {
            _safeTransferEth(msg.sender, claimableEth);
        }

        emit PositionExited(
            tokenId, msg.sender, currentPriceX18, refundTokens, confiscatedTokens, penaltyEthOut, exitPenaltyBps
        );
    }

    function claim(uint256 tokenId) external nonReentrant whenNotPaused returns (uint256 ethAmount) {
        _rollBuckets();
        Position storage position = _requireActivePosition(tokenId);
        if (ownerOf(tokenId) != msg.sender) revert NotPositionOwner();

        uint256 currentPriceX18 = _getCurrentPriceX18();
        if (currentPriceX18 > 0) {
            _syncPosition(tokenId, position, currentPriceX18, true, address(0), true);
        }

        ethAmount = position.pendingPenaltyEth + position.pendingProceedsEth;
        if (ethAmount == 0) return 0;

        position.pendingPenaltyEth = 0;
        position.pendingProceedsEth = 0;
        _safeTransferEth(msg.sender, ethAmount);
        emit Claimed(tokenId, msg.sender, ethAmount);
    }

    function claimProtocolUndistributedEth(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        uint256 amount = protocolUndistributedEth;
        protocolUndistributedEth = 0;
        if (amount > 0) {
            _safeTransferEth(to, amount);
        }
        emit ProtocolDustClaimed(to, amount);
    }

    function setBotRewardBps(uint256 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert InvalidBps();
        botRewardBps = bps;
        emit BotRewardBpsUpdated(bps);
    }

    function setMaxTotalPenaltyBps(uint256 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert InvalidBps();
        maxTotalPenaltyBps = bps;
        emit MaxTotalPenaltyBpsUpdated(bps);
    }

    function setExitMode(bool enabled) external onlyOwner {
        exitMode = enabled;
        emit ExitModeUpdated(enabled);
    }

    function setPoolAddress(address newPoolAddress) external onlyOwner {
        if (newPoolAddress == address(0)) revert InvalidAddress();
        address oldPoolAddress = poolAddress;
        if (oldPoolAddress == newPoolAddress) return;

        if (oldPoolAddress != address(0)) {
            memeToken.forceApprove(oldPoolAddress, 0);
        }
        memeToken.forceApprove(newPoolAddress, type(uint256).max);
        poolAddress = newPoolAddress;
        emit PoolAddressUpdated(oldPoolAddress, newPoolAddress);
    }

    /// @notice Buy token from protocol internal single-sided liquidity.
    function buyTokenInternal(uint256 minTokenOut, uint256 deadline, uint256 maxPositions)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 tokenOut)
    {
        uint256 ethUsed;
        uint256 currentPriceX18;
        uint256 processedPositions;
        (tokenOut, ethUsed, currentPriceX18, processedPositions) =
            _buyTokenInternalCoreWithOption(msg.value, minTokenOut, deadline, maxPositions, true);

        memeToken.safeTransfer(msg.sender, tokenOut);
        if (msg.value > ethUsed) {
            _safeTransferEth(msg.sender, msg.value - ethUsed);
        }

        emit SingleSidedLiquidityBought(msg.sender, tokenOut, ethUsed, currentPriceX18, processedPositions);
    }

    /// @notice Buy token directly from external meme pool.
    function buyTokenExternal(uint256 minTokenOut, uint256 deadline)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 tokenOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value == 0) revert InvalidAmount();

        tokenOut = _buyTokenExternalCore(msg.value, minTokenOut, deadline);
        memeToken.safeTransfer(msg.sender, tokenOut);

        emit ExternalPoolBought(msg.sender, tokenOut, msg.value);
    }

    /// @notice Buy token with mixed route: internal pool + external pool.
    /// @param ratio Percentage routed to internal pool (0~100).
    function buyTokenMix(uint256 minTokenOut, uint256 deadline, uint256 maxPositions, uint256 ratio)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 tokenOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value == 0) revert InvalidAmount();
        if (ratio > 100) revert InvalidRatio();

        _preSyncLiquidityForMix(maxPositions);

        uint256 internalEthIn = Math.mulDiv(msg.value, ratio, 100);
        uint256 externalEthIn = msg.value - internalEthIn;

        uint256 internalTokenOut;
        uint256 internalEthUsed;
        if (internalEthIn > 0) {
            (internalTokenOut, internalEthUsed,,) =
                _buyTokenInternalCoreWithOption(internalEthIn, 0, deadline, maxPositions, false);
        }

        uint256 externalTokenOut;
        if (externalEthIn > 0) {
            externalTokenOut = _buyTokenExternalCore(externalEthIn, 0, deadline);
        }

        tokenOut = internalTokenOut + externalTokenOut;
        if (tokenOut < minTokenOut) revert MinTokenOutNotMet();

        memeToken.safeTransfer(msg.sender, tokenOut);

        uint256 totalEthUsed = internalEthUsed + externalEthIn;
        if (msg.value > totalEthUsed) {
            _safeTransferEth(msg.sender, msg.value - totalEthUsed);
        }

        emit MixedBought(msg.sender, tokenOut, internalTokenOut, externalTokenOut, totalEthUsed, ratio);
    }

    /// @notice Finds exact best mix ratio by scanning 0~100 with revert-encoded quote checks.
    /// @dev Meant for offchain simulation through call/staticcall.
    function getBestBuyRatio(uint256 maxPositions) external payable returns (uint256 bestRatio, uint256 bestTokenOut) {
        uint256 ethIn = msg.value;
        if (ethIn == 0) revert InvalidAmount();

        for (uint256 ratio; ratio <= 100; ++ratio) {
            uint256 out = _checkMixQuoteByRevert(ethIn, maxPositions, ratio);
            if (out > bestTokenOut) {
                bestTokenOut = out;
                bestRatio = ratio;
            }
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function activePositionCount() external view returns (uint256) {
        return activePositions;
    }

    function liquidityPositionCount() external view returns (uint256) {
        return _liquidityTokenIds.length;
    }

    function positionInfo(uint256 tokenId) external view returns (Position memory) {
        return _positions[tokenId];
    }

    function previewExitPenaltyBps(uint256 tokenId)
        external
        view
        returns (uint256 totalPenaltyBps, uint256 timePenaltyBps, uint256 pricePenaltyBps)
    {
        if (exitMode) return (0, 0, 0);

        Position storage position = _requireActivePositionView(tokenId);
        uint256 currentPriceX18 = _requireCurrentPriceX18View();

        timePenaltyBps = _computeTimePenaltyBps(position.createdAt);
        pricePenaltyBps = _computePricePenaltyBps(position.initialSellPriceX18, currentPriceX18);

        totalPenaltyBps = timePenaltyBps + pricePenaltyBps;
        if (totalPenaltyBps > maxTotalPenaltyBps) {
            totalPenaltyBps = maxTotalPenaltyBps;
        }
    }

    function previewStakeScore(uint256 tokenId) external view returns (uint256 score, uint256 virtualRemaining) {
        Position storage position = _requireActivePositionView(tokenId);
        uint256 currentPriceX18 = _requireCurrentPriceX18View();

        virtualRemaining = _virtualRemainingAtPrice(position, currentPriceX18);
        uint256 weightCoeffX18 = _timeWeightCoeffX18(position.createdAt);
        score = Math.mulDiv(virtualRemaining, weightCoeffX18, PRICE_PRECISION);
    }

    function _requireActivePosition(uint256 tokenId) internal view returns (Position storage position) {
        position = _positions[tokenId];
        if (!position.active) revert PositionInactive();
    }

    function _requireActivePositionView(uint256 tokenId) internal view returns (Position storage position) {
        position = _positions[tokenId];
        if (!position.active) revert PositionInactive();
    }

    function _computeExitPenaltyBps(Position storage position, uint256 currentPriceX18)
        internal
        view
        returns (uint256 totalPenaltyBps)
    {
        if (exitMode) return 0;

        uint256 timePenaltyBps = _computeTimePenaltyBps(position.createdAt);
        uint256 pricePenaltyBps = _computePricePenaltyBps(position.initialSellPriceX18, currentPriceX18);

        totalPenaltyBps = timePenaltyBps + pricePenaltyBps;
        if (totalPenaltyBps > maxTotalPenaltyBps) {
            totalPenaltyBps = maxTotalPenaltyBps;
        }
    }

    function _computeTimePenaltyBps(uint64 createdAt) internal view returns (uint256) {
        uint256 age = block.timestamp - uint256(createdAt);
        // Penalty = 0.7 / (d + 7), d in days. Converted to bps:
        // bps = 7000 * 1day / (ageSeconds + 7days)
        return Math.mulDiv(7_000, 1 days, age + 7 days);
    }

    function _computePricePenaltyBps(uint256 initialSellPriceX18, uint256 currentPriceX18)
        internal
        pure
        returns (uint256)
    {
        if (currentPriceX18 < initialSellPriceX18 || currentPriceX18 == 0) {
            return 0;
        }
        return Math.mulDiv(MAX_PRICE_PENALTY_BPS, initialSellPriceX18, currentPriceX18);
    }

    function _buyTokenInternalCoreWithOption(
        uint256 ethIn,
        uint256 minTokenOut,
        uint256 deadline,
        uint256 maxPositions,
        bool doSync
    ) internal returns (uint256 tokenOut, uint256 ethUsed, uint256 currentPriceX18, uint256 processedPositions) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (ethIn == 0) revert InvalidAmount();
        if (maxPositions == 0) revert InvalidBatchSize();
        maxPositions;

        _rollBuckets();
        currentPriceX18 = _requireCurrentPriceX18();
        if (doSync) {
            (processedPositions,,) = _syncLiquidityToPrice(currentPriceX18, address(0), type(uint256).max);
        }

        (InternalCandidate[] memory candidates, uint256 count) = _buildInternalCandidates();
        if (count == 0) revert InsufficientLiquidity();

        uint256 clearingPriceX18 = _resolveClearingPriceLinear(candidates, count, ethIn);
        uint256 previewTokenOut = _tokenOutAtPrice(candidates, count, clearingPriceX18);
        if (previewTokenOut == 0) revert InsufficientLiquidity();
        if (previewTokenOut < minTokenOut) revert MinTokenOutNotMet();

        tokenOut = _applyInternalExecution(clearingPriceX18, ethIn);
        if (tokenOut < minTokenOut) revert MinTokenOutNotMet();

        ethUsed = ethIn;
    }

    function _buildInternalCandidates() internal view returns (InternalCandidate[] memory candidates, uint256 count) {
        uint256 len = _liquidityTokenIds.length;
        candidates = new InternalCandidate[](len);

        for (uint256 i; i < len; ++i) {
            uint256 tokenId = _liquidityTokenIds[i];
            Position storage position = _positions[tokenId];
            if (!position.active) continue;

            uint256 amount = position.remainingTokens;
            uint256 lastPriceX18 = position.lastAutoSellPriceX18;
            if (amount == 0 || lastPriceX18 == 0) continue;

            candidates[count] = InternalCandidate({tokenId: tokenId, amount: amount, lastPriceX18: lastPriceX18});
            ++count;
        }
    }

    function _resolveClearingPriceLinear(InternalCandidate[] memory candidates, uint256 count, uint256 ethIn)
        internal
        pure
        returns (uint256 clearingPriceX18)
    {
        uint256 sumAmountSqrtPrice;
        uint256 sumAmountPrice;

        for (uint256 i; i < count; ++i) {
            InternalCandidate memory c = candidates[i];

            sumAmountSqrtPrice += Math.mulDiv(c.amount, Math.sqrt(c.lastPriceX18), 1);
            sumAmountPrice += Math.mulDiv(c.amount, c.lastPriceX18, 1);

            uint256 targetPriceX18 = _solvePriceFromSums(sumAmountSqrtPrice, sumAmountPrice, ethIn);
            if (targetPriceX18 < c.lastPriceX18) {
                targetPriceX18 = c.lastPriceX18;
            }

            uint256 nextPriceX18 = type(uint256).max;
            if (i + 1 < count) {
                nextPriceX18 = candidates[i + 1].lastPriceX18;
            }

            if (targetPriceX18 <= nextPriceX18) {
                clearingPriceX18 = targetPriceX18;
                break;
            }
        }
    }

    function _solvePriceFromSums(uint256 sumAmountSqrtPrice, uint256 sumAmountPrice, uint256 ethIn)
        internal
        pure
        returns (uint256 priceX18)
    {
        if (sumAmountSqrtPrice == 0) return 0;

        uint256 numerator = Math.mulDiv(ethIn, PRICE_PRECISION, 1) + sumAmountPrice;
        uint256 sqrtPriceX9 = numerator / sumAmountSqrtPrice;
        if (sqrtPriceX9 == 0) return 0;

        if (sqrtPriceX9 > type(uint256).max / sqrtPriceX9) {
            return type(uint256).max;
        }
        priceX18 = sqrtPriceX9 * sqrtPriceX9;
    }

    function _tokenOutAtPrice(InternalCandidate[] memory candidates, uint256 count, uint256 priceX18)
        internal
        pure
        returns (uint256 tokenOut)
    {
        for (uint256 i; i < count; ++i) {
            InternalCandidate memory c = candidates[i];
            if (priceX18 <= c.lastPriceX18) continue;

            uint256 newAmount = _computeVirtualRemaining(c.amount, c.lastPriceX18, priceX18);
            if (newAmount < c.amount) {
                tokenOut += (c.amount - newAmount);
            }
        }
    }

    function _applyInternalExecution(uint256 clearingPriceX18, uint256 ethIn) internal returns (uint256 tokenOut) {
        uint256 distributedEth;
        uint256 firstSellerTokenId;

        uint256 len = _liquidityTokenIds.length;
        for (uint256 i; i < len; ++i) {
            uint256 tokenId = _liquidityTokenIds[i];
            (bool shouldStop, uint256 sold, uint256 ethPart) = _applyInternalExecutionOne(tokenId, clearingPriceX18);
            if (shouldStop) {
                break;
            }
            if (sold == 0) continue;

            tokenOut += sold;
            distributedEth += ethPart;
            if (firstSellerTokenId == 0) {
                firstSellerTokenId = tokenId;
            }
        }

        if (tokenOut == 0) revert InsufficientLiquidity();

        uint256 dust = ethIn - distributedEth;
        if (dust > 0) {
            if (firstSellerTokenId != 0) {
                _positions[firstSellerTokenId].pendingProceedsEth += dust;
            } else {
                protocolUndistributedEth += dust;
            }
        }
    }

    function _applyInternalExecutionOne(uint256 tokenId, uint256 clearingPriceX18)
        internal
        returns (bool shouldStop, uint256 sold, uint256 ethPart)
    {
        Position storage position = _positions[tokenId];
        if (!position.active) {
            return (false, 0, 0);
        }

        uint256 oldPriceX18 = position.lastAutoSellPriceX18;
        if (oldPriceX18 >= clearingPriceX18) {
            return (true, 0, 0);
        }

        uint256 oldAmount = position.remainingTokens;
        position.lastAutoSellPriceX18 = clearingPriceX18;
        if (oldAmount == 0) {
            return (false, 0, 0);
        }

        uint256 newAmount = _computeVirtualRemaining(oldAmount, oldPriceX18, clearingPriceX18);
        if (newAmount >= oldAmount) {
            return (false, 0, 0);
        }

        sold = oldAmount - newAmount;
        ethPart = _ethForMove(oldAmount, oldPriceX18, clearingPriceX18);
        position.remainingTokens = newAmount;
        position.pendingProceedsEth += ethPart;
        return (false, sold, ethPart);
    }

    function _ethForMove(uint256 amount, uint256 fromPriceX18, uint256 toPriceX18)
        internal
        pure
        returns (uint256 ethOut)
    {
        if (amount == 0 || fromPriceX18 == 0 || toPriceX18 <= fromPriceX18) return 0;

        uint256 product = Math.mulDiv(fromPriceX18, toPriceX18, 1);
        uint256 sqrtProduct = Math.sqrt(product);
        if (sqrtProduct <= fromPriceX18) return 0;

        ethOut = Math.mulDiv(amount, (sqrtProduct - fromPriceX18), PRICE_PRECISION);
    }

    function _buyTokenExternalCore(uint256 ethIn, uint256 minTokenOut, uint256 deadline)
        internal
        returns (uint256 tokenOut)
    {
        if (ethIn == 0) return 0;
        tokenOut = _buyTokenWithETH(ethIn, minTokenOut, deadline);
        if (tokenOut < minTokenOut) revert MinTokenOutNotMet();
    }

    function _quoteMixTokenOut(uint256 ethIn, uint256 maxPositions, uint256 ratio) internal returns (uint256 tokenOut) {
        if (ethIn == 0) revert InvalidAmount();
        if (ratio > 100) revert InvalidRatio();

        _preSyncLiquidityForMix(maxPositions);

        uint256 internalEthIn = Math.mulDiv(ethIn, ratio, 100);
        uint256 externalEthIn = ethIn - internalEthIn;

        uint256 internalTokenOut;
        if (internalEthIn > 0) {
            (internalTokenOut,,,) =
                _buyTokenInternalCoreWithOption(internalEthIn, 0, block.timestamp, maxPositions, false);
        }

        uint256 externalTokenOut;
        if (externalEthIn > 0) {
            externalTokenOut = _buyTokenExternalCore(externalEthIn, 0, block.timestamp);
        }

        tokenOut = internalTokenOut + externalTokenOut;
    }

    function _checkMixQuoteByRevert(uint256 ethIn, uint256 maxPositions, uint256 ratio)
        internal
        returns (uint256 tokenOut)
    {
        try this.simulateMixCheckByRevert(ethIn, maxPositions, ratio) {
            revert QuoteCheckFailed();
        } catch (bytes memory reason) {
            (bool ok, uint256 out) = _tryDecodeQuoteCheckResult(reason);
            if (!ok) {
                return 0;
            }
            tokenOut = out;
        }
    }

    function simulateMixCheckByRevert(uint256 ethIn, uint256 maxPositions, uint256 ratio) external {
        uint256 tokenOut = _quoteMixTokenOut(ethIn, maxPositions, ratio);
        revert QuoteCheckResult(tokenOut);
    }

    function _tryDecodeQuoteCheckResult(bytes memory reason) internal pure returns (bool ok, uint256 tokenOut) {
        if (reason.length != 36) return (false, 0);

        bytes4 selector;
        assembly {
            selector := mload(add(reason, 0x20))
            tokenOut := mload(add(reason, 0x24))
        }
        if (selector != QuoteCheckResult.selector) return (false, 0);
        return (true, tokenOut);
    }

    function _preSyncLiquidityForMix(uint256 maxPositions) internal {
        if (maxPositions == 0) revert InvalidBatchSize();
        _rollBuckets();
        uint256 currentPriceX18 = _requireCurrentPriceX18();
        _syncLiquidityToPrice(currentPriceX18, address(0), type(uint256).max);
    }

    function _syncLiquidityToPrice(uint256 currentPriceX18, address caller, uint256 maxPositions)
        internal
        returns (uint256 processedPositions, uint256 soldTokens, uint256 ownerEthOut)
    {
        uint256 len = _liquidityTokenIds.length;
        if (len == 0) {
            return (0, 0, 0);
        }

        uint256 boundary;
        while (boundary < len) {
            Position storage p = _positions[_liquidityTokenIds[boundary]];
            if (!p.active) {
                ++boundary;
                continue;
            }
            if (p.lastAutoSellPriceX18 >= currentPriceX18) {
                break;
            }
            ++boundary;
        }

        if (boundary == 0) {
            syncCursor = 0;
            return (0, 0, 0);
        }

        uint256 limit = boundary;
        if (maxPositions < limit) {
            limit = maxPositions;
        }

        uint256 idx = boundary;
        while (processedPositions < limit) {
            unchecked {
                --idx;
            }

            (uint256 sold, uint256 ownerOut) =
                _syncLiquidityOneInOrder(_liquidityTokenIds[idx], currentPriceX18, caller);
            soldTokens += sold;
            ownerEthOut += ownerOut;
            unchecked {
                ++processedPositions;
            }
        }

        syncCursor = boundary - limit;
    }

    function _syncLiquidityOneInOrder(uint256 tokenId, uint256 currentPriceX18, address caller)
        internal
        returns (uint256 soldTokens, uint256 ownerEthOut)
    {
        Position storage position = _positions[tokenId];
        if (!position.active) return (0, 0);
        return _syncPosition(tokenId, position, currentPriceX18, true, caller, false);
    }

    function _syncPosition(
        uint256 tokenId,
        Position storage position,
        uint256 currentPriceX18,
        bool applyAutoSell,
        address caller,
        bool reposition
    ) internal returns (uint256 soldTokens, uint256 ownerEthOut) {
        if (!applyAutoSell || currentPriceX18 == 0) {
            return (0, 0);
        }

        uint256 oldPriceX18 = position.lastAutoSellPriceX18;
        (soldTokens, ownerEthOut) = _autoSellToPrice(tokenId, position, currentPriceX18, caller);

        if (reposition && position.lastAutoSellPriceX18 != oldPriceX18) {
            _repositionLiquidityPosition(tokenId);
        }
    }

    function _addLiquidityPosition(uint256 tokenId) internal {
        if (_liquidityIndexPlusOne[tokenId] != 0) return;

        uint256 priceX18 = _positions[tokenId].lastAutoSellPriceX18;
        uint256 len = _liquidityTokenIds.length;
        _liquidityTokenIds.push(tokenId);

        uint256 idx = len;
        while (idx > 0) {
            uint256 prevTokenId = _liquidityTokenIds[idx - 1];
            uint256 prevPriceX18 = _positions[prevTokenId].lastAutoSellPriceX18;
            if (prevPriceX18 <= priceX18) {
                break;
            }
            _liquidityTokenIds[idx] = prevTokenId;
            _liquidityIndexPlusOne[prevTokenId] = idx + 1;
            unchecked {
                --idx;
            }
        }

        _liquidityTokenIds[idx] = tokenId;
        _liquidityIndexPlusOne[tokenId] = idx + 1;
    }

    function _removeLiquidityPosition(uint256 tokenId) internal {
        uint256 idxPlusOne = _liquidityIndexPlusOne[tokenId];
        if (idxPlusOne == 0) return;

        uint256 idx = idxPlusOne - 1;
        uint256 len = _liquidityTokenIds.length;

        for (uint256 i = idx; i + 1 < len; ++i) {
            uint256 movedTokenId = _liquidityTokenIds[i + 1];
            _liquidityTokenIds[i] = movedTokenId;
            _liquidityIndexPlusOne[movedTokenId] = i + 1;
        }

        _liquidityTokenIds.pop();
        delete _liquidityIndexPlusOne[tokenId];

        uint256 newLen = _liquidityTokenIds.length;
        if (newLen == 0) {
            syncCursor = 0;
            buyCursor = 0;
        } else {
            if (syncCursor >= newLen) syncCursor = newLen - 1;
            if (buyCursor >= newLen) buyCursor = newLen - 1;
        }
    }

    function _repositionLiquidityPosition(uint256 tokenId) internal {
        uint256 idxPlusOne = _liquidityIndexPlusOne[tokenId];
        if (idxPlusOne == 0) return;

        uint256 len = _liquidityTokenIds.length;
        uint256 idx = idxPlusOne - 1;
        uint256 priceX18 = _positions[tokenId].lastAutoSellPriceX18;

        while (idx > 0) {
            uint256 prevTokenId = _liquidityTokenIds[idx - 1];
            if (_positions[prevTokenId].lastAutoSellPriceX18 <= priceX18) {
                break;
            }
            _liquidityTokenIds[idx] = prevTokenId;
            _liquidityIndexPlusOne[prevTokenId] = idx + 1;
            unchecked {
                --idx;
            }
        }

        while (idx + 1 < len) {
            uint256 nextLiquidityTokenId = _liquidityTokenIds[idx + 1];
            if (_positions[nextLiquidityTokenId].lastAutoSellPriceX18 >= priceX18) {
                break;
            }
            _liquidityTokenIds[idx] = nextLiquidityTokenId;
            _liquidityIndexPlusOne[nextLiquidityTokenId] = idx + 1;
            unchecked {
                ++idx;
            }
        }

        _liquidityTokenIds[idx] = tokenId;
        _liquidityIndexPlusOne[tokenId] = idx + 1;
    }

    function _autoSellToPrice(uint256 tokenId, Position storage position, uint256 currentPriceX18, address caller)
        internal
        returns (uint256 soldTokens, uint256 ownerEthOut)
    {
        uint256 oldPriceX18 = position.lastAutoSellPriceX18;
        if (currentPriceX18 <= oldPriceX18 || oldPriceX18 == 0) {
            return (0, 0);
        }

        uint256 oldAmount = position.remainingTokens;
        position.lastAutoSellPriceX18 = currentPriceX18;

        if (oldAmount == 0) {
            return (0, 0);
        }

        uint256 targetRemaining = _computeVirtualRemaining(oldAmount, oldPriceX18, currentPriceX18);
        if (targetRemaining >= oldAmount) {
            return (0, 0);
        }

        soldTokens = oldAmount - targetRemaining;
        position.remainingTokens = targetRemaining;

        uint256 ethOut = _sellTokenForETH(soldTokens);
        uint256 botReward;
        if (caller != address(0) && caller != ownerOf(tokenId) && botRewardBps > 0 && ethOut > 0) {
            botReward = Math.mulDiv(ethOut, botRewardBps, BPS_DENOMINATOR);
            if (botReward > 0) {
                _safeTransferEth(caller, botReward);
                emit BotRewardPaid(tokenId, caller, botReward);
            }
        }

        ownerEthOut = ethOut - botReward;
        position.pendingProceedsEth += ownerEthOut;
    }

    function _virtualRemainingAtPrice(Position storage position, uint256 currentPriceX18)
        internal
        view
        returns (uint256)
    {
        return _computeVirtualRemaining(position.remainingTokens, position.lastAutoSellPriceX18, currentPriceX18);
    }

    function _computeVirtualRemaining(uint256 remainingTokens, uint256 fromPriceX18, uint256 toPriceX18)
        internal
        pure
        returns (uint256)
    {
        if (remainingTokens == 0 || fromPriceX18 == 0 || toPriceX18 <= fromPriceX18) {
            return remainingTokens;
        }

        uint256 sqrtFrom = Math.sqrt(fromPriceX18);
        uint256 sqrtTo = Math.sqrt(toPriceX18);
        if (sqrtTo == 0) {
            return remainingTokens;
        }
        return Math.mulDiv(remainingTokens, sqrtFrom, sqrtTo);
    }

    function _timeWeightCoeffX18(uint64 createdAt) internal view returns (uint256 coeffX18) {
        uint256 age = block.timestamp - uint256(createdAt);
        if (age >= TIME_RAMP) {
            return PRICE_PRECISION;
        }
        coeffX18 = Math.mulDiv(age, PRICE_PRECISION, TIME_RAMP);
    }

    function _stakeScoreAtPrice(Position storage position, uint256 currentPriceX18)
        internal
        view
        returns (uint256 score)
    {
        if (!position.active || position.remainingTokens == 0) {
            return 0;
        }

        uint256 virtualRemaining = _virtualRemainingAtPrice(position, currentPriceX18);
        if (virtualRemaining == 0) {
            return 0;
        }

        uint256 coeffX18 = _timeWeightCoeffX18(position.createdAt);
        if (coeffX18 == 0) {
            return 0;
        }

        score = Math.mulDiv(virtualRemaining, coeffX18, PRICE_PRECISION);
    }

    function _distributePenaltyEth(uint256 penaltyEthIn, uint256 currentPriceX18) internal {
        if (penaltyEthIn == 0) {
            return;
        }

        uint256 len = _liquidityTokenIds.length;
        uint256 totalScore;
        for (uint256 i; i < len; ++i) {
            Position storage position = _positions[_liquidityTokenIds[i]];
            totalScore += _stakeScoreAtPrice(position, currentPriceX18);
        }

        if (totalScore == 0) {
            protocolUndistributedEth += penaltyEthIn;
            emit PenaltyDistributed(penaltyEthIn, 0, activePositions, 0);
            return;
        }

        uint256 distributed;
        for (uint256 i; i < len; ++i) {
            Position storage position = _positions[_liquidityTokenIds[i]];
            uint256 score = _stakeScoreAtPrice(position, currentPriceX18);
            if (score == 0) continue;

            uint256 share = Math.mulDiv(penaltyEthIn, score, totalScore);
            if (share == 0) continue;

            position.pendingPenaltyEth += share;
            distributed += share;
        }

        uint256 dust = penaltyEthIn - distributed;
        if (dust > 0) {
            protocolUndistributedEth += dust;
        }

        emit PenaltyDistributed(penaltyEthIn, distributed, activePositions, totalScore);
    }

    function _rollBuckets() internal {
        // Kept for interface compatibility with previous bucket-based implementation.
        lastRolledBucket = _currentBucket();
    }

    function _currentBucket() internal view returns (uint256) {
        return block.timestamp / BUCKET_DURATION;
    }

    function _safeTransferEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    function _getCurrentPriceX18() internal view returns (uint256) {
        return _queryCurrentPriceX18External();
    }

    function _requireCurrentPriceX18() internal view returns (uint256 priceX18) {
        priceX18 = _getCurrentPriceX18();
        if (priceX18 == 0) revert PriceUnavailable();
    }

    function _requireCurrentPriceX18View() internal view returns (uint256 priceX18) {
        priceX18 = _getCurrentPriceX18();
        if (priceX18 == 0) revert PriceUnavailable();
    }

    // -------- External platform hooks --------
    // Price query from your meme platform (closed-source curve/pair adapter).
    function _queryCurrentPriceX18External() internal view virtual returns (uint256) {
        address pool = poolAddress;
        if (pool == address(0)) revert PoolNotSet();
        return IMemePool(pool).getCurrentPrice();
    }

    // Execute token -> ETH sell through configured pool.
    function _sellTokenForETH(uint256 tokenAmount) internal virtual returns (uint256 ethOut) {
        address pool = poolAddress;
        if (pool == address(0)) revert PoolNotSet();
        ethOut = IMemePool(pool).sell(tokenAmount, 0, block.timestamp);
    }

    // Execute ETH -> token buy through configured pool.
    function _buyTokenWithETH(uint256 ethAmount, uint256 minOut, uint256 deadline)
        internal
        virtual
        returns (uint256 tokenOut)
    {
        address pool = poolAddress;
        if (pool == address(0)) revert PoolNotSet();
        tokenOut = IMemePool(pool).buy{value: ethAmount}(minOut, deadline);
    }

    // Optional future use: simulation quote for token -> ETH.
    function _simulateSellTokenForETH(uint256 tokenAmount) internal view virtual returns (uint256 ethOut) {
        tokenAmount;
        return 0;
    }

    // Optional future use: simulation quote for ETH -> token.
    function _simulateBuyTokenWithETH(uint256 ethAmount) internal view virtual returns (uint256 tokenOut) {
        ethAmount;
        return 0;
    }
}
