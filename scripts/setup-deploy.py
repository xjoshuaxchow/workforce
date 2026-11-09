"""Create private deployment inputs once; never print or rotate existing secrets."""
import argparse,base64,os,pathlib,secrets
root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--file',type=pathlib.Path,default=root/'.env')
args=parser.parse_args()
if args.file.exists():
    print('Existing configuration preserved.')
else:
    content=(root/'.env.example').read_text()
    values={'WORKFORCE_DB_PASSWORD':secrets.token_hex(32),'WORKFORCE_SETTINGS_KEY':base64.b64encode(secrets.token_bytes(32)).decode(),'MESSAGING_SECRET':secrets.token_hex(32),'SEED_ADMIN_PASSWORD':secrets.token_urlsafe(24),'WHATSAPP_WEBHOOK_VERIFY_TOKEN':secrets.token_hex(32)}
    for key,value in values.items():
        content=content.replace(key+'=\n',key+'='+value+'\n')
    fd=os.open(args.file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as stream:stream.write(content)
    print('Created private configuration. View it locally to obtain initial administrator credentials; do not post it in chat.')
