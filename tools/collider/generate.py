"""Reconstruct a local collision mesh from Gaussian centers; all processing is local.

Uses the Open3D normals + Poisson approach also used by hh-hang/collider-forge,
with filtering, support trimming and simplification for this survey scene.
No source code is copied from that project.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from scipy.spatial import cKDTree


def log(message):
    print(message, flush=True)


def read_gaussians(path):
    with path.open('rb') as file:
        header = []
        while True:
            line = file.readline()
            if not line or file.tell() > 65536:
                raise ValueError('Missing PLY header')
            header.append(line.decode('ascii').strip())
            if line.strip() == b'end_header':
                offset = file.tell()
                break
    if 'format binary_little_endian 1.0' not in header:
        raise ValueError('Expected binary little endian Gaussian PLY')
    count = int(next(line.split()[2] for line in header if line.startswith('element vertex ')))
    fields = [line.split()[2] for line in header if line.startswith('property float ')]
    if any(line.startswith('property ') and not line.startswith('property float ') for line in header):
        raise ValueError('Expected float-only Gaussian vertex properties')
    dtype = np.dtype([(field, '<f4') for field in fields])
    if path.stat().st_size != offset + count * dtype.itemsize:
        raise ValueError('PLY byte count does not match header')
    return np.memmap(path, dtype=dtype, mode='r', offset=offset, shape=(count,))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, default=Path('model-gs-ply/scene.ply'))
    parser.add_argument('--output', type=Path, default=Path('model-gs-ply/collision'))
    parser.add_argument('--bounds', type=float, nargs=6, default=[-40, -40, -8, 40, 40, 18],
                        metavar=('XMIN', 'YMIN', 'ZMIN', 'XMAX', 'YMAX', 'ZMAX'))
    parser.add_argument('--voxel', type=float, default=0.16)
    parser.add_argument('--opacity', type=float, default=0.25)
    parser.add_argument('--max-scale', type=float, default=1.0)
    parser.add_argument('--depth', type=int, default=9)
    parser.add_argument('--support-distance', type=float, default=0.4)
    parser.add_argument('--triangles', type=int, default=100000)
    args = parser.parse_args()
    started = time.monotonic()
    args.output.mkdir(parents=True, exist_ok=True)
    lo, hi = np.array(args.bounds[:3]), np.array(args.bounds[3:])
    if np.any(lo >= hi) or args.voxel <= 0 or not 0 < args.opacity < 1:
        raise ValueError('Invalid reconstruction parameters')
    raw = read_gaussians(args.input)
    mask = np.ones(len(raw), dtype=bool)
    for i, axis in enumerate('xyz'):
        mask &= np.isfinite(raw[axis]) & (raw[axis] >= lo[i]) & (raw[axis] <= hi[i])
    roi_count = int(mask.sum())
    mask &= raw['opacity'] >= np.log(args.opacity / (1 - args.opacity))
    for axis in range(3):
        mask &= np.isfinite(raw[f'scale_{axis}']) & (raw[f'scale_{axis}'] <= np.log(args.max_scale))
    ids = np.flatnonzero(mask)
    if len(ids) < 1000:
        raise ValueError('Too few supported points in ROI')
    log(f'Input {len(raw):,}; ROI {roi_count:,}; opacity/scale filtered {len(ids):,}')
    points = np.column_stack([raw[axis][ids] for axis in 'xyz']).astype(np.float64)
    cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(points))
    del points
    cloud = cloud.voxel_down_sample(args.voxel)
    log(f'Voxel downsample: {len(cloud.points):,} points')
    cloud, _ = cloud.remove_statistical_outlier(nb_neighbors=24, std_ratio=2.0)
    log(f'Outlier removal: {len(cloud.points):,} points; estimating normals')
    cloud.estimate_normals(o3d.geometry.KDTreeSearchParamKNN(knn=30))
    cloud.normalize_normals()
    cloud.orient_normals_consistent_tangent_plane(30)
    # Most of the scene is ground viewed from above. Choose a consistent outward sign.
    normals = np.asarray(cloud.normals)
    upward_surface = np.abs(normals[:, 2]) > 0.7
    if np.median(normals[upward_surface, 2]) < 0:
        normals *= -1
    log(f'Poisson reconstruction depth {args.depth}')
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        cloud, depth=args.depth, scale=1.05, linear_fit=False, n_threads=4)
    poisson_triangles = len(mesh.triangles)
    vertices = np.asarray(mesh.vertices)
    support_tree = cKDTree(np.asarray(cloud.points))
    distance, _ = support_tree.query(vertices, workers=4)
    density_cutoff = float(np.quantile(densities, 0.01))
    unsupported = ((distance > args.support_distance)
                   | (np.asarray(densities) < density_cutoff)
                   | (vertices < lo).any(axis=1) | (vertices > hi).any(axis=1))
    mesh.remove_vertices_by_mask(unsupported)
    mesh.remove_duplicated_vertices().remove_duplicated_triangles()
    mesh.remove_degenerate_triangles().remove_unreferenced_vertices()
    labels, counts, areas = mesh.cluster_connected_triangles()
    labels, counts, areas = np.asarray(labels), np.asarray(counts), np.asarray(areas)
    mesh.remove_triangles_by_mask((counts[labels] < 100) | (areas[labels] < 0.5))
    mesh.remove_unreferenced_vertices()
    trimmed_triangles = len(mesh.triangles)
    log(f'Poisson {poisson_triangles:,} triangles; supported surface {trimmed_triangles:,}')
    if trimmed_triangles > args.triangles:
        mesh = mesh.simplify_quadric_decimation(args.triangles, boundary_weight=10)
    mesh.remove_degenerate_triangles().remove_duplicated_triangles().remove_unreferenced_vertices()
    mesh.compute_vertex_normals()
    v, f = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    if not len(f) or not np.isfinite(v).all():
        raise ValueError('Reconstruction produced no valid mesh')
    log(f'Final mesh: {len(v):,} vertices / {len(f):,} triangles; validating')

    # Geometric validation is in original +Z-up coordinates.
    ray_scene = o3d.t.geometry.RaycastingScene()
    ray_scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(mesh))
    samples = np.asarray(cloud.points)[::max(1, len(cloud.points) // 50000)].astype(np.float32)
    sample_dist = ray_scene.compute_distance(o3d.core.Tensor(samples)).numpy()
    origins = np.array([[0, 0, 15], [2, 0, 15], [-2, 0, 15], [0, 2, 15], [0, -2, 15]], dtype=np.float32)
    rays = np.column_stack([origins, np.tile([0, 0, -1], (len(origins), 1))]).astype(np.float32)
    hits = ray_scene.cast_rays(o3d.core.Tensor(rays))['t_hit'].numpy()
    spawn_hits = [{'x': float(o[0]), 'y': float(o[1]), 'surface_z': float(o[2] - t) if np.isfinite(t) else None}
                  for o, t in zip(origins, hits)]
    log(f'Spawn ground samples: {spawn_hits}')

    # Export raw coordinates for editing, and standards-compliant Y-up GLB for Three.js.
    if not o3d.io.write_triangle_mesh(str(args.output / 'scene-collider-zup.ply'), mesh, write_ascii=False):
        raise RuntimeError('PLY export failed')
    y_up = v[:, [0, 2, 1]].copy()
    y_up[:, 2] *= -1
    y_up_normals = np.asarray(mesh.vertex_normals)[:, [0, 2, 1]].copy()
    y_up_normals[:, 2] *= -1
    exported = trimesh.Trimesh(vertices=y_up, faces=f, vertex_normals=y_up_normals, process=False)
    exported.visual = trimesh.visual.ColorVisuals(mesh=exported, face_colors=[119, 207, 190, 255])
    exported.export(args.output / 'scene-collider.glb', include_normals=True)
    # Preview samples preserve original Gaussian colors, using the exact same rotation.
    preview_ids = ids[::max(1, int(np.ceil(len(ids) / 100000)))]
    preview = np.column_stack([raw['x'][preview_ids], raw['z'][preview_ids], -raw['y'][preview_ids],
                              *[np.clip(raw[k][preview_ids] * 0.28209479177387814 + 0.5, 0, 1)
                                for k in ['f_dc_0', 'f_dc_1', 'f_dc_2']]]).astype('<f4')
    preview.tofile(args.output / 'source-preview.bin')

    # Reload exported artifact to verify GLB geometry survived serialization.
    reloaded = trimesh.load(args.output / 'scene-collider.glb', force='mesh', process=False)
    if len(reloaded.faces) != len(f) or not np.allclose(reloaded.bounds, exported.bounds, atol=1e-4):
        raise RuntimeError('GLB round-trip mismatch')
    report = {
        'source': args.input.name,
        'source_sha256': hashlib.sha256(args.input.read_bytes()).hexdigest(),
        'scope': 'Construction area near the origin only; not the full survey',
        'source_up_axis': '+Z', 'glb_up_axis': '+Y',
        'source_to_glb': '(x, y, z) -> (x, z, -y); no translation or scale baked in',
        'integration': 'Apply the existing scene recenter translation and scale, but do not rotate Z-up again.',
        'parameters': {k: val for k, val in vars(args).items() if k not in ['input', 'output']},
        'source_points': len(raw), 'roi_points': roi_count, 'filtered_points': len(ids),
        'reconstruction_points': len(cloud.points), 'poisson_triangles': poisson_triangles,
        'trimmed_triangles': trimmed_triangles, 'vertices': len(v), 'triangles': len(f),
        'source_bounds': [v.min(axis=0).tolist(), v.max(axis=0).tolist()],
        'glb_bounds': reloaded.bounds.tolist(),
        'glb_bytes': (args.output / 'scene-collider.glb').stat().st_size,
        'preview_points': len(preview),
        'qa': {
            'point_to_mesh_distance_percentiles': dict(zip(['p50', 'p90', 'p95', 'p99'], np.percentile(sample_dist, [50, 90, 95, 99]).tolist())),
            'sample_points_within_0_4': float(np.mean(sample_dist <= 0.4)),
            'spawn_downward_ray_hits': spawn_hits,
            'finite_vertices': bool(np.isfinite(v).all()),
            'degenerate_triangles': int(np.sum(exported.area_faces < 1e-10)),
            'watertight': bool(exported.is_watertight),
            'glb_roundtrip_valid': True,
        },
        'elapsed_seconds': round(time.monotonic() - started, 1),
        'limitations': [
            'Approximate reconstruction from Gaussian centers, not a surveyed solid model.',
            'Open boundaries and unsupported holes are intentionally not sealed.',
            'Vegetation and thin structures require manual review before player collision use.',
            'A collision controller is not enabled by this asset generation step.',
        ],
    }
    (args.output / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    log(json.dumps(report['qa'], indent=2))
    log(f'Saved {args.output / "scene-collider.glb"} in {report["elapsed_seconds"]}s')


if __name__ == '__main__':
    main()
