# arsn-ciyuan

适用于哪吒监控 Dashboard v2 的前端主题。界面基于哪吒 Dashboard，并由 [hamster1963/nezha-dash-v2](https://github.com/hamster1963/nezha-dash-v2) 进行二次美化开发。

作者：[@arsnyeon](https://github.com/arsnyeon)

## 主题特点

- 液态玻璃背景、卡片和浮层，适配深色与浅色主题。
- 卡片、列表、详情视图可直接在当前页面切换。
- 永雏塔菲看板娘、文字气泡和表情包互动。
- 网易云歌单播放器、歌词视图、底部悬浮歌词及播放模式提示。
- 天气播报、服务监控展示、页脚友情链接和不蒜子统计。
- 在 Dashboard「自定义代码（样式和脚本）」中可配置主题资源及 XunJinLu API Key。

本仓库仅提供前端主题，不包含哪吒 Dashboard 或 Agent。

## 安装

在 Dashboard 的前端主题管理页面选择 GitHub 仓库安装，或填写仓库地址：

```text
https://github.com/arsnyeon/arsn-ciyuan
```

主题通过 GitHub Releases 提供。每个稳定 Release 都包含 Dashboard 可安装的 `dist.zip`，标题格式为 `arsn-ciyuan vX.Y.Z`。不要把 `/releases/latest` 填作仓库地址。

## 可选配置

在「自定义代码（样式和脚本）」中填写 `window.ArsnThemeConfig`。所有项都可省略；省略时采用默认值。只需要设置你要覆盖的配置：

```js
window.ArsnThemeConfig = {
  "playlistId": "443797814",
  "backgroundApi": "https://acg.yaohud.cn/dm/adaptive.php",
  "logoUrl": "/arsn-assets/logo.png",
  "overviewIconUrl": "/arsn-assets/title-icon.webp",
  "mascotUrl": "/arsn-assets/taffy.webp",
  "footerLinks": [
    { "name": "ApiNexus", "link": "https://api.xunjinlu.fun/" },
    { "name": "FlowLoss 网测", "link": "https://net.arsn.cn/" }
  ],
  "apiKey": ""
};
```

对象字段请使用双引号，且不要在对象内添加注释或尾随逗号，这样配置对象才能被主题读取。

| 配置项 | 用途 | 默认值 |
| --- | --- | --- |
| `playlistId` | 网易云歌单 ID，供音乐播放器读取歌单 | `443797814` |
| `backgroundApi` | 点击换背景按钮时请求随机壁纸的 API | `https://acg.yaohud.cn/dm/adaptive.php` |
| `logoUrl` | 页眉 Logo 和站点图标 | `/arsn-assets/logo.png` |
| `overviewIconUrl` | 概览标题旁的装饰图标 | `/arsn-assets/title-icon.webp` |
| `mascotUrl` | 网络概览卡片上的看板娘图片 | `/arsn-assets/taffy.webp` |
| `footerLinks` | 页脚友情链接数组；每项包含 `name` 和 `link`。设为 `[]` 可隐藏 | ApiNexus、FlowLoss 网测 |
| `apiKey` | XunJinLu 全局 API Key，同时用于天气及红云音乐接口 | 空字符串 |

`apiKey` 默认不设置。设置后，它只会发送给 `api.xunjinlu.fun` 下的天气和音乐接口，不发送给背景图片 API、Meting 备用源、IP 定位服务或哪吒 Dashboard。旧配置字段 `weatherKey` 仍作为兼容别名，但新配置请统一使用 `apiKey`。

### 数据与 API

| 功能 | 接口来源 | 是否使用 `apiKey` |
| --- | --- | --- |
| 天气播报 | `api.xunjinlu.fun/api/weather/v3.php` | 是 |
| 网易云歌单及歌曲解析 | `api.xunjinlu.fun/apis/wymusic` | 是 |
| 音乐备用播放与歌词 | Meting 服务 | 否 |
| IP 城市定位 | `net.arsn.cn` | 否 |
| 背景图片 | `backgroundApi` 配置的地址 | 否 |

后台自定义代码可配置上述资源和密钥；主题样式及交互功能已编译进主题包，不需要再粘贴旧版的大段 CSS/JavaScript。

## 本地构建与验证

需要 Node.js 22 或更高版本及 pnpm 11：

```bash
pnpm install --frozen-lockfile
pnpm run dev
pnpm run verify
pnpm run build
```

`pnpm run build` 生成 `dist/`。GitHub Actions 在推送版本标签时会构建并发布 `dist.zip`。

## 鸣谢

- 哪吒监控：[nezhahq/nezha](https://github.com/nezhahq/nezha)
- 二次美化开发基础：[hamster1963/nezha-dash-v2](https://github.com/hamster1963/nezha-dash-v2)
- 主题作者：[arsnyeon](https://github.com/arsnyeon)
