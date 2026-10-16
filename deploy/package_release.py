"""只打包构建产物，并在包内写入可核对的版本标记。"""
import json
import re
import sys
import tarfile
from pathlib import Path


def package(source, sha, destination):
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('版本必须是完整提交 SHA')
    source = Path(source).resolve()
    if not (source / 'index.html').is_file():
        raise ValueError('缺少构建入口')
    version = {'schema': 1, 'sha': sha, 'repository': 'biniiiiiiiiiii/ashen-frontier'}
    (source / 'version.json').write_text(json.dumps(version), encoding='utf-8')
    with tarfile.open(destination, 'w:gz') as archive:
        for entry in sorted(source.rglob('*')):
            if entry.is_symlink():
                raise ValueError('构建产物不允许包含符号链接')
            if entry.is_file():
                archive.add(str(entry), arcname=entry.relative_to(source).as_posix(), recursive=False)
    print('已打包版本：' + sha)


if __name__ == '__main__':
    package(*sys.argv[1:])
