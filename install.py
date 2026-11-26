#!/usr/bin/env python3
"""Guarded installer for the PVE 9 node Summary extension."""
import argparse
import datetime
import fcntl
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT/'src'
JS = Path('/usr/share/pve-manager/js/pvemanagerlib.js')
PM = Path('/usr/share/perl5/PVE/API2/Nodes.pm')
COLLECTOR = Path('/opt/pve-hardware-monitor/collector.py')
UNIT = Path('/etc/systemd/system/pve-hardware-monitor.service')
SERVICE = 'pve-hardware-monitor.service'
BACKUPS = Path('/var/backups/pve-hardware-monitor')
MARKER = 'PVE-HARDWARE-MONITOR'


def run(*cmd, check=True, capture=False):
    return subprocess.run(cmd, check=check, text=True, capture_output=capture, timeout=180 if cmd[:2] == ('systemctl','restart') else 45)


def remove_block(text, block, label):
    if MARKER not in text:
        return text
    if text.count(block) != 1 or text.count(MARKER) != 2:
        raise RuntimeError(f'{label}: existing monitor block differs; refusing to overwrite. Restore or inspect manually.')
    return text.replace(block, '', 1)


def plan(js, pm, uninstall=False):
    jblock = (SRC/'dashboard.js').read_text()
    pblock = (SRC/'endpoint.pm').read_text()
    known = [jblock] + [path.read_text() for path in sorted((SRC/'legacy').glob('dashboard-*.js'))]
    existing = next((block for block in known if block in js), jblock)
    j = remove_block(js, existing, 'JavaScript')
    p = remove_block(pm, pblock, 'Perl')
    if uninstall:
        return j,p
    if len(re.findall(r"Ext\.define\(['\"]PVE\.node\.Summary['\"]",j)) != 1 or 'pveSelNode' not in j or not re.search(r"alias\s*:\s*['\"]widget\.pveNodeSummary['\"]",j):
        raise RuntimeError('PVE.node.Summary class not found exactly once; unsupported JavaScript layout.')
    if re.search(r"path\s*=>\s*['\"]hardware-monitor['\"]",p):
        raise RuntimeError('hardware-monitor API path already exists; refusing to overwrite.')
    anchor = re.compile(r"(?m)^__PACKAGE__->register_method\(\{\s*\n\s*name\s*=>\s*['\"]status['\"]\s*,\s*\n\s*path\s*=>\s*['\"]status['\"]\s*,\s*\n\s*method\s*=>\s*['\"]GET['\"]")
    matches = list(anchor.finditer(p))
    if len(matches) != 1 or 'package PVE::API2::Nodes::Nodeinfo;' not in p[:matches[0].start()]:
        raise RuntimeError('Node status API anchor not found exactly once; unsupported Perl layout.')
    pos = matches[0].start()
    return j + jblock, p[:pos]+pblock+p[pos:]


def atomic(path, content, mode=0o644):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink():
        raise RuntimeError(f'Refusing to replace symlink: {path}')
    old = path.stat() if path.exists() else None
    fd,tmp = tempfile.mkstemp(prefix='.phm-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f:
            f.write(content)
            f.flush(); os.fsync(f.fileno())
            os.fchmod(f.fileno(),stat.S_IMODE(old.st_mode) if old else mode)
            if old: os.fchown(f.fileno(),old.st_uid,old.st_gid)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def check_host():
    if os.geteuid()!=0: raise RuntimeError('Run as root on the Proxmox host, not inside an LXC.')
    if not Path('/etc/pve').is_dir() or not shutil.which('pveversion'):
        raise RuntimeError('Proxmox VE host not detected.')
    ver=run('pveversion',capture=True).stdout.strip()
    if not re.search(r'pve-manager/9\.',ver): raise RuntimeError(f'Only PVE 9.x is targeted: {ver}')
    print(ver,flush=True)
    if not JS.is_file() or not PM.is_file(): raise RuntimeError('Expected Proxmox UI or API file missing.')
    if not JS.read_text().endswith('\n'): raise RuntimeError('Unexpected JavaScript file ending; refusing patch.')


def known_collector(content):
    """Only replace byte-identical releases; do not overwrite local edits."""
    candidates = [SRC/COLLECTOR.name, *sorted((SRC/'legacy').glob('collector-v*.py'))]
    return any(content == candidate.read_bytes() for candidate in candidates)


def service_active():
    return run('systemctl','is-active','--quiet',SERVICE,check=False).returncode==0


def service_enabled():
    return run('systemctl','is-enabled','--quiet',SERVICE,check=False).returncode==0


def wait_snapshot():
    import time,json
    file=Path('/run/pve-hardware-monitor/metrics.json')
    for _ in range(30):
        try:
            data=json.loads(file.read_text())
            if data['version']==1 and data['cpu']['threads'] and data['memory']['total']>0 and time.time()-data['timestamp']<5:
                return
        except (OSError,ValueError,KeyError): pass
        time.sleep(.5)
    raise RuntimeError('Collector did not produce a valid snapshot; inspect journalctl.')


def preflight_restart():
    import json
    for service in ('pvedaemon','pveproxy'):
        state=run('systemctl','show',service,'-p','ActiveState','--value',capture=True).stdout.strip()
        if state != 'active':
            raise RuntimeError(f'{service}: {state}; resolve service state before restarting PVE.')
    jobs=run('systemctl','list-jobs','--no-legend','--no-pager',capture=True).stdout
    if any(unit in jobs for unit in ('pvedaemon.service','pveproxy.service','corosync.service','pve-cluster.service')):
        raise RuntimeError('Pending PVE systemd jobs; resolve them before proceeding.')
    stuck=run('ps','-eo','pid=,stat=,comm=',capture=True).stdout.splitlines()
    blocked=[line.strip() for line in stuck if len(line.split())>=3 and line.split()[1].startswith('D')]
    if blocked:
        raise RuntimeError('Uninterruptible I/O tasks detected; retry when storage is healthy: '+ '; '.join(blocked[:8]))
    node=run('hostname','-s',capture=True).stdout.strip()
    tasks=json.loads(run('pvesh','get',f'/nodes/{node}/tasks','--source','active','--limit','10000','--output-format','json',capture=True).stdout)
    running=[t for t in tasks if t.get('status')=='RUNNING' or not t.get('status')]
    if running:
        raise RuntimeError('Active PVE tasks detected; finish them first: '+', '.join(str(t.get('type','unknown')) for t in running[:8]))


def restart_pve():
    run('systemctl','restart','pvedaemon')
    run('systemctl','restart','pveproxy')
    run('systemctl','is-active','--quiet','pvedaemon')
    run('systemctl','is-active','--quiet','pveproxy')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['check','install','repair','uninstall','status','activate'],nargs='?',default='install')
    args=parser.parse_args()
    check_host()
    with open('/run/lock/pve-hardware-monitor.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        j,p=JS.read_text(),PM.read_text()
        if args.action=='status':
            print('UI patch:',MARKER in j,'API patch:',MARKER in p)
            run('systemctl','--no-pager','status',SERVICE,check=False)
            return
        if args.action=='activate':
            preflight_restart();restart_pve();print('PVE services restarted. Test HTTPS API and refresh browser.');return
        uninstall=args.action=='uninstall'
        nj,np=plan(j,p,uninstall)
        api_changed=np!=p
        if UNIT.exists() and UNIT.read_bytes()!=(SRC/UNIT.name).read_bytes():
            raise RuntimeError('Service unit differs from this release; refusing overwrite/removal.')
        if COLLECTOR.exists() and not known_collector(COLLECTOR.read_bytes()):
            raise RuntimeError('Collector differs from this release; refusing overwrite/removal.')
        if args.action=='check':
            print('Patch anchors and existing blocks OK. No files changed.')
            if api_changed: preflight_restart()
            print('PVE service restart required:',api_changed);return
        if uninstall and nj==j and np==p and not UNIT.exists() and not COLLECTOR.exists():
            print('Already uninstalled.');return
        if api_changed: preflight_restart()
        paths=[JS,PM,COLLECTOR,UNIT]
        backup=BACKUPS/(datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        backup.mkdir(parents=True,mode=0o700)
        previous={}
        for path in paths:
            if path.is_symlink(): raise RuntimeError(f'Refusing symlink {path}')
            previous[path]=path.read_bytes() if path.exists() else None
            if path.exists(): shutil.copy2(path,backup/path.name)
        active,enabled=service_active(),service_enabled()
        print('Backup:',backup,flush=True)
        restart_attempted=False
        collector_touched=False
        try:
            if nj!=j: atomic(JS,nj.encode())
            if api_changed:
                atomic(PM,np.encode())
                run('perl','-c',str(PM))
            if shutil.which('node'): run('node','--check',str(JS))
            if uninstall:
                if UNIT.exists():
                    collector_touched=True
                    run('systemctl','disable','--now',SERVICE)
                UNIT.unlink(missing_ok=True);COLLECTOR.unlink(missing_ok=True)
                run('systemctl','daemon-reload')
            else:
                collector_changed=previous[COLLECTOR]!=(SRC/COLLECTOR.name).read_bytes()
                unit_changed=previous[UNIT]!=(SRC/UNIT.name).read_bytes()
                collector_touched=collector_changed or unit_changed or not active or not enabled
                if collector_changed: atomic(COLLECTOR,(SRC/COLLECTOR.name).read_bytes())
                if unit_changed:
                    atomic(UNIT,(SRC/UNIT.name).read_bytes())
                    run('systemctl','daemon-reload')
                if not enabled: run('systemctl','enable',SERVICE)
                if collector_changed or unit_changed or not active: run('systemctl','restart',SERVICE)
                wait_snapshot()
                node=run('hostname','-s',capture=True).stdout.strip()
                result=run('pvesh','get',f'/nodes/{node}/hardware-monitor','--output-format','json',capture=True)
                import json
                if json.loads(result.stdout).get('version')!=1: raise RuntimeError('Unexpected pvesh response.')
            if api_changed:
                preflight_restart()
                restart_attempted=True
                restart_pve()
            else: print('API unchanged; no PVE services restarted.')
        except BaseException:
            print('Installation failed; restoring prior files.',file=sys.stderr,flush=True)
            try:
                if collector_touched and UNIT.exists():run('systemctl','disable','--now',SERVICE,check=False)
                for path,content in previous.items():
                    if content is None:path.unlink(missing_ok=True)
                    elif not path.exists() or path.read_bytes()!=content:atomic(path,content)
                if collector_touched:
                    run('systemctl','daemon-reload')
                    if enabled:run('systemctl','enable',SERVICE)
                    if active:run('systemctl','start',SERVICE)
                if restart_attempted:
                    print('Files restored. PVE services may still have pending jobs; inspect systemctl and use activate only after recovery.',file=sys.stderr)
            except Exception as error:
                print(f'Automatic rollback incomplete: {error}; backups: {backup}',file=sys.stderr)
            raise
        print(('Uninstalled' if uninstall else 'Installed')+' successfully. Reload browser (Ctrl/Cmd+Shift+R).',flush=True)

if __name__=='__main__':
    try: main()
    except (Exception,KeyboardInterrupt) as e:
        print(f'ERROR: {e}',file=sys.stderr);sys.exit(1)
