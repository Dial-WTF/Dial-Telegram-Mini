import { formatCaption } from "#/lib/format";

/**
 * Build QR code and message components for a payment request
 * @param baseUrl - Base URL for the application
 * @param id - Request ID
 * @param ethUri - Optional ethereum: URI for direct wallet payment
 * @param ethWei - Amount in wei (bigint)
 * @param note - Optional note/memo
 * @returns QR URL, caption, keyboard, and payment URL
 */
export function buildQrForRequest(
  baseUrl: string,
  id: string,
  ethUri: string | undefined,
  ethWei: bigint,
  note: string
) {
  const base = (baseUrl || "").replace(/\/$/, "");
  const payUrl = `${base}/pay/${id}`;
  const scanUrl = `https://scan.request.network/request/${id}`;
  const qrPayload = ethUri || payUrl;
  const qrApi = `${base}/api/qr`;
  const qrUrl = `${qrApi}?size=720&data=${encodeURIComponent(qrPayload)}&logo=/phone-logo-no-bg.png&bg=%23F8F6FF&grad1=%237C3AED&grad2=%23C026D3&footerH=180&wordmark=/Dial.letters.transparent.bg.crop.png`;
  const caption = formatCaption(ethWei, note);
  const topRow: any[] = [{ text: "Open invoice", url: payUrl }];
  if (ethUri)
    topRow.push({
      text: "Pay in wallet",
      url: `${base}/paylink?uri=${encodeURIComponent(ethUri)}`,
    });
  const scanRow: any[] = [{ text: "View on Request Scan", url: scanUrl }];
  const statusRow: any[] = [{ text: "Status: ❌ Unpaid", callback_data: "sr" }];
  const keyboard = { inline_keyboard: [topRow, scanRow, statusRow] } as any;
  return { qrUrl, caption, keyboard, payUrl };
}
