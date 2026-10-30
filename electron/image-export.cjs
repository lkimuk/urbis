const fs = require('node:fs/promises');
const path = require('node:path');
const { AtlasError } = require('./errors.cjs');
const PNG_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PIXELS = 64 * 1024 * 1024;

function decodePng(dataURL) {
  if (
    typeof dataURL !== 'string' ||
    dataURL.length > 100 * 1024 * 1024 ||
    !dataURL.startsWith(PNG_PREFIX)
  ) {
    throw new AtlasError('INVALID_IMAGE', '无效的 PNG 图片');
  }
  const encoded = dataURL.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new AtlasError('INVALID_IMAGE', '图片编码无效');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (
    buffer.length < 33 ||
    !buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new AtlasError('INVALID_IMAGE', '图片不是有效的 PNG 文件');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width * height > MAX_PIXELS) {
    throw new AtlasError('IMAGE_TOO_LARGE', '图片尺寸过大，请降低导出精度');
  }
  return { buffer, width, height };
}

function pngFilename(value) {
  const name = typeof value === 'string' ? value : '城市地图';
  const forbidden = new Set('<>:"/\\|?*');
  let stem = Array.from(name, (char) =>
    char.charCodeAt(0) < 32 || forbidden.has(char) ? '_' : char,
  )
    .slice(0, 90)
    .join('')
    .replace(/[. ]+$/g, '');
  if (!stem) stem = '城市地图';
  if (
    [
      'con',
      'prn',
      'aux',
      'nul',
      ...Array.from({ length: 9 }, (_, i) => 'com' + (i + 1)),
      ...Array.from({ length: 9 }, (_, i) => 'lpt' + (i + 1)),
    ].includes(stem.split('.')[0].toLowerCase())
  )
    stem = '_' + stem;
  return stem + '.png';
}

function createImageExporter({ nativeImage, choosePath, writeFile = fs.writeFile }) {
  let saving = false;
  return async function savePng(payload) {
    if (saving) throw new AtlasError('EXPORT_BUSY', '请先完成当前图片保存');
    saving = true;
    try {
      const { buffer, width, height } = decodePng(payload?.dataURL);
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty() || image.getSize().width !== width || image.getSize().height !== height) {
        throw new AtlasError('INVALID_IMAGE', 'PNG 图片无法解码');
      }
      let filePath = await choosePath(pngFilename(payload.filename));
      if (!filePath) return { canceled: true };
      if (!filePath.toLowerCase().endsWith('.png')) filePath += '.png';
      try {
        await writeFile(filePath, buffer);
      } catch {
        throw new AtlasError('SAVE_FAILED', '无法保存图片，请检查目标目录是否可写');
      }
      return { canceled: false, filePath: path.resolve(filePath), size: { width, height } };
    } finally {
      saving = false;
    }
  };
}

module.exports = { decodePng, pngFilename, createImageExporter };
