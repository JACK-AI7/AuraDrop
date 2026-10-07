// AuraDrop True Incremental Streaming SHA-256 Engine (FIPS 180-4 Standard)
// Zero RAM Accumulation — Hashes arbitrary multi-gigabyte streams chunk-by-chunk

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export class IncrementalSha256 {
  private h0 = 0x6a09e667;
  private h1 = 0xbb67ae85;
  private h2 = 0x3c6ef372;
  private h3 = 0xa54ff53a;
  private h4 = 0x510e527f;
  private h5 = 0x9b05688c;
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;

  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private totalBytes = 0;
  private w = new Uint32Array(64);
  private isFinalized = false;

  /**
   * Updates the running SHA-256 state with a new streaming chunk.
   * Does NOT buffer the chunk in memory.
   */
  public update(chunk: Uint8Array): this {
    if (this.isFinalized) {
      throw new Error('IncrementalSha256 already finalized');
    }

    let offset = 0;
    const len = chunk.byteLength;
    this.totalBytes += len;

    // Fill partial 64-byte block if buffer has pending bytes
    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength;
      if (len >= needed) {
        this.buffer.set(chunk.subarray(0, needed), this.bufferLength);
        this.processBlock(this.buffer, 0);
        offset += needed;
        this.bufferLength = 0;
      } else {
        this.buffer.set(chunk, this.bufferLength);
        this.bufferLength += len;
        return this;
      }
    }

    // Process all full 64-byte blocks directly from input chunk
    while (offset + 64 <= len) {
      this.processBlock(chunk, offset);
      offset += 64;
    }

    // Store remaining bytes into buffer (< 64 bytes)
    if (offset < len) {
      this.buffer.set(chunk.subarray(offset), 0);
      this.bufferLength = len - offset;
    }

    return this;
  }

  /**
   * Finalizes the SHA-256 calculation and returns the 64-character lowercase hex string.
   */
  public finalize(): string {
    if (this.isFinalized) {
      throw new Error('IncrementalSha256 already finalized');
    }
    this.isFinalized = true;

    // Standard SHA-256 padding: 0x80 byte, followed by zeros, followed by 64-bit length
    const totalBits = BigInt(this.totalBytes) * 8n;
    this.buffer[this.bufferLength++] = 0x80;

    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength, 64);
      this.processBlock(this.buffer, 0);
      this.bufferLength = 0;
    }

    this.buffer.fill(0, this.bufferLength, 56);

    // Append 64-bit Big-Endian length
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 64);
    view.setBigUint64(56, totalBits, false);
    this.processBlock(this.buffer, 0);

    const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
    return (
      toHex(this.h0) +
      toHex(this.h1) +
      toHex(this.h2) +
      toHex(this.h3) +
      toHex(this.h4) +
      toHex(this.h5) +
      toHex(this.h6) +
      toHex(this.h7)
    );
  }

  private processBlock(data: Uint8Array, offset: number): void {
    const view = new DataView(data.buffer, data.byteOffset + offset, 64);
    for (let i = 0; i < 16; i++) {
      this.w[i] = view.getUint32(i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(this.w[i - 15], 7) ^ rotr(this.w[i - 15], 18) ^ (this.w[i - 15] >>> 3);
      const s1 = rotr(this.w[i - 2], 17) ^ rotr(this.w[i - 2], 19) ^ (this.w[i - 2] >>> 10);
      this.w[i] = (this.w[i - 16] + s0 + this.w[i - 7] + s1) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + this.w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }
}
