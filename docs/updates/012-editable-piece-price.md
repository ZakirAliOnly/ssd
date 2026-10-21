# Update 012 - Piece-first selling prices

Both Add Product entry points accept a piece selling price. Packet selling price automatically fills as piece price times pieces per packet. Users can override the packet price; that override stays in place when the piece price or packet size changes. Use calculated price restores automatic calculation. Save piece and packet prices independently so invoice selling units use the correct price. Stock and cost remain entered per packet; margin uses packet price and packet cost. New forms reset the override. No migration required.
