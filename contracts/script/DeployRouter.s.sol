// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MemeInsuranceRouter} from "../src/MemeInsuranceRouter.sol";

contract DeployRouterScript is Script {
    function run() external {
        // 从环境变量读取 platform 地址
        address platform = vm.envAddress("PLATFORM_ADDRESS");

        vm.startBroadcast();

        MemeInsuranceRouter router = new MemeInsuranceRouter(platform);

        vm.stopBroadcast();

        console.log("MemeInsuranceRouter deployed at:", address(router));
        console.log("Owner (msg.sender):", router.owner());
        console.log("Platform:", router.platform());
    }
}
