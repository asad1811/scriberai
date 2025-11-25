"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Mic, Monitor } from "lucide-react";

export default function NewSessionPage() {
  const router = useRouter();

  function handleStartMic() {
    router.push("/sessions/live?source=mic");
  }

  function handleStartTab() {
    router.push("/sessions/live?source=tab");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Start a New Session
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Choose how you want to capture audio for real-time transcription.
          </p>
        </div>

        {/* Options */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Microphone Card */}
          <button
            onClick={handleStartMic}
            className="group rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-left transition hover:border-sky-600 hover:shadow-lg hover:shadow-sky-600/10"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 rounded-lg bg-sky-600/10 border border-sky-600/20">
                <Mic className="h-5 w-5 text-sky-500" />
              </div>
              <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-sky-500 transition" />
            </div>

            <h2 className="text-lg font-medium mb-1">Use Microphone</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Capture audio directly from your device’s microphone for
              real-time transcription.
            </p>
          </button>

          {/* Tab Audio Card */}
          <button
            onClick={handleStartTab}
            className="group rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-left transition hover:border-sky-600 hover:shadow-lg hover:shadow-sky-600/10"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 rounded-lg bg-sky-600/10 border border-sky-600/20">
                <Monitor className="h-5 w-5 text-sky-500" />
              </div>
              <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-sky-500 transition" />
            </div>

            <h2 className="text-lg font-medium mb-1">Use Tab Audio</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Capture audio from a chosen browser tab (Google Meet, Zoom, etc.)
              with system audio enabled.
            </p>
          </button>
        </div>
      </div>
    </main>
  );
}
