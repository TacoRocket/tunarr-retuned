<p align="center">
  <img src="./design/tunarr-retuned.png" width="180" alt="Tunarr Retuned logo">
</p>

<h1 align="center">Tunarr Retuned</h1>

<p align="center"><strong>Tunarr, with extensions, real commercial breaks and a CRT picture.</strong></p>

<p align="center">A fork of <a href="https://github.com/chrisbenincasa/tunarr">Tunarr</a> that stays close to upstream and adds the things below. New channels use ErsatzTV next. Existing channels keep their playback engine on upgrade, and the channel editor offers a one-click move to ErsatzTV next; until then their settings are read-only.</p>

<p align="center">
  <a href="https://github.com/TacoRocket/tunarr-retuned/releases"><img src="https://img.shields.io/github/v/release/TacoRocket/tunarr-retuned?include_prereleases&style=flat&logo=github&color=lightseagreen&label=retuned%20release" alt="Retuned Release"></a>
  <a href="https://github.com/TacoRocket/tunarr/pkgs/container/tunarr"><img src="https://img.shields.io/badge/fork%20container-GHCR-lightseagreen?style=flat&logo=docker" alt="Fork Container"></a>
  <a href="https://github.com/chrisbenincasa/tunarr/releases"><img src="https://img.shields.io/github/v/release/chrisbenincasa/tunarr?style=flat&logo=github&color=lightgrey&label=built%20on%20upstream" alt="Built on upstream"></a>
  <a href="https://discord.gg/7tUjBbDxag"><img src="https://img.shields.io/discord/1254564006123802805?style=flat&logo=discord&logoColor=white&label=Discord" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Zlib-lightseagreen?style=flat" alt="License"></a>
</p>

<p align="center">
  <img src="./design/tunarr-guide.png" alt="Tunarr TV Guide">
</p>

---

## What Retuned adds

### 🧩 Extensions (early beta)

Add features to Tunarr without patching Tunarr. Install, update and remove extensions from **Settings → Extensions**. Each one runs in its own sandbox, only reaches the services you set it up for, and never sees your credentials.

- **[Bazarr](https://github.com/TacoRocket/tunarr-bazarr-extension)** fetches subtitles Tunarr is missing.
- **[Potion](https://github.com/TacoRocket/tunarr-extensions/tree/main/packages/potion)** finds similar titles with a small model that runs inside Tunarr.
- **Build your own** in JavaScript. [Extensions guide](docs/fork/extensions.md)

### 📺 CRT looks

Make a channel look like it is playing on an old tube TV: scanlines, a soft glow, a little color bleed. Five looks, chosen per channel, so the Saturday-morning cartoons channel can go full retro while the movie channel stays crisp. [CRT looks](docs/fork/crt.md) · [See them side by side](https://imgur.com/a/FvFRizg)

### 📼 After-show ad pods

A real commercial break after each show: a bumper, a couple of ads, a station ID, drawn from your own filler lists. On program-count Random Slots schedules, you add it through the API; there is no switch in the app yet. [Ad pods](docs/fork/scheduling.md#after-show-ad-pods)

### 🎞️ Credits the way TV does them

- **Credit squeeze:** the end credits keep playing in a smaller box over your channel's background, and the next program still starts on time. [Credit squeeze](docs/fork/credit-squeeze.md)
- **Skip the end credits:** the channel moves on when the final credits start. [Skip the end credits](docs/fork/scheduling.md#skip-the-end-credits)

### 🌱 Channels that program themselves

Pick up to ten shows, episodes or movies and Tunarr builds a lineup of related titles from your library. [Generate from seeds](docs/fork/scheduling.md#generate-from-seeds)

### ⚡ More 4K HDR channels on a small Intel box

On an Intel Core i3-1220P, the optional hardware path delivered **61% higher HDR-to-SDR throughput** with five streams and used **73% less FFmpeg CPU time** in a separate three-stream playback test. These are opt-in results, not a claim that every workload runs faster, and the HDR picture is darker. [Setup and trade-offs](docs/fork/hardware-comparison.md)

### Also in the box

| Feature                        | What it does                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filler from a saved search** | Point a filler list at a Smart Collection and new commercials show up on their own. [Guide](docs/fork/scheduling.md#filler-lists-from-a-smart-collection) |
| **Offset channels**            | Mirror a lineup at the same time or a few hours later, with its own CRT look if you want. [Guide](docs/fork/scheduling.md#offset-channels)                |
| **Repair re-added items**      | When Plex re-adds a show under a new ID, repair exact matches so lineups and watch history follow the replacement. [Guide](docs/fork/trash-repair.md)     |
| **Prepared subtitles**         | Reuse text or convert PGS ahead of airing, so players can show subtitles without burning them into 4K video. [Guide](docs/fork/subtitles.md)              |
| **One thing to install**       | One container with Tunarr and its matching FFmpeg; no development branches to combine. [Container notes](docs/fork/container.md)                          |

Some of these do not have buttons in the app yet; each guide gives you a short command to switch one on. The full list is in the [fork docs](docs/fork/README.md).

## How it relates to upstream

- **Built on [upstream Tunarr](https://github.com/chrisbenincasa/tunarr).** Each release says which upstream version it carries and what it adds. The display name and logo identify this fork; container paths and `trfork` version tags remain unchanged. [Releases](https://github.com/TacoRocket/tunarr-retuned/releases)
- **Our long-term goal is to make this fork unnecessary.** We stay close to upstream, keep our changes focused, and contribute improvements back when they fit. When upstream ships its own version of something here, we adopt it and retire ours. Specialized picture styles can remain optional fork features.
- **Problems with a `-trfork` build go to this fork's issues,** not upstream's. See [Community](#community).

## What is Tunarr?

Tunarr lets you build custom live TV channels out of your existing media libraries — movies, TV episodes, music videos, or local files — and stream them as if they were real broadcast channels.

Tune in by adding Tunarr's spoofed HDHomeRun tuner to Plex, Jellyfin, or Emby, or grab the M3U URL for any IPTV player like [Tivimate](https://tivimate.com/) or [UHF](https://www.uhfapp.com/).

## Features

**Media Sources**

- Connect Plex, Jellyfin, Emby, or local file libraries
- Advanced search, filter, and sort across all connected libraries

**Channel Management**

- Drag-and-drop lineup editor
- Filler content between programs (commercials, music videos, prerolls, branding)
- Per-channel logos and automatic configuration backups

**Scheduling**

- Time-slot and random-slot scheduling tools
- Web-based TV guide for viewing channel lineups

**Playback & Integration**

- Spoofed [HDHR](https://www.silicondust.com/hdhomerun/) tuner for Plex, Jellyfin, and Emby
- M3U/IPTV output for [Dispatcharr](https://github.com/Dispatcharr/Dispatcharr), [Threadfin](https://github.com/Threadfin/Threadfin), [xTeVe](https://github.com/xteve-project/xTeVe), or any IPTV client
- Stream channels directly in the browser
- Per-channel audio language and subtitle preferences

**Transcoding**

- Hardware-accelerated transcoding: Nvidia NVENC, VAAPI, Intel QuickSync, macOS VideoToolbox
- Multiple transcode profiles, configurable per channel

## Screenshots

<table>
  <tr>
    <td align="center"><img src="./design/tunarr-channels.png" alt="Channel Management"><br><em>Channel Management</em></td>
    <td align="center"><img src="./docs/assets/channel-properties.png" alt="Channel Configuration"><br><em>Channel Configuration</em></td>
  </tr>
</table>

## Quick Start

The [public container](https://github.com/TacoRocket/tunarr/pkgs/container/tunarr) bundles Tunarr and its matching FFmpeg. No registry login or branch selection is needed. Every published version is on the [Releases page](https://github.com/TacoRocket/tunarr/releases), with notes on what changed and anything to do before upgrading. The example below uses `2026.11.2-trfork.1`; the [latest release](https://github.com/TacoRocket/tunarr/releases/latest) may be newer.

The current container recipe runs Tunarr on **Node 22 LTS**. Older published images keep
their original runtime; see [container runtime and releases](docs/fork/container.md#runtime)
for the Node version pin and publication steps.

The fork image is initially **Linux x86-64 (`linux/amd64`)**. Create a `compose.yaml`:

```yaml
services:
  tunarr:
    image: ghcr.io/tacorocket/tunarr:2026.11.2-trfork.1
    container_name: tunarr
    ports:
      - 8000:8000
    environment:
      - TZ=Etc/UTC
    volumes:
      - ./tunarr-data:/config/tunarr
    restart: unless-stopped
```

Then run:

```bash
docker compose up -d
```

Tunarr will be available at `http://localhost:8000`.

**Next:** set up your channels as usual, then check out the [fork docs](docs/fork/README.md) to switch on CRT looks, ad pods and more.

Connect your media server in Tunarr, or add a read-only media volume for local files. For Intel/AMD hardware access, GPU-specific options, source revisions, and rollback instructions, see [the container notes](docs/fork/container.md). Start with a separate configuration directory when trying the fork; keep a configuration backup before upgrading an existing install.

**Upstream installation options:** these install upstream Tunarr and do not include this fork's additions.

| Platform                 | Method                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| Linux / macOS / Windows  | [Standalone binaries](https://github.com/chrisbenincasa/tunarr/releases)      |
| Unraid                   | Community App Store                                                           |
| Proxmox                  | [LXC helper script](https://tunarr.com/getting-started/installation/#proxmox) |
| ARM (Raspberry Pi, etc.) | Docker image (`linux/arm64`)                                                  |

For hardware-accelerated transcoding setup, see the [transcoding docs](https://tunarr.com/getting-started/run/).

## Documentation

- [Fork docs](docs/fork/README.md): CRT looks, ad pods, skipping credits, hardware options
- [Installation guide](https://tunarr.com/getting-started/installation/)
- [Creating channels](https://tunarr.com/configure/channels/)
- [Scheduling tools](https://tunarr.com/configure/scheduling/)
- [Transcoding configuration](https://tunarr.com/configure/ffmpeg/transcode_config/)
- [Full documentation](https://tunarr.com/)

## Development

```bash
pnpm i
pnpm turbo dev  # backend at :8000, frontend at :5173/web
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for a full development guide.

Fork CI validates ready code PRs to `main`; container publication is manual. We use upstream's documentation site and native platform releases, while testing our combined source and publishing our own Linux x86-64 image. See [the CI and release process](docs/fork/container.md#ci-and-release-checks).

## Community

This fork exists because of [upstream Tunarr](https://github.com/chrisbenincasa/tunarr) and the people who build it. Please keep fork reports here so they don't add to upstream's queue.

- **Problems with this build** (any version ending in `-trfork.N`): [open a fork issue](https://github.com/TacoRocket/tunarr/issues). If you can reproduce the same problem on an upstream Tunarr build, it's upstream's bug; report it there, and mention it here.
- **Feedback on fork features** (CRT looks, ad pods, final-credit controls, low-power encoding): fork issues, the [first-release feedback thread](https://github.com/TacoRocket/tunarr/pull/25), or [pull requests](https://github.com/TacoRocket/tunarr/pulls).
- **General Tunarr questions**: upstream's [documentation](https://tunarr.com/), [Discord](https://discord.gg/7tUjBbDxag) and [Discussions](https://github.com/chrisbenincasa/tunarr/discussions). Mention that you run this fork.

## License

Tunarr is released under the [Zlib License](LICENSE).

Tunarr and the underlying media libraries remain the work of their respective authors. Our FFmpeg build builds on [ErsatzTV-ffmpeg](https://github.com/ErsatzTV/ErsatzTV-ffmpeg), FFmpeg, libplacebo, and their contributors; their licenses and attribution continue to apply.
