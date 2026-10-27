/** Fill each sheet in order. If totals need another sheet, carry only the
 * final row with them when it fits, rather than emptying most of the last page. */
export function paginateInvoiceRows(heights: number[], capacity: number, summaryHeight: number): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  heights.forEach((size, index) => {
    if (used + size > capacity && pages.at(-1)!.length) {
      pages.push([]);
      used = 0;
    }
    pages.at(-1)!.push(index);
    used += size;
  });
  if (used + summaryHeight > capacity) {
    const tail = pages.at(-1)!;
    const last = tail.at(-1);
    // A tall continued text fragment may need a separate totals-only sheet.
    if (tail.length > 1 && last !== undefined && heights[last] + summaryHeight <= capacity) {
      tail.pop();
      pages.push([last]);
    } else {
      pages.push([]);
    }
  }
  return pages;
}
