import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // adjust path if needed

export async function GET() {
  try {
    const sessions = await prisma.meetingSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      include: {
        summary: true,
        transcript: {
          orderBy: { index: "asc" },
          take: 1, // ONE chunk only → minimal preview
        },
      },
    });

    const mapped = sessions.map((s) => ({
      id: s.id,
      createdAt: s.startedAt.toISOString(),
      mode: "meeting", // minimal placeholder
      summary: s.summary ? s.summary.summaryText : null,
      transcriptPreview: s.transcript[0]?.text ?? null,
    }));

    return NextResponse.json({ sessions: mapped });
  } catch (err) {
    console.error("Error loading sessions:", err);
    return NextResponse.json({ sessions: [] }, { status: 500 });
  }
}
