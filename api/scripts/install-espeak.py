"""Install pinned eSpeak NG into .local, without changing system packages.

Run: python3 scripts/install-espeak.py
Build dependencies stay in .local/espeak-build; runtime is .local/espeak.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

root = Path(__file__).resolve().parent.parent
work = root / ".local" / "espeak-build"
prefix = root / ".local" / "espeak"
version = "1.52.0"
source_url = f"https://codeload.github.com/espeak-ng/espeak-ng/tar.gz/refs/tags/{version}"
expected_sha256 = "bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23"
installed = prefix / "workforce-install.json"
if installed.exists() and "--rebuild" not in sys.argv:
    manifest = json.loads(installed.read_text())
    if manifest.get("version") == version:
        subprocess.run([str(prefix / "bin" / "espeak-ng"), "--version"], check=True)
        print(json.dumps(manifest))
        sys.exit(0)
work.mkdir(parents=True, exist_ok=True)
archive = work / f"espeak-ng-{version}.tar.gz"
if not archive.exists():
    print("Downloading official eSpeak NG source", flush=True)
    with urllib.request.urlopen(source_url, timeout=60) as response:
        contents = response.read(32 * 1024 * 1024 + 1)
        if len(contents) > 32 * 1024 * 1024:
            raise RuntimeError("Source archive exceeds size limit")
        archive.write_bytes(contents)
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_sha256:
    raise RuntimeError("Source archive checksum mismatch")
source = work / f"espeak-ng-{version}"
if not source.exists():
    with tarfile.open(archive) as package:
        for member in package.getmembers():
            path = (work / member.name).resolve()
            safe_link = member.issym() and work.resolve() in (path.parent / member.linkname).resolve().parents
            if work.resolve() not in path.parents or not (member.isfile() or member.isdir() or safe_link):
                raise RuntimeError("Unsafe source archive member")
        package.extractall(work)
cmake = shutil.which("cmake")
if not cmake:
    env = work / "tools"
    if not (env / "bin" / "python3").exists():
        subprocess.run([sys.executable, "-m", "venv", str(env)], check=True)
    cmake = str(env / "bin" / "cmake")
    if not Path(cmake).exists():
        subprocess.run([str(env / "bin" / "python3"), "-m", "pip", "install", "cmake==3.31.6"], check=True)
build = work / "build"
subprocess.run([cmake, "-S", str(source), "-B", str(build),
                f"-DCMAKE_INSTALL_PREFIX={prefix}", "-DCMAKE_BUILD_TYPE=Release",
                "-DBUILD_TESTING=OFF", "-DBUILD_SHARED_LIBS=OFF", "-DUSE_LIBPCAUDIO=OFF",
                "-DUSE_LIBSONIC=OFF", "-DUSE_MBROLA=OFF", "-DUSE_ASYNC=OFF",
                "-DEXTRA_yue=ON"], check=True)
subprocess.run([cmake, "--build", str(build), "--parallel", "4"], check=True)
subprocess.run([cmake, "--install", str(build)], check=True)
subprocess.run([str(prefix / "bin" / "espeak-ng"), "--version"], check=True)
for name in ("COPYING", "LICENSE"):
    if (source / name).is_file():
        shutil.copyfile(source / name, prefix / name)
manifest = {"version": version, "source": source_url,
            "source_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "platform": sys.platform, "runtime_bytes": sum(p.stat().st_size for p in prefix.rglob("*") if p.is_file())}
(prefix / "workforce-install.json").write_text(json.dumps(manifest, indent=2))
print(json.dumps(manifest), flush=True)
