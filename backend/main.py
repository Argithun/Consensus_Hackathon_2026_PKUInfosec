from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import random

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hackathon 直接全开最省事
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



class ExampleReq(BaseModel):
    amount: float
    risk: str


@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/example")
def generate_example(req: ExampleReq):
    # 可替换为 GPT / LangChain
    apy = round(random.uniform(5, 15), 2)

    return {
        "action": "deposit",
        "recommended_amount": req.amount,
        "expected_apy": apy
    }
