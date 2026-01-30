# Consensus Hackathon 2026 PKUInfosec

## Env Setup

OS: Ubuntu 24.04.3 LTS

```bash

cd Consensus_Hackathon_2026_PKUInfosec

#---------------- 合约 ------------------#

mkdir contracts
cd contracts

curl -fsSL "https://aptos.dev/scripts/install_cli.py" | python3

echo "export PATH=/home/pzr/.local/bin:$PATH" >> ~/.bashrc      # 需要依据上一步安装的提示写入
source ~/.bashrc

aptos init      # 选择 devnet

aptos move init --name hackathon_2026_pkuinfosec    # 已初始化完毕，无需运行

aptos move publish


#---------------- 后端 ------------------#

mkdir backend
cd backend

conda create -n hackathon python=3.13
conda activate hackathon
pip install -r requirements.txt

uvicorn main:app --host 0.0.0.0 --port 8000 --reload      # 运行后访问 http://127.0.0.1:8000/docs，即 fastapi 的后端文档页面


#---------------- 前端 ------------------#

npx create-next-app@latest frontend     # 选择 TypeScript ✔ App Router ✔ Tailwind ✔，已初始化完毕，无需运行

cd frontend
npm i @aptos-labs/wallet-adapter-react @aptos-labs/ts-sdk axios     # 已初始化完毕，无需运行

npm run dev     # 运行后访问 http://localhost:3000

```