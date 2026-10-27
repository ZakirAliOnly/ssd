"use client";

type Props = { style?: React.CSSProperties };

/** Original colorful A4 letterhead, kept separate from compact invoice/receipt headers. */
export function A4PrintHeader({ style }: Props = {}) {
  return (
    <div className="business-print-header" style={{ width: "100%", marginBottom: 10, flexShrink: 0,
      containerType: "inline-size", breakInside: "avoid", background: "#fff", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0 10px",
        borderBottom: "2px solid #0284c7", color: "#0369a1", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="S.S. Diagnostics logo"
          style={{ width: "clamp(56px, 14cqw, 95px)", height: "auto", aspectRatio: "1", flexShrink: 0 }}>
          <path d="M50 7 94 88H6Z" fill="#f0f9ff" stroke="#0284c7" strokeWidth="2.8" />
          <text x="50" y="58" textAnchor="middle" fill="#0284c7" fontFamily="Arial, sans-serif" fontSize="23" fontWeight="700">S.S.</text>
          <text x="50" y="76" textAnchor="middle" fill="#0284c7" fontFamily="Arial, sans-serif" fontSize="8.3" fontWeight="700" letterSpacing=".4">DIAGNOSTICS</text>
        </svg>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: "clamp(8px, 1.9cqw, 13px)", fontWeight: 600, lineHeight: 1.45 }}>
          <div style={{ fontFamily: "Georgia, Times New Roman, serif", color: "#111", fontSize: "clamp(18px, 4.5cqw, 30px)", fontWeight: 700, lineHeight: 1.15, marginBottom: 5 }}>S.S. DIAGNOSTICS</div>
          <div>Dawn Medical Centre, Room No. 1, 1st Floor</div>
          <div>Jinnah Road, Quetta, Pakistan · Tel: +92-81-2836967</div>
          <div>Mob: 0333-7808836, 0334-2247408, 0345-8346536</div>
        </div>
      </div>
    </div>
  );
}
