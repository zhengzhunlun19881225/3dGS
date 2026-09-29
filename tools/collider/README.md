# 本地碰撞网格生成

使用 Open3D 0.19 的法线估计 + Poisson 重建流程，与 [collider-forge](https://github.com/hh-hang/collider-forge/blob/main/tools/3dgs-collider/main.cpp) 的算法路线一致。这里以 Python 在 Apple Silicon 上运行，没有复制该仓库代码或运行 Windows 程序。场景数据只在本机处理。

## 运行与预览

本机已安装项目独立环境，可在项目根目录重新生成：

```sh
.venv-collider312/bin/python tools/collider/generate.py
```

其他机器使用 Python 3.12 创建环境，然后安装 `tools/collider/requirements.txt`。运行脚本会覆盖该输出目录下的同名生成文件，原始 `scene.ply` 不变。

启动项目本地服务后打开 <http://127.0.0.1:5173/collider-preview.html>。可切换源点云、碰撞表面、线框与透明度；双击网格显示原始 PLY 坐标。点云叠加使用从原始高斯中心抽样的带色点，不是完整高斯渲染。

## 输出

- `model-gs-ply/collision/scene-collider.glb`：简化三角网格，+Y 向上，含法线。
- `model-gs-ply/collision/scene-collider-zup.ply`：+Z 向上的原坐标网格，适合编辑或后续处理。
- `model-gs-ply/collision/source-preview.bin`：预览点云；小端 float32，每点 `[x, y, z, r, g, b]`，已转为 +Y 向上。
- `model-gs-ply/collision/report.json`：输入哈希、参数、顶点/面数、范围、点到网格距离和出生点附近的射线检测结果。

## 当前范围与处理

默认采用原 PLY 坐标 `X/Y ∈ [-40,40]`、`Z ∈ [-8,18]` 的施工区，**不是整个测绘场景**。尺寸与距离均以 PLY 原始坐标单位表达；没有外部测量基准证明单位一定是米。

过滤低透明度高斯（sigmoid opacity < 0.25）和过大高斯（任一主轴尺度 > 1），按 0.16 体素降采样并移除统计离群点。估计和统一法线后使用 depth 9 重建；裁掉低密度、距输入点超过 0.4 的顶点、越界面和小孤立片，最后减面至约 10 万面。减面可能使边界发生少量位移。生成文件保留缺失区域的开放边界，不添加底盖。

`report.json` 的距离统计针对过滤及降采样后的点，是几何拟合检查，不代表整个原始场景的覆盖率，也不能证明所有孔洞和错误连接都已消除。源码重建存在轻微并行浮点差异，重复生成的字节和面数可能略有不同。

已在本地浏览器检查点云叠加和独立网格，地形和圆形结构位置一致。外围植被、细柱和孔洞仍需人工复核；尚未对玩家胶囊、台阶或墙体连续碰撞做运行验证。

## 接入现有场景时的坐标

GLB 已烘焙旋转 `(x, y, z) → (x, z, -y)`，没有平移、缩放。当前主场景还会居中并缩放，因此不能仅把 GLB 原样加入已有场景，也不能重复应用一次 Z-up 旋转。

若希望碰撞对象完全复用主模型的 `matrixWorld`，可先把 GLB 包装在一个绕 X 轴旋转 `+π/2` 的父级中，将它恢复为源坐标，再应用主模型变换。或者直接使用原坐标 PLY 并复用主模型变换。

生成脚本只负责资产。主漫游页面现已加载该 GLB 并使用隐藏胶囊碰撞；`src/collision-world.js` 会先恢复源坐标，再应用主模型的 `matrixWorld`。独立预览页面用于检查可见网格，不包含人物控制器。主场景中的碰撞几何始终不可见。
