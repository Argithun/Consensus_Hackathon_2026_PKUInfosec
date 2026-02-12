// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {MemeInsuranceStaking} from "./MemeInsuranceStaking.sol";

/// @title MemeInsuranceRouter
/// @notice Deploys and indexes MemeInsuranceStaking instances per token.
contract MemeInsuranceRouter is Ownable {
    bytes4 public constant POOL_QUERY_SELECTOR = 0x0c74fbac;

    error InvalidAddress();
    error AlreadyCreated();
    error NotFound();
    error PoolQueryFailed();
    error InvalidPool();

    event PlatformUpdated(address indexed oldPlatform, address indexed newPlatform);
    event StakingCreated(
        address indexed token,
        address indexed staking,
        address indexed pool,
        address creator,
        string name,
        string symbol
    );
    event PoolSynced(address indexed token, address indexed staking, address indexed pool);

    address public platform;
    string public defaultPositionName = "Meme Stake Position";
    string public defaultPositionSymbol = "MSP";

    address[] private _allTokens;
    address[] private _allStakings;

    mapping(address => address) public stakingByToken;
    mapping(address => address) public tokenByStaking;

    constructor(address platform_) Ownable(msg.sender) {
        if (platform_ == address(0)) revert InvalidAddress();
        platform = platform_;
    }

    function setPlatform(address newPlatform) external onlyOwner {
        if (newPlatform == address(0)) revert InvalidAddress();
        address oldPlatform = platform;
        platform = newPlatform;
        emit PlatformUpdated(oldPlatform, newPlatform);
    }

    function setDefaultMetadata(string calldata name_, string calldata symbol_) external onlyOwner {
        defaultPositionName = name_;
        defaultPositionSymbol = symbol_;
    }

    function createStaking(address token) external returns (address staking) {
        staking = _createStaking(token, defaultPositionName, defaultPositionSymbol);
    }

    function createStaking(address token, string calldata name_, string calldata symbol_)
        external
        returns (address staking)
    {
        staking = _createStaking(token, name_, symbol_);
    }

    function syncPool(address token) external onlyOwner returns (address pool) {
        address staking = stakingByToken[token];
        if (staking == address(0)) revert NotFound();

        pool = _queryPoolAddress(token);
        MemeInsuranceStaking(payable(staking)).setPoolAddress(pool);
        emit PoolSynced(token, staking, pool);
    }

    function allTokensLength() external view returns (uint256) {
        return _allTokens.length;
    }

    function allStakingsLength() external view returns (uint256) {
        return _allStakings.length;
    }

    function tokenAt(uint256 index) external view returns (address) {
        return _allTokens[index];
    }

    function stakingAt(uint256 index) external view returns (address) {
        return _allStakings[index];
    }

    function _createStaking(address token, string memory name_, string memory symbol_)
        internal
        returns (address staking)
    {
        if (token == address(0)) revert InvalidAddress();
        if (stakingByToken[token] != address(0)) revert AlreadyCreated();

        address pool = _queryPoolAddress(token);

        MemeInsuranceStaking deployed = new MemeInsuranceStaking(token, name_, symbol_, address(this));
        staking = address(deployed);

        deployed.setPoolAddress(pool);

        stakingByToken[token] = staking;
        tokenByStaking[staking] = token;
        _allTokens.push(token);
        _allStakings.push(staking);

        emit StakingCreated(token, staking, pool, msg.sender, name_, symbol_);
    }

    function _queryPoolAddress(address token) internal view returns (address pool) {
        (bool ok, bytes memory data) = platform.staticcall(abi.encodeWithSelector(POOL_QUERY_SELECTOR, token));
        if (!ok || data.length < 32) revert PoolQueryFailed();
        pool = abi.decode(data, (address));
        if (pool == address(0)) revert InvalidPool();
    }
}
