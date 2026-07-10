# Etsy Open API v3 本地取数测试后端

这个项目只用于在本地 Mac 上验证 Etsy Open API v3 的取数链路：

OAuth 授权 -> 保存 token -> 获取 shop_id -> 读取 listings -> 读取 receipts -> 读取 transactions

它不是正式数据看板，不包含前端 dashboard、数据库、定时任务或正式部署。

## 1. 文件结构

```text
etsy-api-test/
├── package.json
├── server.js
├── .env.example
├── .gitignore
└── README.md
```

运行和授权成功后，本地还会生成这些文件：

```text
etsy-token.json
etsy-shops.json
etsy-listings.json
etsy-receipts.json
etsy-transactions.json
```

这些文件包含 token 或店铺数据，已经写进 `.gitignore`，不要提交到 GitHub。

## 2. 每个文件的作用

- `package.json`：Node.js 项目配置和启动命令。
- `server.js`：Express 测试后端，负责 Etsy OAuth、token 刷新、API 请求和本地 JSON 保存。
- `.env.example`：环境变量模板。
- `.gitignore`：忽略 `.env`、token、测试数据和 `node_modules`。
- `README.md`：本地操作说明。

## 3. 安装依赖

进入项目目录：

```bash
cd ~/Desktop/etsy-api-test
```

安装依赖：

```bash
npm install
```

## 4. 创建并填写 .env

复制模板：

```bash
cp .env.example .env
```

打开 `.env`，填入：

```env
ETSY_KEYSTRING=你的 Etsy Keystring
ETSY_SHARED_SECRET=你的 Etsy Shared Secret
ETSY_REDIRECT_URI=https://你的临时域名.trycloudflare.com/etsy/callback
PORT=3000
```

注意：`.env` 不要提交到 GitHub。

## 5. 启动本地后端

开发模式：

```bash
npm run dev
```

普通启动：

```bash
node server.js
```

启动后，本地服务地址是：

```text
http://localhost:3000
```

## 6. 启动 Cloudflare Quick Tunnel

另开一个终端，执行：

```bash
cloudflared tunnel --url http://localhost:3000
```

如果提示没有 `cloudflared`，可以先安装：

```bash
brew install cloudflared
```

Cloudflare 会输出一个临时 HTTPS 地址，类似：

```text
https://xxxx.trycloudflare.com
```

## 7. Etsy App Callback URL 应该填什么

在 Etsy Developer App 后台，把 Callback URL 设置为：

```text
https://xxxx.trycloudflare.com/etsy/callback
```

同时把 `.env` 里的 `ETSY_REDIRECT_URI` 改成同一个地址：

```env
ETSY_REDIRECT_URI=https://xxxx.trycloudflare.com/etsy/callback
```

改完 `.env` 后，重启 Node 服务。

Cloudflare Quick Tunnel 是临时地址，每次重启可能会变。如果地址变了，需要同步修改：

1. Etsy Developer App 的 Callback URL
2. `.env` 里的 `ETSY_REDIRECT_URI`
3. 重启 `node server.js` 或 `npm run dev`

## 8. 开始 Etsy 授权

浏览器打开：

```text
https://xxxx.trycloudflare.com/etsy/connect
```

然后用 Etsy 店铺主账号授权。

当前申请的 scope 只有只读权限：

```text
shops_r listings_r transactions_r feedback_r
```

不会申请写权限，也不会调用任何写入 Etsy 的接口。

## 9. 授权成功后应该看到什么

授权成功后，页面会显示：

- `Etsy 授权成功`
- `shop_id`
- `shop_name`
- Etsy 返回的原始 JSON

本地会生成：

```text
etsy-token.json
etsy-shops.json
```

`etsy-token.json` 保存 access token、refresh token、过期时间和 user_id。

`etsy-shops.json` 保存店铺信息。

## 10. 如何确认已经拿到 shop_id

打开：

```text
https://xxxx.trycloudflare.com/etsy/test-shops
```

如果页面显示 `shop_id` 和 `shop_name`，就说明已经成功读取到店铺。

也可以在本地查看：

```bash
cat etsy-shops.json
```

## 11. 如何确认 listing 和 order 数据能读取

读取商品列表：

```text
https://xxxx.trycloudflare.com/etsy/test-listings
```

成功后会生成：

```text
etsy-listings.json
```

页面会显示：

- count
- 前 5 个 listing 的 `listing_id`、`title`、`state`、`price`、`quantity`、`views`、`num_favorers`

读取订单 receipts：

```text
https://xxxx.trycloudflare.com/etsy/test-receipts
```

成功后会生成：

```text
etsy-receipts.json
```

页面会显示：

- count
- 前 5 条 receipt 的 `receipt_id`、`created_timestamp`、`grandtotal/total_price`、`is_paid`、`is_shipped`

读取交易 transactions：

```text
https://xxxx.trycloudflare.com/etsy/test-transactions
```

成功后会生成：

```text
etsy-transactions.json
```

页面会显示前 5 条交易明细。

## 12. 已确认的 Etsy Open API v3 路径

代码使用 Etsy 官方 OpenAPI spec 中的这些只读路径：

```text
GET /v3/application/users/{user_id}/shops
GET /v3/application/shops/{shop_id}/listings/active
GET /v3/application/shops/{shop_id}/receipts
GET /v3/application/shops/{shop_id}/transactions
```

请求头使用：

```text
x-api-key: keystring:shared_secret
Authorization: Bearer access_token
```

## 13. Token 自动刷新

`server.js` 里实现了：

```js
getValidAccessToken()
```

逻辑：

1. 读取 `etsy-token.json`
2. 如果 access token 即将过期，自动用 refresh token 刷新
3. 保存新的 access token、refresh token、expires_at、updated_at
4. 如果 Etsy API 返回 401，会强制刷新 token 后重试一次

Etsy refresh token 可能轮换，所以每次刷新后都会保存新的 refresh token。

## 14. 常见错误排查

### redirect_uri 不一致

现象：授权失败，或 token 换取失败。

检查这两个地方必须完全一致：

- Etsy Developer App Callback URL
- `.env` 里的 `ETSY_REDIRECT_URI`

包括 `https://`、域名、路径 `/etsy/callback` 都要一致。

### access_denied

一般是 Etsy 授权页上点了拒绝，或者当前账号没有授权该 App。

重新打开：

```text
/etsy/connect
```

再授权一次。

### invalid_grant

常见原因：

- 授权 code 已经被用过
- code 过期
- `ETSY_REDIRECT_URI` 和授权时使用的不一致
- server 重启导致 PKCE `code_verifier` 丢失

重新打开 `/etsy/connect` 授权。

### invalid state

说明回调里的 state 和本地保存的不一致，通常是：

- 授权过程中重启了 Node 服务
- 打开了多个授权链接，旧链接失效
- 回调不是从当前这次 `/etsy/connect` 来的

重新打开 `/etsy/connect` 授权。

### 401 unauthorized

常见原因：

- access token 过期
- refresh token 已失效
- scope 不够
- `x-api-key` 或 `Authorization` 头不正确

代码会自动刷新 token 并重试一次。如果仍然失败，请重新授权。

### 429 rate limit

说明 Etsy API 限流。

代码会读取 `retry-after` 并简单等待后重试一次。如果仍然失败，等一会儿再刷新页面。

### cloudflared 地址变化

Cloudflare Quick Tunnel 的地址是临时的。地址变了以后，必须同步修改：

1. Etsy Developer App Callback URL
2. `.env` 里的 `ETSY_REDIRECT_URI`
3. 重启 Node 服务

## 15. 华磊物流 API 本地配置

这部分用于先验证华磊系统 API 能不能拿到物流渠道、跟踪号和费用字段。

`.env` 里新增了这些配置：

```env
HUALEI_API_BASE=http://www.sz56t.com:8082
HUALEI_LABEL_BASE=http://www.sz56t.com:8089
HUALEI_USERNAME=
HUALEI_PASSWORD=
HUALEI_CUSTOMER_ID=
HUALEI_CUSTOMER_USER_ID=
```

先只需要填写：

```env
HUALEI_USERNAME=华磊账号
HUALEI_PASSWORD=华磊密码
```

填完后重启本地后端，再按顺序打开：

```text
http://localhost:3001/logistics/config
http://localhost:3001/logistics/auth
http://localhost:3001/logistics/products
```

`/logistics/auth` 成功后会生成：

```text
hualei-auth.json
```

里面会有 `customer_id` 和 `customer_userid`。如果后面创建物流订单，就需要这两个字段。

测试某个 Etsy 订单号是否能返回物流费用：

```text
http://localhost:3001/logistics/test-fees?orderNo=你的订单号
```

这个接口会调用华磊的 `getOrderTrackingNumberBatch.htm`，并自动找疑似费用字段，例如 `orderpricetrial_amount`、`total_amount`、`fee`、`cost` 等。

如果真实已计费订单也没有返回费用字段，就需要向华磊或货代确认是否有单独的“费用明细 / 账单查询 / 订单费用”接口。

## 16. 项目边界

当前只验证本地取数和外部 API 调通链路。

不做：

- 前端 dashboard
- 数据库
- 定时任务
- 正式部署
- 广告数据
- 流量来源数据
- 客户咨询数据
- 写商品
- 改库存
- 发货
- 上传图片
