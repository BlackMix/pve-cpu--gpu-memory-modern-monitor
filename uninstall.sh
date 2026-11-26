#!/bin/bash
set -eu
exec bash "$(dirname "$0")/install.sh" uninstall
