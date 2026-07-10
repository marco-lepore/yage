---
"@yagejs-addons/virtual-controls": minor
---

The overlay's screen-space layer (`"virtual-controls"`) moved from order 1050 to 1080: above the inventory addon's layers (1050–1070), below the dialogue addon's chrome (1100). Order 1050 collided with the inventory panel layer, so which drew on top depended on insertion order. Scenes that pin the layer by spreading `VIRTUAL_CONTROLS_LAYERS` pick up the new order automatically; only code that hardcoded `order: 1050` needs updating.
