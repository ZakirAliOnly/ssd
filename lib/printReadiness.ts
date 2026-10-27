/** Bound asynchronous preparation so a stalled request cannot lock print controls. */
export async function withPrintTimeout<T>(work: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Print preparation timed out. Check your connection and try again.")), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Printing can use fallback fonts when a web font never finishes downloading. */
export async function waitForPrintFonts(ready: Promise<unknown>) {
  await withPrintTimeout(ready, 2_000).catch(() => undefined);
}
