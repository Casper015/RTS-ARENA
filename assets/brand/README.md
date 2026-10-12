# RTS Arena 标志

`logo.svg` 是透明底的唯一原稿，网页页头和视频渲染直接使用它。盾牌、英文名和中文副标题均为矢量路径，不依赖本机字体。

修改原稿后运行 `node scripts/brand-assets.ts`，生成浏览器图标 `favicon.svg` 和带深色底板的仓库展示图 `repository.svg`；`npm run build` 也会自动执行这一步。底板保证标志在代码托管网站的浅色和深色主题下都清晰。
