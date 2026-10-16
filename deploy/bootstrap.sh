#!/usr/bin/env bash
# 仅在检查服务器环境后由管理员执行一次，不改动其他容器或站点。
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
    echo '使用方式：由 root 执行 bootstrap.sh 项目部署公钥文件'
    exit 1
fi
public_key="$(cat -- "$1")"
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+\ ashen-frontier-actions$ ]] || { echo '部署公钥格式不正确'; exit 1; }
command -v docker >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null
docker info >/dev/null
if ss -ltn | awk '{print $4}' | grep -Eq '(^|:)8081$'; then
    echo '8081 已被占用，停止初始化'
    exit 1
fi
if docker container inspect ashen-frontier-web >/dev/null 2>&1; then
    echo '游戏容器已存在，停止初始化，避免覆盖'
    exit 1
fi
if [[ -e /etc/ashen-frontier || -e /srv/ashen-frontier ]]; then
    echo '游戏配置目录已经存在，需要人工检查后恢复初始化'
    exit 1
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
image="${NGINX_IMAGE:-nginx:stable-alpine}"
# 先确认镜像可用，再创建账户和目录；不修改 Docker 镜像源。
if ! docker image inspect "$image" >/dev/null 2>&1; then docker pull "$image"; fi
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
if ! id ashen-deploy >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash ashen-deploy
    usermod --password '*' ashen-deploy
else
    echo 'ashen-deploy 账户已存在，需要检查后再继续'
    exit 1
fi
install -d -m 755 /etc/ashen-frontier /usr/local/libexec
install -m 644 "$script_dir/nginx.conf" /etc/ashen-frontier/nginx.conf
install -m 755 "$script_dir/receive_release.py" /usr/local/libexec/ashen-frontier-receiver
python3 - <<'PY'
import json
from pathlib import Path
Path('/etc/ashen-frontier/deploy.json').write_text(json.dumps({'app_root':'/srv/ashen-frontier','health_url':'http://127.0.0.1:8081'}),encoding='utf-8')
PY
install -d -o ashen-deploy -g ashen-deploy -m 755 /srv/ashen-frontier /srv/ashen-frontier/releases /srv/ashen-frontier/.incoming /srv/ashen-frontier/releases/bootstrap
printf '%s\n' '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>灰烬边境</title><p>游戏部署准备中。</p></html>' > /srv/ashen-frontier/releases/bootstrap/index.html
printf '%s\n' '{"sha":"bootstrap"}' > /srv/ashen-frontier/releases/bootstrap/version.json
chmod 644 /srv/ashen-frontier/releases/bootstrap/*
chown ashen-deploy:ashen-deploy /srv/ashen-frontier/releases/bootstrap/*
runuser -u ashen-deploy -- ln -s releases/bootstrap /srv/ashen-frontier/current
install -d -o ashen-deploy -g ashen-deploy -m 700 /home/ashen-deploy/.ssh
printf 'restrict,command="/usr/local/libexec/ashen-frontier-receiver" %s\n' "$public_key" > /home/ashen-deploy/.ssh/authorized_keys
chown ashen-deploy:ashen-deploy /home/ashen-deploy/.ssh/authorized_keys
chmod 600 /home/ashen-deploy/.ssh/authorized_keys
docker run --detach --name ashen-frontier-web \
    --label app=ashen-frontier --restart unless-stopped \
    --read-only --user nginx:nginx --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m \
    --publish 8081:8080 \
    --volume /etc/ashen-frontier/nginx.conf:/etc/nginx/nginx.conf:ro,Z \
    --volume /srv/ashen-frontier:/srv/ashen-frontier:ro,Z \
    --log-opt max-size=10m --log-opt max-file=3 \
    "$image_id"
for attempt in {1..15}; do
    if curl --fail --silent http://127.0.0.1:8081/version.json; then
        echo
        echo '游戏容器初始化成功，尚需检查防火墙与阿里云安全组。'
        exit 0
    fi
    sleep 1
done
echo '容器健康检查失败，请检查 ashen-frontier-web 日志；未修改其他容器。'
exit 1
