# ArsnProbe Theme

基于 `hamster1963/nezha-dash-v2` 的哪吒探针主题，加入 ArsnProbe 的液态玻璃界面、详情卡片、视图切换、塔菲看板娘、气泡、音乐播放器、天气播报、服务监控轮播和页脚统计等定制功能。

## 发布

哪吒后台的“前端管理”支持 GitHub 仓库或 Release API 地址。这个仓库使用官方 v2 的静态主题构建方式：

1. 将仓库推送到你自己的 GitHub 仓库。
2. 推送 `v1.0.0` 这样的版本标签，GitHub Actions 会构建 `dist/` 并创建 Release 上传 `dist.zip`。
3. 在哪吒后台填写：
   - 仓库地址：`https://github.com/你的用户名/你的仓库`
   - 或 Release API：`https://api.github.com/repos/你的用户名/你的仓库/releases/latest`

主题中的定制代码已经在构建时打包，不依赖后台 `custom_code`，避免首屏先显示原主题再延迟注入。

## 本地验证

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

构建结果位于 `dist/`，发布包为 `dist.zip`。
