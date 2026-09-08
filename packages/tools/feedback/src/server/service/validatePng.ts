import { PNG } from "pngjs";

// Bound decoding before allocating pixel buffers. Canvas PNGs are non-interlaced.
const MAX_PIXELS = 16_777_216;
export function validatePng(
  bytes: Buffer,
  width: number,
  height: number,
): void {
  if (
    bytes.length < 33 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("Invalid PNG header.");
  if (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height)
    throw new Error("PNG dimensions do not match capture dimensions.");
  if (width * height > MAX_PIXELS || bytes[28] !== 0)
    throw new Error(
      "Screenshots must be non-interlaced PNGs of at most 16777216 pixels.",
    );
  // Require complete chunks and terminal IEND; then decode pixels and check CRCs.
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const next = offset + length + 12;
    if (next > bytes.length) throw new Error("Truncated PNG chunk.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR" && offset !== 8)
      throw new Error("PNG contains multiple headers.");
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.length)
        throw new Error("Invalid PNG end chunk.");
      ended = true;
      break;
    }
    offset = next;
  }
  if (!ended) throw new Error("PNG is missing its end chunk.");
  try {
    PNG.sync.read(bytes, { checkCRC: true });
  } catch (error) {
    throw new Error("PNG pixels could not be decoded.", { cause: error });
  }
}
