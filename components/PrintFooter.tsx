"use client";

type Props = { style?: React.CSSProperties };

/** Shared print/PDF credit; business details appear in the header only. */
export function PrintFooter({ style }: Props = {}) {
  return (
    <div style={{ width: "100%", marginTop: 12, textAlign: "center", fontSize: 11,
      fontWeight: 600, color: "#000", flexShrink: 0, breakInside: "avoid", ...style }}>
      Software developed by AddsMint.com
    </div>
  );
}
