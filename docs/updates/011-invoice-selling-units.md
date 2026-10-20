# Update 011 - Invoice selling units

Party and walk-in invoices show an explicit Sell in selector and label rates per selected unit. Selecting Piece uses the piece selling price; selecting Packet uses the packet price (or piece price times packet size as fallback). Quantity is the number of selected units. Line amounts recalculate as quantity times the selected rate, with existing discounts applied. Saved lines retain their unit and conversion for stock deduction and history.

Packets are selectable even when a packet contains one piece. Legacy box products remain supported. No database migration is required.
