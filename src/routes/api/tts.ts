import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

/** Streaming text-to-speech proxy for the reader's premium read-aloud voices. */
export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("TTS not configured", { status: 503 });

        let body: { text?: unknown; voice?: unknown; speed?: unknown; instructions?: unknown };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return new Response("Missing text", { status: 400 });
        const voice = typeof body.voice === "string" && body.voice ? body.voice : "alloy";
        const speed =
          typeof body.speed === "number" && body.speed >= 0.25 && body.speed <= 4 ? body.speed : 1;

        const instructions =
          typeof body.instructions === "string" && body.instructions.trim()
            ? body.instructions.slice(0, 600)
            : "Read this book passage aloud as a warm, natural audiobook narrator. Relaxed pacing, gentle expression, clear diction.";
        const input = text.slice(0, 4000);
        // "g-<VoiceName>" selects a Gemini studio voice; anything else is an OpenAI voice.
        const studio = voice.startsWith("g-");
        const payload = studio
          ? {
              model: "google/gemini-2.5-flash-tts",
              stream_format: "sse",
              contents: [{ role: "user", parts: [{ text: `${instructions}\n\n${input}` }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.slice(2) } },
                },
              },
            }
          : {
              model: "openai/gpt-4o-mini-tts",
              input,
              voice,
              speed,
              stream_format: "sse",
              response_format: "pcm",
              instructions,
            };

        try {
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: request.signal,
          });


          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => "");
            console.error(`TTS gateway failed [${upstream.status}]: ${detail}`);
            return new Response(detail || "TTS failed", { status: upstream.status });
          }

          return new Response(upstream.body, {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
          });
        } catch (err) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          throw err;
        }
      },
    },
  },
});
