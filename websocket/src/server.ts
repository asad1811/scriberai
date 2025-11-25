async function transcribeChunk(audio: Buffer): Promise<string | null> {
  if (!transcriptionModel) return "(Gemini unavailable)";

  try {
    const base64 = audio.toString("base64");

    const diarizationPrompt = `
You are a transcription engine with speaker diarization.
Return ONLY the raw transcript with speaker labels.

Strict rules:
- Use "Speaker 1:", "Speaker 2:", etc. for each turn.
- If unsure who is speaking, label as "Speaker ?:".
- Do NOT hallucinate new content or rewrite phrasing.
- Preserve filler words and natural speech.
- Keep the output concise and chronological.
- Do NOT add summaries or explanations.
`;

    const result = await transcriptionModel.generateContent([
      {
        inlineData: { data: base64, mimeType: "audio/webm" },
      },
      {
        text: diarizationPrompt,
      }
    ]);

    const text = result.response.text().trim();
    return text.length > 0 ? text : null;

  } catch (err) {
    console.error("[Gemini] Transcription (diarization) error:", err);
    return null;
  }
}
