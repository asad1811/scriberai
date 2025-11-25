# scriberai
https://drive.google.com/file/d/1F_L6R9BDqOmLVmZlkpHY8gXI27KbmEqO/view?usp=sharing
Check this link for the walkthrough of the app or download "walkthrough.mp4" directly from the repository.
In this project, I built a real-time meeting transcription and summarization system that handles audio capture, streaming, transcription, and post-processing end to end. I structured the system so it can capture audio either from the microphone or from a shared browser tab, using MediaRecorder on the frontend to produce small chunks. These chunks are streamed to the backend using Socket.io, which manages the full session flow—start, pause, resume, audio_chunk processing, and stop. On the server, I maintain per-session in-memory state, including batching buffers, user information, source mode, and transcript indexing. Once batches are processed, I store transcript chunks and final summaries using Prisma models for sessions, chunks, and summaries.

A large part of my work focused on demonstrating “media handling depth.” I implemented adaptive chunk batching, allowing batch sizes to expand or shrink based on Gemini latency and backpressure signals. I added a ring buffer to ensure raw audio is stored safely without unbounded memory growth, and I introduced a bounded backpressure-aware queue to keep the system stable when inbound audio exceeds processing capacity. I also refined tab-audio handling by validating audio tracks, detecting tab-end events, and falling back to the microphone when necessary.

To make the system observable, I incorporated an optional diagnostics overlay that surfaces key metrics such as current batch size, Gemini latency, pending batches, ring-buffer overflow status, and reconnection events. These combined choices reflect deliberate architectural decisions optimized for long-duration streaming and stable transcription. Enter npm run dev from root folder to run both the frontend and backend together.

# Architecture Diagram (Mermaid)
    
    A[Start Session] --> B[MediaRecorder Captures Chunks]
    B --> C[Socket.io Streams Chunks to Server]
    C --> D[Adaptive 15–45s Batch Aggregation]
    D --> E[Ring Buffer + Backpressure Queue]
    E --> F[Gemini Transcription per Batch]
    F --> G[Store Transcript Chunks in Postgres via Prisma]
    G --> H[Stop Session Trigger]
    H --> I[Aggregate Full Transcript]
    I --> J[Gemini Summary Generation]
    J --> K[Store Summary in Database]
    K --> L[Emit 'Completed' to Frontend]
    L --> M[Display Live Transcript + Summary]

    
# Latency
Low; real-time incremental 


# Reliability
Adaptive batching + ring buffer + backpressure queue


# Error Handling
Fine-grained (dropped batches, reconnects, fallback)


# Scalability
Bounded memory + adaptive load


# User Feedback
Live transcripts + diagnostics


