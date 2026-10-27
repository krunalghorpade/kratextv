# KRATEX TV

A CRT television in a little room, with six channels of Kratex. Built with Node.js and browser-native HTML, CSS, and JavaScript. No dependencies, API keys, or build step.

## Run

Requires Node.js 22 or newer.

```sh
npm run dev
```

Open **http://127.0.0.1:3000**. Refresh the browser after editing front-end files. Restart the server after changing `server.mjs`.

```sh
npm start           # Same lightweight server, for regular use
npm run check       # JavaScript syntax checks
npm test            # Playback races, playlist membership, random starts, HTTP and media checks
npm run sync:channels # Refresh the videos in all six configured playlists
```

To use a different port or listen outside localhost:

```sh
HOST=0.0.0.0 PORT=8080 npm start
```

For production, run behind an HTTPS reverse proxy with a Node process manager. This checkout has not been deployed by the redesign.

## Experience

- An Akai-inspired 4:3 CRT with a deep black bezel and slim lower chin, in a room with a record cabinet, poster, lamp, and window. Video stays inside the TV aperture.
- Night by default, with a day/night switch that changes the room's lighting, sky, sun/moon, and colors.
- Hover over **Remote** to reveal it; click or tap to keep it open. Click outside or press Escape to dismiss it.
- Separate CHANNEL and PROGRAM rockers on the remote, plus power, six channel presets, play/pause, volume, mute, picture modes, help, and fullscreen.
- The only row below the TV is the current program name and a **View full video** link. The link opens that video from the beginning on YouTube in a new tab and pauses the TV.
- Y2K, clean, VHS, and black-and-white picture modes, controlled from the remote.
- Responsive phone layouts, semantic buttons, keyboard navigation, reduced-motion support, and saved room/audio/picture/channel preferences.
- The local teaser is muted. YouTube loads only after the visitor switches on or selects a channel. Failed connections, unavailable embeds, and blocked autoplay have recovery controls.

## Channels

`config.json` retains the six existing playlist IDs and order. Edit the name or ID to change a channel:

```json
{
  "channels": [
    { "name": "Music", "id": "PL_YOUR_YOUTUBE_PLAYLIST_ID" }
  ]
}
```

The first visit selects DJ sets; later visits restore the selected channel. `channel-catalog.json` holds verified playlist members. After editing playlist IDs or adding videos on YouTube, run `npm run sync:channels`. The sync follows playlist pagination, handles Shorts, excludes recommendations, and replaces the catalog only when every playlist has loaded successfully. No API key or LemnosLife proxy is required.

Each channel switch selects a random member of that channel and a random point before its ending. PROGRAM +/− steps forward/backward through that channel’s playlist and wraps at either end. Each program gets a random start; automatic advancement also stays in playlist order. Shorts with unknown duration are sought once their duration becomes available. A fresh player and request token isolate every switch, so late events from an old channel cannot show the wrong video. The picture is revealed only after the selected video is playing at its chosen point. Unavailable embeds retry other members of the same channel, up to five attempts.

Native player controls and keyboard interaction are disabled, player edge chrome sits outside the visible aperture, and the TV supplies loading, pause, autoplay recovery, and error screens. YouTube can still impose availability restrictions and insert provider content. Volume and mute persist across switches. Browsers that block sound autoplay show the TV's own Play button.

Live verification: Conversations, Music, DJ sets, Vlogs, and Shorts played with random starts. The five Nusta Vibes videos returned “This video is unavailable” from YouTube's embedded player, despite having public watch pages. This channel preserves its original playlist and shows a TV error after trying its members; it needs embed availability restored or replacement source files. It never substitutes videos from a different channel.

The old `ticker.json` and `settings.json` remain available for existing content, but the new room UI does not use the scrolling ticker or the old video zoom. Existing brand assets and Google Analytics ID are retained. The channel-card grid, footer links, physical TV buttons, and secondary playback labels are removed to keep the room uncluttered.

## Keyboard

| Key | Action |
| --- | --- |
| Left / right | Previous / next channel |
| [ / ] | Previous / next program within the channel |
| Up / down | Volume |
| Space | Play / pause |
| 1–6 | Select channel |
| P / M | Power / mute |
| L / F | Picture / fullscreen |
| R / D | Remote / day and night |
| ? | Shortcut guide |
| Escape | Close remote or shortcut guide; exit fullscreen |

Keyboard shortcuts and pointer input stay in the main page; the embedded player is excluded from focus and pointer interaction. Fullscreen availability depends on the browser.

## Files

- `server.mjs`: Node HTTP server; public asset allowlist, safe path resolution, video byte ranges, and `/health`.
- `index.html`: room, Akai-style TV, full-video link, and accessible remote markup.
- `style.css`: scenery, lighting, CRT materials, responsive layouts, and transitions.
- `script.js`: room UI, player adapter, remote, keyboard shortcuts, and preferences.
- `playback.js`: channel isolation, random video selection/seeking, retries, and playback history.
- `channel-catalog.json`: public video IDs verified against each playlist.
- `lib/playlist-catalog.mjs` and `scripts/sync-channels.mjs`: playlist extraction and catalog refresh.
- `config.json`: channel playlists.
- `assets/`: existing Kratex logo, font, teaser video, and images.
- `tests/`: Node's built-in test runner; no package installation required.

YouTube integration references: [IFrame API](https://developers.google.com/youtube/iframe_api_reference), [player parameters](https://developers.google.com/youtube/player_parameters).
