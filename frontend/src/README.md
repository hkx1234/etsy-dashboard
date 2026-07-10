# src 目录说明

这个目录存放前端业务源码。阅读时建议先看入口和路由，再看布局、页面、数据。

```text
src
├─ main.ts              应用入口，挂载 Vue、路由和 Ant Design Vue
├─ App.vue              全局主题和路由出口
├─ router/              页面路由配置
├─ layouts/             后台系统公共外壳，例如侧边栏、顶部栏
├─ pages/               具体业务页面
├─ data/                本地样例数据，后续可替换为接口数据
├─ types/               业务数据类型定义
├─ utils/               通用工具函数
├─ styles/              全局样式
└─ vite-env.d.ts        Vite 和 Vue 类型声明
```

当前项目还处于前端原型阶段，`data/mockData.ts` 里的数据用于页面展示。以后接后端时，建议新增 `api/` 目录，把接口请求统一放进去。
