import { encode } from "uqr";

/**
 * A QR code drawn by the website's server: one SVG path of dark squares on a
 * `size` x `size` grid (quiet zone included). No third-party service or script
 * sees the text it holds.
 */
export function qrCode(text: string) {
  const qr = encode(text, { ecc: "M", border: 4 });
  const size = qr.data.length;
  let path = "";
  qr.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    })
  );
  return { size, path };
}

/** The same QR code as a stand-alone SVG file (black on white, 10 px a square). */
export function qrCodeSvg(text: string) {
  const { size, path } = qrCode(text);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 10}" height="${size * 10}" ` +
    `viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  );
}
