# GnuDash on a home server over Tailscale

Serves GnuDash to your own devices at `https://<host>.<tailnet>.ts.net:10000`,
tailnet-only, always opening the **Syncthing-synced book read-only**.

Read-only is enforced three ways:

1. **Syncthing** folder is *Receive Only* on the server.
2. **systemd** mounts the book directory read-only for the service.
3. **The app**: with `GNUDASH_BOOK_PATH` set, every browser opens that book
   read-only and the edit toggle and upload controls are hidden. Open tabs
   reload it when the file changes (on focus and every 5 minutes).

App data (portfolios, classifications, Plaid/SnapTrade stores, caches) is
separate from the book and stays writable in `/srv/gnudash/data`.

## Install (Fedora)

```bash
# Service user, directories
sudo useradd --system --home-dir /srv/gnudash --shell /sbin/nologin gnudash
sudo mkdir -p /opt/gnudash /srv/gnudash/data /srv/gnucash /etc/gnudash
sudo chown "$USER": /opt/gnudash
sudo chown -R gnudash: /srv/gnudash && sudo chmod 700 /srv/gnudash
# Book dir: Syncthing (you) writes, gnudash reads, nobody else
sudo chown "$USER":gnudash /srv/gnucash && sudo chmod 2750 /srv/gnucash

# Node 24 pinned under /opt, independent of Fedora's (mise ~ uv for Node)
curl -fsSL https://mise.run | sh
MISE_DATA_DIR=/opt/gnudash/.mise ~/.local/bin/mise install node@24
ln -sfn "$(MISE_DATA_DIR=/opt/gnudash/.mise ~/.local/bin/mise where node@24)" /opt/gnudash/node

# Code + build
git clone <your fork> /opt/gnudash/app-src   # or: git clone ... && git checkout plus
ln -sfn /opt/gnudash/app-src/app /opt/gnudash/app
/opt/gnudash/app-src/deploy/tailscale/build.sh

# Config + service
sudo cp /opt/gnudash/app-src/deploy/tailscale/gnudash.env.example /etc/gnudash/gnudash.env
sudo chmod 600 /etc/gnudash/gnudash.env && sudoedit /etc/gnudash/gnudash.env
sudo cp /opt/gnudash/app-src/deploy/tailscale/gnudash.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gnudash
sudo tailscale serve --bg --https=10000 http://127.0.0.1:3100
```

Point the Syncthing folder at `/srv/gnucash` and set it to **Receive Only**,
ignoring GnuCash's lock and journal files (`.stignore`):

```
*.LCK
*.LNK
*.gnucash-journal
*.log
```

Copy your app data from the Mac (`app/data/*` → `/srv/gnudash/data/`), then
`sudo chown -R gnudash: /srv/gnudash/data`.

## Update

```bash
cd /opt/gnudash/app-src && git pull && deploy/tailscale/build.sh && sudo systemctl restart gnudash
```

## Check

```bash
curl -sI http://127.0.0.1:3100/api/book     # 200 + ETag = book visible
journalctl -u gnudash -f
```
