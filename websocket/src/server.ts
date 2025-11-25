import express from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";
import crypto from "crypto";
import {
  PrismaClient,
  SessionStatus,
} from "./generated/prisma/client.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PrismaPg } from "@prisma/adapter-pg";

// ─────────────────────────────────────────────
// Prisma Init (Postgres adapter)
// ─────────────────────────────────────────────
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────
// Gemini Init
// ─────────────────────────────────────────────
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

const genAI = GEMINI_API_KEY
  ? new GoogleGenerativeAI(GEMINI_API_KEY)
  : null;

const transcriptionModel = genAI
  ? genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
  : null;

const summaryModel = genAI
  ? genAI.getGenerativeModel({ model: "gemini-2.0-pro" })
  : null;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface RingBuffer {
  data: Buffer[];
  capacity: number;
  index: number;
}

interface PendingBatch {
  audio: Buffer;
  timestamp: number;
}

interface SessionMemoryState {
  ring: RingBuffer;
  batchMs: number;
  lastGeminiLatency: number;
  pendingBatches: PendingBatch[];
  maxPending: number;
  userId: string;
  mode: "mic" | "tab";
  dbChunkIndex: number;
  accumulatedMs: number;
}

// All active sessions in memory
const sessions = new Map<string, SessionMemoryState>();

// ─────────────────────────────────────────────
// Utility: Ring buffer
// ─────────────────────────────────────────────
function createRingBuffer(size: number): RingBuffer {
  return {
    data: new Array<Buffer>(size).fill(Buffer.alloc(0)),
    capacity: size,
    index: 0,
  };
}

function ringPush(ring: RingBuffer, value: Buffer): void {
  ring.data[ring.index] = value;
  ring.index = (ring.index + 1) % ring.capacity;
}

function ringToArray(ring: RingBuffer): Buffer[] {
  const result: Buffer[] = [];
  for (let i = 0; i < ring.capacity; i++) {
    const idx = (ring.index + i) % ring.capacity;
    const chunk = ring.data[idx];
    if (chunk.length > 0) result.push(chunk);
  }
  return result;
}

// ─────────────────────────────────────────────
// Gemini Transcription
// ─────────────────────────────────────────────
async function transcribeChunk(audio: Buffer): Promise<string | null> {
  if (!transcriptionModel) return "(Gemini unavailable)";

  try {
    const base64 = audio.toString("base64");

    const result = await transcriptionModel.generateContent([
      {
        inlineData: { data: base64, mimeType: "audio/webm" },
      },
      {
        text: "Transcribe this audio. Return ONLY the raw transcript.",
      },
    ]);

    const text = result.response.text().trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error("[Gemini] Transcription error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────
// Gemini Summary
// ─────────────────────────────────────────────
async function summarizeTranscript(transcript: string): Promise<string> {
  if (!summaryModel) return "Summary unavailable.";

  try {
    const systemPrompt = `
Provide a structured meeting summary:
- Key discussion points
- Action items
- Decisions
- Risks
- Next steps
Do not invent details.
`;

    const result = await summaryModel.generateContent([
      { text: systemPrompt },
      { text: transcript },
    ]);

    return result.response.text().trim();
  } catch (err) {
    console.error("[Gemini] Summary error:", err);
    return "Summary generation failed.";
  }
}

// ─────────────────────────────────────────────
// Express + Socket.io
// ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ─────────────────────────────────────────────
// Process pending batch queue
// ─────────────────────────────────────────────
async function processPendingQueue(
  sessionId: string,
  socket: Socket
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  while (session.pendingBatches.length > 0) {
    const batch = session.pendingBatches.shift();
    if (!batch) continue;

    try {
      const start = Date.now();
      const text = (await transcribeChunk(batch.audio)) ?? "(unintelligible)";
      const end = Date.now();

      session.lastGeminiLatency = end - start;

      // Adaptive batch sizing
      if (session.lastGeminiLatency > 20000 && session.batchMs < 45000) {
        session.batchMs = session.batchMs + 5000;
      } else if (session.lastGeminiLatency < 8000 && session.batchMs > 15000) {
        session.batchMs = session.batchMs - 5000;
      }

      await prisma.transcriptChunk.create({
        data: {
          id: crypto.randomUUID(),
          meetingSessionId: sessionId,
          index: session.dbChunkIndex,
          text: text,
          // createdAt default(now())
        },
      });

      session.dbChunkIndex = session.dbChunkIndex + 1;

      socket.emit("transcription_update", { sessionId: sessionId, partial: text });

      socket.emit("diagnostics_update", {
        sessionId: sessionId,
        batchMs: session.batchMs,
        geminiLatency: session.lastGeminiLatency,
        queueLength: session.pendingBatches.length,
      });
    } catch (err) {
      console.error("[DB] Error while processing pending batch:", err);
      socket.emit("session_error", {
        sessionId: sessionId,
        error: "Failed to save transcript chunk.",
      });
    }
  }
}

// ─────────────────────────────────────────────
// WebSocket Handlers
// ─────────────────────────────────────────────
io.on("connection", (socket: Socket) => {
  console.log(" Connected:", socket.id);

  // ───────────────────────────────
  // START SESSION
  // ───────────────────────────────
  socket.on(
    "start_session",
    async (payload: { sessionId: string; mode: "mic" | "tab"; userId: string }) => {
      const sessionId = payload.sessionId;
      const mode = payload.mode;
      const userId = payload.userId;

      try {
        if (!sessionId || !userId) {
          socket.emit("session_error", {
            sessionId: sessionId,
            error: "sessionId and userId are required.",
          });
          return;
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          socket.emit("session_error", {
            sessionId: sessionId,
            error: "User not found. Cannot start session.",
          });
          return;
        }

        await prisma.meetingSession.create({
          data: {
            id: sessionId,
            userId: userId,
          },
        });

        sessions.set(sessionId, {
          ring: createRingBuffer(20),
          batchMs: 30000,
          lastGeminiLatency: 0,
          pendingBatches: [],
          maxPending: 3,
          userId: userId,
          mode: mode,
          dbChunkIndex: 0,
          accumulatedMs: 0,
        });

        socket.emit("session_status", { sessionId: sessionId, status: "recording" });
      } catch (err) {
        console.error("[DB] Error starting session:", err);
        socket.emit("session_error", {
          sessionId: sessionId,
          error: "Failed to start session.",
        });
      }
    }
  );

  // ───────────────────────────────
  // RESUME SESSION
  // ───────────────────────────────
  socket.on(
    "resume_session",
    async (payload: { sessionId: string; mode: "mic" | "tab"; userId: string }) => {
      const sessionId = payload.sessionId;
      const mode = payload.mode;
      const userId = payload.userId;

      try {
        const dbSession = await prisma.meetingSession.findUnique({
          where: { id: sessionId },
        });

        if (!dbSession) {
          socket.emit("session_error", {
            sessionId: sessionId,
            error: "Session not found. Cannot resume.",
          });
          return;
        }

        if (dbSession.status !== SessionStatus.RECORDING) {
          socket.emit("session_error", {
            sessionId: sessionId,
            error: "Cannot resume: session is not in RECORDING state.",
          });
          return;
        }

        const chunkCount = await prisma.transcriptChunk.count({
          where: { meetingSessionId: sessionId },
        });

        sessions.set(sessionId, {
          ring: createRingBuffer(20),
          batchMs: 30000,
          lastGeminiLatency: 0,
          pendingBatches: [],
          maxPending: 3,
          userId: userId,
          mode: mode,
          dbChunkIndex: chunkCount,
          accumulatedMs: 0,
        });

        socket.emit("session_resumed", { sessionId: sessionId });
      } catch (err) {
        console.error("[DB] Error resuming session:", err);
        socket.emit("session_error", {
          sessionId: sessionId,
          error: "Failed to resume session.",
        });
      }
    }
  );

  // ───────────────────────────────
  // AUDIO CHUNK
  // ───────────────────────────────
  socket.on(
    "audio_chunk",
    async (payload: { sessionId: string; chunk: ArrayBuffer }) => {
      const sessionId = payload.sessionId;
      const chunk = payload.chunk;

      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }

      try {
        const buf = Buffer.from(chunk);
        ringPush(session.ring, buf);
        session.accumulatedMs = session.accumulatedMs + 3000;

        if (session.accumulatedMs >= session.batchMs) {
          const chunks = ringToArray(session.ring);
          const batch = Buffer.concat(chunks);

          session.accumulatedMs = 0;

          if (session.pendingBatches.length >= session.maxPending) {
            session.pendingBatches.shift();
          }

          session.pendingBatches.push({
            audio: batch,
            timestamp: Date.now(),
          });

          void processPendingQueue(sessionId, socket);
        }
      } catch (err) {
        console.error("[Audio] Error handling audio_chunk:", err);
        socket.emit("session_error", {
          sessionId: sessionId,
          error: "Failed to process audio chunk.",
        });
      }
    }
  );

  // ───────────────────────────────
  // TAB AUDIO LOST → FALLBACK
  // ───────────────────────────────
  socket.on("tab_audio_lost", (payload: { sessionId: string }) => {
    const sessionId = payload.sessionId;
    socket.emit("audio_fallback", {
      sessionId: sessionId,
      mode: "mic",
    });
  });

  // ───────────────────────────────
  // STOP SESSION
  // ───────────────────────────────
  socket.on("stop_session", async ({ sessionId }: { sessionId: string }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      console.warn(`stop_session called with no in-memory session: ${sessionId}`);
    }

    try {
      const dbSession = await prisma.meetingSession.findUnique({
        where: { id: sessionId },
      });

      if (!dbSession) {
        socket.emit("session_error", {
          sessionId: sessionId,
          error: "Session not found in database.",
        });
        return;
      }

      await prisma.meetingSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.PROCESSING,
          endedAt: new Date(),
        },
      });

      const chunks = await prisma.transcriptChunk.findMany({
        where: { meetingSessionId: sessionId },
        orderBy: { index: "asc" },
      });

      const fullTranscript = chunks.map((c) => c.text).join(" ");
      const summary = await summarizeTranscript(fullTranscript);

      const existingSummary = await prisma.meetingSummary.findUnique({
        where: { meetingSessionId: sessionId },
      });

      if (!existingSummary) {
        await prisma.meetingSummary.create({
          data: {
            id: crypto.randomUUID(),
            meetingSessionId: sessionId,
            summaryText: summary,
          },
        });
      } else {
        await prisma.meetingSummary.update({
          where: { meetingSessionId: sessionId },
          data: { summaryText: summary },
        });
      }

      await prisma.meetingSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.COMPLETED },
      });

      socket.emit("session_completed", {
        sessionId: sessionId,
        transcript: fullTranscript,
        summary: summary,
      });

      sessions.delete(sessionId);
    } catch (err) {
      console.error("[DB] Error stopping session:", err);
      socket.emit("session_error", {
        sessionId: sessionId,
        error: "Failed to stop session and generate summary.",
      });
    }
  });
});

// ─────────────────────────────────────────────
// Start HTTP server
// ─────────────────────────────────────────────
const PORT = Number(process.env.PORT || 4000);
httpServer.listen(PORT, () => {
  console.log(` Socket server running on ${PORT}`);
});
