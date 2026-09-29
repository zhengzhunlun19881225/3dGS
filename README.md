# PLY 场景漫游

本地 WebGL2 场景浏览器，使用 Three.js 0.180 与 Spark 2.2。默认打开 `model-gs-ply/scene.ply`，也支持拖入本地 PLY / SPZ / SPLAT / KSPLAT。

## 在线发布

GitHub Pages 目标地址：https://zhengzhunlun19881225.github.io/3dGS/

源码保存在仓库，466 MB 的原始模型单独保存在 `scene-assets-v1` Release 的 `scene.ply` 附件中。GitHub Actions 下载并校验模型后构建网站，模型与网页在同一站点提供，不依赖跨域 Release 链接播放。推送到 `main` 或手动运行 `Publish scene to GitHub Pages` 即可重新发布。

从 GitHub 新克隆项目后，可运行以下命令取回默认场景（或自行放入同名模型）：

```sh
gh release download scene-assets-v1 --repo zhengzhunlun19881225/3dGS --pattern scene.ply --dir model-gs-ply
```

替换模型时需要更新 Release 附件、`model-gs-ply/scene.sha256` 中的 SHA-256，以及 `src/default-scene.js` 中的字节数与版本哈希。首次在线访问需下载约 466 MB 并生成 LoD，等待时间取决于网络和设备。页面显示下载进度，完整下载并核对字节数后才交给解析器；不完整响应最多自动尝试 3 次，失败后可点击「重新加载场景」。

## 运行

安装 Node.js 20.19+ 或 22.12+，然后：

```sh
npm install
npm run dev
```

也可以使用 `pnpm install`、`pnpm dev`。打开终端显示的本地地址（默认 http://127.0.0.1:5173）。在本次电脑环境中，还可直接双击 `启动场景.command`，使用 Codex 已提供的 Node 运行时并自动打开浏览器。请保持启动窗口运行；关闭窗口会停止服务。不要直接双击 `index.html` 浏览场景；直接打开时会显示启动指引。

## 使用

- 自由浏览：左键旋转、右键平移、滚轮缩放；「全景定位」查看完整模型。
- 点击第一／第三人称即可漫游；按住鼠标拖动转向。第一人称在支持的浏览器中也可锁定鼠标，Esc 释放并清除输入。
- WASD 移动，Shift 奔跑，空格跳跃，V 切换视角，F 飞行。飞行时 W 沿视线前进（向下看可下降），空格上升，Shift 加速。
- 「交互与物理」可设置过肩视角、弹簧相机、Foot IK、切换动作组、招手，或投放球体、盒体、移动平台、车辆。最多 24 个动态道具、4 个平台、2 辆车；有对应清除按钮。
- 靠近静止车辆按 E 上／下车。W/S 油门／倒车，A/D 转向，空格刹车，Shift 手刹。「车辆扶正」恢复翻倒车辆。
- 「键位与输入」支持逐项重新绑定按键；Q 保留给监控，重复键位会被拒绝。支持手柄；触屏设备默认显示虚拟摇杆与动作按钮，桌面也可手动打开。
- 「自定义角色与动画」导入带内嵌动画的 GLB，然后选择待机／行走／奔跑／跳跃片段。Foot IK 自动识别常见人形骨骼；非标准骨骼可通过外部 API 提供映射。角色动画和模型在本机解析。
- 「3DTiles 流式场景」支持 tileset.json URL 及无需联网的双瓦片台阶示例。显示的模型与隐藏碰撞共用变换；近处可见瓦片通过 Worker 构建碰撞，隐藏、卸载、远离后回收。构建期间暂停进入附近瓦片。
- 「重置玩家」回到出生点；速度、跟随距离、模型缩放和向上轴可调。有专属碰撞网格时地面高度只读。原始施工场景按 +Z 向上处理，出生点在源坐标 (0, 0, 2.5) 附近。

## 控制器集成

使用 MIT 开源项目 [three-player-controller](https://github.com/hh-hang/three-player-controller) **0.6.2**（不是仿制实现），配合 `three-mesh-bvh` 0.9.1 与 `3d-tiles-renderer` 0.5.3。代码入口：

- `src/controller-runtime.js`：控制器生命周期、米制换算、地形碰撞、动态物体、平台、车辆和安全位置恢复。
- `src/controller-assets.js`：本地程序化骨骼人形、AnimationClips 和独立四轮车模，无外部角色资源依赖。
- `src/controller-ui.js`：键位、手柄、触屏、动画导入及功能面板。
- `src/streaming-colliders.js`：3DTiles 加载／显隐／卸载事件及 60 / 85 米滞回碰撞范围。

人物缩放参数为 0.01，对应约 1.8 米人形、0.3 米胶囊半径；行走 3 m/s、奔跑 6.5 m/s、飞行 8 m/s、重力 14 m/s²。控制器的 `jumpHeight` 实际是初速度，此处设为 5.2 m/s。车辆使用自身的米制参数。Foot IK 有真实髋、腿、足、趾骨骼及动画轨道。自然行走／谨慎行走使用独立 Locomotion Set。

BVH Worker 在开发与生产都单独打包；Vite 排除控制器的依赖预打包以保持 Worker URL 正确。Worker 异常时上游会回退同步构建并输出警告；未完成的碰撞不会用于漫游。相机遇阻立即缩回，弹簧用于目标跟随，避免遮挡修正的缓动暂时穿墙。

宿主页面可通过公开的 `window.sceneControls` 接口接入外部控制（只在漫游且监控未打开时接受输入）：

```js
sceneControls.setInput({ moveX: 0, moveY: 1, shift: true });
sceneControls.setInput({ moveX: 0, moveY: 0, shift: false }); // 必须释放持续输入
sceneControls.setInput({ toggleFly: true }); // 一次触发，勿每帧重复
sceneControls.setKeyMap({ forward: 'ArrowUp', backward: 'ArrowDown' });
sceneControls.registerAnimation('greeting', 'Wave', { loop: false });
sceneControls.playAnimation('greeting', { fade: 0.2, returnToPrev: true });
sceneControls.registerLocomotionSet('slow', { idle: 'Idle', walking: 'Careful', running: 'Run' });
sceneControls.switchLocomotionSet('slow');
// setCharacter({ model, animations, idleAnim, walkAnim, runAnim, jumpAnim,
//   headBoneName?, skeleton? }) 可接入其他 GLTFLoader 结果。
```

## 范围与限制

### 本地碰撞网格

已为原点附近施工区生成局部碰撞网格，位于 `model-gs-ply/collision/`。主漫游场景自动加载匹配的 GLB，转换到与高斯场景相同的坐标系并构建 BVH；碰撞几何不加入渲染场景，因此始终不可见。第一／第三人称共享控制器的角色胶囊，支持墙体阻挡、坡面贴地、小台阶、跳跃和头顶碰撞；第三人称相机遇到遮挡会缩短跟随距离。辅助坐标网格默认关闭，可单独开启，它与碰撞几何无关。

碰撞网格就绪前暂停进入漫游；加载失败会明确提示并提供单独重试按钮。施工区以外或网格孔洞没有虚构的平面地面，角色坠落后会返回最近有地面支持的位置。碰撞范围为源坐标原点附近约 80 × 80，边缘、植被和细小结构仍受重建质量限制。模型变换会同步重建碰撞索引。导入其他模型会卸载当前专属碰撞体，并明确使用平面地面。

启动本地服务后可打开 <http://127.0.0.1:5173/collider-preview.html>，独立对比源点云、碰撞表面与三角线框。生成参数、坐标约定、重跑方法和限制见 [碰撞网格说明](tools/collider/README.md)。

### 3DTiles 与设备限制

瓦片 URL 必须允许浏览器跨域访问，私有服务的鉴权需由宿主接入。常规本地坐标直接使用，地心大坐标在场景附近重定位为 Y-up；尚未配置与此施工 PLY 的测绘坐标精确配准。这里提供加载与碰撞桥接，不会把高斯 PLY 自动转换为 3DTiles。覆盖上游渲染器支持的格式，特殊扩展需额外插件。移出摄像机视野的瓦片会撤销碰撞，应使用具有地面覆盖的合理层级与包围体。现有施工区静态网格始终保留，不受瓦片卸载影响。

触控与手柄输入接口已接入；实际移动设备仍受 466 MB 源场景的内存／GPU 要求限制。建议先用 `/?demo` 检查设备性能。车辆与球盒使用实时简化刚体模型，不能替代工程级动力学仿真。地形质量、尺度、缺面会影响悬挂、抓地和脚部贴合。

### 场景监控

场景内提供 3 个演示监控点：施工区全景、场地入口、周界道路。点击悬浮摄像机图标或右上角点位列表打开监控弹窗，底部可切换点位，Esc 或关闭按钮退出。漫游时可按 Q 查看准星附近监控。查看监控期间暂停玩家移动，关闭后点击进入漫游继续。

默认画面是对应点位的三维场景模拟巡航，以 15 FPS 渲染，明确标注“非真实监控”，没有连接真实摄像机。点位位置、朝向和视频地址位于 `src/cameras.js`；`position` / `target` 使用原始 PLY 的 +Z 向上坐标，模型旋转、缩放和平移时同步转换。替换为其他本地模型后隐藏这些专属点位，避免错位。

把点位的 `videoUrl` 替换为浏览器可播放的 MP4 / WebM 地址即可显示视频播放器；连接失败会显示错误提示。当前没有 RTSP、HLS 转码或鉴权代理，真实摄像机需先提供浏览器兼容的视频源。未配置视频地址时不会请求任何外部媒体。图标是定位叠加层，可透过场景显示。

这份 466 MB PLY 包含 8,324,819 个高斯点。首次打开会下载本地文件并在浏览器 Worker 中生成 LoD；这一步可能需要数分钟及较多内存。渲染预算设为约 100 万点，像素比上限为 1.5。当前不持久化 LoD，刷新会重新生成。用于正式部署时建议预生成可分页的 RAD / LoD 资源。

普通 PLY 自动按网格或点云显示，高斯 PLY 使用 Spark。为保持大文件自动定位响应，边界计算采样最多约 10 万个高斯中心；渲染本身仍使用完整输入构建的细节层级。

高斯外观与碰撞几何分别加载。默认场景已接入生成的静态碰撞网格；重建中的缺失或错误表面仍可能造成卡住或坠落，可使用「重置玩家」。其他导入场景只有水平地面回退，不能自动获得墙体或坡面碰撞。

## 验证与构建

```sh
npm test
npm run build
npm run preview
```

新增 `tests/controller-integration.test.js` 直接运行开源控制器，覆盖贴地／跳跃／防二段跳、行走与奔跑、墙体阻挡、飞行、动态球盒及冲量传递、平台随行、Foot IK、动作组、相机避障、车辆驾驶制动及真实 GLB 地形。原有 PLY、下载、边界及旧控制器回归测试仍保留。构建产物在 `dist/`，包含场景和碰撞文件，可部署到静态服务；原始高斯 PLY 未纳入 Git。

参考：[Spark 文档](https://sparkjs.dev/docs/)、[SplatMesh API](https://sparkjs.dev/docs/splat-mesh/)。
