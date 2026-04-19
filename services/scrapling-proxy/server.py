"""
Scrapling Proxy Service — runs on your Oracle Cloud ARM instance.

Exposes a simple HTTP API that accepts render requests from the
PackFinder API server and returns fully-rendered HTML using Scrapling's
StealthyFetcher (Camoufox-based, bypasses Cloudflare Turnstile).

Endpoints:
    POST /render   — Render a URL and return HTML + metadata
    GET  /health   — Health check

Setup on Oracle Cloud ARM:
    pip install "scrapling[all]" fastapi uvicorn
    scrapling install          # downloads Camoufox browser (ARM64 build)
    python server.py           # starts on port 8787

Environment variables:
    SCRAPLING_PORT       — port to listen on (default 8787)
    SCRAPLING_API_SECRET — shared secret for auth (optional but recommended)
"""

import os
import time
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scrapling-proxy")

app = FastAPI(title="Scrapling Proxy", version="1.0.0")

API_SECRET = os.environ.get("SCRAPLING_API_SECRET", "")


# ── Request / Response models ──


class RenderRequest(BaseModel):
    url: str
    wait_selector: Optional[str] = None
    timeout: int = 30000
    block_resources: bool = False
    solve_cloudflare: bool = True
    humanize: bool = True
    network_idle: bool = True
    headless: bool = True


class RenderResponse(BaseModel):
    html: str
    url: str
    status: int
    elapsed_ms: int
    cookies: dict = {}


# ── Auth middleware ──


def check_auth(authorization: Optional[str] = Header(None)):
    if not API_SECRET:
        return  # no secret configured = open access
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = authorization.removeprefix("Bearer ").strip()
    if token != API_SECRET:
        raise HTTPException(status_code=403, detail="Invalid token")


# ── Routes ──


@app.get("/health")
def health():
    return {"status": "ok", "service": "scrapling-proxy"}


@app.post("/render", response_model=RenderResponse)
def render(req: RenderRequest, authorization: Optional[str] = Header(None)):
    check_auth(authorization)

    # Lazy import so startup is fast even if scrapling takes a moment
    from scrapling.fetchers import StealthyFetcher

    logger.info(f"Rendering: {req.url}")
    start = time.time()

    try:
        page = StealthyFetcher.fetch(
            req.url,
            headless=req.headless,
            solve_cloudflare=req.solve_cloudflare,
            network_idle=req.network_idle,
            wait_selector=req.wait_selector if req.wait_selector else None,
            timeout=req.timeout,
            disable_resources=req.block_resources,
        )

        elapsed_ms = int((time.time() - start) * 1000)

        # page.body is the raw HTML, page.status is HTTP status
        html = page.body if hasattr(page, "body") else str(page)
        status = page.status if hasattr(page, "status") else 200
        cookies = page.cookies if hasattr(page, "cookies") else {}

        logger.info(
            f"Rendered {req.url} — {status} — {len(html)} bytes — {elapsed_ms}ms"
        )

        return RenderResponse(
            html=html,
            url=req.url,
            status=status,
            elapsed_ms=elapsed_ms,
            cookies=cookies if isinstance(cookies, dict) else {},
        )

    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        logger.error(f"Render failed for {req.url}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


if __name__ == "__main__":
    port = int(os.environ.get("SCRAPLING_PORT", "8787"))
    logger.info(f"Starting Scrapling proxy on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
