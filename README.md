# 📰 NEEEEEWS

[![Build & Push Docker Image](https://github.com/Choih0401/neeeeews/actions/workflows/deploy-image.yml/badge.svg)](https://github.com/Choih0401/neeeeews/actions/workflows/deploy-image.yml)

NEEEEEWS — A SvelteKit-based web service that fetches stock & forex news, summarizes sentiment, and displays results in a clean dashboard.  
Runs on Node.js (default port: **3000**) and is available as a Docker image.

---

## 🚀 Quick Start

```bash
# Pull the latest image
docker pull choih0401/neeeeews:latest

# Run the container (exposing port 3000)
docker run -d -p 3000:3000 --name neeeeews choih0401/neeeeews:latest
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚡ Features

- Fetches **stock & forex related news** from multiple sources  
- Summarizes each article with **sentiment analysis** (positive/negative)  
- Displays insights in a **modern dashboard UI** (cards, charts)  
- Provides simple **/api/news** endpoint for integration  

---

## 🛠️ Tech Stack

- [SvelteKit](https://kit.svelte.dev/) — Frontend & API routes  
- Node.js — Runtime environment  
- Tailwind CSS — Styling  
- Docker — Containerization for easy deployment  

---

## 📦 Docker Tags

- `latest` — most recent build  
- versioned tags like `v1.0.0` — auto-bumped on release  

---

## 🔗 Links

- **DockerHub**: [choih0401/neeeeews](https://hub.docker.com/r/choih0401/neeeeews)  
- **GitHub Releases**: [Releases Page](https://github.com/Choih0401/NEEEEEWS/releases)  

---
