"""Regression: migrations wait for PostgreSQL TCP, not its temporary init socket.
Run after building the API image: python3 test/docker-readiness.py
Uses only a unique disposable Compose project, then removes its own volumes.
"""
import json, pathlib, subprocess, tempfile, time, uuid
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='workforce-readiness-') as folder:
    temp=pathlib.Path(folder)
    env=temp/'.env'
    subprocess.run(['python3',str(root/'scripts/setup-deploy.py'),'--file',str(env)],check=True,capture_output=True)
    delay=temp/'slow-init.sql'
    delay.write_text('SELECT pg_sleep(12);\n')
    delay.chmod(0o644)
    overlay=temp/'slow.yaml'
    overlay.write_text('services:\n  workforce-db:\n    volumes:\n      - type: bind\n        source: '+json.dumps(str(delay))+'\n        target: /docker-entrypoint-initdb.d/99-readiness.sql\n        read_only: true\n')
    command=['docker','compose','--project-name','workforce-readiness-'+uuid.uuid4().hex[:10],'--env-file',str(env),'-f',str(root/'compose.yaml'),'-f',str(overlay)]
    def run(args,check=True):
        result=subprocess.run(command+args,cwd=root,capture_output=True,text=True,timeout=120)
        if check and result.returncode:
            raise RuntimeError(result.stderr[-3000:])
        return result.stdout.strip()
    try:
        started=time.monotonic()
        run(['up','-d','--no-build','workforce-init'])
        container=run(['ps','--all','--quiet','workforce-init'])
        result=subprocess.run(['docker','wait',container],capture_output=True,text=True,check=True,timeout=90)
        if result.stdout.strip()!='0':
            logs=run(['logs','--no-color','--tail=50','workforce-init'],check=False)
            raise AssertionError('Migration started before TCP readiness:\n'+logs[-3000:])
        assert time.monotonic()-started>=12,'Initialization delay fixture did not run'
        print('PASS: fresh database waited through temporary socket-only initialization before migrations and admin seed.')
    finally:
        run(['down','--volumes','--remove-orphans'],check=False)
