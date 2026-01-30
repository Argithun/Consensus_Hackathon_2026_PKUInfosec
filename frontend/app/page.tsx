"use client";

import axios from "axios";
import { useState } from "react";

export default function Home() {
  const [result, setResult] = useState<any>(null);

  const callAI = async () => {
    const res = await axios.post("/api/example", {
      amount: 100,
      risk: "low",
    });

    setResult(res.data);
  };

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold mb-6">
        Hackathon 2026 Demo
      </h1>

      <button
        onClick={callAI}
        className="px-4 py-2 bg-black text-white rounded"
      >
        Generate Strategy
      </button>

      {result && (
        <pre className="mt-6">{JSON.stringify(result, null, 2)}</pre>
      )}
    </main>
  );
}
