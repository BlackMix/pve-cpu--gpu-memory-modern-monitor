import sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import collector as c

class GPU(unittest.TestCase):
    def test_mixed_pci(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            def device(bus,vendor,driver,cls='0x030000'):
                p=root/bus;p.mkdir()
                for k,v in {'vendor':vendor,'class':cls,'device':'0x1234'}.items(): (p/k).write_text(v)
                (p/'driver').symlink_to(root/'drivers'/driver)
                return p
            amd=device('0000:04:00.0','0x1002','amdgpu')
            device('0000:04:00.1','0x1002','snd_hda_intel','0x040300')
            device('0000:03:00.0','0x10de','nvidia')
            device('0000:05:00.0','0x8086','vfio-pci')
            intel=device('0000:00:02.0','0x8086','i915');(intel/'drm/card0').mkdir(parents=True)
            device('0000:06:00.0','0x8086','xe')
            for k,v in {'gpu_busy_percent':'0','mem_info_vram_used':'1048576','mem_info_vram_total':'4194304'}.items(): (amd/k).write_text(v)
            hw=amd/'hwmon/hwmon0';hw.mkdir(parents=True)
            for k,v in {'temp1_input':'54000','power1_average':'168000000','power1_cap':'390000000','fan1_input':'1500','fan1_max':'3000'}.items(): (hw/k).write_text(v)
            with patch.object(c,'PCI',root),patch.object(c,'pci_name',side_effect=lambda b,v,d:v),patch.object(c,'query_nvidia',return_value=[dict(bus='0000:03:00.0',vendor='NVIDIA',usage=97)]),patch.object(c,'intel_usage',return_value=42):
                gpus,error=c.query_gpus()
            self.assertIsNone(error);self.assertEqual(len(gpus),5)
            g={g['bus']:g for g in gpus};a=g['0000:04:00.0']
            self.assertEqual([a[k] for k in ('usage','vram_used','vram_total','temp','fan','power','power_limit')],[0,1,4,54,50,168,390])
            self.assertEqual(g['0000:03:00.0']['usage'],97)
            self.assertTrue(g['0000:05:00.0']['passthrough']);self.assertIsNone(g['0000:05:00.0']['usage'])
            self.assertEqual(g['0000:00:02.0']['usage'],42);self.assertIsNone(g['0000:00:02.0']['vram_total'])
            self.assertIsNone(g['0000:06:00.0']['usage'])
    def test_intel_stream(self):
        self.assertEqual(c.intel_engine_usage('[{"engines":{"Render":{"busy":2},"Video":{"busy":7}}},{"engines":{"Render":{"busy":42},"Video":{"busy":0}}},{"engines":'),42)
        self.assertIsNone(c.intel_engine_usage('[{"engines":{"Render":{"busy":null}}}]'))
        self.assertEqual(c.intel_engine_usage('[{"engines":{"Render":{"busy":0}}}]'),0)
    def test_nvidia_bus(self):
        with patch.object(c.shutil,'which',return_value='/usr/bin/nvidia-smi'),patch.object(c.subprocess,'run',return_value=SimpleNamespace(stdout='0, RTX 3090, 00000000:03:00.0, 620.73.04, 0, 1, 24576, 44, N/A, 49, 390\n')):
            g=c.query_nvidia()[0]
        self.assertEqual(g['bus'],'0000:03:00.0');self.assertEqual(g['usage'],0);self.assertIsNone(g['fan'])

if __name__=='__main__':unittest.main()
