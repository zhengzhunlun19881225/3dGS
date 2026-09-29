// Read only the header: the binary body must never be decoded as text.
export function inspectPly(buffer) {
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)));
  if (!/^ply\r?\n/.test(header)) throw new Error('文件不是有效的 PLY。');
  const end = header.indexOf('end_header');
  if (end < 0) throw new Error('无法读取 PLY 文件头。');
  const lines = header.slice(0, end).split(/\r?\n/);
  let element = '';
  const properties = [];
  let vertices = 0, faces = 0;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element') {
      element = parts[1];
      if (element === 'vertex') vertices = Number(parts[2]);
      if (element === 'face') faces = Number(parts[2]);
    }
    if (parts[0] === 'property' && element === 'vertex') properties.push(parts.at(-1));
  }
  if (!Number.isSafeInteger(vertices) || vertices < 1) throw new Error('PLY 中没有有效顶点。');
  const gaussian = ['f_dc_0', 'opacity', 'scale_0', 'rot_0'].every(p => properties.includes(p));
  const compressed = ['packed_position', 'packed_rotation', 'packed_scale', 'packed_color'].every(p => properties.includes(p));
  return { type: gaussian || compressed ? 'gaussian' : faces > 0 ? 'mesh' : 'points', vertices };
}
