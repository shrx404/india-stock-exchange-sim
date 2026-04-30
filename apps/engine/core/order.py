from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
import uuid


class Side(Enum):
    BUY  = "BUY"
    SELL = "SELL"


class OrderType(Enum):
    MARKET = "MARKET"
    LIMIT  = "LIMIT"


class OrderStatus(Enum):
    PENDING   = "PENDING"
    PARTIAL   = "PARTIAL"
    FILLED    = "FILLED"
    CANCELLED = "CANCELLED"


@dataclass
class Order:
    scrip:      str
    side:       Side
    order_type: OrderType
    quantity:   int
    price:      float        # 0.0 for MARKET orders
    trader_id:  str

    order_id:   str         = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp:  datetime    = field(default_factory=datetime.utcnow)
    filled_qty: int         = 0
    visible_qty: int        = 0         # 0 means same as quantity
    status:     OrderStatus = OrderStatus.PENDING

    @property
    def pending_qty(self) -> int:
        return self.quantity - self.filled_qty

    @property
    def is_active(self) -> bool:
        return self.status in (OrderStatus.PENDING, OrderStatus.PARTIAL)

    def __repr__(self):
        return (
            f"Order({self.side.value} {self.pending_qty}x {self.scrip} "
            f"@ ₹{self.price} [{self.status.value}])"
        )


# --- smoke test ---
if __name__ == "__main__":
    o = Order(
        scrip="RELIANCE",
        side=Side.BUY,
        order_type=OrderType.LIMIT,
        quantity=10,
        price=2950.00,
        trader_id="trader_human"
    )
    print(o)
    print("pending_qty:", o.pending_qty)
    print("is_active  :", o.is_active)
    print("order_id   :", o.order_id)

    # Expected:
    # Order(BUY 10x RELIANCE @ ₹2950.0 [PENDING])
    # pending_qty: 10
    # is_active  : True
    # order_id   : <some-uuid>