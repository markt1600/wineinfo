import { ImageResponse } from "next/og";

// Link-preview card (WhatsApp, iMessage, Slack, X…): wine bottles + the
// app name on the brand gradient.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Wine (a)ID — snap a bottle, shelf, or menu; get prices, ratings and best value";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2b0a12 0%, #14040a 100%)",
          color: "#f5e9ec",
        }}
      >
        <div style={{ display: "flex", fontSize: 150, gap: 28 }}>
          🍾🍷🥂
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 100,
            fontWeight: 700,
            marginTop: 36,
            letterSpacing: -2,
          }}
        >
          <span>Wine&nbsp;</span>
          <span style={{ color: "#e0526e" }}>(a)ID</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            color: "#c9a3ad",
            marginTop: 24,
          }}
        >
          Snap a bottle, shelf, or menu — prices, ratings & best value
        </div>
      </div>
    ),
    { ...size, emoji: "twemoji" }
  );
}
