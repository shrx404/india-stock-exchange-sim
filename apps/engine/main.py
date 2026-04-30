from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import asyncio
import json

from core.order import Order, Side, OrderType
from core.matcher import Matcher

app     = FastAPI(title="India Exchange Sim", version="0.1.0")
matcher = Matcher()

# allow React dev server to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- connected WebSocket clients ---
clients: list[WebSocket] = []


# ------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------

class PlaceOrderRequest(BaseModel):
    scrip:      str
    side:       str        # BUY | SELL
    order_type: str        # MARKET | LIMIT
    quantity:   int
    price:      float = 0.0
    trader_id:  str

class CancelOrderRequest(BaseModel):
    scrip:    str
    order_id: str


# ------------------------------------------------------------------
# REST routes
# ------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "exchange running"}


@app.post("/orders")
async def place_order(req: PlaceOrderRequest):
    try:
        order = Order(
            scrip      = req.scrip,
            side       = Side(req.side),
            order_type = OrderType(req.order_type),
            quantity   = req.quantity,
            price      = req.price,
            trader_id  = req.trader_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    trades = matcher.place_order(order)

    # broadcast updated depth to all WS clients
    depth = matcher.get_depth(req.scrip)
    await broadcast(depth)

    return {
        "order_id": order.order_id,
        "status"  : order.status.value,
        "trades"  : [
            {
                "trade_id" : t.trade_id,
                "price"    : t.price,
                "quantity" : t.quantity,
                "buyer_id" : t.buyer_id,
                "seller_id": t.seller_id,
            }
            for t in trades
        ],
    }


@app.delete("/orders")
def cancel_order(req: CancelOrderRequest):
    success = matcher.cancel_order(req.scrip, req.order_id)
    if not success:
        raise HTTPException(status_code=404, detail="Order not found or already done")
    return {"cancelled": req.order_id}


@app.get("/depth/{scrip}")
def get_depth(scrip: str, levels: int = 5):
    return matcher.get_depth(scrip.upper(), levels)


@app.get("/ltp/{scrip}")
def get_ltp(scrip: str):
    return {"scrip": scrip.upper(), "ltp": matcher.get_ltp(scrip.upper())}


# ------------------------------------------------------------------
# WebSocket — pushes order book updates to frontend
# ------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()   # keep connection alive
    except WebSocketDisconnect:
        clients.remove(websocket)


async def broadcast(data: dict):
    dead = []
    for ws in clients:
        try:
            await ws.send_text(json.dumps(data, default=str))
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.remove(ws)