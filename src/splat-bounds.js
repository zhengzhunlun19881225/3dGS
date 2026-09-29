import * as THREE from 'three';

// Spark may omit the original packed array when loading with lod:true.
export function getSplatBounds(mesh) {
  const source = mesh.packedSplats?.lodSplats ?? mesh.extSplats?.lodSplats ?? mesh.splats;
  const box = new THREE.Box3();
  const include = center => {
    if ([center.x, center.y, center.z].every(Number.isFinite)) box.expandByPoint(center);
  };
  if (source?.getSplat) {
    const count = source.getNumSplats();
    // A bounded sample keeps framing large scenes responsive. Rendering uses all points.
    const stride = Math.max(1, Math.floor(count / 100000));
    for (let i = 0; i < count; i += stride) include(source.getSplat(i).center);
  } else source?.forEachSplat((_index, center) => include(center));
  return box;
}
