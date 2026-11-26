import importlib.util
import json
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
import collector
import install

JS="Ext.define('PVE.node.Summary', { alias: 'widget.pveNodeSummary', pveSelNode: null });\n"
PM="""package PVE::API2::Nodes::Nodeinfo;
__PACKAGE__->register_method({
    name => 'status',
    path => 'status',
    method => 'GET',
});
1;
"""

class Tests(unittest.TestCase):
    def test_cpu_delta(self):
        old=collector.stat('cpu0 100 20 30 800 50 0 0 0 10 0')
        new=collector.stat('cpu0 120 20 40 860 60 0 0 0 20 0')
        self.assertEqual(collector.percent(old['cpu0'],new['cpu0']),30)
        self.assertIsNone(collector.percent(old['cpu0'],old['cpu0']))
    def test_memory(self):
        m=collector.memory('MemTotal: 1000 kB\nMemFree: 200 kB\nCached: 400 kB\nSReclaimable: 50 kB\nShmem: 100 kB\nBuffers: 20 kB\nMemAvailable: 600 kB\nSwapTotal: 50 kB\nSwapFree: 20 kB')
        self.assertEqual(m['cache'],350*1024)
        self.assertEqual(m['used'],430*1024)
        self.assertEqual(m['total'],sum(m[x] for x in ('used','cache','buffers','free')))
        self.assertEqual(m['swap_used'],30*1024)
    def test_patch_idempotence_and_reversal(self):
        j,p=install.plan(JS,PM)
        self.assertEqual((j,p),install.plan(j,p))
        self.assertEqual((JS,PM),install.plan(j,p,True))
        self.assertEqual((JS+'// another mod\n',PM),install.plan(j+'// another mod\n',p,True))
    def test_upgrade_legacy(self):
        legacy=(ROOT/'src/legacy/dashboard-v0.1.0.js').read_text()
        j,p=install.plan(JS,PM)
        self.assertEqual((j,p),install.plan(JS+legacy,p))
        self.assertEqual((JS,PM),install.plan(JS+legacy,p,True))
        self.assertNotIn('HardwareMonitorOverride',j)
    def test_all_prior_versions(self):
        j,p=install.plan(JS,PM)
        for path in (ROOT/'src/legacy').glob('*.js'):
            with self.subTest(path=path.name):
                self.assertEqual((j,p),install.plan(JS+path.read_text(),p))
                self.assertEqual((JS,PM),install.plan(JS+path.read_text(),p,True))
    def test_known_collector_upgrade(self):
        old=(ROOT/'src/legacy/collector-v0.1.6.py').read_bytes()
        self.assertTrue(install.known_collector(old))
        self.assertTrue(install.known_collector((ROOT/'src/collector.py').read_bytes()))
        self.assertFalse(install.known_collector(old+b'\n# custom modification'))
    def test_reject_changed_blocks(self):
        j,p=install.plan(JS,PM)
        with self.assertRaises(RuntimeError):install.plan(j.replace('Hardware Monitor · Live','changed'),p,True)
        with self.assertRaises(RuntimeError):install.plan(JS,'1;\n')
    def test_preflight(self):
        def fake(*cmd, **kwargs):
            if cmd[0]=='systemctl':
                out='active' if cmd[1]=='show' else ''
            elif cmd[0]=='ps': out='1 S init'
            elif cmd[0]=='hostname': out='pve'
            elif cmd[0]=='pvesh': out='[]'
            else: raise AssertionError(cmd)
            return SimpleNamespace(stdout=out,returncode=0)
        with patch.object(install,'run',side_effect=fake): install.preflight_restart()
        for mode in ('blocked','jobs','tasks','state'):
            def unsafe(*cmd, **kwargs):
                if mode=='blocked' and cmd[0]=='ps': return SimpleNamespace(stdout='12993 D umount')
                if mode=='jobs' and cmd[:2]==('systemctl','list-jobs'): return SimpleNamespace(stdout='pvedaemon.service restart running')
                if mode=='tasks' and cmd[0]=='pvesh': return SimpleNamespace(stdout='[{"type":"vzrestore","status":"RUNNING"}]')
                if mode=='state' and cmd[:2]==('systemctl','show'): return SimpleNamespace(stdout='deactivating')
                return fake(*cmd,**kwargs)
            with self.subTest(mode=mode), patch.object(install,'run',side_effect=unsafe), self.assertRaises(RuntimeError):
                install.preflight_restart()
    def test_live_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'metrics.json'
            script=f'import sys;sys.path.insert(0,{str(ROOT/"src")!r});import collector;from pathlib import Path;collector.OUT=Path({str(out)!r});collector.main()'
            process=subprocess.Popen([sys.executable,'-c',script])
            try:
                deadline=time.monotonic()+8
                data=None
                while time.monotonic()<deadline:
                    try:
                        data=json.loads(out.read_text())
                        if data['cpu']['usage'] is not None:break
                    except (OSError,ValueError):pass
                    time.sleep(.2)
                self.assertIsNotNone(data)
                self.assertTrue(data['cpu']['threads'])
                self.assertIsNotNone(data['cpu']['usage'])
                self.assertGreater(data['memory']['total'],0)
            finally:
                process.terminate();process.wait(timeout=5)

if __name__=='__main__':unittest.main()
