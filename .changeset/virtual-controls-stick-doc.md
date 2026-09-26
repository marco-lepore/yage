---
"@yagejs-addons/virtual-controls": patch
---

Documentation examples read `controls.stick(id)?.value`, since `stick()` returns `undefined` for an unknown id, and describe that an idle gamepad does not hide the virtual stick.
