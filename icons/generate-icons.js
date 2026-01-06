/**
 * Icon Generator for ElevenPage Reader
 * 
 * This script generates PNG icons for the Chrome extension.
 * Run with: node icons/generate-icons.js
 */

import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

// CRC32 implementation
function makeCRCTable() {
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}

const crcTable = makeCRCTable();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
  }
  return crc ^ 0xFFFFFFFF;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function isInSpeaker(x, y) {
  // Speaker body
  if (x >= 40 && x <= 55 && y >= 48 && y <= 80) return true;
  // Speaker cone (triangle)
  if (x >= 55 && x <= 70) {
    const progress = (x - 55) / 15;
    const topY = 48 - progress * 13;
    const bottomY = 80 + progress * 13;
    if (y >= topY && y <= bottomY) return true;
  }
  return false;
}

function isInWave(x, y, waveNum) {
  const cx = 70;
  const cy = 64;
  const innerRadius = waveNum === 1 ? 8 : 18;
  const outerRadius = waveNum === 1 ? 12 : 22;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  
  if (dist >= innerRadius && dist <= outerRadius) {
    const angle = Math.atan2(y - cy, x - cx);
    if (angle >= -Math.PI / 2.5 && angle <= Math.PI / 2.5) {
      return true;
    }
  }
  return false;
}

function createIconPNG(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(6, 9);   // color type (RGBA)
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter
  ihdrData.writeUInt8(0, 12);  // interlace
  
  const ihdr = createChunk('IHDR', ihdrData);
  
  // Generate pixel data
  const rawData = [];
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.47;
  const scale = size / 128;
  
  for (let y = 0; y < size; y++) {
    rawData.push(0); // filter byte (none)
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      
      if (dist <= radius) {
        // Map to 128x128 coordinate space
        const sx = x / scale;
        const sy = y / scale;
        
        if (isInSpeaker(sx, sy) || isInWave(sx, sy, 1) || isInWave(sx, sy, 2)) {
          // White for speaker/waves
          rawData.push(255, 255, 255, 255);
        } else {
          // Indigo background (#6366f1)
          rawData.push(99, 102, 241, 255);
        }
      } else {
        // Transparent outside circle
        rawData.push(0, 0, 0, 0);
      }
    }
  }
  
  const compressed = deflateSync(Buffer.from(rawData));
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Generate all icon sizes
const sizes = [16, 48, 128];

for (const size of sizes) {
  const png = createIconPNG(size);
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`Created icon${size}.png (${size}x${size})`);
}

console.log('\nAll icons generated successfully!');
console.log('Icons are located in the icons/ directory.');