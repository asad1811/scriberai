"use client";

import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";

interface DiagnosticsProps {
  socket: Socket | null;
  sessionId: string;
}

export default function DiagnosticsPanel({ socket, sessionId }: DiagnosticsProps) {
  const [visible, setVisible] = useState(false);
  const [batchMs, setBatchMs] = useState(0);
  const [latency, setLatency] = useState(0);
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    if (!socket) return;

    const handler = (data: {
      sessionId: string;
      batchMs: number;
      geminiLatency: number;
      queueLength: number;
    }) => {
      if (data.sessionId !== sessionId) return;

      setBatchMs(data.batchMs);
      setLatency(data.geminiLatency);
      setQueueLength(data.queueLength);
    };

    socket.on("diagnostics_update", handler);

    return () => {
      socket.off("diagnostics_update", handler);
    };
  }, [socket, sessionId]);

  return (
    <>
      <button
        onClick={() => setVisible(!visible)}
        className="text-sm px-3 py-1 border rounded-lg"
      >
        {visible ? "Hide Debug" : "Show Debug"}
      </button>

      {visible && (
        <div className="fixed bottom-4 right-4 p-4 bg-black/80 text-white rounded-xl shadow-lg text-sm space-y-2">
          <div>Batch Size: {batchMs} ms</div>
          <div>Gemini Latency: {latency} ms</div>
          <div>Backpressure Queue: {queueLength}</div>
        </div>
      )}
    </>
  );
}
