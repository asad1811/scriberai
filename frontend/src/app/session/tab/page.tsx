"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { socket } from "@/lib/socket";

type Mode = "mic" | "meeting";

export default function TabSessionPage() {
  const router = useRouter();
  const { data: sessionData, isPending } = authClient.useSession();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const mode: Mode = "meeting";

  // auth guard
  useEffect(() => {
    if (!isPending && !sessionData) {
      router.replace("/");
    }
  }, [isPending, sessionData, router]);

  // socket listeners
  useEffect(() => {
    function handleSessionStarted(payload: { sessionId: string }) {
      setSessionId(payload.sessionId);
    }

    socket.on("session-started", handleSessionStarted);

    return () => {
      socket.off("session-started", handleSessionStarted);
    };
  }, []);

  // timer
  function startTimer() {
    setTimer(0);
    const id = window.setInterval(() => {
      setTimer((t) => t + 1);
    }, 1000);
    timerRef.current = id;
  }

  function stopTimer() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // backend session
  async function startBackendSession() {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        router.replace("/");
        return null;
      }
      const data = await res.json();
      if (!data.user) {
        router.replace("/");
        return null;
      }

      const tokenRes = await fetch("/api/auth/socket-token");
      if (!tokenRes.ok) {
        setError("Auth error. Please login again.");
        router.replace("/");
        return null;
      }

      const { token } = (await tokenRes.json()) as { token: string };

      socket.emit("start-session", { token, mode });

      return token;
    } catch {
      setError("Unable to start session. Check your connection.");
      return null;
    }
  }

  // start tab capture
  async function startTabRecording() {
    setError(null);
    const token = await startBackendSession();
    if (!token) return;

    let stream: MediaStream;
    try {
      stream = await (navigator.mediaDevices as any).getDisplayMedia({
        audio: true,
        video: false,
      });
    } catch {
      setError("Tab sharing was not granted.");
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0 && sessionId) {
        const reader = new FileReader();
        reader.onload = () => {
          socket.emit("audio-chunk", {
            sessionId,
            chunkIndex: Date.now(),
            timestamp: Date.now(),
            chunk: reader.result,
          });
        };
        reader.readAsArrayBuffer(event.data);
      }
    };

    recorder.start(3000); // send every 3s
    setIsRecording(true);
    startTimer();
  }

  function stopRecording() {
    recorderRef.current?.stop();
    stopTimer();
    if (sessionId) {
      socket.emit("stop-session", { sessionId });
    }
    setIsRecording(false);
    router.push("/dashboard");
  }

  if (isPending || (!sessionData && isPending)) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white dark:bg-black text-neutral-500">
        Checking session…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black dark:bg-black dark:text-white px-6 py-12 flex flex-col items-center">
      <h1 className="text-3xl font-semibold tracking-tight mb-10">Tab Mode</h1>

      <div className="w-full max-w-xl rounded-3xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 shadow-lg p-10 flex flex-col items-center text-center">
        <div className="text-6xl mb-6">{isRecording ? "🔴" : "🪟"}</div>

        <h2 className="text-xl font-medium mb-2">
          {isRecording ? "Recording Tab Audio…" : "Choose a tab to begin"}
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          {isRecording
            ? `Elapsed: ${timer}s`
            : "Browser will prompt you to choose a tab with audio."}
        </p>

        {isRecording && (
          <div className="flex gap-2 mt-3 mb-8">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-2 h-6 bg-red-500 rounded-full animate-pulse"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        )}

        {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

        {!isRecording ? (
          <button
            onClick={startTabRecording}
            className="px-10 py-4 rounded-xl bg-black text-white dark:bg.white dark:text-black text-lg font-medium shadow hover:opacity-90 transition"
          >
            Start Tab Audio
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-10 py-4 rounded-xl bg-red-600 text-white text-lg font-medium shadow hover:bg-red-700 transition"
          >
            Stop Recording
          </button>
        )}
      </div>
    </main>
  );
}
