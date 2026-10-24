"use client";

import { A4PrintHeader } from "./A4PrintHeader";

type Props = { style?: React.CSSProperties; variant?: "default" | "challan" | "invoice" | "thermal" };

/** Shared scalable letterhead for all documents and thermal receipts. */
export function PrintHeader({ style, variant = "default" }: Props = {}) {
  if (variant === "default") return <A4PrintHeader style={style} />;
  const thermal = variant === "thermal";
  const height = thermal ? 170 : 152;
  return <div className="business-print-header" style={{ width: "100%", marginBottom: 10, flexShrink: 0, breakInside: "avoid", background: "#fff", ...style }}>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={"0 0 700 " + height} role="img" aria-label="S.S. Diagnostics letterhead with Quetta address and contact details" style={{ display: "block", width: "100%", height: "auto" }}>
      <rect width="700" height={height} fill="#fff" />
      <g transform="translate(0 10) scale(1.3)">
        <path d="M50 7 94 88H6Z" fill="#effbfc" stroke="#008ac4" strokeWidth="2.8" />
        <text x="50" y="58" textAnchor="middle" fill="#008ac4" fontFamily="Arial, Helvetica, sans-serif" fontSize="23" fontWeight="700">S.S.</text>
        <text x="50" y="76" textAnchor="middle" fill="#008ac4" fontFamily="Arial, Helvetica, sans-serif" fontSize="8.3" fontWeight="700" letterSpacing=".4">DIAGNOSTICS</text>
      </g>
      <g textAnchor="middle">
        <text x="440" y="42" fill="#000" fontFamily="Georgia, Times New Roman, serif" fontSize={thermal ? 38 : 34} fontWeight="700">S.S. DIAGNOSTICS</text>
        <g fill="#007db5" fontFamily="Arial, Helvetica, sans-serif" fontSize={thermal ? 18 : 13} fontWeight="700">
          <text x="440" y={thermal ? 74 : 68}>Dawn Medical Centre, Room No. 1, 1st Floor</text>
          <text x="440" y={thermal ? 100 : 87}>Jinnah Road, Quetta, Pakistan · Tel: +92-81-2836967</text>
          <text x="440" y={thermal ? 126 : 106}>Mob: 0333-7808836, 03342427408, 0345-8346536</text>
        </g>
      </g>
      <path d={"M0 " + (height - 2) + "H700"} stroke="#008ac4" strokeWidth="2" />
    </svg>
  </div>;
}
