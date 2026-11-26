#!/usr/bin/env python3
"""Compatibility helper: the readable installer no longer needs generation."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
installer = root / 'install.sh'
subprocess.run(['bash', '-n', str(installer)], check=True)
print('install.sh syntax OK. No embedded payload or build step is required.')
