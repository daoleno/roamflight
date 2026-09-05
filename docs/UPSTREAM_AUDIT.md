# 原项目对照：首轮源码审计

## 范围与结论

本次对照在 Roamflight 首次提交并推送后进行。基准为
[Sebastian Lague / Geographical Adventures](https://github.com/SebLague/Geographical-Adventures)
的提交 `82fcda20bebb033c749b2339e9ce3a6e58007699`。

**目前移植的是部分地理资产和基础飞行体验，不是原作完整的游戏与渲染系统。**
精致度的差距不仅来自贴图，还来自飞行控制、反馈循环、资源管理、任务设计、
分层渲染和大量次级动画。继续增加装饰物不能替代这些基础工作。

这是源码层面的首轮审计，没有运行原 Unity 构建进行逐帧性能测试。下文数值是
代码声明或常量；Unity Inspector 中的序列化值可能覆盖可配置字段。

## 功能对照

| 系统         | 原项目实际实现                                                      | Roamflight 当前实现                      | 下一步                                                   |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| 飞行控制     | 独立俯仰、高度上下限、俯仰影响水平与垂直速度、转向平滑              | 球面移动、转向与滚转；高度主要自动保持   | 加入可控升降和俯仰，同时保留轻松操作                     |
| 飞机细节     | 副翼随转向偏转、俯仰滚转模型动画、夜间航行灯                        | 原飞机模型、滚转和修正过旋转中心的螺旋桨 | 补齐副翼、航行灯及与速度有关的次级动画                   |
| 加速         | 有限加速储量、消耗、奖励补充、平滑回充                              | 按住 Shift 持续加速                      | 作为奖励与资源循环设计，而非无限加速                     |
| 镜头         | 速度与加速分别影响 FOV，多视角参数，菜单到飞行过渡                  | 三视角和 FOV 平滑，主要是固定偏移        | 建立固定参考镜头与参数对照，再调手感                     |
| 任务         | 三个并行任务、先取货后投递、热气球取货                              | 单个目的地，无需取货即可投递             | 建立完整任务状态机和合理路线选择                         |
| 评分         | 精度分档、国家判断、落海判断、连击、奖励加速                        | 190 km 阈值判定成功并增加计数            | 分离精度、国家与落海反馈，提供奖励闭环                   |
| 模式与进度   | 限时模式、无尽模式、个人最佳记录                                    | 无尽飞行与简单任务轮换，不保存进度       | 先做短局目标与本地记录，再扩展长期成长                   |
| 包裹与降落伞 | 重力、二次阻力、开伞时机、程序化伞面和落地塌陷                      | 两阶段下降速度，球面扇区伞面和缩放塌陷   | 移植可测试的运动模型与更自然的伞面变形                   |
| 地形性能     | 高低精度渲染组、距离和视锥判断、分帧更新                            | 合并后的高精度全球网格，BVH 用于高度查询 | 优先拆分地形并接入 LOD，不先增加全局几何量               |
| 海洋         | 多层三平面波纹、折射扰动、带噪声遮罩的海岸泡沫、阴影与角度衰减      | 经纬 UV 波纹、简化高光、海岸距离图和泡沫 | 先处理极区与远处闪烁，再完善泡沫和反射                   |
| 大气         | Rayleigh、Mie、臭氧吸收、透射率 LUT、空中透视 LUT、低分辨率天空积分 | 着色器颜色过渡与简化距离雾               | 单独建立可验证的大气原型，不直接照搬 Unity ComputeShader |
| 昼夜与天空   | 日/月/年状态、太阳地球月亮与星空的协调更新                          | 手动日夜切换，随玩家设置光向，随机星点   | 与大气一起设计稳定的时间和太阳方向模型                   |
| 城市夜景     | 基于数据的城市灯光分组、实例渲染和日夜判断                          | 未实现城市灯光                           | 先增加可识别的城市夜景，再讨论城市建筑数据               |
| 地图反馈     | 投递点与目标点、距离相关弧线和最近投递结果                          | 地球视图、目的地标记                     | 加入航迹、发现记录与任务结果可视化                       |

## 最值得先做的三件事

### 1. 飞行手感与飞机响应

从 `Player.HandleMovement`、`UpdateGraphics` 和 `GameCamera` 对照开始。
先确定坐标和单位，再实现俯仰、升降、副翼及有限加速。不要直接复制 Unity
的 `SmoothDamp` 参数到现有指数平滑函数；两者的响应需要通过轨迹测试比较。

验收：同一输入序列下在不同帧率运行，位置和姿态保持稳定；高度不穿入地形；
键盘和触控都能完成升降与转向，副翼、螺旋桨和镜头无异常轴心旋转。

### 2. 一个完整、可重复游玩的任务闭环

原作的 `QuestSystem` 不只是“投中一个点”。代码中同时维护三组任务，有取货
状态、结果展示锁、国家与海洋判定，以及计分和加速奖励。
其距离分档常量为 75 / 300 / 1000 km，限时默认值为 15 分钟。
这些数值值得作为参考，不必原样变成 Roamflight 的最终设计。

验收：取货、携带、投递、结果、替换任务状态明确；不能重复领奖；跨国或落海
得到正确反馈；更换地区后不会遗留旧任务回调；限时与自由飞行可清晰区分。

### 3. 地形 LOD 与可靠光照

原作 `SimpleLodSystem` 根据距离与视锥切换高低精度组，并把更新分散到多帧。
我们把全球地形合并为一个网格，虽然减少 draw call，但也失去了区域级细粒度
裁剪和精度切换。增加城市细节之前必须先解决这个结构问题。

大气是另一项独立工程。原作使用多个 LUT 和计算着色器；WebGL2 没有同样的
ComputeShader 接口，应先验证可行的离线 LUT 或渲染到纹理方案，并明确移动端
纹理格式、内存和回退路径。不要为“大气效果”先把基础兼容性改成只支持 WebGPU。

验收：固定经纬度、太阳位置、机位和视口进行图像对比；分别记录 CPU/GPU 帧时、
draw call、三角形数量、纹理内存和首次加载流量，不用单一 FPS 宣称“优化完成”。

## 城市低空飞行的边界

**原项目的城市坐标和夜间灯光，不等于完整的城市三维建筑世界。**
低空穿行城市、机场起降和全球城市细节需要新的建筑/地标数据来源、许可核验、
流式加载、缓存、碰撞及尺度设计。应先选一个城市验证质量和性能，再扩展到更多
区域与国家。不能把它描述成读取原仓库后就已经支持的功能。

## 本轮核对的源码

以下链接固定到本次审计提交，而非会变化的 `main`：

- [Player.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Player/Player.cs)：移动、升降、加速、副翼和航行灯。
- [GameCamera.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Player/GameCamera.cs)：镜头和 FOV。
- [QuestSystem.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Quest/QuestSystem.cs)：任务、评分与奖励。
- [Package.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Player/Package.cs) 和 [Parachute.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Player/Parachute.cs)：下降和程序化伞面。
- [SimpleLodSystem.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Generation/Terrain/SimpleLodSystem.cs)：LOD 策略。
- [Ocean.shader](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Shaders/Game/Ocean.shader)：波纹、泡沫、折射与阴影。
- [AtmosphereEffect.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Post%20Processing/Effects/Atmosphere/AtmosphereEffect.cs)：大气参数和 LUT 管线。
- [CityLights.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/City%20Lights/CityLights.cs)：城市灯光数据渲染。
- [SolarSystemManager.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Solar%20System/SolarSystemManager.cs)：日月年状态与天体协调。
- [GlobeDeliveryDisplay.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Navigation/Globe/GlobeDeliveryDisplay.cs)：投递结果弧线。
- [PlayerAudio.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Audio/PlayerAudio.cs) 和 [Music.cs](https://github.com/SebLague/Geographical-Adventures/blob/82fcda20bebb033c749b2339e9ce3a6e58007699/Assets/Scripts/Game/Audio/Music.cs)：淡入、俯仰音调响应和曲目播放；不等于允许使用视频中的所有音乐录音。

后续应继续核对场景序列化参数、地形生成、国家索引、输入系统、设置与统计页面，
再做原生运行对照。本文件不代表已经完成原仓库全部模块的审计或移植。
