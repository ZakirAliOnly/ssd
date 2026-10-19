/** Save actions suppress their old popup when automation is on; manual buttons stay intact. */
export async function hasWhatsAppAutomation(kind: "payment_received" | "supplier_payment") {
  try {
    const response = await fetch("/api/whatsapp/automation", { cache: "no-store" });
    if (!response.ok) return false;
    return (await response.json())[kind] === true;
  } catch { return false; }
}
