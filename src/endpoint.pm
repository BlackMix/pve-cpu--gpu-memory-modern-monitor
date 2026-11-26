# BEGIN PVE-HARDWARE-MONITOR
__PACKAGE__->register_method({
    name => 'mixdev_hardware_monitor',
    path => 'hardware-monitor',
    method => 'GET',
    proxyto => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    description => 'Read local hardware monitor snapshot.',
    parameters => {
        additionalProperties => 0,
        properties => { node => get_standard_option('pve-node') },
    },
    returns => { type => 'object', additionalProperties => 1 },
    code => sub {
        my ($param) = @_;
        my $path = '/run/pve-hardware-monitor/metrics.json';
        my $raw = eval { PVE::Tools::file_get_contents($path, 1024*1024) };
        die "Hardware monitor snapshot unavailable\n" if $@ || !defined($raw);
        my $data = eval { JSON::decode_json($raw) };
        die "Hardware monitor snapshot invalid\n" if $@ || ref($data) ne 'HASH';
        die "Hardware monitor snapshot stale\n" if !defined($data->{timestamp}) || time() - $data->{timestamp} > 15;
        return $data;
    },
});
# END PVE-HARDWARE-MONITOR
