// FrameGit Core - Zero-Dependency ZIP Reader and Writer
// Specifically handles DaVinci Resolve (.drp) archives (Deflate / Stored files)
const zlib = require('node:zlib');

class ZipUtil {
  /**
   * Unpack a ZIP archive buffer into a Map of relativePath -> Buffer.
   * @param {Buffer} buffer 
   * @returns {Map<string, Buffer>}
   */
  static unpack(buffer) {
    const files = new Map();
    let offset = 0;

    while (offset < buffer.length - 4) {
      const sig = buffer.readUInt32LE(offset);
      // Local file header signature: 0x04034b50 ("PK\x03\x04")
      if (sig !== 0x04034b50) {
        break; // Stop at central directory
      }

      const method = buffer.readUInt16LE(offset + 8); // 0 = stored, 8 = deflated
      const compSize = buffer.readUInt32LE(offset + 18);
      const uncompSize = buffer.readUInt32LE(offset + 22);
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);

      const fileName = buffer.toString('utf-8', offset + 30, offset + 30 + nameLen);
      const dataStart = offset + 30 + nameLen + extraLen;
      const compData = buffer.subarray(dataStart, dataStart + compSize);

      let fileData;
      if (method === 8) {
        fileData = zlib.inflateRawSync(compData);
      } else {
        fileData = compData;
      }

      if (!fileName.endsWith('/')) {
        files.set(fileName.replace(/\\/g, '/'), fileData);
      }

      offset = dataStart + compSize;
    }

    return files;
  }

  /**
   * Pack a Map of relativePath -> Buffer into a standard ZIP archive buffer.
   * @param {Map<string, Buffer|string>} fileMap 
   * @returns {Buffer}
   */
  static pack(fileMap) {
    const localHeaders = [];
    const centralHeaders = [];
    let currentOffset = 0;

    for (const [rawPath, rawContent] of fileMap.entries()) {
      const filePath = rawPath.replace(/\\/g, '/');
      const uncompData = Buffer.isBuffer(rawContent) ? rawContent : Buffer.from(rawContent, 'utf-8');
      const compData = zlib.deflateRawSync(uncompData);
      const nameBuf = Buffer.from(filePath, 'utf-8');

      const crc = crc32(uncompData);

      // Local Header (30B + nameLen)
      const lh = Buffer.alloc(30 + nameBuf.length);
      lh.writeUInt32LE(0x04034b50, 0); // Sig
      lh.writeUInt16LE(20, 4);         // Version needed
      lh.writeUInt16LE(0, 6);          // Flags
      lh.writeUInt16LE(8, 8);          // Method (Deflate)
      lh.writeUInt16LE(0, 10);         // Mod time
      lh.writeUInt16LE(0, 12);         // Mod date
      lh.writeUInt32LE(crc, 14);       // CRC32
      lh.writeUInt32LE(compData.length, 18);   // Comp size
      lh.writeUInt32LE(uncompData.length, 22); // Uncomp size
      lh.writeUInt16LE(nameBuf.length, 26);    // Name len
      lh.writeUInt16LE(0, 28);                 // Extra len
      nameBuf.copy(lh, 30);

      localHeaders.push(lh, compData);

      // Central Directory Header (46B + nameLen)
      const ch = Buffer.alloc(46 + nameBuf.length);
      ch.writeUInt32LE(0x02014b50, 0); // Sig
      ch.writeUInt16LE(20, 4);         // Version made by
      ch.writeUInt16LE(20, 6);         // Version needed
      ch.writeUInt16LE(0, 8);          // Flags
      ch.writeUInt16LE(8, 10);         // Method (Deflate)
      ch.writeUInt16LE(0, 12);         // Mod time
      ch.writeUInt16LE(0, 14);         // Mod date
      ch.writeUInt32LE(crc, 16);       // CRC32
      ch.writeUInt32LE(compData.length, 20);   // Comp size
      ch.writeUInt32LE(uncompData.length, 24); // Uncomp size
      ch.writeUInt16LE(nameBuf.length, 28);    // Name len
      ch.writeUInt16LE(0, 30);                 // Extra len
      ch.writeUInt16LE(0, 32);                 // Comment len
      ch.writeUInt16LE(0, 34);                 // Disk start
      ch.writeUInt16LE(0, 36);                 // Internal attr
      ch.writeUInt32LE(0, 38);                 // External attr
      ch.writeUInt32LE(currentOffset, 42);     // Offset of local header
      nameBuf.copy(ch, 46);

      centralHeaders.push(ch);
      currentOffset += lh.length + compData.length;
    }

    const centralDirBuffer = Buffer.concat(centralHeaders);

    // End of Central Directory Record (22B)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // Sig
    eocd.writeUInt16LE(0, 4);          // Disk num
    eocd.writeUInt16LE(0, 6);          // Start disk
    eocd.writeUInt16LE(fileMap.size, 8); // Entries on this disk
    eocd.writeUInt16LE(fileMap.size, 10); // Total entries
    eocd.writeUInt32LE(centralDirBuffer.length, 12); // Central dir size
    eocd.writeUInt32LE(currentOffset, 16);           // Offset of central dir
    eocd.writeUInt16LE(0, 20);                       // Comment len

    return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
  }
}

/**
 * Standard IEEE 802.3 CRC-32 checksum calculation.
 */
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

module.exports = { ZipUtil };
