from dataclasses import dataclass, field
from datetime import datetime
import uuid


@dataclass
class Trade:
    scrip:      str
    buy_order:  str      # order_id
    sell_order: str      # order_id
    price:      float
    quantity:   int
    buyer_id:   str
    seller_id:  str

    trade_id:   str      = field(default_factory=lambda: str(uuid.uuid4()))
    traded_at:  datetime = field(default_factory=datetime.utcnow)

    @property
    def value(self) -> float:
        return round(self.price * self.quantity, 2)

    def __repr__(self):
        return (
            f"Trade({self.scrip} {self.quantity} @ ₹{self.price} "
            f"| buyer={self.buyer_id} seller={self.seller_id})"
        )


# --- smoke test ---
if __name__ == "__main__":
    t = Trade(
        scrip="TCS",
        buy_order="uuid-buy-123",
        sell_order="uuid-sell-456",
        price=3800.50,
        quantity=5,
        buyer_id="trader_human",
        seller_id="bot_mm_01"
    )
    print(t)
    print("trade value: ₹", t.value)

    # Expected:
    # Trade(TCS 5 @ ₹3800.5 | buyer=trader_human seller=bot_mm_01)
    # trade value: ₹ 19002.5