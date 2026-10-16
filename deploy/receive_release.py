#!/usr/bin/env python3
"""仅接收本项目的静态版本包；部署账户不能通过 SSH 执行任意命令。"""
import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path, PurePosixPath

SHA = re.compile(r'^[a-f0-9]{40}$')
MAX_ARCHIVE = 20 * 1024 * 1024
MAX_CONTENT = 40 * 1024 * 1024


def release_name(value):
    """版本名称只能是完整提交编号或初始化版本。"""
    if value != 'bootstrap' and not SHA.fullmatch(value):
        raise ValueError('无效的版本编号')
    return value


def current(root):
    """只接受指向本项目版本目录的相对链接。"""
    path = root / 'current'
    if not path.is_symlink():
        return None
    parts = PurePosixPath(os.readlink(str(path))).parts
    if len(parts) != 2 or parts[0] != 'releases':
        raise ValueError('当前版本链接不在项目目录内')
    return release_name(parts[1])


def switch(root, version):
    """原子替换链接，避免上传中的文件被直接用于线上服务。"""
    temporary = root / ('.current-' + uuid.uuid4().hex)
    os.symlink('releases/' + release_name(version), str(temporary))
    os.replace(str(temporary), str(root / 'current'))


def extract(archive_path, target, sha):
    """逐个验证并复制普通文件，拒绝路径越界、链接、设备和重复条目。"""
    total = 0
    seen = set()
    with tarfile.open(str(archive_path), 'r:gz') as archive:
        for count, member in enumerate(archive, 1):
            if count > 2048:
                raise ValueError('版本文件过多')
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or '\\' in member.name or not name.parts:
                raise ValueError('版本包含非法路径')
            if member.name in seen:
                raise ValueError('版本包含重复文件')
            seen.add(member.name)
            destination = target.joinpath(*name.parts)
            if os.path.commonpath([str(target.resolve()), str(destination.resolve())]) != str(target.resolve()):
                raise ValueError('版本路径越界')
            if member.isdir():
                destination.mkdir(mode=0o755, parents=True, exist_ok=True)
                continue
            if not member.isfile() or member.size > 8 * 1024 * 1024:
                raise ValueError('版本包含不支持的文件')
            total += member.size
            if total > MAX_CONTENT:
                raise ValueError('解压后的版本过大')
            destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError('无法读取版本文件')
            with source, destination.open('xb') as output:
                shutil.copyfileobj(source, output)
            destination.chmod(0o644)
    if not (target / 'index.html').is_file():
        raise ValueError('版本缺少入口文件')
    version = json.loads((target / 'version.json').read_text(encoding='utf-8'))
    if version != {'schema': 1, 'sha': sha, 'repository': 'biniiiiiiiiiii/ashen-frontier'}:
        raise ValueError('包内版本与本次提交不一致')


def healthy(config, sha):
    """在服务器本机验证版本，失败时由调用方恢复旧链接。"""
    for _ in range(12):
        try:
            url = config['health_url'] + '/version.json?check=' + uuid.uuid4().hex
            with urllib.request.urlopen(url, timeout=3) as response:
                version = json.load(response)
            if version.get('sha') == sha:
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


def activate(config, root, sha):
    """版本健康后记录回滚点，失败则自动切回原版本。"""
    previous = current(root)
    switch(root, sha)
    if not healthy(config, sha):
        if previous:
            switch(root, previous)
        else:
            (root / 'current').unlink()
        raise RuntimeError('版本健康检查失败，已恢复原版本')
    if previous and previous != sha:
        temporary = root / '.previous-next'
        temporary.write_text(previous, encoding='ascii')
        os.replace(str(temporary), str(root / '.previous'))


def clean(root):
    """只清理本项目下多余的历史版本，保留当前及回滚点。"""
    protected = {current(root)}
    previous = root / '.previous'
    if previous.exists():
        protected.add(release_name(previous.read_text(encoding='ascii').strip()))
    releases = root / 'releases'
    candidates = sorted([p for p in releases.iterdir() if SHA.fullmatch(p.name) and p.is_dir() and not p.is_symlink()], key=lambda p: p.stat().st_mtime, reverse=True)
    protected.update(p.name for p in candidates[:5])
    for path in candidates:
        if path.name not in protected and path.resolve().parent == releases.resolve():
            shutil.rmtree(str(path))


def receive(config, command, stream):
    """只允许查询、发布和回滚三种固定操作。"""
    root = Path(config['app_root']).resolve()
    arguments = shlex.split(command)
    if arguments == ['status']:
        versions = sorted(p.name for p in (root / 'releases').iterdir() if SHA.fullmatch(p.name))
        print(json.dumps({'current': current(root), 'versions': versions}))
        return
    if len(arguments) == 2 and arguments[0] == 'rollback':
        sha = arguments[1]
        if sha == 'previous':
            sha = (root / '.previous').read_text(encoding='ascii').strip()
        release_name(sha)
        if not (root / 'releases' / sha / 'index.html').is_file():
            raise ValueError('目标版本不存在')
        activate(config, root, sha)
        print(json.dumps({'rollback': sha}))
        return
    if len(arguments) != 3 or arguments[0] != 'deploy' or not SHA.fullmatch(arguments[1]) or not re.fullmatch(r'[a-f0-9]{64}', arguments[2]):
        raise ValueError('只允许发布、查询或回滚本项目')
    sha, expected = arguments[1:]
    releases = root / 'releases'
    incoming = root / '.incoming'
    incoming.mkdir(mode=0o755, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='upload-', dir=str(incoming)) as folder:
        work = Path(folder).resolve()
        if work.parent != incoming.resolve():
            raise ValueError('临时目录校验失败')
        archive_path = work / 'release.tar.gz'
        digest = hashlib.sha256()
        size = 0
        with archive_path.open('wb') as output:
            while True:
                block = stream.read(65536)
                if not block:
                    break
                size += len(block)
                if size > MAX_ARCHIVE:
                    raise ValueError('上传包过大')
                digest.update(block)
                output.write(block)
        if digest.hexdigest() != expected:
            raise ValueError('上传包校验失败')
        target = releases / sha
        if target.exists():
            if target.is_symlink() or (target / '.artifact-sha256').read_text(encoding='ascii') != expected:
                raise ValueError('相同提交对应的版本包不一致')
        else:
            staging = work / 'contents'
            staging.mkdir(mode=0o755)
            extract(archive_path, staging, sha)
            (staging / '.artifact-sha256').write_text(expected, encoding='ascii')
            staging.chmod(0o755)
            os.replace(str(staging), str(target))
        activate(config, root, sha)
        clean(root)
        print(json.dumps({'deployed': sha, 'bytes': size}))


def main():
    """强制命令入口使用系统配置及进程锁，串行处理发布。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='/etc/ashen-frontier/deploy.json')
    options = parser.parse_args()
    config = json.loads(Path(options.config).read_text(encoding='utf-8'))
    os.umask(0o022)
    import fcntl
    root = Path(config['app_root']).resolve()
    with (root / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        receive(config, os.environ.get('SSH_ORIGINAL_COMMAND', ''), sys.stdin.buffer)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('发布未完成：' + str(error), file=sys.stderr)
        sys.exit(1)
