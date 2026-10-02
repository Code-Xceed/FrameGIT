/**
 * FrameGit Premiere Pro UXP Plugin Packager (.ccx)
 * 
 * Generates Adobe UXP manifest v5 compliant icons and bundles
 * plugin/premiere/* into a distributable FrameGit-Premiere.ccx package.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { ZipUtil } = require('../core/zip_util');
const { wrapFsOperation } = require('../core/errors');

/**
 * IEEE 802.3 CRC32 calculation for PNG chunks.
 */
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
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

/**
 * Generate a valid RGBA PNG icon in pure Node.js without external dependencies.
 * Renders FrameGit brand colors: Dark slate background with a vibrant cyan "F" badge.
 * @param {number} size Width & Height in pixels
 * @returns {Buffer} Valid PNG file buffer
 */
function createPngIcon(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // 1. IHDR Chunk (13 bytes payload)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData.writeUInt8(8, 8);        // bit depth (8 bits per channel)
  ihdrData.writeUInt8(6, 9);        // color type (RGBA)
  ihdrData.writeUInt8(0, 10);       // compression method
  ihdrData.writeUInt8(0, 11);       // filter method
  ihdrData.writeUInt8(0, 12);       // interlace method

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // 2. Raw uncompressed pixel buffer with filter byte per scanline
  const rawScanlines = [];
  const radius = size * 0.45;
  const centerX = size / 2;
  const centerY = size / 2;

  for (let y = 0; y < size; y++) {
    const scanline = Buffer.alloc(1 + size * 4);
    scanline[0] = 0; // Filter type 0: None

    for (let x = 0; x < size; x++) {
      const pixelOffset = 1 + (x * 4);
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Icon Design: Rounded FrameGit logo badge
      if (dist <= radius) {
        // Cyan badge (#00d2ff -> 0, 210, 255) with inner 'F' mark
        const relX = x / size;
        const relY = y / size;
        const isFVertical = (relX >= 0.35 && relX <= 0.48 && relY >= 0.25 && relY <= 0.75);
        const isFTopBar = (relX >= 0.35 && relX <= 0.72 && relY >= 0.25 && relY <= 0.38);
        const isFMidBar = (relX >= 0.35 && relX <= 0.62 && relY >= 0.45 && relY <= 0.55);

        if (isFVertical || isFTopBar || isFMidBar) {
          // White symbol
          scanline[pixelOffset] = 255;
          scanline[pixelOffset + 1] = 255;
          scanline[pixelOffset + 2] = 255;
          scanline[pixelOffset + 3] = 255;
        } else {
          // FrameGit gradient cyan/indigo
          scanline[pixelOffset] = 14;     // R: #0ea5e9
          scanline[pixelOffset + 1] = 165;
          scanline[pixelOffset + 2] = 233;
          scanline[pixelOffset + 3] = 255;
        }
      } else {
        // Transparent border
        scanline[pixelOffset] = 0;
        scanline[pixelOffset + 1] = 0;
        scanline[pixelOffset + 2] = 0;
        scanline[pixelOffset + 3] = 0;
      }
    }
    rawScanlines.push(scanline);
  }

  // 3. IDAT Chunk (Compressed image data)
  const idatCompressed = zlib.deflateSync(Buffer.concat(rawScanlines));
  const idatChunk = createChunk('IDAT', idatCompressed);

  // 4. IEND Chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

/**
 * Main packager function: compiles plugin into .ccx bundle.
 */
function buildUxpCcx(pluginDir, outputCcxPath) {
  const iconsDir = path.join(pluginDir, 'icons');
  if (!fs.existsSync(iconsDir)) {
    wrapFsOperation(() => fs.mkdirSync(iconsDir, { recursive: true }), iconsDir, 'mkdir');
  }

  // Ensure icons exist (24, 48, 96)
  const iconSizes = [24, 48, 96];
  for (const sz of iconSizes) {
    const iconFile = path.join(iconsDir, `icon-${sz}.png`);
    if (!fs.existsSync(iconFile)) {
      const pngBuf = createPngIcon(sz);
      wrapFsOperation(() => fs.writeFileSync(iconFile, pngBuf), iconFile, 'write');
    }
  }

  // Update manifest.json with icon entries
  const manifestPath = path.join(pluginDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.icons = [
      { width: 24, height: 24, path: "icons/icon-24.png", scale: [1, 2] },
      { width: 48, height: 48, path: "icons/icon-48.png", scale: [1, 2] },
      { width: 96, height: 96, path: "icons/icon-96.png", scale: [1, 2] }
    ];
    if (manifest.entrypoints && manifest.entrypoints[0]) {
      manifest.entrypoints[0].icons = [
        { width: 24, height: 24, path: "icons/icon-24.png" }
      ];
    }
    wrapFsOperation(() => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)), manifestPath, 'write');
  }

  // Collect files to package
  const fileMap = new Map();
  function collect(dir, base = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = base ? `${base}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        collect(full, rel);
      } else if (ent.isFile()) {
        fileMap.set(rel, fs.readFileSync(full));
      }
    }
  }
  collect(pluginDir);

  // Pack into ZIP buffer (.ccx)
  const ccxBuffer = ZipUtil.pack(fileMap);

  const outDir = path.dirname(outputCcxPath);
  if (!fs.existsSync(outDir)) {
    wrapFsOperation(() => fs.mkdirSync(outDir, { recursive: true }), outDir, 'mkdir');
  }
  wrapFsOperation(() => fs.writeFileSync(outputCcxPath, ccxBuffer), outputCcxPath, 'write');

  return {
    totalFiles: fileMap.size,
    packageSizeBytes: ccxBuffer.length,
    outputPath: outputCcxPath
  };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const pluginDir = path.join(root, 'plugin', 'premiere');
  const outPath = path.join(root, 'dist', 'FrameGit-Premiere.ccx');
  const res = buildUxpCcx(pluginDir, outPath);
  console.log(`Successfully built UXP package: ${res.outputPath} (${(res.packageSizeBytes / 1024).toFixed(1)} KB, ${res.totalFiles} files)`);
}

module.exports = {
  buildUxpCcx,
  createPngIcon
};
