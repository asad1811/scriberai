"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { authClient } from "@/lib/auth-client";
import ThemeToggle from "@/components/theme-toggle";
import DiagnosticsPanel from "@/components/DiagnosticsPanel";

type RecordingMode = "mic" | "tab" | null;
type RecordingState =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "processing"
  | "completed"
  | "error";

interface SessionHistoryItem {
  id: string;
  createdAt: string;
  mode: string;
  summary: string | null;
  transcriptPreview: string | null;
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL as string;

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  // UI + Recording state
  const [recordingMode, setRecordingMode] = useState<RecordingMode>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const [sessionHistory, setSessionHistory] = useState<SessionHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ───────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────

  const showToast = (msg: string, duration = 3500) => {
    setToastMessage(msg);
    if (duration > 0) {
      window.setTimeout(() => setToastMessage(null), duration);
    }
  };

  const fetchHistory = async () => {
    try {
      setIsHistoryLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error("Failed to load history");
      const data = await res.json();
      setSessionHistory(data.sessions ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const ensureSocket = () => {
    if (socketRef.current) return socketRef.current;

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1200,
    });

    socket.on("connect", () => {
      setIsSocketConnected(true);

      // Minimal reconnection: if we have an active session, ask server to resume
      if (sessionIdRef.current && recordingMode && session) {
        socket.emit("resume_session", {
          sessionId: sessionIdRef.current,
          mode: recordingMode,
          userId: session.user.id,
        });
      }
    });

    socket.on("disconnect", () => {
      setIsSocketConnected(false);
    });

    socket.on("transcription_update", (payload: { sessionId: string; partial: string }) => {
      if (payload.sessionId === sessionIdRef.current) {
        setLiveTranscript((prev) => (prev ? `${prev} ${payload.partial}` : payload.partial));
      }
    });

    socket.on(
      "session_completed",
      (payload: { sessionId: string; transcript: string; summary: string }) => {
        if (payload.sessionId === sessionIdRef.current) {
          setRecordingState("completed");
          setLiveTranscript(payload.transcript);
          setSummary(payload.summary);
          fetchHistory();
        }
      }
    );

    socket.on("session_status", (payload: { sessionId: string; status: RecordingState }) => {
      if (payload.sessionId === sessionIdRef.current) {
        setRecordingState(payload.status);
      }
    });

    socket.on("session_resumed", (payload: { sessionId: string }) => {
      if (payload.sessionId === sessionIdRef.current) {
        showToast("Reconnected to live session.");
      }
    });

    socketRef.current = socket;
    return socket;
  };

  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const mm = minutes.toString().padStart(2, "0");
    const ss = seconds.toString().padStart(2, "0");

    if (hours > 0) {
      const hh = hours.toString().padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }

    return `${mm}:${ss}`;
  };

  // ───────────────────────────────────────────────
  // Hooks (must come BEFORE conditional returns)
  // ───────────────────────────────────────────────

  // Load history on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      socketRef.current?.disconnect();
    };
  }, []);

  // Timer effect
  useEffect(() => {
    if (recordingState !== "recording") return undefined;

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [recordingState]);

  // ───────────────────────────────────────────────
  // Conditional early returns (AFTER HOOKS)
  // ───────────────────────────────────────────────

  if (isPending) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 dark:from-black dark:to-slate-900">
        <div className="animate-pulse text-neutral-500 dark:text-neutral-400">
          Loading Dashboard…
        </div>
      </main>
    );
  }

  if (!session) {
    router.replace("/");
    return null;
  }

  // ───────────────────────────────────────────────
  // Recording helpers
  // ───────────────────────────────────────────────

  const startMediaRecorder = (stream: MediaStream, mode: RecordingMode) => {
    const socket = ensureSocket();
    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;

    socket.emit("start_session", {
      sessionId,
      mode,
      userId: session.user.id,
    });

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    recorder.onstart = () => {
      setRecordingState("recording");
      setLiveTranscript("");
      setSummary(null);
      setElapsedSeconds(0);
      showToast(mode === "mic" ? "Mic recording started." : "Tab recording started.");
    };

    recorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && socketRef.current && sessionIdRef.current) {
        const arrayBuffer = await event.data.arrayBuffer();
        socketRef.current.emit("audio_chunk", {
          sessionId: sessionIdRef.current,
          chunk: arrayBuffer,
        });
      }
    };

    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    mediaRecorderRef.current = recorder;
    recorder.start(3000); // send chunks every 3s
  };

  const handleMicStart = async () => {
    if (recordingState !== "idle") return;

    try {
      setRecordingState("requesting");
      setRecordingMode("mic");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      startMediaRecorder(stream, "mic");
    } catch (err) {
      console.error(err);
      setRecordingState("error");
      showToast("Microphone access denied.");
    }
  };

  const handleTabStart = async () => {
    if (recordingState !== "idle") return;

    try {
      setRecordingState("requesting");
      setRecordingMode("tab");

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });

      const hasAudio = displayStream.getAudioTracks().length > 0;

      if (!hasAudio) {
        displayStream.getTracks().forEach((t) => t.stop());
        showToast("Tab audio unavailable. Switching to microphone…");

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setRecordingMode("mic");
        streamRef.current = micStream;

        startMediaRecorder(micStream, "mic");
        return;
      }

      streamRef.current = displayStream;
      startMediaRecorder(displayStream, "tab");
    } catch (err) {
      console.error(err);
      setRecordingState("idle");
      showToast("Tab sharing cancelled.");
    }
  };

  const handleStop = () => {
    if (recordingState !== "recording") return;

    setRecordingState("processing");
    mediaRecorderRef.current?.stop();

    if (socketRef.current && sessionIdRef.current) {
      socketRef.current.emit("stop_session", {
        sessionId: sessionIdRef.current,
      });
    }
  };

  const handlePause = () => {
    if (recordingState !== "recording") return;
    mediaRecorderRef.current?.pause();
    setRecordingState("paused");
  };

  const handleResume = () => {
    if (recordingState !== "paused") return;
    mediaRecorderRef.current?.resume();
    setRecordingState("recording");
  };

  // ───────────────────────────────────────────────
  // UI Starts Here
  // ───────────────────────────────────────────────

  const isRecording = recordingState === "recording";
  const isProcessing = recordingState === "processing";
  const isRequesting = recordingState === "requesting";

  const diagnosticsSocket = socketRef.current;
  const diagnosticsSessionId = sessionIdRef.current ?? "";

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-black dark:via-slate-950 dark:to-slate-900 px-6 py-8 text-black dark:text-white">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="backdrop-blur-xl bg-white/70 dark:bg-slate-900/80 border border-white/60 dark:border-slate-700 shadow-lg px-4 py-2 rounded-full text-sm">
            {toastMessage}
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Capture meetings and let AI do the note-taking.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs px-3 py-1 rounded-full border border-slate-900/10 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50">
              <span className="inline-flex items-center gap-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isSocketConnected ? "bg-emerald-500" : "bg-amber-400"
                  }`}
                />
                {isSocketConnected ? "Live" : "Connecting…"}
              </span>
            </div>
            <ThemeToggle />
          </div>
        </header>

        {/* Diagnostics */}
        {diagnosticsSocket && diagnosticsSessionId && (
          <div className="flex justify-end mb-4">
            <DiagnosticsPanel socket={diagnosticsSocket} sessionId={diagnosticsSessionId} />
          </div>
        )}

        {/* START SESSION */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <section className="lg:col-span-2 rounded-3xl bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl border border-white/60 dark:border-slate-800 shadow-xl px-6 py-6">
            <h2 className="text-lg font-medium mb-4">Start a new session</h2>

            <div className="flex flex-col sm:flex-row gap-4">
              {/* Mic */}
              <button
                onClick={handleMicStart}
                disabled={isRecording || isRequesting || isProcessing}
                className="flex-1 rounded-2xl p-5 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-900 transition-all shadow"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="h-9 w-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl">
                    🎤
                  </div>
                  <div>
                    <div className="text-sm font-medium">Mic Mode</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Record using your microphone.
                    </p>
                  </div>
                </div>
                {isRequesting && recordingMode === "mic" && (
                  <p className="text-xs text-slate-500 mt-1">Requesting mic…</p>
                )}
              </button>

              {/* Tab */}
              <button
                onClick={handleTabStart}
                disabled={isRecording || isRequesting || isProcessing}
                className="flex-1 rounded-2xl p-5 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-900 transition-all shadow"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="h-9 w-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl">
                    🪟
                  </div>
                  <div>
                    <div className="text-sm font-medium">Tab Mode</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Capture audio from a meeting tab.
                    </p>
                  </div>
                </div>
                {isRequesting && recordingMode === "tab" && (
                  <p className="text-xs text-slate-500 mt-1">Requesting tab…</p>
                )}
              </button>
            </div>
          </section>

          {/* Controls */}
          <section className="rounded-3xl bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl border border-white/60 dark:border-slate-800 shadow-xl px-5 py-5 flex flex-col justify-between">
            <div>
              <h2 className="text-sm font-medium mb-2">Session status</h2>
              <div className="flex items-center gap-2 text-sm mb-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    recordingState === "recording"
                      ? "bg-red-500 animate-pulse"
                      : recordingState === "processing"
                      ? "bg-amber-400"
                      : "bg-slate-400"
                  }`}
                />
                {recordingState}
              </div>
              {(recordingState === "recording" || recordingState === "paused") && (
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  Duration: {formatDuration(elapsedSeconds)}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={handleStop}
                disabled={!isRecording}
                className="flex-1 rounded-full bg-red-500 text-white text-xs py-2 disabled:opacity-40"
              >
                Stop
              </button>

              <button
                onClick={recordingState === "paused" ? handleResume : handlePause}
                disabled={!isRecording && recordingState !== "paused"}
                className="flex-1 rounded-full border border-slate-300 dark:border-slate-700 text-xs py-2"
              >
                {recordingState === "paused" ? "Resume" : "Pause"}
              </button>
            </div>
          </section>
        </div>

        {/* LIVE TRANSCRIPT + SUMMARY */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
          {/* Transcript */}
          <section className="lg:col-span-2 rounded-3xl bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl border border-white/60 dark:border-slate-800 shadow-xl px-6 py-5">
            <h2 className="text-sm font-medium mb-3">Live transcript</h2>
            <div className="h-64 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 overflow-y-auto text-sm">
              {liveTranscript || (
                <p className="text-slate-500 text-xs">
                  Speak or share a tab — transcription will appear here.
                </p>
              )}
              {liveTranscript && (
                <p className="whitespace-pre-wrap leading-relaxed">{liveTranscript}</p>
              )}
            </div>
          </section>

          {/* Summary */}
          <section className="rounded-3xl bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl border border-white/60 dark:border-slate-800 shadow-xl px-6 py-5">
            <h2 className="text-sm font-medium mb-3">AI summary</h2>
            <div className="h-64 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 overflow-y-auto text-sm">
              {summary ? (
                <p className="whitespace-pre-wrap leading-relaxed">{summary}</p>
              ) : (
                <p className="text-slate-500 text-xs">Summary will appear after stopping.</p>
              )}
            </div>
          </section>
        </div>

        {/* HISTORY */}
        <section className="rounded-3xl bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl border border-white/60 dark:border-slate-800 shadow-xl px-6 py-5 mb-16">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">Session history</h2>
            <button
              onClick={fetchHistory}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-white"
            >
              Refresh
            </button>
          </div>

          {isHistoryLoading ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : sessionHistory.length === 0 ? (
            <p className="text-xs text-slate-500">No sessions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {sessionHistory.map((s) => (
                <li
                  key={s.id}
                  className="rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="uppercase text-xs text-slate-500">MEETING</span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(s.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                    {s.transcriptPreview || s.summary || "No preview available"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
