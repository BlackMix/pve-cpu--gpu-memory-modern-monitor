#!/usr/bin/env python3
"""Local read-only hardware sampling. No listening socket or external dependencies."""
import json
from functools import lru_cache
import logging
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

OUT = Path('/run/pve-hardware-monitor/metrics.json')
CPU = Path('/sys/devices/system/cpu')
LOG = logging.getLogger('pve-hardware-monitor')


def read(path, default=''):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


def number(value):
    try:
        n = float(value)
        return n if n == n and abs(n) != float('inf') else None
    except (ValueError, TypeError):
        return None


def stat(text):
    result = {}
    for line in text.splitlines():
        fields = line.split()
        if not fields or not re.fullmatch(r'cpu\d*', fields[0]):
            continue
        try:
            v = list(map(int, fields[1:9])) # guest time is already in user/nice
            if len(v) < 4:
                continue
            result[fields[0]] = (sum(v), sum(v[3:5]))
        except ValueError:
            continue
    return result


def percent(old, new):
    if old is None or new is None:
        return None
    total, idle = new[0]-old[0], new[1]-old[1]
    if total <= 0 or idle < 0:
        return None
    return round(100 * max(0, min(1, (total-idle)/total)), 1)


def memory(text):
    m = {}
    for line in text.splitlines():
        match = re.match(r'^(\w+):\s+(\d+)\s+kB$', line)
        if match:
            m[match[1]] = int(match[2])*1024
    total = m.get('MemTotal', 0)
    free = min(total, m.get('MemFree', 0))
    # Cached includes shmem, which is not normally reclaimable file cache.
    cache = min(total-free, max(0, m.get('Cached', 0) + m.get('SReclaimable', 0) - m.get('Shmem', 0)))
    buffers = min(total-free-cache, m.get('Buffers', 0))
    return dict(total=total, free=free, cache=cache, buffers=buffers,
                used=total-free-cache-buffers, available=m.get('MemAvailable'),
                swap_total=m.get('SwapTotal', 0), swap_used=max(0, m.get('SwapTotal', 0)-m.get('SwapFree', 0)),
                shmem=m.get('Shmem', 0))


def topology():
    result = {}
    for p in CPU.glob('cpu[0-9]*'):
        if not re.fullmatch(r'cpu\d+', p.name):
            continue
        i = int(p.name[3:])
        package = read(p/'topology/physical_package_id')
        core = read(p/'topology/core_id')
        result[i] = (package if package not in ('', '-1') else '?', core if core not in ('', '-1') else str(i))
    return result


def cpuinfo():
    model = ''
    freq = {}
    for block in read('/proc/cpuinfo').split('\n\n'):
        d = dict((k.strip(), v.strip()) for k, v in (x.split(':',1) for x in block.splitlines() if ':' in x))
        model = model or d.get('model name', d.get('Hardware', ''))
        if d.get('processor','').isdigit():
            freq[int(d['processor'])] = number(d.get('cpu MHz'))
    return model or 'CPU', freq


def temperatures():
    out = []
    for p in Path('/sys/class/hwmon').glob('hwmon*'):
        driver = read(p/'name')
        if driver not in ('coretemp','k10temp','zenpower','cpu_thermal','x86_pkg_temp','acpitz'):
            continue
        for f in p.glob('temp*_input'):
            val = number(read(f))
            if val is not None and -20000 <= val <= 150000:
                label = read(f.with_name(f.name.replace('_input','_label')), f.stem)
                out.append(dict(label=f'{driver}: {label}', c=round(val/1000, 1)))
    return out


def arc_size():
    for line in read('/proc/spl/kstat/zfs/arcstats').splitlines():
        f = line.split()
        if len(f) == 3 and f[0] == 'size' and f[2].isdigit():
            return int(f[2])
    return None

GPU_FIELDS = ('index','name','pci.bus_id','driver_version','utilization.gpu','memory.used','memory.total','temperature.gpu','fan.speed','power.draw','power.limit')
PCI = Path('/sys/bus/pci/devices')
VENDORS = {'0x10de':'NVIDIA', '0x1002':'AMD', '0x8086':'Intel'}
METRICS = ('usage','vram_used','vram_total','temp','fan','power','power_limit')
BIN_PATH = '/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin'


def canonical_bus(bus):
    match = re.fullmatch(r'([0-9a-fA-F]{4,8}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])', str(bus))
    if match:
        return f'{int(match[1],16):04x}:{match[2].lower()}:{match[3].lower()}.{match[4]}'
    return str(bus).lower()


@lru_cache(maxsize=128)
def pci_name(bus, vendor, device):
    exe = shutil.which('lspci', path=BIN_PATH)
    if exe:
        try:
            out = subprocess.run([exe,'-D','-s',bus], capture_output=True,text=True,timeout=1,check=True).stdout.strip()
            if ': ' in out:
                return out.split(': ',1)[1]
        except (OSError, subprocess.SubprocessError):
            pass
    return f'{vendor} GPU ({device or bus})'


def discover_gpus():
    devices = {}
    for p in sorted(PCI.glob('*')):
        vendor = VENDORS.get(read(p/'vendor').lower())
        # PCI display controller (VGA, 3D, other display). Exclude audio functions.
        if not vendor or not read(p/'class').lower().startswith('0x03'):
            continue
        bus = canonical_bus(p.name)
        driver = (p/'driver').resolve().name if (p/'driver').is_symlink() else None
        cards = sorted(c for c in (p/'drm').glob('card*') if re.fullmatch(r'card\d+',c.name))
        devices[bus] = (p, cards, dict(bus=bus, vendor=vendor, name=pci_name(bus,vendor,read(p/'device')),driver=driver,
                                     passthrough=driver in ('vfio-pci','pci-stub'), **dict.fromkeys(METRICS)))
    return devices


def query_nvidia():
    exe = shutil.which('nvidia-smi', path=BIN_PATH)
    if not exe:
        return []
    import csv
    try:
        p = subprocess.run([exe, '--query-gpu='+','.join(GPU_FIELDS), '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3, check=True, env={**os.environ,'LC_ALL':'C'})
        result = []
        for row in csv.reader(p.stdout.splitlines(), skipinitialspace=True):
            if len(row) != len(GPU_FIELDS):
                continue
            idx, name, bus, driver, usage, used, total, temp, fan, power, limit = row
            result.append(dict(index=idx, name=name, bus=canonical_bus(bus), vendor='NVIDIA', driver=driver, usage=number(usage),
                vram_used=number(used), vram_total=number(total), temp=number(temp), fan=number(fan),
                power=number(power), power_limit=number(limit),passthrough=False))
        return result
    except (OSError, subprocess.SubprocessError):
        return []


def scaled(path, divisor=1):
    val = number(read(path))
    return val/divisor if val is not None and val >= 0 else None


def first_value(paths, divisor=1):
    for path in paths:
        val = scaled(path, divisor)
        if val is not None:
            return val
    return None


def hwmon_metrics(p, g):
    # Use only sensors underneath this PCI device, never CPU/package sensors.
    for hw in sorted((p/'hwmon').glob('hwmon*')):
        for key, names, div in [('temp',('temp1_input',),1000),('power',('power1_average','power1_input'),1000000),('power_limit',('power1_cap',),1000000)]:
            if g[key] is None:
                g[key] = first_value([hw/n for n in names],div)
        # PWM is a requested duty cycle, not measured fan speed. Use RPM ratio only when maximum is exposed.
        rpm, maximum = scaled(hw/'fan1_input'), scaled(hw/'fan1_max')
        if g['fan'] is None and rpm is not None and maximum is not None and maximum>0:
            g['fan'] = min(100,100*rpm/maximum)


def intel_engine_usage(text):
    # intel_gpu_top streams an array; a timeout may leave the last object incomplete.
    # Accept complete samples only, and use busiest engine (not summed engine percentages).
    decoder = json.JSONDecoder()
    latest = None
    pos = 0
    while pos < len(text):
        while pos < len(text) and text[pos] in ' \r\n\t[,]':
            pos += 1
        if pos >= len(text):
            break
        try:
            sample, pos = decoder.raw_decode(text,pos)
        except ValueError:
            break
        engines = sample.get('engines') if isinstance(sample,dict) else None
        if not isinstance(engines,dict):
            continue
        values = [number(e.get('busy')) for e in engines.values() if isinstance(e,dict)]
        values = [v for v in values if v is not None and 0<=v<=100]
        if values:
            latest = max(values)
    return latest


def intel_usage(card):
    exe = shutil.which('intel_gpu_top',path=BIN_PATH)
    if not exe:
        return None
    # Bound the command, even on versions with no sample-count option.
    try:
        p = subprocess.run([exe,'-J','-s','500','-o','-','-d',f'drm:/dev/dri/{card.name}'],capture_output=True,text=True,timeout=2.5,env={**os.environ,'LC_ALL':'C'})
        text = p.stdout
    except subprocess.TimeoutExpired as e:
        text = e.stdout or ''
    except OSError:
        return None
    if isinstance(text,bytes):
        text = text.decode(errors='replace')
    return intel_engine_usage(text)


def query_gpus():
    devices = discover_gpus()
    nvidia = {g['bus']:g for g in query_nvidia()}
    result = []
    for bus,(p,cards,g) in devices.items():
        if bus in nvidia:
            g = nvidia.pop(bus)
        elif not g['passthrough']:
            if g['vendor']=='AMD' and g['driver']=='amdgpu':
                g['usage'] = scaled(p/'gpu_busy_percent')
                g['vram_used'] = scaled(p/'mem_info_vram_used',1048576)
                g['vram_total'] = scaled(p/'mem_info_vram_total',1048576)
            elif g['vendor']=='Intel' and g['driver'] in ('i915','xe'):
                # Do not substitute shared system RAM or per-process allocations for VRAM.
                # Optional i915 engine sampling; xe has no portable equivalent here.
                if g['driver']=='i915' and cards:
                    g['usage'] = intel_usage(cards[0])
            if g['driver'] in ('amdgpu','i915','xe','nouveau','nvidia'):
                hwmon_metrics(p,g)
        result.append(g)
    result.extend(nvidia.values())
    return sorted(result,key=lambda g:g['bus']), None


def gpu_worker(state, lock):
    while True:
        try:
            gpus, error = query_gpus()
            with lock:
                state.update(gpus=gpus, gpu_error=error, gpu_timestamp=time.time())
        except Exception:
            LOG.exception('GPU sampling failed')
            with lock:
                state.update(gpus=[],gpu_error='sampling_failed',gpu_timestamp=time.time())
        time.sleep(2)


def main():
    logging.basicConfig(level=logging.INFO)
    OUT.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    state = dict(gpus=[], gpu_error=None, gpu_timestamp=None)
    lock = threading.Lock()
    threading.Thread(target=gpu_worker, args=(state,lock), daemon=True).start()
    old = stat(read('/proc/stat'))
    while True:
        start = time.monotonic()
        try:
            new = stat(read('/proc/stat'))
            topo = topology()
            model, freqs = cpuinfo()
            threads = []
            for name, counters in new.items():
                if name == 'cpu':
                    continue
                i = int(name[3:]); socket, core = topo.get(i, ('?', str(i)))
                khz = number(read(CPU/name/'cpufreq/scaling_cur_freq'))
                threads.append(dict(id=i, socket=socket, core=core, usage=percent(old.get(name), counters), mhz=round(khz/1000,1) if khz is not None else freqs.get(i)))
            threads.sort(key=lambda t:t['id'])
            aggregate = percent(old.get('cpu'), new.get('cpu'))
            old = new
            m = memory(read('/proc/meminfo'))
            m['zfs_arc'] = arc_size()
            with lock:
                gpu = dict(state)
            data = dict(version=1, timestamp=time.time(), cpu=dict(model=model, usage=aggregate, threads=threads,
                       cores=len({(t['socket'],t['core']) for t in threads}), temperatures=temperatures()), memory=m, **gpu)
            tmp = OUT.with_suffix('.tmp')
            with tmp.open('w') as f:
                json.dump(data,f,allow_nan=False,separators=(',',':'))
            os.chmod(tmp,0o644)
            os.replace(tmp,OUT)
        except Exception:
            LOG.exception('Sampling failed; previous snapshot retained')
        time.sleep(max(0.05,1-(time.monotonic()-start)))

if __name__ == '__main__':
    main()
