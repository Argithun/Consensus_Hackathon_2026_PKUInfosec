// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {MemeInsuranceStaking} from "../src/MemeInsuranceStaking.sol";

contract MockMemeToken is ERC20 {
    constructor() ERC20("Mock Meme", "MMEME") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockMemeInsuranceStaking is MemeInsuranceStaking {
    uint256 public mockSellRateX18 = 1e18;
    uint256 public mockBuyRateX18 = 1_000e18;
    uint256 public mockPriceX18 = 1e18;

    constructor(address token, address owner_) MemeInsuranceStaking(token, "Meme Stake Position", "MSP", owner_) {}

    function setMockSellRateX18(uint256 rateX18) external {
        mockSellRateX18 = rateX18;
    }

    function setMockPriceX18(uint256 priceX18) external {
        mockPriceX18 = priceX18;
    }

    function setMockBuyRateX18(uint256 rateX18) external {
        mockBuyRateX18 = rateX18;
    }

    function _queryCurrentPriceX18External() internal view override returns (uint256) {
        return mockPriceX18;
    }

    function _sellTokenForETH(uint256 tokenAmount) internal view override returns (uint256 ethOut) {
        ethOut = Math.mulDiv(tokenAmount, mockSellRateX18, 1e18);
    }

    function _buyTokenWithETH(uint256 ethAmount, uint256 minOut, uint256 deadline)
        internal
        override
        returns (uint256 tokenOut)
    {
        deadline;
        tokenOut = Math.mulDiv(ethAmount, mockBuyRateX18, 1e18);
        require(tokenOut >= minOut, "mock slippage");
        MockMemeToken(address(memeToken)).mint(address(this), tokenOut);
    }

    function _simulateBuyTokenWithETH(uint256 ethAmount) internal view override returns (uint256 tokenOut) {
        tokenOut = Math.mulDiv(ethAmount, mockBuyRateX18, 1e18);
    }
}

contract MemeInsuranceStakingTest is Test {
    MockMemeToken internal token;
    MockMemeInsuranceStaking internal staking;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal charlie = makeAddr("charlie");
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        token = new MockMemeToken();
        staking = new MockMemeInsuranceStaking(address(token), address(this));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);

        token.mint(alice, 1_000_000 ether);
        token.mint(bob, 1_000_000 ether);
        token.mint(charlie, 1_000_000 ether);

        vm.prank(alice);
        token.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        token.approve(address(staking), type(uint256).max);
        vm.prank(charlie);
        token.approve(address(staking), type(uint256).max);

        staking.setMockPriceX18(1e18);
        vm.deal(address(staking), 10_000 ether);
    }

    function testAutoSellAndKeeperReward() public {
        uint256 tokenId = _open(alice, 100 ether, 1e18);
        staking.setBotRewardBps(1_000); // 10%
        staking.setMockPriceX18(4e18);

        uint256 keeperBalBefore = keeper.balance;
        vm.prank(keeper);
        (, uint256 soldTokens, uint256 ethOut) = staking.poke(1);

        assertEq(soldTokens, 50 ether);
        assertEq(ethOut, 45 ether);
        assertEq(keeper.balance - keeperBalBefore, 5 ether);

        MemeInsuranceStaking.Position memory p = staking.positionInfo(tokenId);
        assertEq(p.remainingTokens, 50 ether);
        assertEq(p.pendingProceedsEth, 45 ether);
    }

    function testExitPenaltyPreview() public {
        uint256 tokenId = _open(alice, 100 ether, 1e18);

        (uint256 total0, uint256 time0, uint256 price0) = staking.previewExitPenaltyBps(tokenId);
        assertEq(time0, 1_000);
        assertEq(price0, 1_000);
        assertEq(total0, 2_000);

        vm.warp(block.timestamp + 7 days);
        staking.setMockPriceX18(2e18);
        (uint256 total7d, uint256 time7d, uint256 price7d) = staking.previewExitPenaltyBps(tokenId);
        assertEq(time7d, 500);
        assertEq(price7d, 500);
        assertEq(total7d, 1_000);

        vm.warp(block.timestamp + 20_000 days);
        staking.setMockPriceX18(5e17); // price penalty = 0
        (uint256 totalLong, uint256 timeLong, uint256 priceLong) = staking.previewExitPenaltyBps(tokenId);
        assertEq(priceLong, 0);
        assertEq(timeLong, 0);
        assertEq(totalLong, 0);
    }

    function testPenaltyDistributionFavorsMatureStake() public {
        uint256 aliceId = _open(alice, 100 ether, 1e18);
        vm.warp(block.timestamp + 7 days);

        uint256 bobId = _open(bob, 100 ether, 1e18);
        uint256 charlieId = _open(charlie, 100 ether, 1e18);

        vm.prank(charlie);
        (, uint256 confiscatedTokens, uint256 penaltyEthOut, uint256 penaltyBps) = staking.exitPosition(charlieId);
        assertEq(confiscatedTokens, 20 ether);
        assertEq(penaltyEthOut, 20 ether);
        assertEq(penaltyBps, 2_000);

        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        uint256 aliceClaimed = staking.claim(aliceId);
        assertEq(aliceClaimed, 20 ether);
        assertEq(alice.balance - aliceBalBefore, 20 ether);

        vm.prank(bob);
        uint256 bobClaimed = staking.claim(bobId);
        assertEq(bobClaimed, 0);
    }

    function testClaimTransfersPendingEth() public {
        uint256 aliceId = _open(alice, 100 ether, 1e18);
        vm.warp(block.timestamp + 7 days);
        uint256 charlieId = _open(charlie, 100 ether, 1e18);

        vm.prank(charlie);
        staking.exitPosition(charlieId);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = staking.claim(aliceId);
        assertEq(claimed, 20 ether);
        assertEq(alice.balance - balBefore, 20 ether);
    }

    function testExitModeDisablesPenaltyOnExit() public {
        uint256 tokenId = _open(alice, 100 ether, 1e18);
        staking.setExitMode(true);

        vm.prank(alice);
        (uint256 refundTokens, uint256 confiscatedTokens, uint256 penaltyEthOut, uint256 exitPenaltyBps) =
            staking.exitPosition(tokenId);

        assertEq(refundTokens, 100 ether);
        assertEq(confiscatedTokens, 0);
        assertEq(penaltyEthOut, 0);
        assertEq(exitPenaltyBps, 0);
    }

    function testBuyTokenFromSingleSidedLiquidityByEthIn() public {
        _open(bob, 100 ether, 1e18);
        staking.setMockPriceX18(4e18);

        uint256 beforeEth = alice.balance;
        uint256 beforeToken = token.balanceOf(alice);
        MemeInsuranceStaking.Position memory beforePos = staking.positionInfo(1);

        vm.prank(alice);
        uint256 out = staking.buyTokenInternal{value: 41 ether}(1 ether, block.timestamp + 1, 1);

        uint256 ethSpent = beforeEth - alice.balance;
        assertGt(out, 8 ether);
        assertLt(out, 9 ether);
        assertEq(token.balanceOf(alice) - beforeToken, out);
        assertEq(ethSpent, 41 ether);

        MemeInsuranceStaking.Position memory afterPos = staking.positionInfo(1);
        assertGt(afterPos.remainingTokens, 41 ether);
        assertLt(afterPos.remainingTokens, 42 ether);
        assertEq(afterPos.pendingProceedsEth - beforePos.pendingProceedsEth, 91 ether);
    }

    function testBuyTokenExternal() public {
        staking.setMockBuyRateX18(2_000e18);
        uint256 beforeToken = token.balanceOf(alice);

        vm.prank(alice);
        uint256 out = staking.buyTokenExternal{value: 1 ether}(1_500 ether, block.timestamp + 1);

        assertEq(out, 2_000 ether);
        assertEq(token.balanceOf(alice) - beforeToken, 2_000 ether);
    }

    function _open(address user, uint256 amount, uint256 sellPriceX18) internal returns (uint256 tokenId) {
        vm.prank(user);
        tokenId = staking.openPosition(amount, sellPriceX18);
    }
}
