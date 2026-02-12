export SKEY1=0xf61105d9b401f77c13f2e222ad90ac344d87b89f590b5eb3f345ba2ee56e059c
export SKEY2=0x0eb63e76063212b1443e6abb78da50a03e969e24f8ec22142045a846f9edf696

export ADDRESS1=`cast wallet address --private-key $SKEY1`
export ADDRESS2=`cast wallet address --private-key $SKEY2`

cast send --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 $ADDRESS1 --value 1000ether
cast send --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 $ADDRESS2 --value 1000ether

PLATFORM_ADDRESS=0x07DFAEC8e182C5eF79844ADc70708C1c15aA60fb forge script script/DeployRouter.s.sol:DeployRouterScript \
  --rpc-url http://127.0.0.1:8545 \
  --private-key $SKEY1 \
  --broadcast