# EarthWatch 🌍

**Interaktive Weltkarte für NASA EONET Naturereignisse** — live, kostenlos, direkt im Browser.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen)](https://your-username.github.io/earthwatch/)

## ✨ Features

- 🔥 **NASA EONET Live-Daten** – Waldbrände, Stürme, Vulkane, Erdbeben & mehr
- 🗺️ **Interaktive Leaflet-Karte** – Dark, Light, Satellite, Terrain & mehr
- 🌐 **3D-Globus** – Drehbarer Globe mit Event-Punkten (globe.gl / Three.js)
- 🎨 **4 Themes** – Dark, Light, Midnight, Hacker
- 🔍 **Filter** – nach Kategorie, Status, Zeitraum & Suchbegriff
- 📐 **Skalenanzeige** – Richter-Skala, Sturmkategorien, Flächenangaben
- ⌨️ **Tastenkürzel** – `G` Globe, `S` Sidebar, `R` Reload, `1–4` Themes, `Esc`

## 🚀 GitHub Pages Deployment

### Option A – GitHub Web UI (empfohlen)

1. Repository erstellen: `https://github.com/new`
2. Alle Dateien aus `earthwatch_fixed/` hochladen
3. Settings → Pages → Source: **main** branch, **/ (root)** → Save
4. Fertig! App läuft unter `https://DEIN-NAME.github.io/REPO-NAME/`

### Option B – Git CLI

```bash
git init
git add .
git commit -m "🌍 EarthWatch initial release"
git remote add origin https://github.com/DEIN-NAME/REPO-NAME.git
git push -u origin main
```
Dann in den Repository Settings → Pages aktivieren.

### Option C – GitHub CLI

```bash
gh repo create earthwatch --public --push --source=.
# Danach in Settings → Pages → main branch aktivieren
```

## 📁 Dateien für GitHub Pages

```
earthwatch_fixed/
├── index.html     ← Haupt-App (GitHub Pages entry point)
├── style.css      ← Styles
├── renderer.js    ← App-Logik
├── .nojekyll      ← Wichtig! Verhindert Jekyll-Processing
├── assets/
│   └── icon.png
└── README.md
```

> **Hinweis:** `main.js`, `preload.js`, `package.json`, `node_modules/` und `dist/` werden von GitHub Pages ignoriert – nur die Web-Dateien werden gebraucht.

## 🛠️ Lokal testen

```bash
# Mit Python (kein npm nötig)
python3 -m http.server 8080
# → http://localhost:8080

# Oder mit npx
npx serve .
```

## 🔑 API

Verwendet die kostenlose [NASA EONET v3 API](https://eonet.gsfc.nasa.gov/docs/v3) – kein API-Key nötig.

## 📄 Lizenz

MIT
