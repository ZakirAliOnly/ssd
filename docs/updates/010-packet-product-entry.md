# Update 010 - Packet product entry

Both Add Product entry points omit box size and box selling price. Packaged products take pieces per packet, packet cost, packet selling price and stock quantity in packets. The piece selling price is calculated automatically (rounded to two decimal places). Stock and cost convert to base pieces on save so existing FIFO and invoice unit conversions continue to work. For example, 10 packets of 12 pieces at Rs 120 per packet save 120 pieces at Rs 10 per piece, with the packet price preserved.

Existing product editing and historical box products retain their existing behavior. No database migration is required.
