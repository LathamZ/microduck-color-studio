# Microduck Color Studio

**简体中文** · [English](README.en.md)

Microduck 3D 配色工作室。基于真实的 Microduck 装配模型，逐件调整颜色、材质与灯光，把脑海中的配色变成可以旋转查看的效果。

**[在线体验](https://lathamz.github.io/microduck-color-studio/)**

![Microduck 配色工作室：15 秒功能演示](docs/media/studio-demo.gif)

演示包含旋转模型、整体换色、单件材质、灯光和库存配色推荐。只录制网页内容，演示库存为示例数据。

## 能做什么

- **逐件配色**：70 个独立装配实例，支持点击模型选择、按名称或 ID 搜索、同名零件批量调整。
- **立体查看**：旋转、缩放、标准视角、单件隔离、展开装配和隐藏标准硬件。
- **材质与灯光**：PLA、哑光 PLA、PETG、TPU 外观预设，摄影棚、日光、暖光，以及可调强度、方向和近似层纹。
- **保存方案**：颜色、材质、涂色与灯光统一保存，支持撤销、重做、JSON 导入导出、浏览器本地保存和 PNG 效果图。
- **库存推荐**：记录已有耗材，比较“只用已有”“补充一色”和“丙烯点缀”方案，明确区分现有料、建议补料与后期涂色。
- **Agent 接口**：稳定零件 ID、版本化 JSON Schema、命令行工具和显式浏览器 API，支持调色、改材质、打光和库存推荐。
- **可替换模型**：通用渲染、编辑状态与模型数据包分离，后续可以接入其他模型。

界面支持简体中文与英文，右上角 **EN / 中文** 可切换语言，保留已有配色和库存。用户填写的耗材名称不会被自动翻译。

## 本地运行

需要 Node.js 22 和 npm。

```sh
npm ci
npm run dev
```

打开终端中显示的本地地址。生产构建使用 `npm run build`，将 `dist/` 部署到任意静态网站服务即可。

项目无需后端、登录、API Key 或打印机连接，也不包含统计追踪。配色与库存保存在当前浏览器；导出 JSON 可以跨设备备份。

## 使用自己的耗材

打开右上角 **我的耗材**，填写实际拥有的耗材名称、颜色与材质。

| 推荐方式 | 处理逻辑                                               |
| -------- | ------------------------------------------------------ |
| 只用已有 | 优先使用库存内的颜色和合适材质，缺少必要材质时明确提示 |
| 补充一色 | 最多建议额外购买一卷配色料，缺少的必要材质另列         |
| 丙烯点缀 | 使用现有料打印，再为允许涂色的硬质外观件建议丙烯笔补色 |

右侧控制面板将已有耗材单独展示，并标记当前颜色与材质是否在库存中。推荐区的 **换一换** 可探索不同组合；库存有限时会如实提示。

推荐使用确定性的颜色距离匹配与配色模板，不把主观审美包装成精确评分。柔性件保留 TPU 要求，不能为了颜色而换成硬质料。涂层颜色单独记录，不会覆盖实际打印本色。

## 给 Agent

从 [AGENTS.md](AGENTS.md)、[接口文档](docs/agent-api.md) 和 [架构设计](docs/architecture.md) 开始。

```sh
npm run -s palette -- parts --role primary
npm run -s palette -- new --out my-look.json
npm run -s palette -- edit --in my-look.json --patch examples/warm-petg.patch.json --out warm-look.json
npm run -s palette -- validate --in warm-look.json
npm run -s palette -- recommend --inventory examples/inventory.json --mode paint --out suggestions.json
```

命令行和网页共用同一套校验与状态格式。结果输出为 JSON；错误写入标准错误并返回退出码 1。`--out` 不覆盖已有文件。浏览器在准备完成后提供 `window.colorStudio`。

## 架构与开发

- `src/domain.ts`：独立于模型和界面的状态、校验与历史记录。
- `src/viewer.ts`：通用 Three.js 渲染、拾取、材质、灯光与相机。
- `src/recommend.ts`：库存校验和配色推荐。
- `src/models/`：当前模型的接入配置与配色模板。
- `public/models/`：GLB 几何与具名零件清单。
- `src/api.ts`、`scripts/palette.ts`：人机共用的公开接口。

接入其他模型请阅读 [模型数据包规范](docs/model-pack.md)。常规运行无需 Python，也不依赖开发者的其他仓库。

```sh
npm test
npm run build
npm run format:check
```

CI 模板位于 `.github/ci.example.yml`。使用具备工作流写入权限的 GitHub 凭证，将其移至 `.github/workflows/ci.yml` 即可启用。

`main` 是默认源码分支；`gh-pages` 只保存构建生成的在线网页。

## 模型范围与效果边界

这是外观配置工具，不是切片软件或装配尺寸校验工具。当前模型来自原版 **XL330 仿真装配**，保留约 79.7 万个原始三角面；它不是精确的 HD1910 装配模型，也不包含轮滑变体。

70 个可视实例中，36 个标记为打印件、34 个为标准硬件；这一数量**不是打印 BOM**。网页不会修改 `.3mf`、STL、CAD 仓库或打印机。

材质效果为近似模拟，未按具体耗材品牌实测。PETG 以不透明材质展示，TPU 不模拟形变；0.2 mm 层纹按装配竖直方向生成，不代表各零件真实打印朝向。丙烯涂色需先用试片检查附着效果。屏幕颜色也不等同于实物色。

## 许可证与来源

- 本项目原创代码与文档：**Apache-2.0**。
- 模型、衍生元数据及渲染图：**CC BY-NC-SA 4.0**，保留署名、非商业性使用和相同方式共享要求。
- 原始模型：**Pollen Robotics**；装配导出与整理来源：[fanhao375/microduck-replica](https://github.com/fanhao375/microduck-replica)。

应用代码的开源许可证不会改变模型本身的授权条件。完整来源与声明见 [NOTICE.md](NOTICE.md)。
