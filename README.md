# 邻里通

社区公共服务协同治理平台，面向居民、社区工作人员、街道/管理者三类用户。

## 功能

- 邮箱注册与登录，支持三类角色
- 居民提交诉求、查看处理进度、报名活动、查看公告
- 社区工作人员受理事项、分派任务、更新处理状态、发布公告、发布/删除活动
- 街道/管理者查看统计数据、高频问题和治理效果
- SQLite 本地数据库存储，首次启动可从旧版 `data/db.json` 自动迁移

## 本地运行

```bash
npm install
npm start
```

默认访问地址：

```text
http://127.0.0.1:3000
```

## 万能演示账号

- 邮箱：`demo@linlitong.local`
- 密码：`demo123456`
- 登录时可选择居民、社区工作人员、街道/管理者任一身份

## 测试

```bash
npm test
npm run check
```

## 部署说明

项目使用 SQLite 本地文件数据库，不需要单独部署 MySQL/PostgreSQL 等数据库服务。部署平台需要先安装依赖：

```bash
npm install
```

然后启动服务：

```bash
node server.js
```

可选环境变量：

- `PORT`：服务端口，默认 `3000`
- `HOST`：监听地址，默认 `127.0.0.1`
- `DB_FILE`：SQLite 数据库文件路径，默认 `data/linlitong.sqlite`
- `DATA_FILE`：旧版 JSON 数据文件路径，默认 `data/db.json`，仅用于首次迁移

生产环境建议把 `DB_FILE` 指向持久化磁盘，并将 `HOST` 设置为部署平台要求的监听地址。SQLite 是本地文件数据库，云服务器只需要保证 `data/` 目录可写。
