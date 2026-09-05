import QRCode from "qrcode";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = concatBytes([typeBytes, data]);
  return concatBytes([uint32(data.byteLength), body, uint32(crc32(body))]);
}

function adler32(input: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of input) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Minimal zlib stream using DEFLATE stored blocks, supported in every Edge runtime. */
function zlibStore(input: Uint8Array): Uint8Array {
  const blockCount = Math.ceil(input.byteLength / 65535);
  const output = new Uint8Array(2 + input.byteLength + blockCount * 5 + 4);
  let sourceOffset = 0;
  let targetOffset = 0;
  output[targetOffset++] = 0x78;
  output[targetOffset++] = 0x01;
  while (sourceOffset < input.byteLength) {
    const length = Math.min(65535, input.byteLength - sourceOffset);
    const final = sourceOffset + length === input.byteLength;
    output[targetOffset++] = final ? 0x01 : 0x00;
    output[targetOffset++] = length & 0xff;
    output[targetOffset++] = (length >>> 8) & 0xff;
    const complement = (~length) & 0xffff;
    output[targetOffset++] = complement & 0xff;
    output[targetOffset++] = (complement >>> 8) & 0xff;
    output.set(input.subarray(sourceOffset, sourceOffset + length), targetOffset);
    sourceOffset += length;
    targetOffset += length;
  }
  output.set(uint32(adler32(input)), targetOffset);
  return output;
}

/** Render an 8-bit grayscale PNG without Canvas, Node streams, Buffer, or fs. */
export function renderQrisPng(payload: string, requestedWidth = 420, marginModules = 2): Uint8Array {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const moduleCount = qr.modules.size;
  const scale = Math.max(1, Math.floor(requestedWidth / (moduleCount + marginModules * 2)));
  const width = (moduleCount + marginModules * 2) * scale;
  const stride = width + 1;
  const raw = new Uint8Array(stride * width);
  raw.fill(255);

  for (let y = 0; y < width; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0; // PNG filter: None
    const moduleY = Math.floor(y / scale) - marginModules;
    for (let x = 0; x < width; x++) {
      const moduleX = Math.floor(x / scale) - marginModules;
      const dark = moduleX >= 0
        && moduleY >= 0
        && moduleX < moduleCount
        && moduleY < moduleCount
        && Boolean(qr.modules.get(moduleY, moduleX));
      raw[rowOffset + x + 1] = dark ? 0 : 255;
    }
  }

  const header = new Uint8Array(13);
  header.set(uint32(width), 0);
  header.set(uint32(width), 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}
