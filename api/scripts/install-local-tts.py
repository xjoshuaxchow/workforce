"""Install private, pinned CPU TTS runtime and verified models. No global install."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import venv

BASE = pathlib.Path(__file__).resolve().parents[1]
YUE_REPO = 'csukuangfj/vits-cantonese-hf-xiaomaiiwn'
YUE_REVISION = '27e0da148bbe6c120107c0d6d01c218337f803e8'
YUE_SHA = '7d8d4f5550b607999417a99131b034c8cc2b8dca69f9e9fdefeff6655643c139'
EN_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2'
EN_SHA = '9e3febfacf0abf4270172d2958bcec246032b7e88efc2720840cc80c93de334e'
EN_MODEL_SHA = '4ba07d8549906668ee855fd9abf9faf66c5db74742712ff026a159f7277fca9f'
PACKAGES = ['sherpa-onnx==1.12.35', 'sherpa-onnx-core==1.12.35', 'numpy==2.0.2', 'lameenc==1.8.1', 'opencc-python-reimplemented==0.1.7']

def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()

def matches_model_file(path, info):
    if not path.is_file() or path.stat().st_size != info['size']:
        return False
    expected = info.get('lfs', {}).get('oid')
    if expected:
        return digest(path) == expected
    data = path.read_bytes()
    header = b'blob ' + str(len(data)).encode('ascii') + b'\0'
    return hashlib.sha1(header + data).hexdigest() == info['oid']

def download(url, target, size, expected):
    if target.exists() and target.stat().st_size == size and digest(target) == expected:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + '.part')
    if size < 1024 * 1024:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read(size + 1)
        if len(data) != size:
            raise ValueError('Unexpected download size')
        partial.write_bytes(data)
    else:
        fd = os.open(partial, os.O_RDWR | os.O_CREAT | os.O_TRUNC, 0o600)
        block = 8 * 1024 * 1024
        ranges = [(start, min(size - 1, start + block - 1)) for start in range(0, size, block)]
        def fetch(bounds):
            start, end = bounds
            req = urllib.request.Request(url + ('&' if '?' in url else '?') + 'part=' + str(start), headers={'Range': 'bytes=%d-%d' % bounds})
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        if r.status != 206 or r.headers.get('Content-Range') != 'bytes %d-%d/%d' % (start, end, size):
                            raise ValueError('Unexpected download range')
                        offset = start
                        while offset <= end:
                            chunk = r.read(min(65536, end - offset + 1))
                            if not chunk:
                                raise ValueError('Truncated download')
                            os.pwrite(fd, chunk, offset)
                            offset += len(chunk)
                    return end - start + 1
                except Exception:
                    if attempt == 2:
                        raise
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                completed = 0
                for future in concurrent.futures.as_completed([pool.submit(fetch, part) for part in ranges]):
                    completed += future.result()
                    print('download', target.name, completed, '/', size, flush=True)
        finally:
            os.close(fd)
    if partial.stat().st_size != size or digest(partial) != expected:
        raise ValueError('Download checksum mismatch: ' + target.name)
    partial.replace(target)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=pathlib.Path, default=BASE / '.local/onnx-tts')
    parser.add_argument('--seed-cantonese', type=pathlib.Path)
    args = parser.parse_args()
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    marker = root / 'installed.json'
    # A failed reinstall must not leave a success marker.
    marker.unlink(missing_ok=True)
    env = root / 'venv'
    if not (env / 'bin/python').exists():
        venv.EnvBuilder(with_pip=True).create(env)
    subprocess.run([str(env / 'bin/python'), '-m', 'pip', 'install', '--only-binary=:all:', *PACKAGES], check=True)
    yue = root / 'yue'
    yue.mkdir(exist_ok=True)
    with urllib.request.urlopen('https://huggingface.co/api/models/' + YUE_REPO + '/tree/' + YUE_REVISION, timeout=30) as r:
        files = json.load(r)
    for item in files:
        if item.get('type') != 'file' or item['path'] == '.gitattributes':
            continue
        name = item['path']
        if '/' in name or name.startswith('.'):
            raise ValueError('Unexpected model file')
        expected = item.get('lfs', {}).get('oid')
        if name.endswith('.onnx') and expected != YUE_SHA:
            raise ValueError('Cantonese model identity changed')
        target = yue / name
        if matches_model_file(target, item):
            continue
        seed = args.seed_cantonese / name if args.seed_cantonese else None
        if seed and matches_model_file(seed, item):
            partial = target.with_suffix(target.suffix + '.part')
            shutil.copyfile(seed, partial)
            partial.replace(target)
            continue
        url = 'https://huggingface.co/' + YUE_REPO + '/resolve/' + YUE_REVISION + '/' + name
        if not expected:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = r.read(1024 * 1024)
            if len(data) != item['size']:
                raise ValueError('Wrong model auxiliary file size')
            partial = target.with_suffix(target.suffix + '.part')
            partial.write_bytes(data)
            if not matches_model_file(partial, item):
                raise ValueError('Auxiliary model file identity changed')
            partial.replace(target)
        else:
            download(url, target, item['size'], expected)
    en_model = root / 'en/en_US-lessac-medium.onnx'
    en_ready = en_model.is_file() and digest(en_model) == EN_MODEL_SHA and (root / 'en/tokens.txt').is_file() and (root / 'en/espeak-ng-data/phontab').is_file()
    if not en_ready:
        archive = root / 'english.tar.bz2'
        download(EN_URL, archive, 67230653, EN_SHA)
        staging = root / 'english-extract'
        staging.mkdir(exist_ok=True)
        with tarfile.open(archive, 'r:bz2') as tar:
            members = tar.getmembers()
            total = 0
            for item in members:
                dest = (staging / item.name).resolve()
                if staging not in dest.parents or item.issym() or item.islnk() or not (item.isfile() or item.isdir()):
                    raise ValueError('Unsafe model archive member')
                total += item.size
                if total > 150 * 1024 * 1024:
                    raise ValueError('Model archive too large')
            tar.extractall(staging, members=members)
        source = staging / 'vits-piper-en_US-lessac-medium'
        shutil.copytree(source, root / 'en', dirs_exist_ok=True)
        shutil.rmtree(staging)
        archive.unlink()
        if digest(en_model) != EN_MODEL_SHA:
            raise ValueError('English model identity changed')
    subprocess.run([str(env / 'bin/python'), '-c', 'import sherpa_onnx,numpy,lameenc; from opencc import OpenCC; assert OpenCC("t2s").convert("測試") == "测试"'], check=True)
    manifest = {'version': 'local-v1', 'packages': PACKAGES, 'cantonese_revision': YUE_REVISION, 'cantonese_sha256': YUE_SHA, 'english_archive_sha256': EN_SHA, 'sources': ['https://huggingface.co/' + YUE_REPO, EN_URL], 'cantonese_model_license': 'not stated by upstream; no commercial license claim'}
    (root / 'UPSTREAM.json').write_text(json.dumps(manifest, indent=2))
    manifest['file_bytes'] = sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and not p.is_symlink())
    marker.write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'installed': True, 'root': str(root), 'file_bytes': manifest['file_bytes']}), flush=True)

if __name__ == '__main__':
    main()
