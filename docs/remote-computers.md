# Computers on separate servers

Run the API, worker and database on one host, and bot computers on one or more other Linux servers,
each with Docker and the sandbox supervisor, reached over a private network. This page covers one
remote supervisor end to end. The single-host Compose stack is unchanged and stays the default.

## How it fits together

```text
 API host                                        Computer host (one per supervisor)
 ┌──────────────────────────────┐   WireGuard   ┌───────────────────────────────────┐
 │ api + worker + Postgres      │ ───────────►  │ supervisor :7091 (private IP only)│
 │ screen proxy                 │               │   └─ computers (one network each)│
 │ home store (+ object storage)│ ◄───────────  │ homes on this host's disk         │
 └──────────────────────────────┘   archives    └───────────────────────────────────┘
```

- **The supervisor owns the homes.** With `SANDBOX_SUPERVISOR_HOMES=remote` it creates each
  computer's home on its own disk and mounts it. The API and worker never create, mount or read
  that directory. The server learns the mode from the supervisor's `/health`, and a supervisor in
  this mode refuses a request that carries a home path, so the two cannot disagree silently.
- **Checkpoints travel as archives.** The API pulls the home as one gzipped tar over the tunnel
  (closing the computer's browsers first) and stores it in the existing home store: the object
  store when `OBJECT_STORAGE_BUCKET` is set, otherwise the server's own disk. Restoring streams a
  stored copy back into the computer. Stopping and starting the same computer on the same host
  keeps using the home already on that host; nothing is copied.
- **Screens go through the supervisor.** With `SANDBOX_SCREEN_GATEWAY=true` the supervisor serves a
  computer's screen and terminal at `/gateway/<container>/...` and the server's screen proxy
  connects there. The sealed capability, the one-second recheck and the view and control tokens are
  unchanged. Nothing outside the computer host ever needs a container address.
- **Limits are enforced by the server.** `SANDBOX_MAX_COMPUTERS_PER_SPACE` counts, in the database
  and under a lock, the computers of a space that still back a live bot, so it holds across
  supervisors. A supervisor given the same value also checks the containers it holds.

## 1. Private network (WireGuard)

Pick a tunnel network that does not overlap either host's LAN, for example `10.8.0.0/24`, with the
API host at `10.8.0.1` and the first computer host at `10.8.0.2`.

On each host:

```bash
sudo apt-get install -y wireguard
umask 077
wg genkey | tee private.key | wg pubkey > public.key
```

`/etc/wireguard/wg0.conf` on the computer host (replace the placeholders):

```ini
[Interface]
Address = 10.8.0.2/24
PrivateKey = <computer host private key>

[Peer]
PublicKey = <API host public key>
Endpoint = <API host public address>:51820
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
```

and on the API host, one `[Peer]` per computer host with `AllowedIPs = 10.8.0.2/32` and the
computer host's public key. Keep `AllowedIPs` to the single address of each peer so a host can only
send from its own tunnel address. Then `sudo systemctl enable --now wg-quick@wg0` on both.

Firewall on the computer host: allow the WireGuard port from the API host, allow SSH from where you
administer it, and allow **nothing else inbound**. The supervisor port must be reachable only
through the tunnel:

```bash
sudo ufw default deny incoming
sudo ufw allow from <API host public address> to any port 51820 proto udp
sudo ufw allow in on wg0 to any port 7091 proto tcp
sudo ufw allow OpenSSH
sudo ufw enable
```

Docker publishes ports around `ufw`, so the Compose file also binds the supervisor to the tunnel
address only (`SUPERVISOR_BIND_ADDRESS`). Check from outside that `7091` is closed.

## 2. The computer host

Install Docker Engine 26 or newer (bot homes are mounted as volume subpaths) from Docker's
repository, with the iptables backend. Rootless Docker, Docker Desktop and the nftables backend are
not supported by the egress rules.

Restrict what computers can reach **before** starting the supervisor. A computer on this host is one
hop from the tunnel, so without these rules a computer could reach the API host:

```bash
sudo bash infra/compose/restrict-computer-egress.sh
```

The node Compose file sets `SANDBOX_COMPUTER_EGRESS=restricted`, so the supervisor checks the rules
are enforced and refuses to start computers until they are. See [self-hosting](./self-host.md) for
what the rules block and the DNS note.

Then start the supervisor ([`docker-compose.supervisor-node.yml`](../infra/compose/docker-compose.supervisor-node.yml)):

```bash
export SUPERVISOR_BIND_ADDRESS=10.8.0.2
export SANDBOX_SUPERVISOR_TOKEN=<same 32+ character value as on the API host>
docker compose -f infra/compose/docker-compose.supervisor-node.yml up -d --wait
```

The healthcheck passes only when the supervisor reports `homes: remote`, so an image from before
this mode never looks healthy.

## 3. The API host

Use the production stack without the in-stack supervisor (do not layer `docker-compose.prod.docker.yml`)
and point it at the computer host by its **private IP**, not a name: the screen proxy only accepts
plain HTTP to private addresses.

```dotenv
SANDBOX_PROVIDER=docker
SANDBOX_SUPERVISOR_URL=http://10.8.0.2:7091
SANDBOX_SUPERVISOR_TOKEN=<same value as the computer host>
# Keep homes recoverable if a computer host is lost (any S3-compatible store).
OBJECT_STORAGE_BUCKET=corvo-homes
OBJECT_STORAGE_ENDPOINT=https://storage.example.com
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_ACCESS_KEY_ID=replace-me
OBJECT_STORAGE_SECRET_ACCESS_KEY=replace-me
# Optional: at most this many computers per space, counted in the database.
SANDBOX_MAX_COMPUTERS_PER_SPACE=6
```

Without object storage, homes are stored on the API host's disk, which is not a backup of anything
the computer host holds; set it before relying on remote computers.

## 4. Verify

From the API host:

```bash
curl -fsS http://10.8.0.2:7091/health          # {"ok":true,...,"homes":"remote"}
curl -s -o /dev/null -w '%{http_code}\n' http://10.8.0.2:7091/computers/x   # 401: the token is required
```

From a machine outside the tunnel, `nc -vz <computer host public address> 7091` must fail.

In the app, start a computer and check that:

1. it boots and its screen and terminal open;
2. a file written in it is still there after it idles and starts again;
3. `ls /var/lib/docker/volumes/corvo-node_appdata/_data/homes` on the computer host shows the home,
   and the API host has no `homes/<id>` folder for it.

## 5. Backup and restore drill

Homes on a remote supervisor are saved to the home store on every idle stop, update and recovery. To
prove a home survives losing the host, on a non-production computer:

1. Start a computer, write a file, then let it idle so it checkpoints (or run Update, which saves
   first). Confirm an object appeared under `homes/` in the bucket.
2. Simulate the loss: `docker compose -f infra/compose/docker-compose.supervisor-node.yml down -v`
   on the computer host, or point `SANDBOX_SUPERVISOR_URL` at a second, empty computer host.
3. Start the computer again. The supervisor reports a new computer, the server restores the saved
   home into it, and the file is back.

Anything written after the last checkpoint is lost, as with any provider that restores from a save.
Snapshot the server's database and object store as described in [self-hosting](./self-host.md);
the object store holds the sealed homes and the database holds the keys to them.

## When a computer host is lost

Computers on it show as gone and are offered a boot. Booting one sends it to the supervisor in
`SANDBOX_SUPERVISOR_URL`: with the same host replaced, or the URL changed to another one, the
server restores each home from its last checkpoint. Work since the last checkpoint is lost. If the
host is only unreachable, nothing is lost: its disk is untouched and computers resume when the
tunnel returns. Removing a deleted computer's home folder from a remote host is not automatic yet;
delete it under `homes/` on that host.

## Security notes

- The supervisor runs as root with the Docker socket. Whoever holds `SANDBOX_SUPERVISOR_TOKEN` and
  can reach port 7091 controls that host, so the token must be long and random, shared only between
  the two hosts, and the port must stay on the tunnel.
- The supervisor's token is also sealed into screen capabilities so the server's proxy can use the
  gateway. It is encrypted with `SCREEN_PROXY_SECRET`, never sent to a browser, and not forwarded to
  a computer.
- Docker with runc is not a boundary for untrusted public code: a kernel or runtime escape reaches
  the host, and from there the tunnel. The egress rules, one network per bot and resource ceilings
  reduce what a computer can do, but they do not replace isolation. Before running code you do not
  trust, run computers under gVisor or microVMs, which a later change adds. Until then, use remote
  computers for your own and trusted users' workloads, and keep API host secrets off computer hosts.
- A computer host holds its users' homes in clear text on its disk, as the single-host stack does.
  Use full-disk encryption on the host.
