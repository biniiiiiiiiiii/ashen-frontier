"""发布接收器的集成检查：正常发布、回滚、校验失败和危险归档。"""
import hashlib
import importlib.util
import io
import json
import os
import tarfile
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).with_name('receive_release.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


def archive(sha, invalid=None):
    payload = io.BytesIO()
    entries = {'index.html': '<html>game</html>', 'version.json': json.dumps({'schema': 1, 'sha': sha, 'repository': 'biniiiiiiiiiii/ashen-frontier'})}
    if invalid:
        entries[invalid] = 'invalid'
    with tarfile.open(fileobj=payload, mode='w:gz') as tar:
        for name, content in entries.items():
            data = content.encode()
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    return payload.getvalue()


def verify():
    with tempfile.TemporaryDirectory(prefix='ashen-frontier-verify-') as folder:
        root = Path(folder).resolve()
        assert root.parent == Path(tempfile.gettempdir()).resolve()
        (root / 'releases').mkdir()
        sha = 'a' * 40
        package = root / 'good.tar.gz'
        package.write_bytes(archive(sha))
        target = root / 'extract'
        target.mkdir()
        receiver.extract(package, target, sha)
        assert (target / 'index.html').is_file()
        for index, name in enumerate(['../escape', '/escape', 'bad\\escape']):
            bad = root / ('bad-%s.tar.gz' % index)
            bad.write_bytes(archive(sha, name))
            destination = root / ('bad-%s' % index)
            destination.mkdir()
            try:
                receiver.extract(bad, destination, sha)
            except ValueError:
                pass
            else:
                raise AssertionError('未拒绝危险路径')
        try:
            os.symlink('releases/' + sha, str(root / 'link-check'))
            (root / 'link-check').unlink()
        except OSError:
            if os.name != 'nt':
                raise
            print('本机已验证打包与路径限制；完整版本切换在 Linux Actions 中验证。')
            return
        original = receiver.healthy
        try:
            receiver.healthy = lambda config, version: True
            config = {'app_root': str(root), 'health_url': 'http://127.0.0.1:8081'}
            def deploy(version):
                data = archive(version)
                receiver.receive(config, 'deploy %s %s' % (version, hashlib.sha256(data).hexdigest()), io.BytesIO(data))
            deploy(sha)
            assert receiver.current(root) == sha
            deploy('b' * 40)
            receiver.receive(config, 'rollback previous', io.BytesIO())
            assert receiver.current(root) == sha
            receiver.healthy = lambda config, version: False
            try:
                deploy('c' * 40)
            except RuntimeError:
                pass
            else:
                raise AssertionError('未拒绝不健康版本')
            assert receiver.current(root) == sha
            try:
                receiver.receive(config, 'deploy %s %s' % ('d' * 40, '0' * 64), io.BytesIO(archive('d' * 40)))
            except ValueError:
                pass
            else:
                raise AssertionError('未拒绝错误校验和')
            for command in ['whoami', 'rollback ../../etc', 'deploy bad hash']:
                try:
                    receiver.receive(config, command, io.BytesIO())
                except ValueError:
                    pass
                else:
                    raise AssertionError('未拒绝越权命令')
        finally:
            receiver.healthy = original
        print('发布、回滚、健康失败恢复、归档路径和受限命令检查通过。')


if __name__ == '__main__':
    verify()
