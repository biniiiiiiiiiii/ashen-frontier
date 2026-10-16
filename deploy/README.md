# GitHub Actions 自动部署

## 已确定的目标

- 仓库：`biniiiiiiiiiii/ashen-frontier`，私有，默认分支 `main`。
- 服务器：`39.97.238.154:22`，Alibaba Cloud Linux 3，已有 Docker 和其他网站。
- 游戏地址：`http://39.97.238.154:8081/`。
- 独立容器：`ashen-frontier-web`，只读 Nginx 容器，不挂载 Docker Socket。
- 独立目录：`/srv/ashen-frontier`；配置在 `/etc/ashen-frontier`。

2026-10-17 已完成服务器初始化和安全组 8081 放行，公网版本接口可访问，`ECS_READY=true`。临时 root 初始化授权已移除；日常推送使用 `ashen-deploy` 专用受限账号。实际版本回滚和恢复已通过服务器健康检查。

## 发布流程

推送 `main` → 无服务器凭据的构建任务 → 校验部署接收器并打包 `dist/` → 发布任务读取专用 SSH 密钥 → 校验服务器身份 → 上传版本包 → 校验 SHA256、包内路径及版本 → 原子切换 `current` → 本机版本健康检查 → 公网版本检查。

初始化完成前，仓库变量 `ECS_READY=false`，Actions 只构建，不尝试部署。完成服务器与公网验证后再设置为 `true`。不需要额外人工确认的日常发布随后自动运行。

构建、传输、归档校验失败不会替换当前版本。本机健康检查失败会切回旧版本。公网检查失败会将任务标为失败，并提示检查安全组或端口，不盲目将有效构建回滚。

## 凭据

GitHub 仓库的 Actions Secrets：

| 名称 | 内容 |
| --- | --- |
| `ECS_DEPLOY_KEY` | 只允许执行本项目发布命令的专用私钥 |
| `ECS_KNOWN_HOSTS` | 已验证的服务器 SSH 主机公钥记录 |

私钥存储在本机项目目录以外，不进入 Git。root 密码不会保存到本项目或 GitHub。临时初始化公钥仅授权当前管理来源地址，并在两小时后失效；配置完成后会主动删除。

日常登录账户为 `ashen-deploy`，不能用该密钥开启交互终端、转发端口或执行任意命令；不属于 Docker 管理组，也不授予 sudo。仅可调用根用户安装的固定接收器：

- `status`：查询当前和历史版本。
- `deploy <提交SHA> <SHA256>`：从标准输入接收本次构建包。
- `rollback previous`：回到上一个版本。
- `rollback <提交SHA>`：回到保留的指定版本。

## 首次初始化

先检查现有容器、8081 监听、系统防火墙和可用 Nginx 镜像。将 `deploy/` 文件复制到服务器临时目录，由 root 执行一次 `bootstrap.sh <专用部署公钥文件>`。该脚本在发现同名容器、项目目录或端口占用时停止；不会修改现有网站配置或 Docker 镜像源。

还需在阿里云安全组放行入方向 TCP 8081。系统防火墙仅在检查实际配置后放行游戏端口，不关闭防火墙。

初始化脚本会先检查或下载官方 Nginx 镜像，然后以本机镜像 ID 固定运行该次安装使用的镜像；后续上传游戏不会自动更新 Nginx。Docker 容器以非 root 用户运行，移除 Linux capabilities，根文件系统只读，运行临时目录位于内存盘。

## 回滚

在 GitHub Actions 中选择“回滚线上版本”，点击 Run workflow。填写 `previous` 或保留版本的完整提交 SHA。回滚与发布共用串行组，不会同时切换版本。

保留最近五个版本，并额外保护当前版本和上一次版本。历史文件的清理仅限本项目 `/srv/ashen-frontier/releases` 内符合提交 SHA 命名的目录。

## 验证

- `npm run build`：类型检查及生产构建。
- `python deploy/verify_receiver.py`：归档越界、校验失败、命令限制、版本切换和失败恢复；Windows 无符号链接权限时只执行可用检查，Linux Actions 完整执行。
- `bash -n deploy/bootstrap.sh`：初始化脚本语法检查。
- 首次上线后通过公网 `version.json` 的提交 SHA 对照 Actions 提交记录，再验证首页与构建资源。

部署脚本更新需要管理员审核并更新服务器上的固定接收器或 Nginx 配置；日常游戏代码发布只上传构建产物。

参考：[GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[Docker 容器运行配置](https://docs.docker.com/engine/containers/run/)。
