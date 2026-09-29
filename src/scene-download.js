export function describeLoadError(error) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error?.message) return String(error.message);
  if (error?.type === 'error') return '模型解析失败，请重试或重新导入模型。';
  return '下载或解析失败，请检查网络后重试。';
}

// Download once and hand Spark a verified local Blob, never a URL that was
// previously requested with Range. Some intermediary caches reuse the partial
// header response for the decoder's full-file request.
export async function downloadScene(url, {
  expectedBytes, signal, onProgress = () => {}, fetchImpl = fetch,
  attempts = 3, retryDelayMs = 750,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    const requestUrl = new URL(url, globalThis.location?.href ?? 'http://localhost/');
    requestUrl.searchParams.set('complete', '1');
    requestUrl.searchParams.set('attempt', String(attempt));
    let reader;
    try {
      onProgress(0, expectedBytes || 0, attempt);
      const response = await fetchImpl(requestUrl.href, { cache: 'no-store', signal });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(response.status === 206 ? '服务器返回了局部数据，正在重新下载完整模型。' : `模型下载失败（HTTP ${response.status}）`);
      }
      if (!response.body) throw new Error('服务器没有返回模型数据。');
      const total = expectedBytes || Number(response.headers.get('content-length')) || 0;
      const chunks = [];
      let received = 0;
      reader = response.body.getReader();
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (expectedBytes && received > expectedBytes) throw new Error('模型文件大小与发布版本不一致。');
        onProgress(received, total, attempt);
      }
      if (!received || (expectedBytes && received !== expectedBytes)) {
        throw new Error(`模型下载不完整：收到 ${received.toLocaleString()} / ${(expectedBytes || total).toLocaleString()} 字节，请重试。`);
      }
      return new Blob(chunks, { type: 'application/octet-stream' });
    } catch (error) {
      lastError = error;
      await reader?.cancel().catch(() => {});
      signal?.throwIfAborted();
      if (attempt + 1 < attempts && retryDelayMs) await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    } finally {
      reader?.releaseLock();
    }
  }
  throw new Error(describeLoadError(lastError));
}
