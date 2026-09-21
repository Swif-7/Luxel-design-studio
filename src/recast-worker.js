// Recast 编码 worker：批量时每张图在这里解码、缩放、编码，主线程不卡。
import { encodeImage } from './recast-encode.js';

self.onmessage = async ({ data: { id, blob, options } }) => {
  try {
    const result = await encodeImage(blob, options);
    self.postMessage({ id, ok: true, ...result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error) });
  }
};
