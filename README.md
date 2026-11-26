# PVE Hardware Monitor v0.1.4

Monitor de hardware independente integrado ao Summary do Proxmox VE 9.x. Não é um plugin oficial do Proxmox. A v0.1.4 reúne a correção ExtJS da v0.1.1, a expansão automática da v0.1.2 e a numeração dos núcleos da v0.1.3. Nenhum hotfix separado é necessário.

## Recursos

- CPU: núcleos físicos agrupados com suas threads, numeração visual sequencial (Core 00, Core 01…), identificador físico preservado no tooltip, frequência por CPU lógica e temperatura máxima dos sensores disponíveis.
- Cores por thread: verde abaixo de 30%, amarelo de 30% a 55% (inclusive), laranja acima de 55% até 90% (inclusive), vermelho acima de 90%. Cada barra muda independentemente, com transição suave; temperatura da GPU usa sua própria escala.
- Memória: uso, cache Linux, buffers, livre, disponível, swap e ZFS ARC. O cache é `Cached + SReclaimable - Shmem`; o ARC é um detalhe, não um segmento extra.
- GPU NVIDIA: uso, VRAM, temperatura, ventoinha, energia, PCI e driver via `nvidia-smi`; histórico local de VRAM de até 60 amostras.
- CPU/RAM a cada segundo, GPU aproximadamente a cada dois segundos. Painel responsivo, recolhível, com altura recalculada após renderização. Gráficos nativos preservados.
- API autenticada do PVE com `Sys.Audit` no nó. Sem porta adicional, telemetria externa, Docker ou compilação. Coletor Python 3 e systemd.

## Instalação local

No host Proxmox VE 9.x como root, não no LXC. Requer Python 3, Perl, systemd e utilitários padrão Debian. O driver NVIDIA é opcional. Guarde acesso SSH/console e faça a instalação em uma janela de manutenção, sem restores ou migrações em andamento.

```bash
bash install.sh check
bash install.sh
```

Atualize a página Summary com Ctrl+Shift+R (Windows/Linux) ou Cmd+Shift+R (Mac).

## Instalação pelo GitHub (raw)

Publique o conteúdo deste diretório em um repositório público. O `install.sh` é autossuficiente: contém um arquivo compactado gerado a partir do código-fonte e não precisa baixar outros arquivos. Substitua `SEU_USUARIO` e `pve-hardware-monitor` pelo seu repositório; prefira uma tag ou commit fixo em produção. Exemplo com tag `v0.1.4` (crie-a primeiro):

```bash
curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/pve-hardware-monitor/v0.1.4/install.sh -o /tmp/phm-install.sh
# Inspecione e confira a procedência do arquivo antes de executá-lo como root.
bash /tmp/phm-install.sh check
bash /tmp/phm-install.sh
```

A instalação verifica a integridade do payload embutido. Essa verificação não autentica a origem do script; obtenha-o do seu repositório confiável. O checksum não substitui revisão ou assinatura. O instalador também funciona com `curl -fsSL URL | bash -s -- check` ou `curl -fsSL URL | bash`, mas baixar e revisar primeiro é mais seguro.

## Atualização de versões anteriores

O instalador reconhece os blocos JavaScript exatos das versões 0.1.0, 0.1.1, 0.1.2 e 0.1.3, além do bloco atual. Não é necessário desinstalar antes. Modificações desconhecidas são recusadas. Quando a API Perl é idêntica à instalada, ela não é reescrita e os serviços `pvedaemon` e `pveproxy` não são reiniciados. O coletor também não é reiniciado se o código, a unidade e o estado já estiverem corretos.

Em instalação nova, reparo da API ou desinstalação com alteração da API, o instalador verifica os serviços, jobs systemd, tarefas PVE em execução e processos em estado D antes de reiniciar os serviços de gerenciamento. A verificação é conservadora e não elimina a possibilidade de uma tarefa iniciar logo depois. Se detectar um problema, interrompe a operação; corrija a causa, não force. Pode haver interrupção temporária da interface web e dos consoles. Não solicita reboot do host nem desligamento das VMs/LXCs.

## Comandos

```bash
bash install.sh --version
bash install.sh check      # valida estrutura e, se necessário, segurança do restart
bash install.sh status
bash install.sh repair     # reaplica após atualização compatível do PVE
bash install.sh uninstall  # remove somente blocos reconhecidos
bash install.sh activate   # reinicia serviços PVE, com preflight; útil se API antiga ainda em memória
```

Os backups ficam em `/var/backups/pve-hardware-monitor/`. Em falha, o instalador tenta reverter os arquivos e o estado do coletor. Se um restart do PVE falhar, ele não tenta reiniciar repetidamente: examine os logs e os jobs pendentes antes de usar `activate`. Não restaure arquivos de uma versão antiga do PVE sobre arquivos de uma versão nova.

## Diagnóstico

```bash
systemctl status pve-hardware-monitor --no-pager
journalctl -u pve-hardware-monitor -n 50 --no-pager
pvesh get /nodes/$(hostname -s)/hardware-monitor --output-format json-pretty
systemctl list-jobs
```

A API GET `/api2/json/nodes/{node}/hardware-monitor` lê `/run/pve-hardware-monitor/metrics.json`. O arquivo é escrito atomicamente; snapshots com mais de 15 segundos são recusados. Se o `pvesh` funcionar mas o navegador retornar HTTP 501, confirme o estado do armazenamento e dos serviços antes de executar `activate`. A atualização do JavaScript por si só não requer restart. O arquivo JSON é acessível localmente no host, não contém credenciais.

## Desenvolvimento

- `src/dashboard.js`: painel ExtJS, já com todos os fixes.
- `src/legacy/`: versões reconhecidas para upgrade/desinstalação; não são carregadas na interface.
- `src/collector.py`: métricas Linux e NVIDIA.
- `src/endpoint.pm`: API com permissão Sys.Audit.
- `src/pve-hardware-monitor.service`: unidade systemd.
- `install.py`: lógica de instalação.
- `scripts/build-installer.py`: gera o `install.sh` autossuficiente.

Após alterar código, regenere e teste o script antes de publicar:

```bash
python3 scripts/build-installer.py
python3 -m unittest discover -s tests -v
node --check src/dashboard.js
bash -n install.sh
python3 tests/smoke_ui.py # opcional: Playwright + Chromium em /usr/bin/chromium
```

## Limitações

Os patches modificam arquivos internos do Proxmox. Não há reaplicação automática após upgrades de pacotes; use `check` e `repair`. Os fixes anteriores foram usados no PVE 9.3.1 do usuário, mas o instalador consolidado ainda não foi validado em um host PVE real neste ambiente. Os testes locais cobrem coleta Linux, idempotência, atualização dos blocos anteriores, reversão, limites de cores, preflight simulado e renderização em Chromium com ExtJS simulado. Teste a instalação em ambiente de manutenção antes de usar em produção. Não há garantia de compatibilidade com qualquer versão futura.

Referência de integração: https://github.com/proxmox/pve-manager (Summary.js e Nodes.pm); não depende de PVE-mods.
