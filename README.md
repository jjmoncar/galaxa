# GALAXA - Arcade Game

A complete, playable Galaxa-style arcade game built with HTML5 Canvas + vanilla JavaScript. Single-file, zero dependencies.

## Features

- 3 enemy types: Bee (50pts), Butterfly (80pts), Boss Galaxa (200-400pts)
- Formation entry with curved flight paths
- Dive attacks with bezier trajectories
- Tractor beam capture & dual-ship rescue
- Infinite wave progression with increasing difficulty
- Bonus stages every 4 waves
- Particle explosions and neon retro aesthetic
- Starfield parallax background
- Web Audio API sound effects
- Touch controls for mobile
- High score saved in localStorage
- Responsive canvas (3:4 ratio)

## Controls

| Action | Desktop | Mobile |
|--------|---------|--------|
| Move | Arrow keys / A-D | Left/Right buttons |
| Fire | Space | FIRE button |
| Pause | P | - |
| Start | Enter / Click | Tap screen |

## Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from project directory
vercel

# Or connect your GitHub repo to Vercel for auto-deploy
```

Since it's a single static HTML file, no build step is needed. Just point Vercel to the repo root.

## Play Locally

Open `index.html` in any modern browser. That's it.
