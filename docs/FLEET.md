# Fleet Daemon

## Start locally
```bash
node scripts/fleet-daemon.mjs
```

## Query
```bash
node scripts/fleetctl.mjs status
node scripts/fleetctl.mjs health
```

## Service install
Copy `services/systemd/pi-setup-fleet.service` to your user systemd directory and enable it.

## Dashboard
Open `dashboards/fleet/index.html` after the daemon is running.
