// Camera positions/targets use the original scene.ply coordinate system (+Z up).
// Replace videoUrl with a browser-playable MP4/WebM URL to use a real feed.
// An empty videoUrl uses a clearly labeled, live-rendered scene simulation.
export const cameras = [
  { id: 'CAM-01', name: '施工区全景', position: [18, -10, 8], target: [0, 0, 2.5], videoUrl: '' },
  { id: 'CAM-02', name: '场地入口', position: [-14, 5, 7], target: [0, 0, 2.5], videoUrl: '' },
  { id: 'CAM-03', name: '周界道路', position: [8, 20, 8], target: [0, 0, 2.5], videoUrl: '' },
];
