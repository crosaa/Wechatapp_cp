# 在另一台电脑继续开发

GitHub 仓库保存源码、脚本、静态资源和可复现配置。数据库、用户上传图片、日志、缓存和本机专用配置不会提交到 Git。

## 1. 克隆源码

在新电脑安装 Git、Node.js 22.5 或更高版本和 pnpm，然后运行：

```powershell
git clone https://github.com/crosaa/Wechatapp_cp.git
cd Wechatapp_cp
pnpm install
pnpm test
```

随后在 Codex 中打开克隆后的 `Wechatapp_cp` 文件夹。微信开发者工具首次导入项目时会自动生成本机的 `project.private.config.json`。

## 2. 迁移现有业务数据（按需）

如果新电脑只用于开发代码，可以跳过本节。若要在新电脑还原当前商品、库存、账号和图片，请在服务停止后，通过移动硬盘或受保护的文件传输方式复制：

- `server/data/catalog.db`：SQLite 主数据库
- `server/uploads/`：用户上传的商品和实拍图片
- `server/inventory-reports/`：历史库存报告（可选）

不要把这些目录提交到 GitHub。它们包含运行数据，体积大，并可能含有敏感业务信息。复制完成后再启动服务，以免 SQLite 数据库处于写入中的不一致状态。

## 3. 日常版本管理

开始工作前同步远程版本：

```powershell
git pull --rebase
```

完成一组改动后提交并推送：

```powershell
git add .
git commit -m "说明本次修改"
git push
```

首次在新电脑推送时，Git Credential Manager 会提示登录 GitHub。不要在仓库中保存密码、Cookie、访问令牌或生产环境 `.env` 文件。
