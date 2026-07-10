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

## Validation

```bash
node --check backend/server.js
cd frontend && npm run build
```
