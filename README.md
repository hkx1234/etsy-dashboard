# Yingling Etsy Data Dashboard

深圳市盈领电商内部 Etsy 数据看板，用于查看店铺商品、订单、广告、财务、评价和权限管理数据。

## Structure

- `frontend/` Vue 3 + Vite 前端，默认运行在 `http://localhost:3000`
- `backend/` Node.js + Express 后端，默认运行在 `http://localhost:3001`
- `backend/.env.example` 后端环境变量模板
- `frontend/.env.example` 前端 API 地址模板

## Local Setup

```bash
cd backend
npm install
copy .env.example .env
npm start
```

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

## Runtime Data

真实 `.env`、Etsy token、店铺数据、订单数据、Hualei 数据、日志、构建产物不会提交到 Git。  
本地运行时数据默认放在 `backend/data/`，请在服务器或本机单独配置。

云端部署必须把运行数据放在持久化卷中，例如：

```env
RUNTIME_DATA_DIR=/app/data
ETSY_AD_REPORT_DIR=/app/data/ads
```

将 `/app/data` 挂载为持久化卷，并把广告 CSV 放入 `/app/data/ads`。云服务器无法读取本地电脑的 `\\192.168.x.x\...` 目录。修改环境变量并重启后，需要在云端重新打开 `/etsy/connect` 完成一次 Etsy 授权，使服务器保存最新 Token。

## Validation

```bash
node --check backend/server.js
cd frontend && npm run build
```
