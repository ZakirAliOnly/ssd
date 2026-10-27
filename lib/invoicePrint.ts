import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { waitForPrintFonts } from "@/lib/printReadiness";
import { paginateInvoiceRows } from "@/lib/invoicePagination";

// A5 portrait invoice sheet. Keep in sync with
// invoice-print.css; browser/PDF checks verify the physical page dimensions.
export const INVOICE_PAPER_MM = { width: 148, height: 210, padding: 10, topPadding: 15 } as const;
const MM = 96 / 25.4;
const height = (node: Element) => node.getBoundingClientRect().height;

/** Put the summary with the last rows whenever possible; never split a row or
 * a totals block across sheets. Every fragment is measured at the print width. */
function splitTallRow(row: HTMLTableRowElement, capacity: number): HTMLTableRowElement[] {
  if (height(row) <= capacity) return [row.cloneNode(true) as HTMLTableRowElement];
  const cells = [...row.cells];
  const remaining = cells.map(cell => cell.hasAttribute("data-fragment-text") ? cell.textContent || "" : "");
  if (!remaining.some(Boolean)) throw new Error("An invoice row is too tall to print. Review its content.");
  const result: HTMLTableRowElement[] = [];
  const probe = row.cloneNode(true) as HTMLTableRowElement;
  row.parentElement!.appendChild(probe);
  const prefix = (text: string, count: number) => {
    if (text.length <= count) return text;
    const chunk = text.slice(0, count), space = chunk.lastIndexOf(" ");
    return space > 0 ? chunk.slice(0, space + 1) : chunk;
  };
  try {
    while (remaining.some(Boolean)) {
      const render = (count: number) => {
        const pieces = remaining.map(text => prefix(text, count));
        [...probe.cells].forEach((cell, i) => {
          if (cells[i].hasAttribute("data-fragment-text")) cell.textContent = pieces[i];
          else if (result.length) cell.textContent = "";
        });
        if (result.length && !cells[0].hasAttribute("data-fragment-text")) probe.cells[0].textContent = "cont.";
        return pieces;
      };
      let low = 1, high = Math.max(...remaining.map(text => text.length)), best = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2); render(mid);
        if (height(probe) <= capacity) { best = mid; low = mid + 1; } else high = mid - 1;
      }
      if (!best) throw new Error("An invoice row cannot fit on A5 paper. Review its content.");
      const pieces = render(best);
      result.push(probe.cloneNode(true) as HTMLTableRowElement);
      pieces.forEach((piece, i) => { remaining[i] = remaining[i].slice(piece.length); });
    }
  } finally { probe.remove(); }
  return result;
}

/** Must finish before window.print(). Restores the caller's exact inline style,
 * including on errors; no financial records or application settings are touched. */
export async function prepareInvoiceDocument(root: HTMLElement): Promise<HTMLElement[]> {
  await waitForPrintFonts(document.fonts.ready);
  const originalStyle = root.getAttribute("style");
  const documents = [...root.querySelectorAll<HTMLElement>(".invoice-document")];
  if (!documents.length) throw new Error("Invoice print template not found.");
  root.style.setProperty("display", "block", "important");
  Object.assign(root.style, { position: "fixed", top: "0", left: "-20000px", width: `${INVOICE_PAPER_MM.width}mm`, maxWidth: "none" });
  try {
    const sheets: HTMLElement[] = [];
    for (const doc of documents) {
      doc.classList.add("invoice-measuring");
      try {
        const source = doc.querySelector<HTMLElement>(".invoice-source")!;
        const header = source.querySelector<HTMLElement>(".invoice-page-header")!;
        const footer = source.querySelector<HTMLElement>(".invoice-page-footer")!;
        const summary = source.querySelector<HTMLElement>(".invoice-totals")!;
        const table = source.querySelector<HTMLTableElement>("table")!;
        // Footer has a 5px margin in addition to its measured border/padding.
        // A small safety allowance absorbs fractional CSS/physical pixel rounding.
        const capacity = (INVOICE_PAPER_MM.height - INVOICE_PAPER_MM.topPadding - INVOICE_PAPER_MM.padding) * MM - height(header) - height(footer) - 5 - height(table.tHead!) - 5;
        const summaryHeight = height(summary);
        if (capacity < 40 || summaryHeight > capacity) throw new Error("Invoice header or totals exceed A5 page space. Shorten the document details.");
        const rows = [...table.tBodies[0].rows].flatMap(row => splitTallRow(row, capacity));
        const measure = (row: HTMLTableRowElement) => {
          table.tBodies[0].appendChild(row); const result = height(row); row.remove(); return result;
        };
        const sizes = rows.map(measure);
        const pages = paginateInvoiceRows(sizes, capacity, summaryHeight)
          .map(indices => indices.map(index => rows[index]));
        const host = doc.querySelector<HTMLElement>(".invoice-pages")!;
        host.replaceChildren();
        pages.forEach((pageRows, i) => {
          const sheet = document.createElement("section"); sheet.className = "invoice-sheet";
          sheet.dataset.page = String(i + 1);
          const body = document.createElement("div"); body.className = "invoice-page-body";
          const pageTable = table.cloneNode(false) as HTMLTableElement;
          pageTable.appendChild(table.querySelector("colgroup")!.cloneNode(true));
          pageTable.appendChild(table.tHead!.cloneNode(true));
          const tbody = document.createElement("tbody");
          pageRows.forEach(row => tbody.appendChild(row)); pageTable.appendChild(tbody); body.appendChild(pageTable);
          if (i === pages.length - 1) body.appendChild(summary.cloneNode(true));
          const pageFooter = footer.cloneNode(true) as HTMLElement;
          pageFooter.querySelector("[data-page-number]")!.textContent = `Page ${i + 1} of ${pages.length}`;
          sheet.append(header.cloneNode(true), body, pageFooter); host.appendChild(sheet); sheets.push(sheet);
        });
      } finally { doc.classList.remove("invoice-measuring"); }
    }
    return sheets;
  } finally {
    if (originalStyle == null) root.removeAttribute("style"); else root.setAttribute("style", originalStyle);
  }
}

export async function invoicePdfBlob(root: HTMLElement): Promise<Blob> {
  const sheets = await prepareInvoiceDocument(root);
  const originalStyle = root.getAttribute("style");
  root.style.setProperty("display", "block", "important");
  Object.assign(root.style, { position: "fixed", top: "0", left: "-20000px", width: `${INVOICE_PAPER_MM.width}mm`, maxWidth: "none" });
  try {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [INVOICE_PAPER_MM.width, INVOICE_PAPER_MM.height], compress: true });
    const metricsStyle = document.createElement("style");
    metricsStyle.id = "__invoice_pdf_metrics";
    metricsStyle.textContent = "body > div > img { display: inline !important; }";
    document.head.appendChild(metricsStyle);
    for (const [i, sheet] of sheets.entries()) {
      const canvas = await html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, INVOICE_PAPER_MM.width, INVOICE_PAPER_MM.height, undefined, "FAST");
    }
    return pdf.output("blob");
  } finally {
    if (originalStyle == null) root.removeAttribute("style"); else root.setAttribute("style", originalStyle);
  }
}

export async function saveInvoicePdf(root: HTMLElement, filename: string) {
  const url = URL.createObjectURL(await invoicePdfBlob(root));
  try {
    const link = document.createElement("a"); link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
  } finally { URL.revokeObjectURL(url); }
}
